# Design QA — 説明用デモ案1

- 実施日: 2026-07-21
- source visual truth: `/Users/kazuki/.codex/generated_images/019f7d67-9b24-7820-bb9e-010b77ae3881/exec-8e294cb7-8183-43ae-b9ed-f12ec2aff528.png`
- implementation screenshot: `release/screenshots/demo-section.png`
- mobile evidence: `release/screenshots/mobile-redesign.png`
- combined comparison evidence: `/private/tmp/solven-owned-site-option1-comparison.png`
- viewport: desktop 1440px、mobile 390px
- state: `#works` の通常表示。HP・LP・Webアプリの説明用デモ3件を含む。

## Findings

P0・P1・P2の未解決findingはありません。

- Fonts and typography: 既存のSolven書体、太さ、見出し階層を維持しました。狭いカード内は本文より小さい表示ですが、原寸desktopと390px mobileで切れ・枠外表示はありません。
- Spacing and layout rhythm: 案1の「課題・変化・成果」の順序を維持しつつ、既存の実績説明と交互レイアウトを残しました。desktopでは横並び、mobileでは縦順に変わります。
- Colors and visual tokens: 既存のDeep navy、Blue、White、neutralのみを使用し、新しい色体系は追加していません。
- Image quality and asset fidelity: 案1の比較構造を、レスポンシブな説明用パネルとして実装しました。ロゴ、顧客画像、stock画像、架空の効果数値は追加していません。
- Copy and content: HP、LP、Webアプリで課題・整理内容・成果を用途別にしました。顧客の声や導入効果を事実として見せず、Webアプリの担当者は「担当A／担当B」として説明用であることを保っています。

## Comparison history

- 初回確認: 1280×720のブラウザ表示で横はみ出しなし。カード内の日本語は枠内に収まりました。
- 修正: `お客様の声` を実績誤認防止のため `導入事例・実績` へ変更し、説明用の人名を `担当A／担当B` へ変更しました。
- 再確認: Chromium、WebKit、FirefoxのローカルE2Eで外部request 0、page error 0、horizontal overflowなし。desktop 1440pxとmobile 390pxのrendered evidenceで読み順を確認しました。

## Focused region comparison

HP・LP・Webアプリの各3段階パネルを原寸で確認しました。矢印は隣接カードと重ならず、mobileでは縦方向に回転し、情報の順番を保っています。重要な文字、CTA風ラベル、業務一覧はfull-viewでも判読できるため、追加の拡大比較は不要と判断しました。

## Primary interactions and console

- アンカー遷移: `#work-hp`、`#work-lp`、`#work-webapp` を確認。
- 既存ブラウザE2E: ナビゲーション、簡易診断、問い合わせフォーム、同意状態を3ブラウザで確認。
- Console errors: 0。

## Writing audits

- `$cognitive-rhythm-writing`: status N/A。今回の追加文は短いUIラベルと説明用コピーで、長文監査の対象外です。
- `$patina`: PASS。HP・LP・Webアプリの意味、CTA、対象範囲を固定して確認し、不自然な煽りや実績の捏造はありません。

final result: passed
