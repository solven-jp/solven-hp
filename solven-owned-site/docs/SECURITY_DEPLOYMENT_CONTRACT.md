# Security and deployment contract

`config/environment.schema.json` is the machine-readable key contract and `src/config/environment.mjs` is the startup validator. Values below are deployment inputs, not application constants.

## Required controls

| control | application contract | deployment responsibility |
|---|---|---|
| allowed host | exact allowlist; wildcard forbidden in production | bind origin so direct alternate hosts cannot reach it |
| trusted proxy | `off`, explicit peer addresses, or approved edge mode | block direct origin access before using edge assertions |
| HTTPS | production/staging origin uses HTTPS; production requires HTTPS | TLS, redirect and certificate lifecycle |
| cookie/session | configurable name, `Secure`, `HttpOnly`, `SameSite`, TTL | shared session adapter for multiple instances; separate staging namespace |
| CSRF | required in production | rotate/session-store behavior must preserve token binding |
| request | JSON only, 32 KiB maximum, same-origin | proxy limits must be equal or lower, never higher |
| CORS | disabled by omission; explicit same-origin only | do not add wildcard headers at CDN |
| headers | CSP, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS | CDN must preserve or strengthen them; enable HSTS subdomains only after the full domain inventory is HTTPS-ready |
| health | public status only | release ID/source SHA available only in authenticated platform health |
| logging | allowlist redaction; no form PII/provider body/secret | log sink access, retention, alerting and redaction verification |
| identifiers | public response is `receipt_id` plus accepted/notification states only; internal `lead_id` never enters HTML, response or browser log | do not create public receipt lookup, analytics identifier or CDN log field |
| secrets | reference names only in schema/artifact | resolve through approved secret manager at runtime |
| retention/backup | days and backup reference are required inputs | encryption, restore test, legal hold and deletion approval |
| incident | validated correlation ID response header | propagate to provider logs without form content |

Production startup fails when it sees local LeadStore, outbox, notifier, rate limiter or session adapter; insecure origin/cookie/HTTPS/HSTS; wildcard/local host; disabled CSRF; body limit above 32 KiB; PII logging; staging/noindex flags; missing persistent adapter, secret-manager, notification destination or backup references. Provider adapters must also be injected; the reserved name alone is not a connection.

Staging startup requires a distinct HTTPS origin, `staging=true`, `noindex=true`, GA4 disabled, staging LeadStore/outbox, notification disabled or sandbox, distributed session/rate limit and a staging secret namespace. Production data, secrets and notification destination are prohibited.

## Secret references

`.env.example` contains only non-secret values and illustrative reference names. It must not be copied into source with resolved values. `*_SECRET_REF`, destination and backup references point to external configuration; provider secret values must never enter the release bundle, process output, browser bundle, logs or incident report.

GA4 is optional. When Measurement ID reference or analytics approval is absent, `SOLVEN_GA4_ENABLED=false` is valid for production release. When approved, deployment resolves `SOLVEN_GA4_MEASUREMENT_ID_REF` and provides the resulting public `SOLVEN_GA4_MEASUREMENT_ID` only to the build process; the reference and the resolved value are never bundled as secret material. No Google script is loaded before Consent even when enabled.
