/*
 * photo-globe.js — embeddable rotating photo-sphere with per-card slideshows.
 *
 * Faithful port of the "Photo Globe" design handoff, adapted for production:
 * each card is bound to its OWN folder via manifest.json (card i shows a
 * cross-fading slideshow of manifest.cards[i]). No build step, no framework.
 *
 * Usage (auto-init):
 *   <div data-photo-globe data-manifest="manifest.json"></div>
 *   <script src="photo-globe.js"></script>
 *
 * Usage (manual):
 *   PhotoGlobe.create({ mount: el, manifestUrl: 'manifest.json' });
 *
 * Options (all optional):
 *   mount        HTMLElement to render into (required for create())
 *   manifestUrl  path to manifest.json (default 'manifest.json')
 *   baseUrl      base for resolving image paths (default = manifest's folder)
 *   slideshow    run per-card slideshows (default true)
 *   slideSeconds seconds between slides, 1.5–10 (default 4)
 *   autoSpeed    auto-rotate °/frame, 0–0.6 (default 0.15)
 *   radius       sphere radius px, 220–480 (default 330)
 *   tileCount    number of cards (default = manifest length, else 72)
 *   showLabels   show 01,02,… labels on cards (default true)
 */
(function (global) {
  'use strict';

  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  var TW = 54, TH = 86;      // card size (px)

  function num(v, d) { return (typeof v === 'number' && !isNaN(v)) ? v : d; }
  function bool(v, d) { return (typeof v === 'boolean') ? v : d; }

  // Resolve the folder that a manifest.json lives in, for relative image paths.
  function dirOf(url) {
    var i = url.lastIndexOf('/');
    return i >= 0 ? url.slice(0, i + 1) : '';
  }

  function PhotoGlobe(opts) {
    opts = opts || {};
    this.mount = opts.mount;
    if (!this.mount) throw new Error('PhotoGlobe: opts.mount is required');

    this.manifestUrl = opts.manifestUrl || 'manifest.json';
    this.baseUrl = (typeof opts.baseUrl === 'string') ? opts.baseUrl : dirOf(this.manifestUrl);

    this.slideshow = bool(opts.slideshow, true);
    this.slideMs = num(opts.slideSeconds, 4) * 1000;
    this.autoSpeed = num(opts.autoSpeed, 0.15);
    this.radius = num(opts.radius, 330);
    this.showLabels = bool(opts.showLabels, true);
    this.tileCountOpt = (typeof opts.tileCount === 'number') ? Math.max(12, Math.round(opts.tileCount)) : null;

    this.cards = null;        // per-card image url arrays (from manifest)
    this.tiles = [];
    this.timers = [];
    this.yaw = 20; this.pitch = -6; this.vYaw = 0; this.vPitch = 0; this.dragging = false;
    this.paused = false;      // frozen while the lightbox is open
    this.titles = [];
    this.destroyed = false;

    this._buildScene();
    this._loadManifest();
  }

  PhotoGlobe.prototype._buildScene = function () {
    var mount = this.mount;
    // Ensure the mount can host an absolutely-positioned 3D scene.
    var cs = global.getComputedStyle ? getComputedStyle(mount) : null;
    if (cs && cs.position === 'static') mount.style.position = 'relative';
    mount.style.overflow = mount.style.overflow || 'hidden';
    mount.style.userSelect = 'none';
    mount.style.touchAction = 'none';

    var scene = document.createElement('div');
    scene.style.cssText =
      'position:absolute;inset:0;perspective:2200px;perspective-origin:50% 50%;' +
      'cursor:grab;touch-action:none;';
    mount.appendChild(scene);
    this.scene = scene;
    this._attach();
    this._startLoop();
  };

  PhotoGlobe.prototype._loadManifest = function () {
    var self = this;
    fetch(this.manifestUrl, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var cards = (data && Array.isArray(data.cards)) ? data.cards : [];
        self.cards = cards.map(function (arr) {
          return (Array.isArray(arr) ? arr : []).map(function (p) { return self._resolve(p); });
        });
        // Optional per-card titles (folder names) — shown in the lightbox.
        self.titles = (data && Array.isArray(data.titles)) ? data.titles.map(function (t) {
          return String(t).replace(/^\s*\d+\s*[-–·.]\s*/, '');   // strip leading "NN - "
        }) : [];
        self.build();
      })
      .catch(function (err) {
        // No manifest yet (e.g. before build-manifest.mjs is run): show the
        // gradient-placeholder globe so the asset still looks intentional.
        console.warn('[PhotoGlobe] could not load manifest (' + self.manifestUrl + '): ' + err.message +
                     ' — showing placeholder globe.');
        self.cards = null;
        self.build();
      });
  };

  PhotoGlobe.prototype._resolve = function (p) {
    if (/^([a-z]+:)?\/\//i.test(p) || p.charAt(0) === '/' || p.indexOf('data:') === 0) return p;
    return this.baseUrl + p;
  };

  PhotoGlobe.prototype._count = function () {
    if (this.tileCountOpt != null) return this.tileCountOpt;
    if (this.cards && this.cards.length) return this.cards.length;
    return 72;
  };

  // Paint slide k of a card's own pool onto a layer.
  PhotoGlobe.prototype._setSlide = function (layer, i, k, pool) {
    if (pool && pool.length) {
      var url = pool[((k % pool.length) + pool.length) % pool.length];
      layer.style.backgroundImage = 'url("' + url.replace(/"/g, '\\"') + '")';
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
    } else {
      // Placeholder gradient for empty card folders.
      var hue = (i * 47 + k * 123) % 360;
      layer.style.backgroundImage = 'none';
      layer.style.background = 'linear-gradient(150deg, hsl(' + hue + ' 58% 66%), hsl(' + ((hue + 42) % 360) + ' 52% 46%))';
    }
  };

  PhotoGlobe.prototype.build = function () {
    var scene = this.scene;
    if (!scene) return;
    this._clearTimers();
    scene.innerHTML = '';

    var globe = document.createElement('div');
    globe.style.cssText = 'position:absolute;top:50%;left:50%;transform-style:preserve-3d;will-change:transform;';
    scene.appendChild(globe);
    this.globe = globe;

    var N = this._count();
    var R = this.radius;
    var labels = this.showLabels;
    this.tiles = [];

    for (var i = 0; i < N; i++) {
      var y = 1 - (i / (N - 1)) * 2;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var t = GOLDEN * i;
      var x = Math.cos(t) * r;
      var z = Math.sin(t) * r;
      var lat = -Math.asin(y) * 180 / Math.PI;
      var lon = Math.atan2(x, z) * 180 / Math.PI;

      // Each card's own image pool (from its folder in the manifest).
      var pool = (this.cards && this.cards[i] && this.cards[i].length) ? this.cards[i] : null;
      var slideCount = pool ? pool.length : 3;

      var el = document.createElement('div');
      el.style.cssText =
        'position:absolute;left:' + (-TW / 2) + 'px;top:' + (-TH / 2) + 'px;width:' + TW + 'px;height:' + TH + 'px;' +
        'transform:rotateY(' + lon + 'deg) rotateX(' + lat + 'deg) translateZ(' + R + 'px);' +
        'overflow:hidden;border-radius:3px;box-shadow:0 6px 18px rgba(20,18,10,0.16);will-change:opacity,filter;';

      var base = document.createElement('div');
      base.style.cssText = 'position:absolute;inset:0;';
      var over = document.createElement('div');
      over.style.cssText = 'position:absolute;inset:0;opacity:0;transition:opacity 0.9s ease;';
      el.appendChild(base);
      el.appendChild(over);

      var startK = pool ? (i % slideCount) : (i % 3);
      this._setSlide(base, i, startK, pool);

      if (!pool) {
        var stripe = document.createElement('div');
        stripe.style.cssText = 'position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(255,255,255,0.09) 0 6px,transparent 6px 13px);pointer-events:none;';
        el.appendChild(stripe);
      }
      if (labels) {
        var lab = document.createElement('div');
        lab.textContent = String(i + 1).padStart(2, '0');
        lab.style.cssText = 'position:absolute;left:6px;bottom:5px;font:700 9px "Space Mono",monospace;color:rgba(255,255,255,0.9);letter-spacing:0.05em;text-shadow:0 1px 2px rgba(0,0,0,0.35);pointer-events:none;';
        el.appendChild(lab);
      }

      globe.appendChild(el);
      var tile = { el: el, base: base, over: over, nx: x, ny: y, nz: z, k: startK, pool: pool,
                   title: (this.titles && this.titles[i]) ? this.titles[i] : '' };
      el._tile = tile;                              // for click → lightbox
      if (pool) el.style.cursor = 'pointer';        // hint clickable cards
      this.tiles.push(tile);

      // Only animate cards that actually have >1 image of their own.
      if (this.slideshow && pool && slideCount > 1) {
        this._scheduleSlide(tile, i, slideCount);
      }
    }
  };

  PhotoGlobe.prototype._scheduleSlide = function (tile, i, slideCount) {
    var self = this;
    var base = this.slideMs;
    var delay = base * (0.5 + Math.random()) + i * 60;
    function tick() {
      var nextK = tile.k + 1;
      self._setSlide(tile.over, i, nextK, tile.pool);
      void tile.over.offsetWidth; // force reflow so the transition runs
      tile.over.style.opacity = '1';
      var commit = setTimeout(function () {
        self._setSlide(tile.base, i, nextK, tile.pool);
        tile.over.style.opacity = '0';
        tile.k = nextK;
      }, 900);
      self.timers.push(commit);
      var next = setTimeout(tick, base * (0.7 + Math.random() * 0.9));
      self.timers.push(next);
    }
    var first = setTimeout(tick, delay);
    this.timers.push(first);
  };

  PhotoGlobe.prototype._clearTimers = function () {
    (this.timers || []).forEach(function (t) { clearTimeout(t); });
    this.timers = [];
  };

  PhotoGlobe.prototype._attach = function () {
    var self = this;
    var scene = this.scene;
    var lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false;

    function down(e) {
      self.dragging = true;
      self.vYaw = 0; self.vPitch = 0;
      lastX = downX = e.clientX; lastY = downY = e.clientY;
      moved = false;
      scene.style.cursor = 'grabbing';
      if (e.cancelable) e.preventDefault();
    }
    this._move = function (e) {
      if (!self.dragging) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 5) moved = true;
      var k = 0.26;
      self.yaw += dx * k;
      self.pitch -= dy * k;
      self._clampPitch();
      self.vYaw = dx * k;
      self.vPitch = -dy * k;
    };
    this._up = function (e) {
      if (!self.dragging) return;
      self.dragging = false;
      scene.style.cursor = 'grab';
      if (!moved) {                    // a tap (not a drag) → open the photo
        self.vYaw = 0; self.vPitch = 0;
        self._handleTap(e);
      }
    };
    scene.addEventListener('pointerdown', down);
    global.addEventListener('pointermove', this._move);
    global.addEventListener('pointerup', this._up);
  };

  PhotoGlobe.prototype._clampPitch = function () {
    if (this.pitch > 88) this.pitch = 88;
    if (this.pitch < -88) this.pitch = -88;
  };

  PhotoGlobe.prototype._startLoop = function () {
    var self = this;
    function step() {
      if (self.destroyed) return;
      var auto = (self.dragging || self.paused) ? 0 : self.autoSpeed;
      if (!self.paused) {                            // freeze rotation while lightbox is open
        self.yaw += self.vYaw + auto;
        self.pitch += self.vPitch;
        self._clampPitch();
        if (!self.dragging) { self.vYaw *= 0.94; self.vPitch *= 0.94; }
      }

      if (self.globe) {
        self.globe.style.transform = 'rotateX(' + self.pitch + 'deg) rotateY(' + self.yaw + 'deg)';
      }

      var yr = self.yaw * Math.PI / 180, pr = self.pitch * Math.PI / 180;
      var sy = Math.sin(yr), cy = Math.cos(yr), sp = Math.sin(pr), cp = Math.cos(pr);
      var tiles = self.tiles || [];
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        var vz = -t.nx * sy + t.nz * cy;
        var wz = t.ny * sp + vz * cp;
        var dep = (wz + 1) / 2;                // 0 back -> 1 front
        t.el.style.opacity = (0.14 + 0.86 * dep).toFixed(3);
        t.el.style.filter = 'brightness(' + (0.68 + 0.32 * dep).toFixed(3) + ')';
      }
      self.raf = requestAnimationFrame(step);
    }
    this.raf = requestAnimationFrame(step);
  };

  // ---- Lightbox (click a card → popup, arrows / scroll / keys to browse) ----

  PhotoGlobe.prototype._handleTap = function (e) {
    var node = document.elementFromPoint(e.clientX, e.clientY);
    while (node && node !== this.scene && !node._tile) node = node.parentNode;
    if (node && node._tile && node._tile.pool && node._tile.pool.length) {
      this._openLightbox(node._tile);
    }
  };

  PhotoGlobe.prototype._ensureLightbox = function () {
    if (this.lb) return this.lb;
    var self = this;

    function mkArrow(dir) {
      var b = document.createElement('button');
      b.setAttribute('aria-label', dir === 'left' ? 'Previous' : 'Next');
      b.style.cssText = 'flex:0 0 auto;width:46px;height:46px;border-radius:50%;cursor:pointer;' +
        'border:1px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.08);color:#fff;' +
        'display:flex;align-items:center;justify-content:center;transition:background 0.15s ease;padding:0;';
      b.onmouseenter = function () { b.style.background = 'rgba(255,255,255,0.22)'; };
      b.onmouseleave = function () { b.style.background = 'rgba(255,255,255,0.08)'; };
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="' +
        (dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6') + '"/></svg>';
      return b;
    }

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:none;' +
      'align-items:center;justify-content:center;background:rgba(20,18,10,0.82);' +
      'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);' +
      "font-family:'Space Mono',monospace;";

    var stage = document.createElement('div');
    stage.style.cssText = 'position:relative;display:flex;align-items:center;gap:18px;';

    var img = document.createElement('img');
    img.style.cssText = 'max-width:78vw;max-height:82vh;border-radius:6px;background:#fff;' +
      'box-shadow:0 20px 60px rgba(0,0,0,0.5);user-select:none;-webkit-user-drag:none;display:block;';

    var prev = mkArrow('left');
    var next = mkArrow('right');
    stage.appendChild(prev); stage.appendChild(img); stage.appendChild(next);
    overlay.appendChild(stage);

    var title = document.createElement('div');
    title.style.cssText = 'position:absolute;top:22px;left:0;right:0;text-align:center;padding:0 70px;' +
      'color:rgba(255,255,255,0.92);font-size:12px;letter-spacing:0.12em;text-transform:uppercase;pointer-events:none;';
    overlay.appendChild(title);

    var counter = document.createElement('div');
    counter.style.cssText = 'position:absolute;bottom:26px;left:0;right:0;text-align:center;' +
      'color:rgba(255,255,255,0.85);font-size:12px;letter-spacing:0.2em;pointer-events:none;';
    overlay.appendChild(counter);

    var close = document.createElement('button');
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&#10005;';
    close.style.cssText = 'position:absolute;top:16px;right:20px;width:38px;height:38px;border-radius:50%;' +
      'border:1px solid rgba(255,255,255,0.35);background:rgba(255,255,255,0.06);color:#fff;' +
      'font-size:15px;line-height:1;cursor:pointer;padding:0;';
    overlay.appendChild(close);

    document.body.appendChild(overlay);

    prev.onclick = function (e) { e.stopPropagation(); self._step(-1); };
    next.onclick = function (e) { e.stopPropagation(); self._step(1); };
    close.onclick = function (e) { e.stopPropagation(); self._closeLightbox(); };
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target === stage) self._closeLightbox();  // click backdrop
    });

    // Scroll / trackpad → step through the slideshow's photos.
    var wheelAcc = 0, wheelLock = false;
    overlay.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (wheelLock) return;
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) > 40) {
        self._step(wheelAcc > 0 ? 1 : -1);
        wheelAcc = 0; wheelLock = true;
        setTimeout(function () { wheelLock = false; }, 200);
      }
    }, { passive: false });

    // Touch swipe (mobile).
    var tsx = 0;
    overlay.addEventListener('touchstart', function (e) { tsx = e.changedTouches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - tsx;
      if (Math.abs(dx) > 40) self._step(dx < 0 ? 1 : -1);
    }, { passive: true });

    this._lbKey = function (e) {
      if (overlay.style.display === 'none') return;
      if (e.key === 'ArrowRight') self._step(1);
      else if (e.key === 'ArrowLeft') self._step(-1);
      else if (e.key === 'Escape') self._closeLightbox();
    };
    document.addEventListener('keydown', this._lbKey);

    this.lb = { overlay: overlay, img: img, prev: prev, next: next, counter: counter, title: title };
    return this.lb;
  };

  PhotoGlobe.prototype._openLightbox = function (tile) {
    var lb = this._ensureLightbox();
    var len = tile.pool.length;
    this._lbPool = tile.pool;
    this._lbIndex = ((tile.k % len) + len) % len;    // open on the photo currently shown
    this._lbTitle = tile.title || '';
    this.paused = true;
    lb.overlay.style.display = 'flex';
    this._renderLightbox();
  };

  PhotoGlobe.prototype._renderLightbox = function () {
    var lb = this.lb, pool = this._lbPool, len = pool.length;
    var i = ((this._lbIndex % len) + len) % len;
    this._lbIndex = i;
    lb.img.src = pool[i];
    lb.counter.textContent = (i + 1) + ' / ' + len;
    lb.title.textContent = this._lbTitle;
    var show = len > 1 ? 'flex' : 'none';
    lb.prev.style.display = show;
    lb.next.style.display = show;
  };

  PhotoGlobe.prototype._step = function (d) {
    if (!this._lbPool) return;
    this._lbIndex += d;
    this._renderLightbox();
  };

  PhotoGlobe.prototype._closeLightbox = function () {
    if (!this.lb) return;
    this.lb.overlay.style.display = 'none';
    this.lb.img.src = '';
    this._lbPool = null;
    this.paused = false;
  };

  PhotoGlobe.prototype.destroy = function () {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this._clearTimers();
    global.removeEventListener('pointermove', this._move);
    global.removeEventListener('pointerup', this._up);
    if (this._lbKey) document.removeEventListener('keydown', this._lbKey);
    if (this.lb && this.lb.overlay.parentNode) this.lb.overlay.parentNode.removeChild(this.lb.overlay);
    if (this.scene && this.scene.parentNode) this.scene.parentNode.removeChild(this.scene);
  };

  var API = {
    create: function (opts) { return new PhotoGlobe(opts); },
    // Auto-init every <div data-photo-globe> on the page.
    autoInit: function (root) {
      root = root || document;
      var nodes = root.querySelectorAll('[data-photo-globe]');
      var made = [];
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.__photoGlobe) continue;
        var d = el.dataset;
        var inst = new PhotoGlobe({
          mount: el,
          manifestUrl: d.manifest || undefined,
          baseUrl: d.base != null ? d.base : undefined,
          slideshow: d.slideshow != null ? d.slideshow !== 'false' : undefined,
          slideSeconds: d.slideSeconds != null ? parseFloat(d.slideSeconds) : undefined,
          autoSpeed: d.autoSpeed != null ? parseFloat(d.autoSpeed) : undefined,
          radius: d.radius != null ? parseFloat(d.radius) : undefined,
          tileCount: d.tileCount != null ? parseInt(d.tileCount, 10) : undefined,
          showLabels: d.showLabels != null ? d.showLabels !== 'false' : undefined
        });
        el.__photoGlobe = inst;
        made.push(inst);
      }
      return made;
    }
  };

  global.PhotoGlobe = API;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { API.autoInit(); });
  } else {
    API.autoInit();
  }
})(typeof window !== 'undefined' ? window : this);
