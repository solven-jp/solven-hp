# Staging / production environment matrix

| item | local | staging required | production required |
|---|---|---|---|
| origin | loopback HTTP | distinct HTTPS origin | confirmed production HTTPS origin |
| indexing | noindex recommended | `noindex,nofollow` | noindex removed; robots/sitemap verified |
| GA4 | disabled | disabled | optional; disabled is releasable |
| LeadStore/outbox | local file | staging-only persistent scope | production persistent scope |
| notification | local record | disabled or sandbox | approved provider and destination |
| real customer data | prohibited | prohibited | approved form verification only |
| rate limiter | local memory | distributed or edge | distributed or edge |
| session | local memory | distributed, staging cookie | distributed, production cookie |
| secrets | none | staging namespace/reference | production namespace/reference |
| production data link | none | prohibited | approved production adapters only |
| release metadata | local | platform admin health only | platform admin health only |
| backup | disposable | staging recovery test | snapshot/backup and restore evidence |

Staging defaults are also encoded in `deploy/staging.defaults.json`. The values for origin, host, provider, secret references, release ID and source SHA remain unresolved until the production destination is selected.

The build reads `SOLVEN_RUNTIME_ENVIRONMENT`, `SOLVEN_NOINDEX` and `SOLVEN_GA4_ENABLED`, matching the runtime schema. If GA4 is approved, deployment resolves `SOLVEN_GA4_MEASUREMENT_ID_REF` outside the repository and injects the resulting public `SOLVEN_GA4_MEASUREMENT_ID` only into the build process. No resolved value belongs in `.env.example` or the release bundle.
