# Photo Globe — 웹사이트용 임베드 에셋

회전하는 사진 카드 지구본. 각 카드는 **자기 폴더의 사진**으로 크로스페이드 슬라이드쇼를 돌립니다.
빌드 도구·프레임워크 불필요 — 정적 파일이라 어느 웹사이트에나 올릴 수 있습니다.

## 폴더 구조
```
photo-globe/
├── index.html        데모/스탠드얼론 페이지
├── photo-globe.js    위젯 본체 (이것만 있으면 됨)
├── server.mjs        로컬 미리보기용 정적 서버 (배포엔 불필요)
├── manifest.json     폴더 → 카드 매핑 (스크립트가 생성)
└── cards/
    ├── card-01/  ← 이 카드가 돌릴 사진들을 여기에
    ├── card-02/
    └── … card-72/
```

## 사진 → 슬라이드쇼: 3단계
1. **사진 넣기** — `cards/card-NN/` 폴더마다 이미지를 넣습니다 (`.jpg/.png/.webp/.gif/.avif`).
   세로(폰) 비율이 카드(54×86)에 가장 잘 맞습니다. 사진이 2장 이상인 카드만 슬라이드쇼가 돕니다.
2. **매니페스트 다시 빌드** — 사진을 추가/삭제할 때마다 실행:
   ```bash
   node "/Users/test/Desktop/design_handoff_photo_globe/scripts/build-manifest.mjs" ~/Desktop/photo-globe
   ```
3. **확인** — 로컬 미리보기:
   ```bash
   node ~/Desktop/photo-globe/server.mjs      # http://localhost:5599
   ```
   사진이 없는 카드는 그라데이션 플레이스홀더로 표시됩니다 (의도된 폴백).

> ⚠️ 브라우저 보안상 `file://`로 직접 열면 `manifest.json`을 못 읽습니다.
> 반드시 위 서버나 실제 웹 호스팅처럼 **HTTP로** 열어야 합니다.

## 웹사이트에 임베드
파일을 사이트에 올린 뒤(`photo-globe.js` + `manifest.json` + `cards/` 함께), 원하는 위치에:
```html
<div data-photo-globe data-manifest="/path/to/manifest.json"
     style="width:100%; height:640px;"></div>
<script src="/path/to/photo-globe.js"></script>
```
또는 코드로:
```js
PhotoGlobe.create({
  mount: document.querySelector('#globe'),
  manifestUrl: '/path/to/manifest.json'
});
```

### 옵션 (data-* 속성 또는 create() 인자)
| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `data-manifest` / `manifestUrl` | `manifest.json` | 매니페스트 경로 |
| `data-slideshow` / `slideshow` | `true` | 슬라이드쇼 on/off |
| `data-slide-seconds` / `slideSeconds` | `4` | 전환 간격(초, 1.5–10) |
| `data-auto-speed` / `autoSpeed` | `0.15` | 자동 회전 속도(°/프레임, 0–0.6) |
| `data-radius` / `radius` | `330` | 구 반지름(px, 220–480) |
| `data-tile-count` / `tileCount` | 매니페스트 카드 수(없으면 72) | 카드 개수 |
| `data-show-labels` / `showLabels` | `true` | 카드 번호 라벨 표시 |

카드 *i* ↔ `manifest.cards[i]` ↔ `cards/card-(i+1)/`.
