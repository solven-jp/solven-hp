# Historical static artifact mirror

This candidate preserves the 22-file static artifact recorded for 2026-08-08. It is historical evidence, not the current website source, a current production baseline, or a deployment instruction. The owner selected historical preservation on 2026-10-21.

- Pinned source: `solven-jp/solven-windows-clean` commit `29eecdf381407e5be51e4e97a032e70f1e011170`, tree `56c1256bb5c5ed778c1176ae596a9199312c268d`.
- The pinned source commit is now visible on GitHub (verified 2026-10-21). The earlier `LOCAL_COMMIT_NOT_PUSHED` observation is retained in the manifest as a capture-time record.
- `site/`, its 22 hashes and `checksums.sha256` are unchanged. No regeneration or hand-edit of the artifact has occurred.
- The release identifiers, ZIP hash, build settings, quality gates and source-output comparison in the manifest are historical records. The ZIP, original release and current production identity were not reverified for this preservation candidate.
- `mirror_role` and `release_mode` retain the original capture classifications for compatibility. `preservation.purpose` defines this candidate's historical-only use; deployment remains unauthorized.

## Known limitations retained

HP3-01 remains unfixed in the historical bytes: the diagnosis consultation action writes to a hidden, disabled form and does not pass its summary to the mail consultation route. This artifact must not be represented as a corrected or accepted current website.

PC/mobile operation, current production matching and A11-BLK-01 through A11-BLK-03 remain unverified. `INDEPENDENT_REVIEW_RECEIPT.md` is evidence for its previous baseline only; its FIX_REQUIRED history is not a PASS for this candidate. The changed metadata requires its own fixed-candidate independent review and owner approval before push or merge.

## Integrity and future use

Run `node scripts/verify-production-mirror.mjs` to check the frozen artifact and formal scope. This validates preservation integrity, not current website behavior or release identity.

The legacy `public/`, `firebase.json`, hosting settings, analytics and noindex remain unchanged. No deployment, customer interaction, Pages unpublishing or production cutover is authorized. Future functional corrections must be made in an identified human-maintained source and regenerated as a separately reviewed artifact; never rewrite the historical bytes and call them the same snapshot.
