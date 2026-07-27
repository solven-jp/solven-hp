# Production mirror operations

## Current boundary

This repository now contains an isolated production artifact mirror at `production-mirror/site/`. It does **not** replace the legacy `public/` directory, alter `firebase.json`, trigger a deployment, or disable GitHub Pages. The mirror is intentionally inert until a separately approved cutover.

## Formal review gate

This repository currently has one GitHub owner, `@solven-jp`. A self-approval is not an independent GitHub approval. To avoid claiming otherwise, this change deliberately removes `CODEOWNERS`; it is not an approval control in the current repository model.

For PR #2, the formal procedural gate is both of the following, bound to the exact PR head SHA and a successful `Production mirror integrity` run:

1. An independent Codex review receipt with a passing disposition after the current `FIX_REQUIRED` response is reviewed.
2. Explicit PM approval of that same head SHA.

`production-mirror/INDEPENDENT_REVIEW_RECEIPT.md` records the original independent review result and this gate. It is evidence for a human decision, not a GitHub-enforced approval or deployment authorization. Until a distinct GitHub user or team is added, do not configure a required CODEOWNERS review as if it supplied independent approval.

## Required review for this baseline

1. Review `production-mirror/release-manifest.json` against the stated source commit and the 18-file checksum inventory.
2. Run `node scripts/verify-production-mirror.mjs`.
3. Review every hash in `production-mirror/FORMAL_REVIEW_SCOPE.sha256`; that file lists the complete content-bearing scope of this change, excluding only itself.
4. Read `production-mirror/INDEPENDENT_REVIEW_RECEIPT.md`, obtain the updated independent review receipt, and record PM approval for the exact head SHA after CI succeeds.
5. Confirm that the recorded baseline is an observation of the current production site, not an authorization to deploy or to replace production with Solven-codex PR #81.

## Later, separately approved actions

### Disable the legacy GitHub Pages site

Expected impact: the legacy site currently reachable at `https://solven-jp.github.io/solven-hp/` will become unavailable after propagation. Do not perform this as part of this PR.

#### Stop preconditions and evidence

Before stopping Pages, record a timestamped evidence bundle containing all of the following:

1. Pages settings: current publishing mode, source branch, source folder, custom domain, HTTPS setting, most recent deployment/run identifier, and configured public URL.
2. The source identity: source branch and folder/path, resolved source commit SHA, and the root entry file hash.
3. The legacy URL baseline: final HTTP status and redirect chain, response-body SHA-256, page title/visible first screen, and canonical URL (or a recorded absence of a canonical element).
4. The owner-approved stop request and the intended rollback owner.

Obtain explicit approval to unpublish Pages and to alter any custom-domain or DNS mapping before acting. Use the GitHub Pages UI's **Unpublish site** action rather than deleting the repository or changing production hosting configuration.

#### Rollback triggers

Start rollback only with explicit owner/PM authorization when any of these occurs after the stop: an approved stakeholder needs the legacy site restored, the approved replacement is unavailable or misroutes traffic, the stop affects an expected business workflow, or the observed legacy URL behavior differs from the recorded stop decision.

#### Exact rollback procedure

1. Open `solven-jp/solven-hp` → **Settings** → **Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Select branch **`main`** and folder **`/(root)`**, then select **Save**. Do not point Pages at `production-mirror/site/` or alter Firebase/Cloud Run as part of this rollback.
4. Observe the resulting Pages deployment. If saving the source does not start one, use the existing Pages deployment workflow's approved rerun path; if an additional source-branch commit is required, obtain separate approval for that exact trigger before creating it.
5. Wait for a successful Pages deployment and then request `https://solven-jp.github.io/solven-hp/` with redirects enabled. Confirm the final HTTP result matches the recorded pre-stop value, the visible page/title matches the recorded legacy baseline, and the canonical URL (or documented absence) matches the pre-stop record.

Rollback is complete only when the Pages deployment is successful, all three legacy URL checks (HTTP, visible content, canonical behavior) match the evidence bundle, no unapproved custom-domain/DNS change remains, and the rollback owner records acceptance. Preserve the evidence bundle with the rollback decision.

GitHub's current UI terminology and branch/folder source constraints are documented in [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and [Unpublishing a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site).

### Protect `main`

Expected impact: direct pushes to `main` will be blocked and changes to the mirror will require review. Do not enable it as part of this PR.

This is a post-PR-#2-merge follow-up. A rule created later cannot retrospectively enforce review or status checks on PR #2 itself.

1. Create a branch protection rule or ruleset for `main`.
2. Require pull requests, at least one approval, stale-review dismissal, and no force pushes or branch deletion.
3. Require the `Production mirror integrity` status check.
4. Do **not** require CODEOWNERS review until a distinct GitHub user or team is available. At that point, add narrowly scoped CODEOWNERS entries for the mirror and require that distinct owner/team's review.
5. Decide and explicitly approve any administrator bypass policy before enabling the rule.

### Merge and production cutover

Merging this draft PR only records the isolated mirror and its integrity check. A later production cutover must have separate approval for its exact Firebase Hosting/Cloud Run target, rollback plan, and observed live-data impact. No `firebase deploy`, Cloud Run change, Firestore change, secret action, or GitHub Pages action is authorized by this repository change.
