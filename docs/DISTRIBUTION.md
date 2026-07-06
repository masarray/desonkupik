# Distribution Guide

This guide explains what should be checked before publishing a public DeSonKuPik release.

## Release artifacts

The release workflow builds packages for:

- Windows
- macOS x64
- macOS arm64
- Linux

The publish job also generates `SHA256SUMS.txt` so users can verify downloaded files.

## Windows

Current public builds may be unsigned. This can trigger Windows SmartScreen.

For stronger public distribution, add:

- Windows code signing certificate
- signed installer
- signed portable executable when possible

## macOS

Current public builds may be unsigned. This can trigger Gatekeeper.

For stronger public distribution, add:

- Apple Developer ID signing
- notarization
- stapling

## Linux

Recommended release artifacts:

- AppImage
- DEB
- tar.gz
- SHA256 checksums

## Before publishing

- Confirm version in `package.json`.
- Run CI.
- Run desktop build workflow.
- Confirm release artifacts exist.
- Confirm `SHA256SUMS.txt` is attached.
- Test install/open/export on at least one target platform when possible.

## User communication

Release notes should clearly mention:

- New features
- Fixes
- Known issues
- Whether builds are signed or unsigned
- Checksums
