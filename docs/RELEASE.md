# Release Guide

DeSonKuPik desktop builds are created by GitHub Actions.

## Normal release

1. Make sure `main` is clean and all changes are committed.
2. Bump the app version:

```bash
npm version patch
```

Use `minor` or `major` when needed.

3. Push the commit and tag:

```bash
git push --follow-tags
```

4. GitHub Actions will build:
   - Windows installer and portable `.exe`
   - macOS `.dmg` and `.pkg`
   - Linux `.AppImage`, `.deb`, and `.tar.gz`

5. After the workflow finishes, the files appear on the GitHub Releases page.

## Manual test build

Open the **Build Desktop Releases** workflow in GitHub Actions and choose **Run workflow**.
Manual workflow runs upload artifacts for 14 days. A public GitHub Release is created only when you push a version tag such as `v0.3.75`.

## Code signing notes

Current builds are unsigned by default:

- Windows may show Microsoft SmartScreen warnings until the app is code signed.
- macOS may show Gatekeeper warnings until the app is signed and notarized using an Apple Developer account.
- Linux AppImage and `.deb` can be distributed directly, but package signing can be added later.

For professional public distribution, add signing secrets in GitHub repository settings before enabling signed release builds.
