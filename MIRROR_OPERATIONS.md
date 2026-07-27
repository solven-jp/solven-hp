# Production mirror operations

## Current boundary

This repository now contains an isolated production artifact mirror at `production-mirror/site/`. It does **not** replace the legacy `public/` directory, alter `firebase.json`, trigger a deployment, or disable GitHub Pages. The mirror is intentionally inert until a separately approved cutover.

## Required review for this baseline

1. Review `production-mirror/release-manifest.json` against the stated source commit and the 18-file checksum inventory.
2. Run `node scripts/verify-production-mirror.mjs`.
3. Review every hash in `production-mirror/FORMAL_REVIEW_SCOPE.sha256`; that file lists the complete content-bearing scope of this change, excluding only itself.
4. Confirm that the recorded baseline is an observation of the current production site, not an authorization to deploy or to replace production with Solven-codex PR #81.

## Later, separately approved actions

### Disable the legacy GitHub Pages site

Expected impact: the legacy site currently reachable at `https://solven-jp.github.io/solven-hp/` will become unavailable after propagation. Do not perform this as part of this PR.

1. Record the current Pages source, custom-domain state, deployment status, and the legacy URL response.
2. Obtain explicit approval to unpublish the Pages site and to remove any custom-domain/DNS mapping if one is configured.
3. Use the GitHub Pages settings or `DELETE /repos/solven-jp/solven-hp/pages` with an authenticated owner session.
4. Verify that the legacy URL no longer serves content and retain the rollback evidence required by the owner.

### Protect `main`

Expected impact: direct pushes to `main` will be blocked and changes to the mirror will require review. Do not enable it as part of this PR.

1. Create a branch protection rule or ruleset for `main`.
2. Require pull requests, at least one approval, stale-review dismissal, and no force pushes or branch deletion.
3. Require the `Production mirror integrity` status check.
4. Require code-owner review; `.github/CODEOWNERS` identifies the mirror, verifier, workflow, and operations document.
5. Decide and explicitly approve any administrator bypass policy before enabling the rule.

### Merge and production cutover

Merging this draft PR only records the isolated mirror and its integrity check. A later production cutover must have separate approval for its exact Firebase Hosting/Cloud Run target, rollback plan, and observed live-data impact. No `firebase deploy`, Cloud Run change, Firestore change, secret action, or GitHub Pages action is authorized by this repository change.
