# Release Checklist

Use this checklist before publishing a DeSonKuPik release.

## Version

- [ ] Confirm `package.json` version.
- [ ] Confirm release tag format is `vX.Y.Z`.
- [ ] Confirm changelog or release notes are ready.

## Validation

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`

## Desktop packaging

- [ ] Windows build completes.
- [ ] macOS x64 build completes.
- [ ] macOS arm64 build completes.
- [ ] Linux build completes.
- [ ] Artifacts are uploaded.
- [ ] `SHA256SUMS.txt` is generated.

## Manual smoke test

- [ ] App opens.
- [ ] Native file open works.
- [ ] Audio preview works.
- [ ] Export works.
- [ ] About/version information is correct.

## Public release quality

- [ ] README download links are correct.
- [ ] Landing page is deployed.
- [ ] Known issues are documented.
- [ ] Unsigned build warning is mentioned when applicable.
