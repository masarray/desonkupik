# Contributing

Thank you for helping improve DeSonKuPik.

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

## Desktop builds

```bash
npm run desktop:win
npm run desktop:mac
npm run desktop:linux
```

macOS packages should be built on macOS. Windows packages should be built on Windows for the most reliable result.
