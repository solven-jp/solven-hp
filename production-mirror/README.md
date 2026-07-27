# Production source mirror

`production-mirror/site/` is a deploy-only, vendored static artifact. It is not a human-authored website source directory and is deliberately separate from this repository's legacy `public/` directory and `firebase.json`.

## Recorded baseline

- Source repository: `solven-jp/Solven-codex`
- Source commit: `52224782dd4f137d30e4fb825aa0ea893f7bb6f4`
- Source tree: `8b4a06173648fc38be0a0b09b6aeee472dd08b8e`
- Source command: `cd apps/solven-owned-site && npm run build:production`
- Output: `apps/solven-owned-site/dist` (18 files)
- Artifact inventory: `checksums.sha256`

The baseline was rebuilt from a clean checkout and compared with `https://solven.jp` on 2026-07-27. All 18 files matched after normalizing Cloudflare's email-obfuscation transform on HTML responses and its explicit managed-content block in `robots.txt`. This records the already-serving artifact; it does not authorize any deployment.

## Local verification

Run without dependencies:

```sh
node scripts/verify-production-mirror.mjs
```

For an offline comparison with files fetched from the live site into a directory that uses the same route-to-file layout as `site/`, run:

```sh
node scripts/verify-production-mirror.mjs --compare-root /absolute/path/to/fetched-site
```

The optional comparison decodes only Cloudflare `__cf_email__` anchors, removes the paired Cloudflare decoder script, and removes the explicit Cloudflare-managed block in `robots.txt` before comparing bytes. It never calls the network.

## Update rule

Do not edit files under `site/` by hand. A future update must originate from a formally reviewed `Solven-codex` bundle, then update the release manifest, checksum inventory, and `FORMAL_REVIEW_SCOPE.sha256` together. The initial baseline's source-review status is intentionally not claimed here; its formal review is the purpose of this draft PR.

## Formal review limitation and gate

This repository has a single GitHub owner, so a self-approval cannot be treated as independent. `CODEOWNERS` is intentionally absent until a distinct GitHub user or team can own the mirror path. For PR #2, an independent Codex review receipt and explicit PM approval must both refer to the exact successful CI head; see `INDEPENDENT_REVIEW_RECEIPT.md`. Future `main` branch protection is a separate post-merge setting and does not retrospectively enforce PR #2.

`firebase.json`, Cloud Run configuration, GitHub Pages configuration, Firestore, and secrets are out of scope for this mirror change.
