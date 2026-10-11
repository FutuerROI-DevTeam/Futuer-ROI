# JOGI HACK 2026

3人チームで JOGI HACK 2026 に参加するためのWebアプリケーション開発リポジトリです。
「なぜその技術が必要なのか説明できるプロダクト」を目指します。

## 現在の状態

| 区分 | 内容 |
| --- | --- |
| 確定 | 大会：JOGI HACK 2026 / 対象：Webアプリケーション / チーム：3人 |
| 確定 | 開発期間：2026-09-19 ～ 2026-10-12 / コードフリーズ：2026-10-12 |
| DECIDED | 2026-09-29に音楽探索案を廃止した。旧案の要件・Scopeは現行計画ではない。[Product Spec P-10](docs/product-spec.md#p-10-音楽探索案の廃止) |
| DECIDED | 2026-09-30にProductを「Future ROI（今日サボると、ゴールは何日遠ざかる？）」に決定し、要件・MVP Scopeを確定した。[Product Spec](docs/product-spec.md#現行状態2026-09-30) |
| Kaito-Iwase判断・レビュー中 | #199／PR #202で全体UXを改善中。旧Hero/Coreコピーを保持。g50は再開待ちであり、同じ継続傾向・設定量と再開後経路共有のモデル上の追加遅れ中央値とも解釈できる（完了日のP50差・因果効果とは別）。訂正理由・未確認の製品受入は[Product Spec P-21](docs/product-spec.md#p-21-todayの朝焼け山並み案)へ。main反映済みとは扱わない |
| DECIDED（Scope・分担） | 2026-10-05、[R-11のMust追加と責任分界をチーム採択](docs/product-spec.md#p-15-質問由来の見通しのmust追加方針)。MustはR-01〜R-11。2026-10-07の依頼者承認範囲の回答保存・公開Engine／GETは#133、質問入力・回答版の競合復旧とTodayの出所別表示は#137・#81でmainへ接続済み。[D-26](docs/architecture.md#d-26)の当時のOPEN履歴と現契約を区別し、実装を製品受入・実ユーザーでの校正済みとは扱わない |
| DECIDED | 現行の実績由来の予測モデル（2状態Bayesian Markov、Beta(2,2)、中心指標はBeta-Geometric分布の中央値）、Data Modelと記載済みの業務API規則。契約の未定義部分・解釈の判断待ちは[Architecture](docs/architecture.md#現行状態2026-09-30)から確認する |
| DECIDED（基本構成） | 2026-10-03のD-23基本構成採用は、FE側のDiscord上の了承についての依頼者報告とBE本人の了承記録に基づく。[採用構成・理由・次の作業](docs/architecture.md#2026-10-03の技術構成合意)。2026-10-05に[npm workspacesと`pg`を追加採択](docs/architecture.md#2026-10-05の追加採択)。当時の合意範囲と、後日の[版固定・API契約](docs/architecture.md#technology-stack)を分けて読む |
| 条件付き第一候補 | Better Authは[D-24](docs/architecture.md#d-24)。公開はFE・BEともVercel Hobby＋Neon Free、ローカルDockerが[D-25](docs/architecture.md#d-25)の第一候補（2026-10-08、本人アカウント・厳密0円・非商用・検証条件付き）。最終採択・配備済み・一般公開や課金の許可ではない |
| mainの実装／受入・公開待ち | [Prediction計算本体・テスト](packages/prediction/README.md)、起動基盤・DB schema/migration・認証・Goal・記録・Today APIと実APIを使う業務画面はmainにある。画面の実装・既存ローカル検証記録と、製品受入・E2E・公開配置の残条件は[対応表の現在地](docs/change-map.md#現在地の読み方)で区別する。未mergeの画面変更をmainの説明へ混ぜない |
| 履歴 | 音楽案向けの要件・設計・比較結果は新案に自動適用しない。[旧案の保管場所](README.md#廃止した音楽案の履歴) |

コードフリーズ後は、原則としてソースコードと事前提出資料を編集できません。
過去の案・会話・実験コードは採用済みの仕様ではありません。

情報には次の区分を明記します。

- **確定**：チームで明示的に決定済み。
- **候補**：現在検討している選択肢。
- **仮説**：検証が必要な推測。
- **未定**：まだ議論・決定されていない事項。

現時点では文書、4種類のIssue Forms、PRテンプレート、AI向けSkills、Serena設定、miseの共通タスク、文書・設定検証用のGitHub Actionsがあります。
旧案の文書と比較PoCは[固定commitの履歴](#廃止した音楽案の履歴)から参照できます。現行のアプリ起動構成（npm workspaces・`apps/api`・`apps/web`・Compose・単一コンテナ・Application CI）は#70で、DBスキーマとmigration（`npm run db:migrate`）は#74で、認証（登録・ログイン・ログアウト、未ログインは401）は#75でローカル実装済みです。Goal API（#76）と記録・Today API（#77、`/today`が純粋Engineを呼ぶ）、Goalの一覧・作成・編集・削除画面（#78）とToday画面（#81）は実APIでローカル実装済みです。今日の記録・変更（#79）と昨日の補完・訂正（#80）も実APIで保存します。公開先（staging）への配置は未実施です。
現行の未決定事項と当時の検証記録への入口は[開発基盤の状態](docs/operations/development-foundation-status.md)で区別しています。
次の案で使える資産と再評価が必要な条件は[引き継ぎの棚卸し](docs/operations/reuse-handoff.md)にまとめています。
実装の棚卸し・調査基準・関連する判断Issueは[仕様・実装・確認方法の対応表](docs/change-map.md)を参照してください。
初めてコードを読む場合は、[記録保存から予測表示までのtrace・用語・テスト入口](docs/change-map.md#コードを読むための短いtrace)から進めます。
旧音楽案のML Issue向けCodex Harnessは通常の実行タスクとCIから外しました。再利用前の確認事項は[引き継ぎ](docs/operations/reuse-handoff.md)を参照してください。

Demo Seed（#82）は認証で作成済みのuserIdとtimezoneを明示し、専用2Goalだけを作成・resetします。[実行・再実行・保全の手順](docs/operations/demo-seed.md)を参照してください。公開DBと恒久Demo Accountの作成、Webの通し確認は別途必要です。

## 開発基盤のセットアップと確認

GitとPowerShell 7を使います。文書・設定チェックの手順は[開発ガイド](docs/DEVELOPMENT_GUIDE.md#13-初回セットアップ)を参照してください。基本構成の採用と認証・公開先の残条件は[Architecture](docs/architecture.md#technology-stack)で確認します。アプリの起動構成はNode 24.21.0に版固定し、[起動・検証手順](docs/DEVELOPMENT_GUIDE.md#アプリを起動検証する)にまとめています。公開先（staging）への配置は未実施です。

Dockerで一式を起動する場合、初回だけ`.env.example`を`.env`へコピーし、ローカル専用の`LOCAL_DB_PASSWORD`と32文字以上の`BETTER_AUTH_SECRET`を設定します。その後は`docker compose up -d --build`でDB health→認証・アプリmigration→単一NodeのWeb/API配信へ進みます。準備完了を待つには`--wait --wait-timeout 120`を追加し、`http://127.0.0.1:8080`を開きます。hostのNode/miseは不要です。[設定・停止・再起動・失敗時とデータ保持](docs/DEVELOPMENT_GUIDE.md#dockerで一式を起動する)、[hostのホットリロードとの使い分け](docs/DEVELOPMENT_GUIDE.md#dockerとhost開発の使い分け)を参照してください。

導入済みの環境では、リポジトリのルートで `mise run --skip-tools check` を実行します。文書・設定を検査し、成功時は `PASS:` が表示されます。
miseがない場合は、PowerShell 7で `pwsh -NoProfile -File scripts/check-foundation.ps1` を実行すると同じ検証ができます。
Hook（コミット前に走る処理）の導入はローカル設定を変更するため、[初回セットアップ](docs/DEVELOPMENT_GUIDE.md#13-初回セットアップ)を読んで別に行います。

アプリ全体は `npm ci` → `npm run typecheck` → `npm test` → `npm run build` で検証します（Node 24.21.0。miseなら `mise install` の後に `mise run test` 等）。APIテストはPostgreSQLを使い、`DATABASE_URL`がなければ開発依存の`embedded-postgres`でローカルクラスタを自動起動します。[Application CI](.github/workflows/application.yml)は同じ4段階とコンテナのsmoke testを実行します。

Prediction単体は[Docker検証手順](packages/prediction/DOCKER.md)で、hostにNodeを追加せず型検査・テスト・接続例・T-14を実行できます。Secret・DBは不要です。製品全体の起動構成やruntimeの採択とは分けます。

`check`は文書・設定の検証です。Secret・DB・アプリRuntimeは不要です。

## 最初に読む順番

1. このREADME：前提、現在の状態、情報の置き場所。
2. [CONTRIBUTING.md](CONTRIBUTING.md)：チーム共通の開発ルール。
3. [開発ガイド](docs/DEVELOPMENT_GUIDE.md)：環境準備からIssue・ブランチ・PR・マージ後までの操作。
4. [AGENTS.md](AGENTS.md)：AIへ作業を依頼する際の共通ルール。
5. [AI開発ツールガイド](AI_DEVELOPMENT_TOOLS.md)：MCPとSkillsの使い分け、利用状況。

機能の仕様を知りたい・変更したい場合は、[対応表](docs/change-map.md#アプリの仕様と実装)から「目的・操作・入力や表示の条件・失敗時の動作」を説明する機能文書へ進み、内部処理、関連コード、確認方法をたどります。
正式な設計文書は[Product Spec](docs/product-spec.md)と[Architecture](docs/architecture.md)の2本です。アプリの起動構成とProduct機能の実装状況、比較結果と未検証範囲はArchitectureからたどれます。[開発基盤と作業手順](docs/change-map.md#開発基盤と作業手順)と[配置ルール](CONTRIBUTING.md#仕様文書の配置)も参照してください。

旧音楽案の領域別記録は[保管場所](README.md#廃止した音楽案の履歴)からたどれます。現在の実装指示ではありません。

AIは最初にAGENTS.mdを読み、必要な文書とSkillを参照してください。

## 情報の正本

| 情報 | 正本 |
| --- | --- |
| プロジェクト概要、日程、文書の入口 | このREADME。Product・Architectureの状態は下記2正本を参照 |
| Issue / ブランチ / コミット / PR / レビュー / マージ / Ready・Done / Scopeの運用ルール | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 共通ルールを実行する具体的な操作手順 | [開発ガイド](docs/DEVELOPMENT_GUIDE.md) |
| AIの判断範囲、安全性、実装・検証原則 | [AGENTS.md](AGENTS.md) |
| ツールの利用方針、環境依存情報、Skill一覧 | [AI開発ツールガイド](AI_DEVELOPMENT_TOOLS.md) |
| 作業別のAIワークフロー | [.agents/skills/](.agents/skills/) の各SKILL.md |
| 機能・ページ・基盤から仕様、実装、確認方法への対応と棚卸し | [仕様・実装・確認方法の対応表](docs/change-map.md) |
| 個別タスクの背景・目的・範囲・完了条件 | [GitHub Issue](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues) |
| 現在のStatus・Scope | [GitHub Projects](https://github.com/orgs/jogi-hack-2026-team/projects/1)（アクセス権が必要） |
| 正式Product仕様・要件・Scope・Product Decision Log | [Product Spec](docs/product-spec.md) |
| 正式Architecture・技術候補・DB・Deployment・Architecture Decision Log | [Architecture](docs/architecture.md) |
| 過去の開発基盤の判断履歴 | [開発基盤ADR](https://github.com/jogi-hack-2026-team/jogi-hack-2026/blob/77c71a5f248a4dce4ce9fb8af6619b41541be9d8/archive/music-exploration/docs/decisions/0001-development-foundation.md)。新規Product設計の正本を増やさない |
| 現行基盤の状態と旧設定・検証記録への入口 | [開発基盤の状態](docs/operations/development-foundation-status.md) |
| リリース・提出・デモ | [リリースとデモの手順](docs/operations/release-demo.md) |

仕様・設計・資料の追加先と執筆手順は[ドキュメント運用](CONTRIBUTING.md#ドキュメントと技術判断)を正本とします。過去の草稿・実施結果は[Issue単位の履歴フォルダ](docs/changes/)から探せます。フォルダには新しい正式仕様を置きません。
同じ説明をコピーせず、正本へリンクします。

## 廃止した音楽案の履歴

廃止した音楽案の文書・比較PoC・当時の設定は、[固定commit `77c71a5` のtree](https://github.com/jogi-hack-2026-team/jogi-hack-2026/tree/77c71a5f248a4dce4ce9fb8af6619b41541be9d8/archive/music-exploration)から参照します。#188でtracked file 111件を現在の作業ツリーから外しました。Git履歴と当時の採択・失敗・検証結果は保持し、現行アプリの仕様や起動手順へ自動適用しません。

ローカルで調べる場合は、そのcommitの別checkoutから `archive/music-exploration` を参照してください。現行checkoutの設定やDBへ復元して動かす前に、[再利用時の確認事項](docs/operations/reuse-handoff.md)を確認します。

固定履歴のfile内容だけを読むには、`<path>`を当時のrepository相対pathに置き換えて `git show 77c71a5f248a4dce4ce9fb8af6619b41541be9d8:<path>` を実行します。現在の作業ツリーへ書き戻す操作ではありません。

## 比較実験の保存範囲

`experiments` は製品runtimeと分け、現在使う検証と過去の比較を次のように扱います。比較実験の保存範囲はこの表を正本とします。過去の成功・失敗・採択理由を現在の製品受入へ読み替えません。

| 実験群 | 配置と用途 |
| --- | --- |
| [question-prior-engine-candidate](experiments/question-prior-engine-candidate/README.md)、[question-prior-contract](experiments/question-prior-contract/README.md) | 現CIの独立数値オラクル・凍結fixtureを使うため保持 |
| [api-mixed-load](experiments/api-mixed-load/README.md) | 実EngineとAPIの能動的な再測定に使うため保持 |
| question-prior-proposal | [固定commitのtree](https://github.com/jogi-hack-2026-team/jogi-hack-2026/tree/77c71a5f248a4dce4ce9fb8af6619b41541be9d8/experiments/question-prior-proposal)へ。historical・reproduced・provenance・rawを一式で保持し、tracked 57件を作業ツリーから外す |
| prediction-model-validation | [固定commitのtree](https://github.com/jogi-hack-2026-team/jogi-hack-2026/tree/77c71a5f248a4dce4ce9fb8af6619b41541be9d8/experiments/prediction-model-validation)へ。旧モデル比較・失敗と修正の根拠を一式で保持し、tracked 22件を作業ツリーから外す |
| question-prior-ui-candidate、architecture-verification | 旧候補UI専用workflowに実行依存があるため今回保持。workflowと必要チェックの確認を含む整理を別途判断する |
