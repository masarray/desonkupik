# DeSonKuPik engineering notes

Target product: lightweight online audio mastering web app for `desonkupik.pages.dev`.

Keep the codebase brand-clean as **DeSonKuPik**. Do not reintroduce the old extension name or generic template names in user-facing UI, metadata, exports, or docs.

Prefer static Vite + React output for Cloudflare Pages. Avoid SSR/template-platform coupling unless the product specifically needs it.
