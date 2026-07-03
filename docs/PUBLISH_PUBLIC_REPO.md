# Publish DeSonKuPik as a Public GitHub Repository

Recommended repository name:

```text
desonkupik
```

Recommended GitHub full name:

```text
masarray/desonkupik
```

## Option A — GitHub CLI

From the project root:

```bash
git init
git add .
git commit -m "Initial DeSonKuPik desktop release project"
gh repo create masarray/desonkupik --public --source . --remote origin --push
```

## Option B — GitHub web UI

1. Create a new public repository named `desonkupik`.
2. Do not initialize it with README, license, or `.gitignore` because this project already includes them.
3. From the project root, run:

```bash
git init
git add .
git commit -m "Initial DeSonKuPik desktop release project"
git branch -M main
git remote add origin https://github.com/masarray/desonkupik.git
git push -u origin main
```

## First automated release

```bash
npm version patch
git push --follow-tags
```

GitHub Actions will build Windows, macOS, and Linux installers and attach them to the GitHub Release.

## Notes

Early builds are unsigned. Windows SmartScreen and macOS Gatekeeper may show warnings until code signing and notarization are configured.
