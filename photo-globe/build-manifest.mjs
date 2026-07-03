// build-manifest.mjs (app version — supports title-named card folders)
//
// Scans every subfolder of <ROOT>/cards/ (any name, e.g. "01 - My Post Title")
// and writes manifest.json in folder order. Card i of the globe shows a
// cross-fading slideshow of the images found in the i-th folder.
//
// Differs from the handoff script (which only matched card-NN): this accepts
// arbitrary folder names, sorts them numeric-aware (so an "NN - " prefix keeps
// blog order), and URL-encodes each path segment so spaces / Korean / special
// characters in titles don't break the image URLs in the browser.
//
// Usage:
//   node build-manifest.mjs [ROOT]
//   ROOT  the photo-globe root (default ~/Desktop/photo-globe)

import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = process.argv[2] || join(homedir(), 'Desktop', 'photo-globe');
const CARDS_DIR = join(ROOT, 'cards');
const IMG = /\.(jpe?g|png|webp|gif|avif)$/i;

if (!existsSync(CARDS_DIR)) {
  console.error(`No cards/ folder at ${CARDS_DIR}.`);
  process.exit(1);
}

const encPath = (parts) => parts.map(encodeURIComponent).join('/');

const cardDirs = readdirSync(CARDS_DIR)
  .filter((d) => !d.startsWith('.') && statSync(join(CARDS_DIR, d)).isDirectory())
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const titles = [];
const cards = cardDirs.map((dir) => {
  titles.push(dir);
  const files = readdirSync(join(CARDS_DIR, dir))
    .filter((f) => IMG.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return files.map((f) => 'cards/' + encPath([dir, f]));
});

const total = cards.reduce((n, c) => n + c.length, 0);
writeFileSync(join(ROOT, 'manifest.json'), JSON.stringify({ cards, titles }, null, 2));
console.log(`✅ Wrote manifest.json — ${cards.length} folders, ${total} images total.`);
cardDirs.forEach((dir, i) => {
  const n = cards[i].length;
  const flag = n === 0 ? ' ⚠ no images (placeholder)' : '';
  console.log(`   ${String(i + 1).padStart(2, '0')}. ${dir} — ${n} image${n === 1 ? '' : 's'}${flag}`);
});
