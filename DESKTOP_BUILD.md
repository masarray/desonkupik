# DeSonKuPik Desktop Build

Project ini sudah ditambahkan wrapper **Electron** agar web app Vite/React bisa menjadi desktop app.

## Brand

- App name: **DeSonKuPik**
- Publisher: **SonKuPik**
- App ID: `com.sonkupik.desonkupik`
- Icon source: `build/icon.png`
- Windows icon: `build/icon.ico`
- macOS icon: `build/icon.icns`

## Install dependency

Gunakan `npm ci` untuk install dependency sesuai lockfile.

```bash
npm ci
```

## Development desktop mode

```bash
npm run desktop:dev
```

Command ini menjalankan Vite di `127.0.0.1:5173`, lalu membuka Electron window.

## Build web only

```bash
npm run build
```

Output web tetap di folder `dist/` dan masih aman untuk Cloudflare Pages.

## Build desktop Windows

```bash
npm run desktop:win
```

Output ada di folder `release/`:

- `DeSonKuPik Setup ... .exe`
- `DeSonKuPik ... portable ... .exe`

## Build desktop macOS

Jalankan di mesin macOS:

```bash
npm run desktop:mac
```

Output ada di folder `release/`:

- `.dmg`
- `.pkg`

Untuk distribusi profesional macOS, gunakan Apple Developer certificate agar tidak kena warning Gatekeeper.

## Fitur desktop yang sudah diaktifkan

- Native app window dengan icon DeSonKuPik.
- Native app menu: Open Audio, Export WAV, Export MP3, New Session, Quick Guide, About.
- Native Open File dialog untuk audio.
- Native Open File dialog untuk import settings JSON.
- Native Save As dialog untuk export WAV, MP3, dan settings JSON.
- Secure preload bridge: `contextIsolation: true`, `nodeIntegration: false`.
- Vite `base: "./"` agar build `dist/index.html` bisa dibuka dari Electron production.
