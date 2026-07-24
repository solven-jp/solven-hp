# Portable bundle exclusions

The generator rejects or excludes:

- `release/`, screenshots, design concepts and Owner review materials
- `runtime/`, Lead records, idempotency records, outbox, notification records and events
- test fixtures/data, Playwright reports, `test-results`, coverage and logs
- `.env` other than the value-free `.env.example`, credentials, keys, tokens and resolved secret values
- `node_modules`, browser binaries, caches and unrelated build output
- symlinks, path traversal names and local absolute paths
- canonical source archive and unrelated repository files

The bundle includes provider contract tests because they contain only synthetic reserved-domain fixtures and are required for destination adapter verification.
