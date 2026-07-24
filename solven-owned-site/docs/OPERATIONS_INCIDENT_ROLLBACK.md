# Operations, incidents and rollback

## Notification operation

The API transaction always creates a pending outbox item with the Lead. A worker claims it with a finite lease, sends the PII-free summary and records a normalized result. Failure schedules 1 minute, 5 minute, 30 minute, 2 hour and 12 hour retries. After the initial attempt plus five retries, the item becomes dead letter. Once the outbox records delivery, a later Lead status projection failure is reconciled from that delivered state and must not requeue provider delivery. Manual retry requires authenticated operator action and an audit reason in the production implementation.

Monitor `lead_recorded_total`, notification success/failure/dead-letter counters, pending count and oldest pending age. Alert immediately on LeadStore commit failure; warn when pending exceeds 15 minutes or any dead letter appears. Do not put form content, recipient, provider body, raw idempotency key, receipt number, credential or secret reference into alert text.

## Incident sequence

1. Correlate the public request ID with server/provider logs; do not ask for or paste form PII into chat.
2. Determine whether the Lead transaction committed. If unknown, replay only with the original idempotency key through an approved operator path.
3. If Lead exists and notification failed, keep the Lead, inspect PII-free outbox state and use bounded manual retry only after provider recovery.
4. If duplicate provider delivery is suspected, use internal delivery key and provider receipt; do not expose internal `lead_id` to the customer.
5. For leaked secret or unauthorized data access, stop the affected adapter, rotate through the secret manager, preserve audit evidence and follow the approved incident plan.
6. A `receipt_id` is not an authentication factor and cannot be used for public status lookup.

## Snapshot before staging/production change

Record the immutable source commit, release ID, current static artifact checksum, server revision, route/rewrite, security headers, hosting release, edge configuration, environment key names, adapter schema version and backup/snapshot reference. Values and secrets remain in the provider system, not the report. Keep the prior release available and verify restore/read access before deployment approval.

## Rollback

1. Freeze further release actions and verify whether Lead intake is still safely committing.
2. Restore the previous static release and the matching server revision/rewrite/header configuration as one known-good set.
3. Never roll back, truncate or delete LeadStore/outbox data with application code rollback. Run forward-compatible adapter migrations or a separately approved data recovery plan.
4. Preserve pending/dead-letter items and resume workers only after adapter compatibility is confirmed.
5. Verify public health, top page, price/legal pages, session, synthetic Lead, idempotent replay, receipt display, notification success/failure retention and security headers.
6. Confirm noindex state for the target environment. Production rollback must restore its previous robots/sitemap state.

DNS, production data restoration, Auth/RLS, secret rotation and provider account changes are separate high-risk operations requiring explicit Owner approval. This repository does not execute them.
