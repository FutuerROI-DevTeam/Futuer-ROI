# #225 本人向け評価：検証と運用待ち

2026-10-11。Supporting Artifact。[Product R-12/P-22](../product-spec.md#本人向けの予測保存実績照合r-12既定off)・[Architecture D-32](../architecture.md#d-32-本人向け評価の保存境界225)が正本。既定OFFの追加Should実装であり、実利用や校正済みの証拠ではない。

## 設定と運用待ち

`.env.example`の`EVALUATION_ENABLED=0`を既定とする。有効化は今回実行していない。設定の上限はD-32、実装は[policy](../../apps/api/src/evaluation/policy.ts)を参照する。`EVALUATION_BUILD_VERSION`（80文字までの英数字・`.`・`_`・`-`）または`VERCEL_GIT_COMMIT_SHA`で発行buildを識別する。機密値、個人名、端末IDを指定しない。

実データで開始する前に、利用説明、保持/削除責任者、定期purge頻度と失敗監視、バックアップ上の保持・削除、既存環境へのmigration適用の承認を確定する。これらはOPEN。expiry/age filterで見えなくなったことを物理削除完了とは扱わない。参加期限は参加開始から固定で、遅い発行や再参加ボタンの再送では延長しない。解除後の明示再参加は新しい世代になる。

手動削除の実装入口は、対象と接続先を承認した環境でrootから次のコマンドを実行する。

```text
npm run evaluation:purge --workspace=@futureroi/api -- --confirm-evaluation-purge
```

この入口は`DATABASE_URL`必須でroot `.env`を読み得るため、対象DBを確認せず実行しない。評価tableだけをtransactionで処理し、stdoutには削除件数だけを出す。本タスクはこのCLIを既存/本番DBへ実行していない。専用合成DBではstoreのpurge、expiry、途中失敗のrollbackを検証した。定期schedulerは追加していない。

## 再検証

Node 24.21.0、locked dependencies。既存DBへ誤接続しないよう、local API/browser testは`DATABASE_URL`を除外する。test helperが作る専用合成embedded PostgreSQLだけを使う。

```text
npm run typecheck
npm run test --workspace=@futureroi/prediction
npm run test --workspace=@futureroi/api
npm run test --workspace=@futureroi/web
npm run build
```

専用FE回帰はwebディレクトリで既定と同じalias loaderを使う。

```text
node --import ./tests/register-contracts.mjs --test tests/evaluation-boundary.test.mjs
```

追加の実SPAブラウザはrootで実行する。web build必須。Chromeの既存native CDP helperを使い、新規依存はない。`TEST_BROWSER`で既存browser executable、`EVALUATION_BROWSER_ARTIFACTS`で合成画面PNGの保存先を指定できる。

```text
npm run build --workspace=@futureroi/web
node --test apps/web/tests/evaluation.browser-check.mjs
```

## 確認範囲

- 実HTTP/専用合成DBの評価回帰31件：既定OFF、auth/Origin/owner、strict body、1Goal参加、Engine一致、同日最初の値保持・同時再送、actual amount、q+2、UNKNOWN、null/horizon、timezone、入力訂正・設定/回答版、期限・上限、解除・Goal/user cascade、purge rollback。保存の計算途中で量/設定/回答/現地日/解除/再参加/Goal削除が替わる8ケースを含む。同値PUTは保存できる。
- FEの実hook/QueryClient回帰19件：owner切替・A→B→A・同owner再確認・draft世代・遅延応答・自動送信なし・解除後GET復活防止、401/404後の正常GET回復、続く500で古い401/404を復活させない。
- 実Chrome 154、実SPA・認証API・合成DB：説明checkbox→参加→発行→同日再操作1行→後日のDONE量7+3でP50未到達/P80到達→解除で評価0行かつ業務log3行保持、別ownerの新規navigationで404表示、既定OFF画面。390/1280pxでpage横overflowなし、画面PNGを確認する。
- 独立敵対的レビューは解除前GETの履歴復活を発見して修正前/後の実QueryClientで検証。保持説明と401/404エラー回復のShouldも修正し専用runnerで再確認する。独立レビュー担当はDB/browserを別実行していない。

最終全suite、build、exact HEAD CI結果はPR本文と検証追記に記録する。未実行結果を成功へ数えない。初回ブラウザrunは固定文言の期待値不一致で失敗し、実UI文言に合わせた再実行で上のflowを完了した。実データや公開環境の品質、別タブの保留応答のpixel描画、代表性、校正・学習効果、g50の因果効果は未検証。別ownerブラウザ検証はfresh navigationのアクセス拒否である。

## 合成画面の記録

最終web buildの実SPA/API/合成DBをChrome 154で操作した画面。架空の利用者名・Goal・実績だけを使用した。

- [390px：P50未到達/P80到達の照合](assets/issue-225/390-assessed.png)
- [1280px：同じ照合](assets/issue-225/1280-assessed.png)
- [1280px：既定OFF](assets/issue-225/1280-default-off.png)
