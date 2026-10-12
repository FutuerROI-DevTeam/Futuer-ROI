# CI診断（Issue #188）

Application/Foundationは既存の検証コマンドとrequired check名を維持し、専用runnerで終了code・所要時間・checkout SHA・PR source HEAD SHAを記録する。PRのcheckoutはGitHubの合成merge commitになり得るため、両SHAを別項目で示す。

- 実行: node .github/scripts/ci-report.mjs run LAYER -- COMMAND [ARGS]
- summary: node .github/scripts/ci-report.mjs summary JOB
- 回帰: node --test .github/scripts/ci-report.test.mjs
- 保存先はRUNNER_TEMP/ci-report。local実行ではCI_REPORT_DIRで専用ディレクトリを指定できる。CI_SOURCE_SHAはWorkflowが設定する。
- Workflowのcommand実行はUbuntu。テストではNodeを直接起動し、Windowsでも診断を検証できる。

test層はnpm workspaceのPrediction/API/Webをそれぞれ集計する。固定件数のgateは置かない。集計欠落・重複・0件・不整合・fail/cancel/todoとCIのskipを失敗にする。local Webの明示browser skipは未実行として数え、実browser成功とは扱わない。その他のcommand検査の件数はN/A、未到達stepはnot-run。

この集計gateは元のcommand exit codeに追加する失敗条件であり、成功条件を厳しくする。診断のself-testを製品typecheckより先の必須stepに置くのは、結果の判定器の信頼性を先に検査するため。失敗時は後段の製品検査を未到達として示し、製品の型や挙動が失敗したとは読み替えない。migration確認のshell helperも`set -euo pipefail`を使い、旧inline stepに比べpipeline途中の失敗を見逃しにくくしている。

summaryは常時出力する。失敗artifactは既存のupload-artifact pinを使い、1日保持する。保存するJSONと.logは固定層名・SHA・数値・固定診断種別だけのallowlist。raw stdout/stderr、test名、例外本文、command引数、環境値、要求/応答、Cookie、browser storageは保存しない。詳細な失敗traceは元のActions job logで確認する。checkout/setup前の失敗には記録ファイルがない場合がある。

件数削減・並列度変更・coverage導入・閾値緩和・repository settings変更はしない。速度改善は同条件の実測なしに主張しない。

# 本番CDの判定（Issue #275）

- `deploy-gate.mjs`：Deploy productionの判定器。CI成功・mainの先頭・schemaの分類・配備SHAの照合だけを行い、Secretや接続値は扱わない。
- `with-production-db.sh`：Vercel Productionの直結URLを実行中だけ取得してmaskし、1コマンドへ`DATABASE_URL`として渡す。
- `smoke-deployment.sh`：候補・本番URLのhealth・トップ・未認証401を確認する。HTTP要求は接続5秒・1回20秒で打ち切る。
- `reconcile-production.sh`：promote後に本番URLの実deploymentを照合し、確認失敗・未切替・状態不明なら直前の版へ戻す。回帰は`reconcile-production.test.sh`（stub、Container jobのshell testで実行）。
- 回帰: node --test .github/scripts/deploy-gate.test.mjs（ApplicationのCIでも実行）。流れと停止・戻し方は[リリース手順書の12](../../docs/operations/release-guide.md#12-自動配備cd)。
