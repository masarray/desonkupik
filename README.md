# DeSonKuPik

DeSonKuPik is a lightweight online audio mastering web app for `desonkupik.pages.dev`.

Target workflow:

1. Open an audio file in the browser.
2. The default **Mastering** preset starts immediately: broad corrective EQ, vocal-body guard, gentle glue compression, premium color, source-protected width, and true-peak-safe limiting.
3. Preview through EQ, compressor, color, source-protected stereo width, and limiter.
4. Export a peak-safe 24-bit WAV master.

## Local development

```bash
npm ci
npm run dev
```

## Validation

```bash
npm run typecheck
npm run build
npm run lint
```

## Cloudflare Pages

Use these settings for `desonkupik.pages.dev`:

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: 22 or newer recommended

The repository includes Cloudflare-ready files:

- `wrangler.toml` with `pages_build_output_dir = "dist"`
- `public/_redirects` for SPA fallback
- `public/_headers` for safe static headers and immutable Vite asset cache
- `public/robots.txt` and `public/sitemap.xml`

Optional direct deploy after Cloudflare login:

```bash
npm run cf:deploy
```

## Engineering notes

- Brand is DeSonKuPik only. Old extension/product names and template names should not appear in user-facing UI.

- Default preset is **Mastering**. It is tuned as a one-click studio chain: sub cleanup, controlled bass weight, 490 Hz vocal-body guard, smooth presence/detail, gentle glue compression, harmonic color, source-protected stereo width, and transparent limiting.
- Smart Headroom runs immediately after file decode, before the EQ/compressor/color/width/limiter chain. It uses a fast ITU/EBU-inspired gated loudness estimate plus exact sample-peak scan, then sets the file pre-gain toward roughly -18 LUFS while preserving about 6 dB peak headroom.
- The smart file pre-gain stage is file-specific and preserved when switching presets or A/B slots so every preset starts from the same clean gain-staged file level.
- Low-frequency stereo is protected. Mono bass behavior is implemented as gentle side-bus narrowing, not hard mono collapse.
- Live Output gain is not automatically attenuated by presets; it stays at 0 dB unless the user moves it or enables Gain Match. This keeps the mastered result audibly bigger during normal preview.
- Gain Match is an intentional A/B listening tool only. When enabled, it slowly trims the processed path so comparison stays fair while preserving about +0.7 dB perceived advantage for the mastered result.
- Offline export finalizes the WAV to a global streaming-safe studio target of about -14 LUFS integrated and -1 dBTP ceiling, then applies transparent peak-safe trim only when needed before 24-bit PCM encoding.

## Windows npm native binding fix

This project pins Vite to `6.3.5` to avoid the Vite 8/Rolldown native binding path that can fail on Windows when npm skips platform optional dependencies. The lock file includes Rollup Windows and Linux optional packages, and `.npmrc` keeps installs on the public npm registry with optional dependencies included.

Recommended Windows flow: extract this ZIP into a clean folder, then install from the included lock file.

If you are replacing files inside an existing folder, delete the old `node_modules` first and make sure the `package-lock.json` from this ZIP replaces the old lock file.

```powershell
rd /s /q node_modules
npm ci
npm run typecheck
npm run build
npm run lint
```

Do not delete the new lock file after extraction, and do not run `npm update` casually because it may upgrade Vite back to the newer Rolldown bundler line.
