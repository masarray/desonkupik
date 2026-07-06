<p align="center">
  <img src="docs/assets/icon.svg" width="96" alt="DeSonKuPik icon" />
</p>

<h1 align="center">DeSonKuPik</h1>

<p align="center">
  <strong>Beautiful one-click audio mastering for web and desktop.</strong><br />
  Open an audio file, preview a musical mastering chain, and export a polished WAV or MP3 master.
</p>

<p align="center">
  <a href="https://github.com/masarray/desonkupik/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/masarray/desonkupik/ci.yml?branch=main&label=CI&style=for-the-badge" /></a>
  <a href="https://github.com/masarray/desonkupik/actions/workflows/release.yml"><img alt="Desktop release build" src="https://img.shields.io/github/actions/workflow/status/masarray/desonkupik/release.yml?label=Desktop%20Build&style=for-the-badge" /></a>
  <a href="https://github.com/masarray/desonkupik/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/masarray/desonkupik?display_name=tag&style=for-the-badge" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-GPLv3-20d6ff?style=for-the-badge" /></a>
</p>

<p align="center">
  <a href="https://masarray.github.io/desonkupik/"><strong>Landing Page</strong></a> ·
  <a href="https://github.com/masarray/desonkupik/releases"><strong>Download</strong></a> ·
  <a href="docs/INSTALL.md"><strong>Install Guide</strong></a> ·
  <a href="docs/USER-GUIDE.md"><strong>User Guide</strong></a> ·
  <a href="docs/FAQ.md"><strong>FAQ</strong></a>
</p>

---

## What is DeSonKuPik?

**DeSonKuPik** is a beginner-friendly audio mastering app by **SonKuPik**. It runs as a web app and as a desktop app for Windows, macOS, and Linux using Electron.

The product idea is simple:

> **Open file → improve the sound → export a better master.**

It is designed for creators who want clearer, fuller, and more finished audio without starting from a complex DAW session.

## Who is it for?

- YouTubers who want cleaner voiceover or music audio.
- Podcasters who want speech to sound more controlled.
- Musicians who need quick demo mastering previews.
- Video editors who want audio to feel more finished before upload.
- Beginners who want a simple open-preview-export workflow.

## Highlights

- **One-click starting point** with a ready mastering chain.
- **Studio-style processing**: EQ, compressor, color, stereo width, and limiter.
- **Beginner-friendly workflow**: open, listen, adjust only if needed, export.
- **Desktop-ready** with native file open/export dialogs.
- **Web-ready** for Cloudflare Pages or static hosting.
- **Cross-platform release automation** for Windows, macOS, and Linux through GitHub Actions.
- **Release integrity helper** with generated SHA256 checksums for published artifacts.
- **Clear project governance** with separate source license, trademark policy, security policy, and business-use guidance.

## Desktop downloads

Official installers are published from GitHub Releases after a tagged release build.

| Platform | Recommended artifact | Notes |
|---|---|---|
| Windows | Setup `.exe` | Normal installer |
| Windows | Portable `.exe` | Run without installing |
| macOS | `.dmg` / `.pkg` | May show Gatekeeper warning if unsigned |
| Linux | `.AppImage` | Usually easiest for desktop use |
| Linux | `.deb` | Debian/Ubuntu-based systems |

Unsigned builds may show Windows SmartScreen or macOS Gatekeeper warnings. Production distribution should use Windows code signing and Apple notarization.

## Local development

```bash
npm ci
npm run dev
```

Desktop development:

```bash
npm run desktop:dev
```

## Build and validation

```bash
npm run typecheck
npm run lint
npm run build
```

Desktop builds:

```bash
npm run desktop:win
npm run desktop:mac
npm run desktop:linux
```

## Release workflow

A new release can be created with a version tag:

```bash
npm version patch
git push --follow-tags
```

The release workflow builds Windows, macOS, and Linux packages, generates checksums, and publishes them to GitHub Releases when triggered by a `v*.*.*` tag.

## Documentation

- [Install Guide](docs/INSTALL.md)
- [User Guide](docs/USER-GUIDE.md)
- [FAQ](docs/FAQ.md)
- [License FAQ](docs/LICENSE-FAQ.md)
- [Business Use](BUSINESS-USE.md)
- [Commercial Services](COMMERCIAL-SERVICES.md)
- [Distribution Guide](docs/DISTRIBUTION.md)
- [Release Checklist](docs/RELEASE-CHECKLIST.md)
- [Release Guide](docs/RELEASE.md)

## Licensing, trademark, and business use

- **Source code:** GPL-3.0-or-later. See [LICENSE](LICENSE).
- **Copyright:** see [COPYRIGHT.md](COPYRIGHT.md).
- **Trademark and brand assets:** see [TRADEMARK.md](TRADEMARK.md).
- **Business and enterprise scenarios:** see [BUSINESS-USE.md](BUSINESS-USE.md) and [COMMERCIAL-SERVICES.md](COMMERCIAL-SERVICES.md).

The source license covers source code. The official DeSonKuPik and SonKuPik brand identity is handled separately so users can fork the code without creating brand confusion.

## GitHub Pages landing page

The repository includes a bilingual SEO landing page under `docs/`.

```text
https://masarray.github.io/desonkupik/
```

## Governance and community

- [Governance](GOVERNANCE.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Security](SECURITY.md)
- [Supported Versions](SUPPORTED-VERSIONS.md)

## Engineering notes

- Brand is **DeSonKuPik** only. Legacy app names should not appear in public UI.
- The desktop production build uses relative Vite asset paths so packaged Electron loads the same UI as the web app.
- The app icon, visual identity, presets, and SonKuPik marks remain SonKuPik brand assets.
- Build outputs such as `dist/`, `release/`, installers, caches, and generated binaries are excluded from source control.

---

<p align="center">
  Made with care by <strong>SonKuPik</strong>.
</p>
