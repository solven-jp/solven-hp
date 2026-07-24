# Provider-neutral migration guide

1. Confirm the destination repository, immutable source commit, hosting project/site, deploy directory, production domain and same-origin API rewrite from current evidence.
2. Generate and verify the final portable bundle from a clean committed tree outside the repository. Compare its SHA-256, `source_tree_state=clean` and source commit with the handoff record. `bundle:validate` output is pre-commit evidence only and cannot be deployed.
3. Copy the bundle into an isolated destination branch/worktree. Do not copy excluded review, runtime or test-data paths.
4. Implement LeadStore, NotificationOutbox, RateLimiter and shared session adapters behind the existing contracts. Keep `public/`, canonical data and HTTP success projection unchanged.
5. Run the bundled provider contract suite against the staging implementations, then multi-instance transaction/lease and backup-restore tests.
6. Supply staging values by external configuration and secret references. Use a distinct origin, staging data scopes, disabled/sandbox notification, GA4 disabled and noindex.
7. Run the machine-readable staging checklist and record evidence outside the public artifact.
8. Re-audit automation, rollback snapshot and production values. Complete the production checklist and obtain Owner approval before any deployment.

No migration step authorizes push, PR, provider creation, secret setting, staging or production connection. Those are separate Owner-approved operations.
