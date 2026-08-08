# Production source mirror

`production-mirror/site/` is a deploy-only static artifact mirror. It is separate from the legacy `public/` directory and `firebase.json`.

## Current candidate

- Source repository: `solven-jp/solven-windows-clean`
- Source commit: `29eecdf381407e5be51e4e97a032e70f1e011170`
- Source tree: `56c1256bb5c5ed778c1176ae596a9199312c268d`
- Build command: `npm --prefix apps/solven-owned-site run build:preview-static`
- Output: `apps/solven-owned-site/dist`（22 files）
- Deployed Firebase version: `626e508a8d9c5f25`
- Artifact ZIP SHA-256: `279cefd5016fb703efba018c9ef09fa826880c59a028648b33d11078eb0c53a3`

The 22 files match the local source output byte-for-byte. This candidate records an already deployed artifact; it does not authorize deploy, push, PR, merge, GitHub Pages, Cloudflare, API, data, or secret changes.

## Local verification

```sh
node scripts/verify-production-mirror.mjs
```

## Update rule

Do not edit `site/` by hand. Regenerate it from the pinned source, then update the release manifest, checksum inventory, and formal review scope together.

The source commit is local and not yet pushed. Mirror push, PR, and merge require a separately approved source push plus independent review and Owner approval for the exact mirror head.
