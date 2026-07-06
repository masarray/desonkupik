# Notice

DeSonKuPik uses open-source packages from the JavaScript, React, Vite, Electron, and desktop packaging ecosystem.

Dependency information is listed in:

- `package.json`
- `package-lock.json`

## Important dependency groups

- Desktop runtime and packaging
- Web UI runtime
- Build tooling
- TypeScript and lint tooling
- Audio export tooling
- UI component and icon libraries

## Redistributors

If you package, fork, or redistribute DeSonKuPik, review the dependency metadata and include any required notices for your distribution channel.

## Suggested local check

After installing dependencies, you can inspect package license metadata with npm commands such as:

```bash
npm ls --all
npm view <package-name> license
```

This notice is a practical project reminder and does not replace dependency license files.
