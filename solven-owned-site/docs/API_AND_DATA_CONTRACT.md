# API and data contract

## Public API

All routes are same-origin. CORS response headers are not emitted.

### `GET /api/session`

Cookie transport (local and production) returns `{ "csrf_token": "...", "session_transport": "cookie" }` and an HttpOnly session cookie. Staging header transport returns the CSRF token and a UUID session ID in the response body, with no `Set-Cookie` header. The token and session ID are scoped to this same-origin form flow and are never logged. Session TTL, cookie name, `Secure` and `SameSite` come from validated environment configuration.

### `POST /api/leads`

Requires `Content-Type: application/json`, `Idempotency-Key` and `X-Solven-CSRF`. Cookie transport requires the session cookie; staging header transport requires `X-Solven-Session` with the issued UUID session ID. Body limit is 32 KiB. Server validation, honeypot, same-origin and rate-limit checks run before storage.

Success, including an idempotent replay:

```json
{
  "receipt_id": "SV-7K4M-9Q2R-ABCDE",
  "status": "NEW",
  "notification_status": "LOCAL_RECORDED"
}
```

The example is format-only. A real value is generated server-side. The response has exactly `receipt_id`, `status`, and `notification_status`; internal `lead_id` is never serialized. A first commit returns 201 and an idempotent replay returns 200 with the same `receipt_id`. Notification failure may return `notification_status: RETRY_PENDING` while the accepted Lead remains durable.

Errors use a stable code only: 400 invalid JSON/validation/idempotency, 403 Origin/CSRF, 413 body limit, 415 Content-Type, 421 Host, 429 rate limit plus `Retry-After`, and 500 for safe failure. Provider details and form values are not included.

There is no public lookup endpoint by `receipt_id` or `lead_id`.

### `GET /api/health`

Public response is only `{ "status": "ok" }`. It does not disclose adapter, destination, counts, filesystem path, release ID, source SHA or secret reference. Release metadata may be exposed only through hosting/provider authenticated administration health, outside public routing.

## Internal data model

| entity | required fields | notes |
|---|---|---|
| Lead | `lead_id`, `receipt_id`, `received_at`, consent version, status, notification status, idempotency digest, validated form fields | PII encrypted at rest in production |
| Idempotency | key digest, internal `lead_id`, commit state | digest is unique; raw key is not stored |
| Outbox | outbox ID, internal `lead_id`, delivery key, state, attempts, next attempt, lease | no form PII or provider response body |
| Event | time, event, correlation ID, internal `lead_id`, adapter, normalized code | server-side only; browser logging forbidden |
| Receipt reservation | unique `receipt_id`, reservation/allocation/retired state | deletion retains a non-PII tombstone to prevent reassignment; never becomes a public lookup index |

`lead_id` and `receipt_id` must be separate unique fields. A foreign key from outbox to internal Lead is allowed; a public queryable index is not. Initial Lead, idempotency claim and outbox are one transaction. Deleting or anonymizing a Lead follows retention approval and keeps only the minimum audit fields permitted by policy.

## Contract verification

`tests/contracts/provider-contract.mjs` checks required methods, synchronous/Promise-compatible calls, identifier separation, idempotency, initial outbox, due-item listing, claim lease, retry/dead letter/manual retry, retention enumeration and anonymization. Server tests separately prove that HTTP bodies and browser-facing data do not contain internal identifiers.
