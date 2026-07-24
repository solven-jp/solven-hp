# ブラウザ・security・公開前QA

## 主要ブラウザ手順

同じbuildとsynthetic入力をChromium、WebKit（Safari相当）、Firefoxで実行します。

```sh
npm run build
npm start
# 別terminalで実行
npm run test:browser
```

`test:browser`はChromium、WebKit、Firefoxの3 engineを正式gateとし、1 engineでも`NOT_RUN`または失敗なら非0終了します。QA中にbrowserを自動downloadしません。現在のlocal実測はPlaywright 1.60.0、Chromium 148.0.7778.96、WebKit 26.4、Firefox 150.0.2です。実Safari 26.5.2でも、desktop構造、500px幅のmobile menu、空送信時の5件のerrorと最初の項目へのfocus、synthetic問い合わせのHTTP成功／公開受付番号／成功表示へのfocus、横overflowなしを確認しました。検証後はWebDriver sessionと`safaridriver`を終了しています。VoiceOverによる読み進めは可視操作停止の指示に従って中断し、stagingで人間が行うscreen reader確認だけを残します。Owner画像はrelease bundleへ含めません。

1. 390×844、768、1024、1280、1440×1000でトップを開き、横scroll、文字欠け、focus、sticky headerを確認する。
2. mobile menuをkeyboardで開閉し、主要6 sectionへの遷移、Escape、選択後の閉鎖、遷移先focusが固定headerの下に隠れないことを確認する。
3. LP、HP、Webアプリの目的別入口が固有制作例へ移動し、選択表示と簡易診断へ同じserviceが反映されることを確認する。
4. 診断の時期、予算、補足条件が「相談時の整理結果」にtextとして表示され、CTAから編集可能な問い合わせformへ引き継がれることを確認する。
5. 空送信で日本語error summary／inline error／`aria-invalid`／`aria-describedby`／最初のerrorへのfocusを確認し、修正時にerrorが即時解除されることを確認する。
6. 1280pxで料金見出しが`サービスごとの料金体系を、`／`分かりやすくご案内します。`の自然な2行となり、末尾が孤立しないことを確認する。
7. 料金cardが正本生成dataと一致し、円記号が`¥`（U+00A5）で統一されることを確認する。
8. 簡易診断4経路を確認し、自動見積・契約・決済にならないことを確認する。
9. 同意前にGoogle tag request、解析Cookie、event送信がないことを確認する。
10. 同意、拒否、再読込後の状態、停止操作を確認する。
11. honeypot、正常送信、二重送信、通知失敗を確認する。成功response／DOMは公開`receipt_id`を受付番号として表示し、内部`lead_id`や`LEAD-`を含まず、同じidempotency keyで同じ`receipt_id`を返すことを確認する。
12. keyboardだけでskip link、nav、診断、問い合わせ、Cookie controlを操作する。
13. Privacy、Cookie、会社情報、免責へのリンクと戻り導線を確認する。
14. canonical、OGP、Organization data、favicon、robots.txt、sitemap.xmlと1200×630のOG画像を確認し、local／stagingではnoindex、production buildだけindexになることを確認する。

## accessibility gate

- `lang=ja`、一意の`h1`、見出し順、landmark、skip link、label、fieldset/legend、live region、focus visibleを確認する。
- 主要な本文、CTA、濃紺帯の前景色／背景色が4.5:1以上であることを自動確認する。
- 説明用画面モックへ代替ラベルを付け、操作できない見せかけのbuttonを作らない。
- 200% zoomとmobile幅で内容・操作を失わない。
- 色だけで成功・失敗を伝えず、status textを併記する。
- 自動animationを追加せず、reduced motionを尊重する。
- VoiceOverの実際の読み順、読み上げ文、Rotor操作は、人間が検証時間を確保したstaging確認として実施する。

## security gate

- CSP、nosniff、frame拒否、referrer policy、permissions policyをresponseで確認する。
- allowed Host、trusted proxy、HTTPS、32 KiB上限、JSON限定、same-origin、server validation、CSRF、分散rate limit境界、honeypot、durable idempotencyをtestする。
- static path traversalを拒否する。
- log、event、notification、outbox、analyticsへPII・credentialを複製しない。
- 公開HTML、HTTP response、browser logに内部`lead_id`を出さず、`receipt_id`による公開照会routeを追加しない。
- staging/production cookieは専用名、`Secure`、`HttpOnly`、`SameSite=Strict`とし、共有session adapterを使う。
- public healthはstatusだけとし、release、source、adapter、path、件数、secret参照を返さない。

## 料金・契約gate

- `npm run sync:canonical`後に`npm run project:canonical`で公開最小項目へ投影した`public/data/owned-site.json`だけから料金・会社情報を描画する。
- HP/LPは初期、月額、回数、税別総額、税込参考を正本validatorで再計算する。
- Webアプリは開始価格と有償要件整理を表示し、確定価格に見せない。
- 個別見積、第三者費用、追加作業、解約・満了条件、自動契約・自動決済なしを維持する。

実測結果は`release/OWNER_REVIEW.md`へ記録します。
