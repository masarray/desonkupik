# Contributing

Thank you for helping improve DeSonKuPik.

This project welcomes practical improvements, bug reports, documentation fixes, UI polish, accessibility improvements, and build/release fixes.

## Development setup

```bash
npm ci
npm run dev
```

Desktop development:

```bash
npm run desktop:dev
```

## Quality checks

Run these before opening a pull request:

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

macOS packages should be built on macOS. Windows packages should be built on Windows for the most reliable result.

## Contribution rules

- Keep the public app name as DeSonKuPik.
- Do not add unrelated branding.
- Do not commit build outputs such as `dist/`, `release/`, installers, or `node_modules/`.
- Keep UI changes lightweight and readable.
- Prefer clear explanations over large unexplained rewrites.

## Licensing of contributions

By submitting a pull request, you agree that your contribution can be distributed under the same source license used by this repository.

## Developer Certificate of Origin style sign-off

For larger changes, please add a sign-off line to your commit message:

```text
Signed-off-by: Your Name <your.email@example.com>
```

This means you are allowed to submit the contribution and you agree to the project contribution terms.

## Good first contributions

- Improve documentation for beginners.
- Fix installation instructions.
- Improve accessibility labels.
- Improve responsive layout.
- Add tests or build validation.
- Improve release notes.
