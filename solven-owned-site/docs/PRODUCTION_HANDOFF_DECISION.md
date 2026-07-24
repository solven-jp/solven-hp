# Production handoff decision matrix

## 推奨方針

2026-07-20のOwner回答を受け、将来のproduction移植先は「Dedicated repository」を推奨方針として採用する。既存repositoryの進行中変更、CI trigger、secret境界からreleaseを分離し、検証済みportable bundleだけを取り込めるためである。Read-only確認で専用候補 `solven-jp/solven-hp` の存在を確認したが、現在は公開repository、未保護の`main`、静的`public/`とGitHub Pages automationを持つ旧構成である。現行HPの移植、権限／branch protection、CI、same-origin API、deployは未実施であり、各外部操作の承認を別途必要とする。

実装基盤の推奨は`RECOMMENDED_PRODUCTION_STACK.md`を正とする。既存Google Cloud projectとFirebase Hosting siteの識別子は`solven-jp`まで確認したが、現在のproduction commit、domain authority、API rewrite、rollback releaseは未確認なので、候補情報を新releaseの実環境authorityとして扱わない。

| criterion | Existing production repository transfer | Independent deploy from this repository | New dedicated repository |
|---|---|---|---|
| impact on ongoing overhaul | medium/high if paths or CI overlap | medium if repository CI is shared | low after clean extraction, higher setup |
| rollback | uses existing release history; compatibility must be proven | simple when hosting supports immutable revisions | simple after new pipeline is proven |
| CI/CD | reuse but inherited triggers must be audited | current workflows must be isolated | explicit minimal pipeline can be designed |
| secret boundary | may inherit broad repository secrets | requires path-scoped environment separation | clearest dedicated boundary |
| hosting compatibility | strongest if current hosting source is confirmed | depends on direct server/static support | depends on new project integration |
| same-origin API | likely via existing rewrite | must provide static+server routing | must configure new domain/rewrite |
| Lead data separation | adapter namespace must be added | dedicated adapter config possible | easiest dedicated store boundary |
| maintainability | one existing production codebase | source and production may diverge | clear ownership, extra repository upkeep |
| migration effort | low/medium if source is current | medium | high |
| production incident risk | medium; hidden legacy automation risk | medium/high until hosting path proven | medium initially, low after staged proof |

## Selection conditions

- Select existing repository transfer only when live release, production repository commit, deploy directory, rewrite and CI triggers match uniquely, and the transfer does not overlap dirty worktree paths.
- Select independent deploy only when this repository is confirmed as an authoritative maintained source, CI can path-isolate the app, hosting accepts the bundle unchanged, and rollback can restore both static and server revisions.
- Dedicated repositoryを選ぶ条件は、候補repositoryの採用、公開範囲、ownership、branch protectionが承認され、最小権限のCIとsecret scopeを確立でき、same-origin routingと保守担当を確定できること。
- If production source, hosting project/site, API rewrite, adapter store or rollback source is non-unique, recommendationを外部接続へ進めない。A modeを維持し、Owner evidenceと個別承認を待つ。

The selected method must pass the same bundle verifier, adapter contract, staging checklist and production checklist. Existing remote master or historical PR data is not authority without runtime re-verification.
