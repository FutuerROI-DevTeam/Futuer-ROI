# #274 可読性改善の対象と保持判断

Supporting Artifact / Not a Source of Truth

[Issue #274](https://github.com/FutureROI-DevTeam/Future-ROI/issues/274)・[Draft PR #282](https://github.com/FutureROI-DevTeam/Future-ROI/pull/282)の走査記録。現行契約は[Product Spec](../product-spec.md)、責務と依存は[Architecture](../architecture.md)、変更時の入口は[change-map](../change-map.md)を参照する。この一覧は今回の判断を残すもので、将来のコード追加に合わせて保守する一覧ではない。

## 範囲と方法

初回変更後の`7d0ae9d`を基準に、現行FE・BE・Engine・test・検証入口を追加走査した。長い式・密集control・複数statement・コメントを全fileで確認し、読む段階が混ざる箇所へ限定編集した。長いliteral・SQL・JSXの空白を機械整形する基準にはしない。

最新main `17e8acbe5ab658b85258cbd70070ccc2ecd5b042`から#280・#281・#283を取り込み、Goal一覧・320pxボタン・保存失敗focus・年表示・session失敗UIを保った。競合を解決したSaveFailure/dateと新しいSessionFailure/Noticeも確認した。以下の「変更」はこのmainに対する今回PRの差分であり、追加走査で既に十分と判断したfileにも初回の責務抽出が含まれる。

| 分類 | 一覧件数 | 今回変更 | 保持 |
| --- | ---: | ---: | ---: |
| BE source・test | 115 | 28 | 87 |
| CI設定 | 6 | 2 | 4 |
| Engine source・test | 38 | 30 | 8 |
| FE CSS | 26 | 4 | 22 |
| FE Goal・prior・log | 28 | 25 | 3 |
| FE Today・session・その他 | 72 | 31 | 41 |
| package検証入口 | 4 | 1 | 3 |
| 検証入口・FE test | 75 | 37 | 38 |

## 不変条件と検証の区別

- 表示/純粋変換と状態/保存を分け、時計採取・owner・CAS・冪等性・transaction・ABA・遅延応答の位置を保つ。BEのsnapshot変換はI/Oや時計を持たず、3 storeが取得境界を所有する。
- Engineの演算順・比較・乱数・丸め・公開識別子を保つ。recoveryの1000日は資源保護上限で、予測horizonへ読み替えない。独立oracleと凍結fixtureを保持する。
- 追加編集はruntime/type AST・literal/SQL/JSX、PowerShell parser/token、CSS ASTの同値検査で確認した。mainの機能追加はこの比較と混ぜず、最終HEADの回帰・独立レビューで確認する。
- ローカルAPIの全file実行では新規の使い捨てclusterを既存DATABASE_URL入口で共有し、各testの専用DB作成/削除を保つ。外部URLを拒むmilestone testはURL未設定で別実行する。CIは既存の公式入口で確認する。
- 初回browserのcleanup失敗と途中APIのディスク不足を成功へ読み替えない。停止済みの今回worktreeのtest clusterのみを片付けて再検証する。最終HEAD・実行数・CI結果はPRに記録する。人間による読みやすさの効果測定・本番予測精度・Human Reviewを完了扱いにしない。

## 意図的に保持した範囲

migration、production DB/deploy/smoke操作、CD、無関係なexperiment、配布font・画像・生成物・凍結fixtureは保持した。SQLの文字列、文字列内のJS/HTML/CSS、JSXテキスト、型エラーを確認する`@ts-expect-error`直後の位置も保持する。小さなguard、短いmapper、既に責務が分かれたadapterは改行のためだけに変更しない。

## 全対象の判断

### BE source・test

| file | 判断 | 理由 |
| --- | --- | --- |
| [apps/api/src/app.ts](../../apps/api/src/app.ts) | 保持 | 設定/構成/終了処理は段階ごとのblockと空行がある。候補は型/1登録/1ログの式で、環境/構成入口に追加整形を広げない。 |
| [apps/api/src/auth/background.ts](../../apps/api/src/auth/background.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/auth/bridge.ts](../../apps/api/src/auth/bridge.ts) | 保持 | 残候補は短い早期returnまたは1payload/1応答の式。成功・失敗の境界は既存blockで分かるため改行を増やさない。認証/秘匿の必要なcommentは保持。 |
| [apps/api/src/auth/mail-transport.ts](../../apps/api/src/auth/mail-transport.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/auth/mailer.ts](../../apps/api/src/auth/mailer.ts) | 保持 | 残候補は短い早期returnまたは1payload/1応答の式。成功・失敗の境界は既存blockで分かるため改行を増やさない。認証/秘匿の必要なcommentは保持。 |
| [apps/api/src/auth/options.ts](../../apps/api/src/auth/options.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/auth/reset-mail.ts](../../apps/api/src/auth/reset-mail.ts) | 保持 | 残候補は短い早期returnまたは1payload/1応答の式。成功・失敗の境界は既存blockで分かるため改行を増やさない。認証/秘匿の必要なcommentは保持。 |
| [apps/api/src/auth/sign-out.ts](../../apps/api/src/auth/sign-out.ts) | 保持 | 残候補は短い早期returnまたは1payload/1応答の式。成功・失敗の境界は既存blockで分かるため改行を増やさない。認証/秘匿の必要なcommentは保持。 |
| [apps/api/src/config.ts](../../apps/api/src/config.ts) | 保持 | 設定/構成/終了処理は段階ごとのblockと空行がある。候補は型/1登録/1ログの式で、環境/構成入口に追加整形を広げない。 |
| [apps/api/src/container-start.ts](../../apps/api/src/container-start.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/contracts/error.ts](../../apps/api/src/contracts/error.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/contracts/evaluation.ts](../../apps/api/src/contracts/evaluation.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/contracts/goal.ts](../../apps/api/src/contracts/goal.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/contracts/health.ts](../../apps/api/src/contracts/health.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/contracts/index.ts](../../apps/api/src/contracts/index.ts) | 保持 | 候補はTypeBox schema/型の並列項目。1行は1契約項目で制御や副作用と混在しないため既存の一覧性を維持。 |
| [apps/api/src/contracts/log.ts](../../apps/api/src/contracts/log.ts) | 保持 | 候補はTypeBox schema/型の並列項目。1行は1契約項目で制御や副作用と混在しないため既存の一覧性を維持。 |
| [apps/api/src/contracts/milestone.ts](../../apps/api/src/contracts/milestone.ts) | 保持 | 候補はTypeBox schema/型の並列項目。1行は1契約項目で制御や副作用と混在しないため既存の一覧性を維持。 |
| [apps/api/src/contracts/question.ts](../../apps/api/src/contracts/question.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/contracts/r11.ts](../../apps/api/src/contracts/r11.ts) | 保持 | 候補はTypeBox schema/型の並列項目。1行は1契約項目で制御や副作用と混在しないため既存の一覧性を維持。 |
| [apps/api/src/db/demo-data.ts](../../apps/api/src/db/demo-data.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/db/demo-seed-args.ts](../../apps/api/src/db/demo-seed-args.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/db/migrate-cli.ts](../../apps/api/src/db/migrate-cli.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/db/migrate.ts](../../apps/api/src/db/migrate.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/db/pool.ts](../../apps/api/src/db/pool.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/db/schema-check-cli.ts](../../apps/api/src/db/schema-check-cli.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/db/schema-check.ts](../../apps/api/src/db/schema-check.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/db/seed-demo-cli.ts](../../apps/api/src/db/seed-demo-cli.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/db/seed-demo.ts](../../apps/api/src/db/seed-demo.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/evaluation/assessment.ts](../../apps/api/src/evaluation/assessment.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/evaluation/policy.ts](../../apps/api/src/evaluation/policy.ts) | 保持 | 小さな純粋policy/暦日/再export。候補は短いguard・型・並列引数で、意味の段階が混在しないため既存の簡潔さを維持。 |
| [apps/api/src/evaluation/purge-cli.ts](../../apps/api/src/evaluation/purge-cli.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/evaluation/routes.ts](../../apps/api/src/evaluation/routes.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/evaluation/store.ts](../../apps/api/src/evaluation/store.ts) | 変更 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/goals/create-request-fingerprint.ts](../../apps/api/src/goals/create-request-fingerprint.ts) | 保持 | 小さな純粋policy/暦日/再export。候補は短いguard・型・並列引数で、意味の段階が混在しないため既存の簡潔さを維持。 |
| [apps/api/src/goals/extras.ts](../../apps/api/src/goals/extras.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/goals/goal-id.ts](../../apps/api/src/goals/goal-id.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/goals/local-date.ts](../../apps/api/src/goals/local-date.ts) | 保持 | 小さな純粋policy/暦日/再export。候補は短いguard・型・並列引数で、意味の段階が混在しないため既存の簡潔さを維持。 |
| [apps/api/src/goals/routes.ts](../../apps/api/src/goals/routes.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/goals/settings-policy.ts](../../apps/api/src/goals/settings-policy.ts) | 保持 | 小さな純粋policy/暦日/再export。候補は短いguard・型・並列引数で、意味の段階が混在しないため既存の簡潔さを維持。 |
| [apps/api/src/goals/store.ts](../../apps/api/src/goals/store.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/goals/target-date-policy.ts](../../apps/api/src/goals/target-date-policy.ts) | 保持 | 小さな純粋policy/暦日/再export。候補は短いguard・型・並列引数で、意味の段階が混在しないため既存の簡潔さを維持。 |
| [apps/api/src/http/api-boundary.ts](../../apps/api/src/http/api-boundary.ts) | 保持 | 残候補は短い早期returnまたは1payload/1応答の式。成功・失敗の境界は既存blockで分かるため改行を増やさない。認証/秘匿の必要なcommentは保持。 |
| [apps/api/src/http/errors.ts](../../apps/api/src/http/errors.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/http/guards.ts](../../apps/api/src/http/guards.ts) | 保持 | 残候補は短い早期returnまたは1payload/1応答の式。成功・失敗の境界は既存blockで分かるため改行を増やさない。認証/秘匿の必要なcommentは保持。 |
| [apps/api/src/http/log-url.ts](../../apps/api/src/http/log-url.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/logs/routes.ts](../../apps/api/src/logs/routes.ts) | 保持 | 小さな純粋policy/暦日/再export。候補は短いguard・型・並列引数で、意味の段階が混在しないため既存の簡潔さを維持。 |
| [apps/api/src/logs/store.ts](../../apps/api/src/logs/store.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/milestone/assessment.ts](../../apps/api/src/milestone/assessment.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/milestone/core.ts](../../apps/api/src/milestone/core.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/milestone/policy.ts](../../apps/api/src/milestone/policy.ts) | 保持 | 小さな純粋policy/暦日/再export。候補は短いguard・型・並列引数で、意味の段階が混在しないため既存の簡潔さを維持。 |
| [apps/api/src/milestone/purge-cli.ts](../../apps/api/src/milestone/purge-cli.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/src/milestone/routes.ts](../../apps/api/src/milestone/routes.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/milestone/store.ts](../../apps/api/src/milestone/store.ts) | 変更 | 前段の整理済みstore。残候補はSQL文字列/短い純粋式で、lock/clock/CASの段階は既存blockから追える。SQLの空白を変更しない。 |
| [apps/api/src/prediction/engine.ts](../../apps/api/src/prediction/engine.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/prediction/r11.ts](../../apps/api/src/prediction/r11.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/prediction/routes.ts](../../apps/api/src/prediction/routes.ts) | 保持 | 小さな純粋policy/暦日/再export。候補は短いguard・型・並列引数で、意味の段階が混在しないため既存の簡潔さを維持。 |
| [apps/api/src/prediction/snapshot.ts](../../apps/api/src/prediction/snapshot.ts) | 変更 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/prediction/store.ts](../../apps/api/src/prediction/store.ts) | 変更 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/questions/snapshot.ts](../../apps/api/src/questions/snapshot.ts) | 変更 | 長い検査/引数・DTO/hashの構築・rollback/returnの密集を意味の段階で限定整理。公開型/名前・式・SQL・副作用順を維持。 |
| [apps/api/src/questions/update-policy.ts](../../apps/api/src/questions/update-policy.ts) | 保持 | 小さな純粋policy/暦日/再export。候補は短いguard・型・並列引数で、意味の段階が混在しないため既存の簡潔さを維持。 |
| [apps/api/src/server.ts](../../apps/api/src/server.ts) | 保持 | 設定/構成/終了処理は段階ごとのblockと空行がある。候補は型/1登録/1ログの式で、環境/構成入口に追加整形を広げない。 |
| [apps/api/src/startup-error.ts](../../apps/api/src/startup-error.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/src/vercel.ts](../../apps/api/src/vercel.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/tests/api-boundary.test.ts](../../apps/api/tests/api-boundary.test.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/auth-concurrency.test.ts](../../apps/api/tests/auth-concurrency.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/auth.test.ts](../../apps/api/tests/auth.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/cache-control.test.ts](../../apps/api/tests/cache-control.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/database-encoding.test.ts](../../apps/api/tests/database-encoding.test.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/database-lifecycle.test.ts](../../apps/api/tests/database-lifecycle.test.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/demo-data.test.ts](../../apps/api/tests/demo-data.test.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/tests/demo-seed.test.ts](../../apps/api/tests/demo-seed.test.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/evaluation-policy.test.ts](../../apps/api/tests/evaluation-policy.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/evaluation-replay.test.ts](../../apps/api/tests/evaluation-replay.test.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/evaluation.test.ts](../../apps/api/tests/evaluation.test.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/goal-data-integrity.test.ts](../../apps/api/tests/goal-data-integrity.test.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/goal-pair-migrations.test.ts](../../apps/api/tests/goal-pair-migrations.test.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/tests/goal-policy.test.ts](../../apps/api/tests/goal-policy.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/goals-concurrency.test.ts](../../apps/api/tests/goals-concurrency.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/goals-target-date-integrity.test.ts](../../apps/api/tests/goals-target-date-integrity.test.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/goals-target-date.test.ts](../../apps/api/tests/goals-target-date.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/goals-title-validation.test.ts](../../apps/api/tests/goals-title-validation.test.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/goals.test.ts](../../apps/api/tests/goals.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/health.test.ts](../../apps/api/tests/health.test.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/helper-lifecycle.test.ts](../../apps/api/tests/helper-lifecycle.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/helpers/cleanup.ts](../../apps/api/tests/helpers/cleanup.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/helpers/database.ts](../../apps/api/tests/helpers/database.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/helpers/embedded-binaries.ts](../../apps/api/tests/helpers/embedded-binaries.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/helpers/lifecycle-failures.mjs](../../apps/api/tests/helpers/lifecycle-failures.mjs) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/helpers/milestone-database-policy.ts](../../apps/api/tests/helpers/milestone-database-policy.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/helpers/sign-out-fixture.ts](../../apps/api/tests/helpers/sign-out-fixture.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/tests/helpers/stack.ts](../../apps/api/tests/helpers/stack.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/helpers/windows-embedded-stop.ts](../../apps/api/tests/helpers/windows-embedded-stop.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/logs.test.ts](../../apps/api/tests/logs.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/mailer.test.ts](../../apps/api/tests/mailer.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/migrate.test.ts](../../apps/api/tests/migrate.test.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/tests/milestone-assessment.test.ts](../../apps/api/tests/milestone-assessment.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/milestone-core.test.ts](../../apps/api/tests/milestone-core.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/milestone.test.ts](../../apps/api/tests/milestone.test.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/password-reset.test.ts](../../apps/api/tests/password-reset.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/pool-responsibility.test.ts](../../apps/api/tests/pool-responsibility.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/pool.test.ts](../../apps/api/tests/pool.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/prediction-budget.test.ts](../../apps/api/tests/prediction-budget.test.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/prediction-snapshot.test.ts](../../apps/api/tests/prediction-snapshot.test.ts) | 変更 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/prediction-wire-compatibility.test.ts](../../apps/api/tests/prediction-wire-compatibility.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/question-prior-http.test.ts](../../apps/api/tests/question-prior-http.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/question-prior.test.ts](../../apps/api/tests/question-prior.test.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/record-concurrency.test.ts](../../apps/api/tests/record-concurrency.test.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/schema-check.test.ts](../../apps/api/tests/schema-check.test.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/tests/seed-r11-compatibility.test.ts](../../apps/api/tests/seed-r11-compatibility.test.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/tests/sign-out-failure.test.ts](../../apps/api/tests/sign-out-failure.test.ts) | 変更 | 同一行の操作・assertを分離、競合barrier/cleanupの資源処理境界または長引数を限定整理。assert・fixture値・SQL・順序を維持。 |
| [apps/api/tests/spa.test.ts](../../apps/api/tests/spa.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/startup-error.test.ts](../../apps/api/tests/startup-error.test.ts) | 保持 | 構文走査で密集候補なし。既存の空行・block・短い式で責務を追えるため追加整形しない。 |
| [apps/api/tests/today.test.ts](../../apps/api/tests/today.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |
| [apps/api/tests/vercel.test.ts](../../apps/api/tests/vercel.test.ts) | 保持 | DB操作・migration/配備入口またはfixture保全の指定により変更しない。 |
| [apps/api/tests/windows-embedded-stop.test.ts](../../apps/api/tests/windows-embedded-stop.test.ts) | 保持 | 残候補は固定入力/期待値/境界表、単一assert/call、短いguard/callback。テストのsetup→operation→assertまたはscenario blockは既に分離済み。fixture/独立oracle・assertを保全し追加一括整形しない。 |

### CI設定

| file | 判断 | 理由 |
| --- | --- | --- |
| [.github/workflows/application.yml](../../.github/workflows/application.yml) | 保持 | 既存workflowの起動条件と処理を保持。Docker・Application・CDの動作変更をしない。 |
| [.github/workflows/foundation.yml](../../.github/workflows/foundation.yml) | 変更 | 既存FoundationへのaliasまたはEngine step名だけを整理。条件・exit・artifact・allowlistは保持。 |
| [.github/workflows/prediction-docker.yml](../../.github/workflows/prediction-docker.yml) | 保持 | 既存workflowの起動条件と処理を保持。Docker・Application・CDの動作変更をしない。 |
| [.github/workflows/prediction.yml](../../.github/workflows/prediction.yml) | 変更 | 既存FoundationへのaliasまたはEngine step名だけを整理。条件・exit・artifact・allowlistは保持。 |
| [.github/workflows/question-prior-contract.yml](../../.github/workflows/question-prior-contract.yml) | 保持 | 既存workflowの起動条件と処理を保持。Docker・Application・CDの動作変更をしない。 |
| [.github/workflows/question-prior-ui-candidate.yml](../../.github/workflows/question-prior-ui-candidate.yml) | 保持 | 既存workflowの起動条件と処理を保持。Docker・Application・CDの動作変更をしない。 |

### Engine source・test

| file | 判断 | 理由 |
| --- | --- | --- |
| [packages/prediction/src/completion-integrated.ts](../../packages/prediction/src/completion-integrated.ts) | 変更 | 本PR前段で整形/数式対応済み。全行再確認で追加の密集controlなし。 |
| [packages/prediction/src/completion-scenario.ts](../../packages/prediction/src/completion-scenario.ts) | 変更 | 本PR前段で整形/数式対応済み。全行再確認で追加の密集controlなし。 |
| [packages/prediction/src/completion.ts](../../packages/prediction/src/completion.ts) | 変更 | 本PR前段で整形/数式対応済み。全行再確認で追加の密集controlなし。 |
| [packages/prediction/src/config.ts](../../packages/prediction/src/config.ts) | 保持 | 短い設定/例外/型契約で責務が明確。小さな型literalは比較しやすく、展開だけの変更を増やさない。 |
| [packages/prediction/src/errors.ts](../../packages/prediction/src/errors.ts) | 保持 | 短い設定/例外/型契約で責務が明確。小さな型literalは比較しやすく、展開だけの変更を増やさない。 |
| [packages/prediction/src/frozen-completion-cdf.ts](../../packages/prediction/src/frozen-completion-cdf.ts) | 変更 | 保存CDFの複合検証・一行throw/return・混合ループを展開する。式/丸め順/30日境界保持。 |
| [packages/prediction/src/goal-prior-candidate.ts](../../packages/prediction/src/goal-prior-candidate.ts) | 変更 | snapshotの一行guardと長い入口引数/結果オブジェクトを展開する。 |
| [packages/prediction/src/index.ts](../../packages/prediction/src/index.ts) | 変更 | 公開型exportの長い列挙を分割し、境界を読む順序を保つ。 |
| [packages/prediction/src/observations.ts](../../packages/prediction/src/observations.ts) | 変更 | 日付/ログ検証と遷移分類の一行controlを展開。整数暦式と拒否優先順保持。 |
| [packages/prediction/src/predict.ts](../../packages/prediction/src/predict.ts) | 変更 | 引数/導出error/戻り値の観測metadataを意味単位に分割。数値・key順保持。 |
| [packages/prediction/src/question-prior-adapter-candidate.ts](../../packages/prediction/src/question-prior-adapter-candidate.ts) | 変更 | constructor複数文・構造検証・表示材料分岐・回数計画を展開。候補名と全式保持。 |
| [packages/prediction/src/question-prior-types.ts](../../packages/prediction/src/question-prior-types.ts) | 保持 | 短い設定/例外/型契約で責務が明確。小さな型literalは比較しやすく、展開だけの変更を増やさない。 |
| [packages/prediction/src/question-prior.ts](../../packages/prediction/src/question-prior.ts) | 変更 | 公開型列挙・長いplan三項式・例外分類を展開。公開key順保持。 |
| [packages/prediction/src/random.ts](../../packages/prediction/src/random.ts) | 変更 | Gamma guard/continueと受理条件を展開。乱数消費順と式保持。 |
| [packages/prediction/src/recovery.ts](../../packages/prediction/src/recovery.ts) | 変更 | 本PR前段で整形/数式対応済み。全行再確認で追加の密集controlなし。 |
| [packages/prediction/src/types.ts](../../packages/prediction/src/types.ts) | 変更 | コメントと混在したavailable Completion型の複数フィールドを展開。型保持。 |
| [packages/prediction/tests/completion-deadline.test.mjs](../../packages/prediction/tests/completion-deadline.test.mjs) | 変更 | 多重loopと長い境界assert引数を分割。独立積/fixture値保持。 |
| [packages/prediction/tests/completion-integrated.test.mjs](../../packages/prediction/tests/completion-integrated.test.mjs) | 変更 | 多重loop・複数宣言/文・長いassert引数を分割。moment/pathOracle式保持。 |
| [packages/prediction/tests/completion.test.mjs](../../packages/prediction/tests/completion.test.mjs) | 変更 | 5重loop・単文if/return・独立畳み込みloopを展開。oracle計算式保持。 |
| [packages/prediction/tests/connection-examples.test.mjs](../../packages/prediction/tests/connection-examples.test.mjs) | 変更 | completionValuesの一行関数を展開。長いテスト名/期待値の内容保持。 |
| [packages/prediction/tests/demo-inputs.test.mjs](../../packages/prediction/tests/demo-inputs.test.mjs) | 変更 | 観測countsの単文loopを展開。デモ入力と固定期待値保持。 |
| [packages/prediction/tests/examples/question-prior-handoff.mjs](../../packages/prediction/tests/examples/question-prior-handoff.mjs) | 保持 | 小さな解決済みfixtureの構築のみ。固定snapshot/contextの内容と並びを保ち、今回追加編集しない。 |
| [packages/prediction/tests/examples/question-prior-worker-copy.mjs](../../packages/prediction/tests/examples/question-prior-worker-copy.mjs) | 変更 | 長いimport/例外guard/コピー結果を展開。transport分類保持。 |
| [packages/prediction/tests/fixtures-pr118.json](../../packages/prediction/tests/fixtures-pr118.json) | 保持 | 固定参照データのため編集除外。値・key順・注釈も保持する。 |
| [packages/prediction/tests/fixtures.ts](../../packages/prediction/tests/fixtures.ts) | 保持 | 固定参照データのため編集除外。値・key順・注釈も保持する。 |
| [packages/prediction/tests/goal-prior-candidate.test.mjs](../../packages/prediction/tests/goal-prior-candidate.test.mjs) | 変更 | 単文control/複数宣言・文/多重loopを展開。独立生存確率式保持。 |
| [packages/prediction/tests/observations.test.mjs](../../packages/prediction/tests/observations.test.mjs) | 変更 | null/完了境界の単文ifを展開。暦oracleと表形式の固定case保持。 |
| [packages/prediction/tests/predict.test.mjs](../../packages/prediction/tests/predict.test.mjs) | 変更 | 単文quantile境界/negative-case loop/helperを展開。独立CDF式保持。 |
| [packages/prediction/tests/question-prior-adapter-candidate.test.mjs](../../packages/prediction/tests/question-prior-adapter-candidate.test.mjs) | 変更 | fixture比較/多重loop/凍結helperと複数文を展開。PR118データ・期待値保持。 |
| [packages/prediction/tests/question-prior-handoff.test.mjs](../../packages/prediction/tests/question-prior-handoff.test.mjs) | 変更 | 複数宣言/文・known-error caseとassert引数を展開。worker終端動作保持。 |
| [packages/prediction/tests/question-prior-public.test.mjs](../../packages/prediction/tests/question-prior-public.test.mjs) | 変更 | raw gate loop/長い公開入口assertを分割。公開key順/fixture値保持。 |
| [packages/prediction/tests/random.test.mjs](../../packages/prediction/tests/random.test.mjs) | 変更 | momentsの一行loopとcallbackの複数文を展開。抽選/集計順保持。 |
| [packages/prediction/tests/recalculation.test.mjs](../../packages/prediction/tests/recalculation.test.mjs) | 変更 | freeze/逆順再計算/UNKNOWN集計の単文controlを展開。独立暦oracle式保持。 |
| [packages/prediction/tests/recovery.test.mjs](../../packages/prediction/tests/recovery.test.mjs) | 変更 | factorial/閾値/質量集計の単文controlを展開。独立階乗式保持。 |
| [packages/prediction/tests/result-contract.test.mjs](../../packages/prediction/tests/result-contract.test.mjs) | 保持 | 短い契約assertが中心。長いテスト名と表形式のcaseは意味のあるまとまりで保持する。 |
| [packages/prediction/tests/scaffold.test.mjs](../../packages/prediction/tests/scaffold.test.mjs) | 変更 | recursive source監査とfixture oracleの単文controlを展開。監査regex/fixture文字列保持。 |
| [packages/prediction/tests/test-discovery.test.mjs](../../packages/prediction/tests/test-discovery.test.mjs) | 保持 | 長行は実行fixtureのソース文字列とspawn引数。文字列に空白の意味があり、fixture文字列は保持する。 |
| [packages/prediction/tests/type-contracts.ts](../../packages/prediction/tests/type-contracts.ts) | 変更 | void複数文とswitch caseの複数文を展開。ts-expect-error直後行は位置依存で保持。 |

### FE CSS

| file | 判断 | 理由 |
| --- | --- | --- |
| [apps/web/src/features/account/account.css](../../apps/web/src/features/account/account.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/features/evaluation/evaluation.css](../../apps/web/src/features/evaluation/evaluation.css) | 変更 | 長い宣言group・nested media/keyframeのみ展開。selector・property・value・順序・commentは保持。 |
| [apps/web/src/features/goals/goals.css](../../apps/web/src/features/goals/goals.css) | 変更 | 長い宣言group・nested media/keyframeのみ展開。selector・property・value・順序・commentは保持。 |
| [apps/web/src/features/history/history.css](../../apps/web/src/features/history/history.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/features/logs/logs.css](../../apps/web/src/features/logs/logs.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/features/prior/question-prior.css](../../apps/web/src/features/prior/question-prior.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/features/today/assets/zen-old-mincho.css](../../apps/web/src/features/today/assets/zen-old-mincho.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/features/today/today-dawn.css](../../apps/web/src/features/today/today-dawn.css) | 変更 | 長い宣言group・nested media/keyframeのみ展開。selector・property・value・順序・commentは保持。 |
| [apps/web/src/features/today/today.css](../../apps/web/src/features/today/today.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/routes/app-shell.css](../../apps/web/src/routes/app-shell.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/routes/auth.css](../../apps/web/src/routes/auth.css) | 変更 | 長い宣言group・nested media/keyframeのみ展開。selector・property・value・順序・commentは保持。 |
| [apps/web/src/routes/route-states.css](../../apps/web/src/routes/route-states.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/styles.css](../../apps/web/src/styles.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/AppBar.css](../../apps/web/src/ui/components/AppBar.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/Button.css](../../apps/web/src/ui/components/Button.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/ChoiceButton.css](../../apps/web/src/ui/components/ChoiceButton.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/ConfirmDialog.css](../../apps/web/src/ui/components/ConfirmDialog.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/DeskHeader.css](../../apps/web/src/ui/components/DeskHeader.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/FormField.css](../../apps/web/src/ui/components/FormField.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/Notice.css](../../apps/web/src/ui/components/Notice.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/Section.css](../../apps/web/src/ui/components/Section.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/Spinner.css](../../apps/web/src/ui/components/Spinner.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/StatusBadge.css](../../apps/web/src/ui/components/StatusBadge.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/components/StickyActionBar.css](../../apps/web/src/ui/components/StickyActionBar.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/page.css](../../apps/web/src/ui/page.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |
| [apps/web/src/ui/tokens.css](../../apps/web/src/ui/tokens.css) | 保持 | 短い宣言group・独立したruleを保持。長いselectorや値は意味単位であり機械分割しない。 |

### FE Goal・prior・log

| file | 判断 | 理由 |
| --- | --- | --- |
| [apps/web/src/features/goals/create-attempt.ts](../../apps/web/src/features/goals/create-attempt.ts) | 変更 | owner/key/schema検査と作成/終了のguard・storage例外の段階を改行。 |
| [apps/web/src/features/goals/footprint.ts](../../apps/web/src/features/goals/footprint.ts) | 変更 | 記録整合チェック、日種別、連続実施forの段階を改行。 |
| [apps/web/src/features/goals/form/form-recovery.ts](../../apps/web/src/features/goals/form/form-recovery.ts) | 変更 | 先の責務抽出で復元条件・storage例外・失敗種別を分割済み。短い型と判定以外に密集した処理はない。 |
| [apps/web/src/features/goals/form/GoalFormFields.tsx](../../apps/web/src/features/goals/form/GoalFormFields.tsx) | 変更 | 量入力のmode別propsと単位fieldset属性を分割。 |
| [apps/web/src/features/goals/form/GoalFormPresentation.tsx](../../apps/web/src/features/goals/form/GoalFormPresentation.tsx) | 変更 | 回復/owner/410のreturn枝とaction JSXを分割。 |
| [apps/web/src/features/goals/form/TimeAmountField.tsx](../../apps/web/src/features/goals/form/TimeAmountField.tsx) | 変更 | 先の整理で形式切替と不正draftの段階を分割済み。残る短いprops・labelは意味が明瞭。 |
| [apps/web/src/features/goals/goal-form.ts](../../apps/web/src/features/goals/goal-form.ts) | 変更 | 先の整理で整数・日付・量・PATCH条件を分割済み。単独の短い型はそのまま維持。 |
| [apps/web/src/features/goals/GoalFootprint.tsx](../../apps/web/src/features/goals/GoalFootprint.tsx) | 変更 | キーボード位置計算とfocus/state更新の複数文を分割。 |
| [apps/web/src/features/goals/GoalFormPage.tsx](../../apps/web/src/features/goals/GoalFormPage.tsx) | 変更 | draft/failure layout effectの依存配列を意味の段階で分割。 |
| [apps/web/src/features/goals/GoalListPage.tsx](../../apps/web/src/features/goals/GoalListPage.tsx) | 変更 | Goal一覧・履歴query設定と整合したfootprint入力の構築を分割。 |
| [apps/web/src/features/goals/GoalStates.tsx](../../apps/web/src/features/goals/GoalStates.tsx) | 保持 | 各error表示が短い単独componentで、唯一の早期returnも単純な認証分類。密集した条件はない。 |
| [apps/web/src/features/goals/navigation/useConfirmedGoalSave.ts](../../apps/web/src/features/goals/navigation/useConfirmedGoalSave.ts) | 変更 | receipt型・mount cleanup・訪問照合・完了例外を分割。 |
| [apps/web/src/features/goals/navigation/useGoalFormFailure.ts](../../apps/web/src/features/goals/navigation/useGoalFormFailure.ts) | 変更 | receipt型・許可guard・完了例外・返却項目を分割。 |
| [apps/web/src/features/logs/AmountEditor.tsx](../../apps/web/src/features/logs/AmountEditor.tsx) | 変更 | 短い表示と操作は保持。既存recordStepに一致するよう「1回の量ずつ」を「1回の量に応じた刻みで」へ訂正。 |
| [apps/web/src/features/logs/draft-preview.ts](../../apps/web/src/features/logs/draft-preview.ts) | 変更 | draft型と試算のsnapshot/量境界guardを分割。 |
| [apps/web/src/features/logs/record-log.ts](../../apps/web/src/features/logs/record-log.ts) | 変更 | 保存種類・日付・DONE量・到達日のguardを分割し排他commentを簡潔化。 |
| [apps/web/src/features/logs/RecordChoiceBar.tsx](../../apps/web/src/features/logs/RecordChoiceBar.tsx) | 変更 | draft初期化/破棄/focus/cancelの複数文と設定propsを分割。未入力追従理由を簡潔化。 |
| [apps/web/src/features/logs/RecordChoices.tsx](../../apps/web/src/features/logs/RecordChoices.tsx) | 保持 | 量状態・focus・選択表示を既存小関数で区分済み。残る短いguardと独立button propsは追跡できる。 |
| [apps/web/src/features/logs/save-feedback.ts](../../apps/web/src/features/logs/save-feedback.ts) | 変更 | snapshot比較guardとBroadcastChannel検知/開始/終了を段階で分割。 |
| [apps/web/src/features/logs/SaveFailure.tsx](../../apps/web/src/features/logs/SaveFailure.tsx) | 変更 | 409設定回復のpropsと表示枝を分割。 |
| [apps/web/src/features/logs/SaveFeedback.tsx](../../apps/web/src/features/logs/SaveFeedback.tsx) | 保持 | 14行の単独表示component。保存前との差と単位の説明を保ち、不要な全面整形を避ける。 |
| [apps/web/src/features/logs/useSaveLog.ts](../../apps/web/src/features/logs/useSaveLog.ts) | 変更 | 保存固定値・snapshot検査・effect cleanup・保留/再送/reload guardを分割。 |
| [apps/web/src/features/logs/YesterdayCorrection.tsx](../../apps/web/src/features/logs/YesterdayCorrection.tsx) | 変更 | 設定回復propsと失敗文言引数を分割。 |
| [apps/web/src/features/logs/YesterdayPrompt.tsx](../../apps/web/src/features/logs/YesterdayPrompt.tsx) | 変更 | 設定回復propsと未保存量文言引数を分割。 |
| [apps/web/src/features/prior/forecast-validation.ts](../../apps/web/src/features/prior/forecast-validation.ts) | 変更 | 表示値・plan・quantileの拒否条件とswitch検証順を分割。 |
| [apps/web/src/features/prior/presentation-types.ts](../../apps/web/src/features/prior/presentation-types.ts) | 変更 | progress/plan/forecastの複数fieldを1行ずつ区分。 |
| [apps/web/src/features/prior/PriorForecast.tsx](../../apps/web/src/features/prior/PriorForecast.tsx) | 変更 | 表示sectionの階層と状態switchを分割。JSX本文は維持。 |
| [apps/web/src/features/prior/QuestionPriorFields.tsx](../../apps/web/src/features/prior/QuestionPriorFields.tsx) | 変更 | propsと選択callbackのdisabled→chosen→回答更新を分割。 |

### FE Today・session・その他

| file | 判断 | 理由 |
| --- | --- | --- |
| [apps/web/src/api/client.ts](../../apps/web/src/api/client.ts) | 保持 | 短いHTTP契約adapterと単純な成功/失敗境界。既存構成を保持 |
| [apps/web/src/api/evaluation-http.ts](../../apps/web/src/api/evaluation-http.ts) | 保持 | 短いHTTP契約adapterと単純な成功/失敗境界。既存構成を保持 |
| [apps/web/src/api/goals-http.ts](../../apps/web/src/api/goals-http.ts) | 変更 | 作成要求の引数とowner/idempotency headerを読み分ける。HTTP値と順序は保持 |
| [apps/web/src/api/http.ts](../../apps/web/src/api/http.ts) | 保持 | 短いHTTP契約adapterと単純な成功/失敗境界。既存構成を保持 |
| [apps/web/src/api/session-cache.ts](../../apps/web/src/api/session-cache.ts) | 変更 | owner/世代の複合条件・通知とcleanupを分割。ABA保護・時計位置・effect依存は保持 |
| [apps/web/src/api/session-draft.ts](../../apps/web/src/api/session-draft.ts) | 変更 | owner/世代の複合条件・通知とcleanupを分割。ABA保護・時計位置・effect依存は保持 |
| [apps/web/src/api/today-http.ts](../../apps/web/src/api/today-http.ts) | 保持 | 短いHTTP契約adapterと単純な成功/失敗境界。既存構成を保持 |
| [apps/web/src/auth/action.ts](../../apps/web/src/auth/action.ts) | 保持 | 短い項目検証と既に分かれた送信/effect/描画。単純guardだけを変更しない |
| [apps/web/src/auth/client.ts](../../apps/web/src/auth/client.ts) | 保持 | 短い項目検証と既に分かれた送信/effect/描画。単純guardだけを変更しない |
| [apps/web/src/auth/form.ts](../../apps/web/src/auth/form.ts) | 保持 | 短い項目検証と既に分かれた送信/effect/描画。単純guardだけを変更しない |
| [apps/web/src/auth/redirect.ts](../../apps/web/src/auth/redirect.ts) | 保持 | 短い項目検証と既に分かれた送信/effect/描画。単純guardだけを変更しない |
| [apps/web/src/auth/reset.ts](../../apps/web/src/auth/reset.ts) | 保持 | 短い項目検証と既に分かれた送信/effect/描画。単純guardだけを変更しない |
| [apps/web/src/auth/session.ts](../../apps/web/src/auth/session.ts) | 変更 | 確認完了とredirect拒否を分割。認証分類・処理順は保持 |
| [apps/web/src/calendar.ts](../../apps/web/src/calendar.ts) | 変更 | 限定したprops・JSX階層・複合条件・説明コメントを整理。意味のある空白は保持 |
| [apps/web/src/copy/amount.ts](../../apps/web/src/copy/amount.ts) | 変更 | 単位別の表示設定と条件式を分割。丸め・単位・表示文字列は保持 |
| [apps/web/src/copy/app.ts](../../apps/web/src/copy/app.ts) | 保持 | 固定文言と短い表示変換。文字列や明確な単純guardを機械的に整形しない |
| [apps/web/src/copy/date.ts](../../apps/web/src/copy/date.ts) | 変更 | 最新main #281の年表示条件を保持。nullは補完しない説明とtodayによる年比較を整理。 |
| [apps/web/src/copy/goals.ts](../../apps/web/src/copy/goals.ts) | 保持 | 固定文言と短い表示変換。文字列や明確な単純guardを機械的に整形しない |
| [apps/web/src/copy/progress.ts](../../apps/web/src/copy/progress.ts) | 保持 | 固定文言と短い表示変換。文字列や明確な単純guardを機械的に整形しない |
| [apps/web/src/copy/today.ts](../../apps/web/src/copy/today.ts) | 保持 | 固定文言と短い表示変換。文字列や明確な単純guardを機械的に整形しない |
| [apps/web/src/features/account/AccountMenu.tsx](../../apps/web/src/features/account/AccountMenu.tsx) | 変更 | 限定したprops・JSX階層・複合条件・説明コメントを整理。意味のある空白は保持 |
| [apps/web/src/features/evaluation/EvaluationPage.tsx](../../apps/web/src/features/evaluation/EvaluationPage.tsx) | 変更 | 密集した状態分岐・送信境界・propsとJSX階層を分割。文言・拒否順・呼出順は保持 |
| [apps/web/src/features/evaluation/useEvaluation.ts](../../apps/web/src/features/evaluation/useEvaluation.ts) | 変更 | 密集した状態分岐・送信境界・propsとJSX階層を分割。文言・拒否順・呼出順は保持 |
| [apps/web/src/features/history/calendar.ts](../../apps/web/src/features/history/calendar.ts) | 変更 | 読込境界・長いprops・暦日配列を分割。月選択と日付境界は保持 |
| [apps/web/src/features/history/DayMark.tsx](../../apps/web/src/features/history/DayMark.tsx) | 変更 | 読込境界・長いprops・暦日配列を分割。月選択と日付境界は保持 |
| [apps/web/src/features/history/HistoryPage.tsx](../../apps/web/src/features/history/HistoryPage.tsx) | 変更 | 読込境界・長いprops・暦日配列を分割。月選択と日付境界は保持 |
| [apps/web/src/features/history/RecentDays.tsx](../../apps/web/src/features/history/RecentDays.tsx) | 保持 | 候補を確認済み。短い純粋表示/境界で追加変更の利益が小さいため保持 |
| [apps/web/src/features/today/chart-geometry.ts](../../apps/web/src/features/today/chart-geometry.ts) | 変更 | 長いprops・SVG属性・座標式・制御を分割。数式順・文字列・描画順は保持 |
| [apps/web/src/features/today/CoreMetric.tsx](../../apps/web/src/features/today/CoreMetric.tsx) | 保持 | 候補を確認済み。短い純粋表示/境界で追加変更の利益が小さいため保持 |
| [apps/web/src/features/today/day-rollover.ts](../../apps/web/src/features/today/day-rollover.ts) | 保持 | 候補を確認済み。短い純粋表示/境界で追加変更の利益が小さいため保持 |
| [apps/web/src/features/today/DraftProgressPreview.tsx](../../apps/web/src/features/today/DraftProgressPreview.tsx) | 変更 | 長いprops・SVG属性・座標式・制御を分割。数式順・文字列・描画順は保持 |
| [apps/web/src/features/today/fetch-policy.ts](../../apps/web/src/features/today/fetch-policy.ts) | 保持 | 候補を確認済み。短い純粋表示/境界で追加変更の利益が小さいため保持 |
| [apps/web/src/features/today/forecast-view.ts](../../apps/web/src/features/today/forecast-view.ts) | 変更 | 前段のToday責務抽出・整形で整理済み。追加差分は不要 |
| [apps/web/src/features/today/ForecastBoundary.tsx](../../apps/web/src/features/today/ForecastBoundary.tsx) | 保持 | 候補を確認済み。短い純粋表示/境界で追加変更の利益が小さいため保持 |
| [apps/web/src/features/today/GoalMenu.tsx](../../apps/web/src/features/today/GoalMenu.tsx) | 保持 | 候補を確認済み。短い純粋表示/境界で追加変更の利益が小さいため保持 |
| [apps/web/src/features/today/OutlookPanel.tsx](../../apps/web/src/features/today/OutlookPanel.tsx) | 変更 | 長いprops・SVG属性・座標式・制御を分割。数式順・文字列・描画順は保持 |
| [apps/web/src/features/today/ProgressSummary.tsx](../../apps/web/src/features/today/ProgressSummary.tsx) | 変更 | 長いprops・SVG属性・座標式・制御を分割。数式順・文字列・描画順は保持 |
| [apps/web/src/features/today/RecordedSummary.tsx](../../apps/web/src/features/today/RecordedSummary.tsx) | 変更 | 長いprops・SVG属性・座標式・制御を分割。数式順・文字列・描画順は保持 |
| [apps/web/src/features/today/ResponsiveDetails.tsx](../../apps/web/src/features/today/ResponsiveDetails.tsx) | 変更 | 長いprops・SVG属性・座標式・制御を分割。数式順・文字列・描画順は保持 |
| [apps/web/src/features/today/snapshot.ts](../../apps/web/src/features/today/snapshot.ts) | 変更 | 前段のToday責務抽出・整形で整理済み。追加差分は不要 |
| [apps/web/src/features/today/target-gap.ts](../../apps/web/src/features/today/target-gap.ts) | 変更 | null日数を計算範囲より先と断定するコメントを簡潔に訂正。コードは保持 |
| [apps/web/src/features/today/TodayContent.tsx](../../apps/web/src/features/today/TodayContent.tsx) | 変更 | 前段のToday責務抽出・整形で整理済み。追加差分は不要 |
| [apps/web/src/features/today/TodayPage.tsx](../../apps/web/src/features/today/TodayPage.tsx) | 変更 | 前段のToday責務抽出・整形で整理済み。追加差分は不要 |
| [apps/web/src/features/today/useTodayData.ts](../../apps/web/src/features/today/useTodayData.ts) | 変更 | 前段のToday責務抽出・整形で整理済み。追加差分は不要 |
| [apps/web/src/features/today/yesterday-later.ts](../../apps/web/src/features/today/yesterday-later.ts) | 保持 | 候補を確認済み。短い純粋表示/境界で追加変更の利益が小さいため保持 |
| [apps/web/src/features/today/YesterdayDetails.tsx](../../apps/web/src/features/today/YesterdayDetails.tsx) | 変更 | 長いprops・SVG属性・座標式・制御を分割。数式順・文字列・描画順は保持 |
| [apps/web/src/main.tsx](../../apps/web/src/main.tsx) | 保持 | 候補を確認済み。短い純粋表示/境界で追加変更の利益が小さいため保持 |
| [apps/web/src/router.tsx](../../apps/web/src/router.tsx) | 変更 | 確認完了とredirect拒否を分割。認証分類・処理順は保持 |
| [apps/web/src/routes/AppShell.tsx](../../apps/web/src/routes/AppShell.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/routes/AuthPage.tsx](../../apps/web/src/routes/AuthPage.tsx) | 保持 | 短い項目検証と既に分かれた送信/effect/描画。単純guardだけを変更しない |
| [apps/web/src/routes/ForgotPasswordPage.tsx](../../apps/web/src/routes/ForgotPasswordPage.tsx) | 保持 | 短い項目検証と既に分かれた送信/effect/描画。単純guardだけを変更しない |
| [apps/web/src/routes/HealthPage.tsx](../../apps/web/src/routes/HealthPage.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/routes/Home.tsx](../../apps/web/src/routes/Home.tsx) | 変更 | 限定したprops・JSX階層・複合条件・説明コメントを整理。意味のある空白は保持 |
| [apps/web/src/routes/MainLandmark.tsx](../../apps/web/src/routes/MainLandmark.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/routes/ResetPasswordPage.tsx](../../apps/web/src/routes/ResetPasswordPage.tsx) | 保持 | 短い項目検証と既に分かれた送信/effect/描画。単純guardだけを変更しない |
| [apps/web/src/routes/RouteStates.tsx](../../apps/web/src/routes/RouteStates.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/routes/SessionFailure.tsx](../../apps/web/src/routes/SessionFailure.tsx) | 変更 | 最新main #283のsession失敗UIを保持し、重複した説明だけを簡潔化。新規main部品も確認。 |
| [apps/web/src/ui/components/AppBar.tsx](../../apps/web/src/ui/components/AppBar.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/Button.tsx](../../apps/web/src/ui/components/Button.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/ChoiceButton.tsx](../../apps/web/src/ui/components/ChoiceButton.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/ConfirmDialog.tsx](../../apps/web/src/ui/components/ConfirmDialog.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/DeskHeader.tsx](../../apps/web/src/ui/components/DeskHeader.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/FormField.tsx](../../apps/web/src/ui/components/FormField.tsx) | 変更 | 限定したprops・JSX階層・複合条件・説明コメントを整理。意味のある空白は保持 |
| [apps/web/src/ui/components/Icon.tsx](../../apps/web/src/ui/components/Icon.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/Notice.tsx](../../apps/web/src/ui/components/Notice.tsx) | 変更 | 最新main #280のfocusTitle・effect依存を保持し、effectのcontrolとWHYコメントを分割。 |
| [apps/web/src/ui/components/PageTitle.tsx](../../apps/web/src/ui/components/PageTitle.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/Section.tsx](../../apps/web/src/ui/components/Section.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/Spinner.tsx](../../apps/web/src/ui/components/Spinner.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/StatusBadge.tsx](../../apps/web/src/ui/components/StatusBadge.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/components/StickyActionBar.tsx](../../apps/web/src/ui/components/StickyActionBar.tsx) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/layout.ts](../../apps/web/src/ui/layout.ts) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |
| [apps/web/src/ui/useElementWidth.ts](../../apps/web/src/ui/useElementWidth.ts) | 保持 | 短い部品・宣言・ルート状態。既存階層が読めるため不要な全体整形をしない |

### package検証入口

| file | 判断 | 理由 |
| --- | --- | --- |
| [apps/api/package.json](../../apps/api/package.json) | 保持 | 既存commandと依存を保持。formatter・新依存を導入しない。 |
| [apps/web/package.json](../../apps/web/package.json) | 保持 | 既存commandと依存を保持。formatter・新依存を導入しない。 |
| [package.json](../../package.json) | 変更 | 既存Foundation/CI診断へのaliasを追加。依存・既存command・gateは保持。 |
| [packages/prediction/package.json](../../packages/prediction/package.json) | 保持 | 既存commandと依存を保持。formatter・新依存を導入しない。 |

### 検証入口・FE test

| file | 判断 | 理由 |
| --- | --- | --- |
| [.github/scripts/check-migrations.sh](../../.github/scripts/check-migrations.sh) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [.github/scripts/ci-report.mjs](../../.github/scripts/ci-report.mjs) | 変更 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [.github/scripts/ci-report.test.mjs](../../.github/scripts/ci-report.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [.github/scripts/smoke-script-tests.sh](../../.github/scripts/smoke-script-tests.sh) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [apps/web/tests/amount-editor.browser.tsx](../../apps/web/tests/amount-editor.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/amount.test.mjs](../../apps/web/tests/amount.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/auth-action.test.mjs](../../apps/web/tests/auth-action.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/auth-pages.test.mjs](../../apps/web/tests/auth-pages.test.mjs) | 保持 | No dense controls/sequences or long conditions requiring a change |
| [apps/web/tests/auth-redirect.test.mjs](../../apps/web/tests/auth-redirect.test.mjs) | 保持 | No dense controls/sequences or long conditions requiring a change |
| [apps/web/tests/browser-configuration.test.mjs](../../apps/web/tests/browser-configuration.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/browser-debug-endpoint.mjs](../../apps/web/tests/browser-debug-endpoint.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/browser-debug-endpoint.test.mjs](../../apps/web/tests/browser-debug-endpoint.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/browser-startup.mjs](../../apps/web/tests/browser-startup.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/browser-startup.test.mjs](../../apps/web/tests/browser-startup.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/client.test.mjs](../../apps/web/tests/client.test.mjs) | 保持 | No dense controls/sequences or long conditions requiring a change |
| [apps/web/tests/completion-horizon.test.mjs](../../apps/web/tests/completion-horizon.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/evaluation-boundary.test.mjs](../../apps/web/tests/evaluation-boundary.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/evaluation.browser-check.mjs](../../apps/web/tests/evaluation.browser-check.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/fetch-policy.test.mjs](../../apps/web/tests/fetch-policy.test.mjs) | 保持 | No dense controls/sequences or long conditions requiring a change |
| [apps/web/tests/footprint.test.mjs](../../apps/web/tests/footprint.test.mjs) | 保持 | No dense controls/sequences or long conditions requiring a change |
| [apps/web/tests/form-recovery.test.mjs](../../apps/web/tests/form-recovery.test.mjs) | 変更 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/goal-feedback.browser-check.mjs](../../apps/web/tests/goal-feedback.browser-check.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/goal-feedback.browser.tsx](../../apps/web/tests/goal-feedback.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/goal-feedback.test.mjs](../../apps/web/tests/goal-feedback.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/goal-form.test.mjs](../../apps/web/tests/goal-form.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/goal-integrity.test.mjs](../../apps/web/tests/goal-integrity.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/goal-recovery.test.mjs](../../apps/web/tests/goal-recovery.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/history.test.mjs](../../apps/web/tests/history.test.mjs) | 保持 | No dense controls/sequences or long conditions requiring a change |
| [apps/web/tests/issue148-browser.mjs](../../apps/web/tests/issue148-browser.mjs) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [apps/web/tests/issue185-browser-check.mjs](../../apps/web/tests/issue185-browser-check.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/issue185-failure.browser.tsx](../../apps/web/tests/issue185-failure.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/outlook-axis.native.tsx](../../apps/web/tests/outlook-axis.native.tsx) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/password-reset.test.mjs](../../apps/web/tests/password-reset.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/record-log.test.mjs](../../apps/web/tests/record-log.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/register-contracts.mjs](../../apps/web/tests/register-contracts.mjs) | 変更 | No dense controls/sequences or long conditions requiring a change |
| [apps/web/tests/responsive-details.browser-check.mjs](../../apps/web/tests/responsive-details.browser-check.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/responsive-details.browser.tsx](../../apps/web/tests/responsive-details.browser.tsx) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/routes.browser.tsx](../../apps/web/tests/routes.browser.tsx) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/session-browser-ci.test.mjs](../../apps/web/tests/session-browser-ci.test.mjs) | 保持 | No dense controls/sequences or long conditions requiring a change |
| [apps/web/tests/session-cache.browser-check.mjs](../../apps/web/tests/session-cache.browser-check.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/session-cache.browser.tsx](../../apps/web/tests/session-cache.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/session-confirm.test.mjs](../../apps/web/tests/session-confirm.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/session-draft.browser.tsx](../../apps/web/tests/session-draft.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/session-focus.browser.tsx](../../apps/web/tests/session-focus.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/session-today-boundary.browser.tsx](../../apps/web/tests/session-today-boundary.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/session-today.browser.tsx](../../apps/web/tests/session-today.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/sign-out.browser.tsx](../../apps/web/tests/sign-out.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/target-date-integrity.test.mjs](../../apps/web/tests/target-date-integrity.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/target-gap.test.mjs](../../apps/web/tests/target-gap.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/today-data.test.mjs](../../apps/web/tests/today-data.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/today-presentation.test.mjs](../../apps/web/tests/today-presentation.test.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [apps/web/tests/yesterday-correction.native.tsx](../../apps/web/tests/yesterday-correction.native.tsx) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [apps/web/tests/yesterday-rollover.browser.tsx](../../apps/web/tests/yesterday-rollover.browser.tsx) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [packages/prediction/scripts/benchmark-goal-prior-candidate.mjs](../../packages/prediction/scripts/benchmark-goal-prior-candidate.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [packages/prediction/scripts/benchmark.mjs](../../packages/prediction/scripts/benchmark.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [packages/prediction/scripts/check.mjs](../../packages/prediction/scripts/check.mjs) | 変更 | No dense controls/sequences or long conditions requiring a change |
| [packages/prediction/scripts/test-files.mjs](../../packages/prediction/scripts/test-files.mjs) | 変更 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [packages/prediction/scripts/verify-docker.mjs](../../packages/prediction/scripts/verify-docker.mjs) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/build-vercel.mjs](../../scripts/build-vercel.mjs) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [scripts/check-doc-migration.ps1](../../scripts/check-doc-migration.ps1) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/check-document-diagrams.ps1](../../scripts/check-document-diagrams.ps1) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [scripts/check-foundation.ps1](../../scripts/check-foundation.ps1) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [scripts/check-migrations.mjs](../../scripts/check-migrations.mjs) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/install-hooks.ps1](../../scripts/install-hooks.ps1) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
| [scripts/render-readme-diagrams.ps1](../../scripts/render-readme-diagrams.ps1) | 保持 | Current entry is readable; archived exporter and exact SVG strings preserved |
| [scripts/smoke-compose.sh](../../scripts/smoke-compose.sh) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/smoke-container.sh](../../scripts/smoke-container.sh) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/smoke-env.sh](../../scripts/smoke-env.sh) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/smoke-today.sh](../../scripts/smoke-today.sh) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/test-doc-migration.ps1](../../scripts/test-doc-migration.ps1) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/tests/check-document-diagrams.test.ps1](../../scripts/tests/check-document-diagrams.test.ps1) | 変更 | Split dense event/state/await/assert sequences or control/argument groups; preserve behavior and literals |
| [scripts/tests/check-migrations.test.mjs](../../scripts/tests/check-migrations.test.mjs) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/tests/smoke-env.test.sh](../../scripts/tests/smoke-env.test.sh) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/tests/smoke-today.test.sh](../../scripts/tests/smoke-today.test.sh) | 保持 | Docker/CD/migration exclusion; inspect inventory only |
| [scripts/tests/vercel-bundle.test.mjs](../../scripts/tests/vercel-bundle.test.mjs) | 保持 | Remaining hits are literal fixtures, generated source strings, self-contained expected payloads, or short single-purpose guards/assertion loops |
