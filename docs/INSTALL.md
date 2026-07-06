# DeSonKuPik Install Guide

This guide is written for non-technical users.

## Download

Open the Releases page:

https://github.com/masarray/desonkupik/releases

Choose the file that matches your operating system.

## Windows

### Normal install

Download the file that looks like:

```text
DeSonKuPik-Setup-...-x64.exe
```

Run it and follow the installer.

### Portable mode

Download the file that looks like:

```text
DeSonKuPik-...-portable-x64.exe
```

Portable mode means you can run the app from a folder without installing it.

### Windows warning

Windows may show SmartScreen warning because community builds may be unsigned. This does not automatically mean the app is unsafe. It means Windows does not yet recognize the publisher certificate.

## macOS

Download `.dmg` or `.pkg` from Releases.

macOS may block unsigned builds. If that happens, open System Settings, go to Privacy & Security, and allow the app manually.

## Linux

### AppImage

AppImage is usually the easiest option.

```bash
chmod +x DeSonKuPik-*.AppImage
./DeSonKuPik-*.AppImage
```

### DEB

For Debian or Ubuntu based systems:

```bash
sudo dpkg -i DeSonKuPik-*.deb
```

## Build from source

```bash
npm ci
npm run build
npm run desktop:win
npm run desktop:mac
npm run desktop:linux
```

Use the command for your operating system only.
