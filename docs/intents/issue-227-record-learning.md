# #227 本人の記録から学ぶ予測のDesign Intent

Supporting Artifact / Not a Source of Truth。正式なScope・表示は[Product R-13/P-23](../product-spec.md#本人の記録から学ぶ予測r-13既定off)、計算・保存・契約は[Architecture D-33](../architecture.md#d-33-本人の記録から学ぶ予測227)を正本とする。[Issue #227](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/227)、2026-10-11、base `013ac93` からの作業中source。最終HEADでの全体検証や実運用承認を済みとは扱わない。

## Context / Intent

#225の本人限定記述評価と参加は維持する。最初の#227依頼は本人履歴学習→未見比較→資格採用→Today主予測で、P-22/D-32の学習除外をsource/所有合成検証に限り再検討した履歴である。追加の人間承認は**標準R11主表示を保った明示本人履歴fitと実験forecast並列比較**。精度改善・実80%的中未確認、no-auto-adoption。本人実データ運用や本番flagを許可した意味ではない。

旧v1/v2資格gateは監査履歴として保持する。90日保持対約190日の未見資格比較、as-of回答履歴はHOLDで、固定MID/全9priorを解決済みの製品条件へ昇格しない。


## Design / Why

実在する隣接記録だけをcanonical入力にし、未知日では期間をリセットする。`duration-model-v1`のp1は独立Beta、p0/gammaは同時事後。gamma点・prior・cap・比較窓・gateはholdoutを見る前に固定する。p0/gammaの平均を将来の毎日に入れる方式では同一経路のパラメータ不確実性を失うため、1経路のパラメータを固定してCDFを求める。

旧資格経路の設計履歴: 既存R-11を比較対象とし、両モデルが同じ起点・残量・量・観測窓の結果を使う。初回の時系列60/20/20分割とH+2訂正窓、partitionごとの起点/block/適用件数、RPS改善・P80過信・有限率を満たす場合だけADOPTABLEにする。固定候補を選んだ後に検証ラベルを見てモデルや閾値を変え、同じテストで成功扱いしない。再fit/解除再参加でも新しい未見期間を必要とし、Goalごとに比較済み最終日1個を残す。

別参加・immutable結果・id/hashを使う。新実験POSTはtraining-only fitでpurpose=EXPERIMENTAL、gate=INSUFFICIENTの結果を保存する。numeric不足でも理由付き結果を保存し、学習成功・資格合格を主張しない。旧CAS資格pointerは別監査欄として保持する。新標準主表示はR11、評価発行はdisplayedForecast=BASELINEを明示する。旧未指定クライアントselectorと既存同日immutable replayは維持し、実験値を評価保存・採用しない。

標準主表示を保持し、実験の別DTOで同じ今日量/H≤30のBASELINE referenceとEXPERIMENTALを並列比較する。不足はnull/reasonを示しbaselineを借りない。正量と0休みは別起点の未保存GET。精度改善・実80%的中未確認を示し、量差を因果的遅延と呼ばない。
## Invariants / Failure Modes

- 未知日はSKIPPEDではない。重複PUTや並び順で遷移を二重加算しない。初期進捗・今日の仮実行・質問回答を学習遷移にしない。
- owner/参加世代/fit世代/Goal/日付/設定・回答版/hash/CASが合わない書込みを確定しない。計算中のDB接続保持や自動書込みretryをしない。
- FEは書込み前にlearning/Today/evaluationの読取を取消し、ローカル世代とprivate/draft境界でabort無視の遅延応答を拒否する。書込み結果が不明ならowner cache内の保留状態を画面再表示にも引き継ぎ、fresh採用状態とfreshTodayの両方が同じ採用版で確認されるまで実験/資格予測・操作を保留し標準主表示は保つ。解除後に古いGETで候補を戻さず、タブ復帰は読取再確認だけにする。選択済みpointerだけで実適用中と表示しない。
- 不採用、不足、未知期間、数値診断不足、期限/条件変更を隠して採用済み表示へ進めない。401/404とtransient500を区別する。
- 新しい参加説明は解除時の候補/モデル/学習予測評価削除、日次記録保持、最終比較日だけのGoal削除までの保持を明示する。backup消去や法的同意を保証しない。
- 本人1Goal、既定OFF、最大90日/5候補、初期H30/cap14。デモのためにgate・期間・最低件数を緩めない。

## Alternatives / Trade-offs / Non-goals

合成数値だけのツールは隔離が簡単だが、要求された本人の実験モデルを別カードで比較できない。既存Beta値への偽装は出所とモデル条件を取り違える。全閲覧からの自動学習、全員即採用、同じholdoutの再利用は範囲と過学習リスクを増やす。独立した有界候補と明示操作は実装・保持・失敗状態を増やすが、gateや所有者境界を確認できる。新比較はreadonlyでactivepointerを書かず、訂正後の遅い旧RR replyをQuery identity/countとprivate/draft世代で棄却する。

十分に長く欠損の少ない記録がなければ採用されない。16/32/64点の有限診断に加え、学習completionは実N/H/状態のCDF32→64点の有限refinement（H≤30）とsurvival補助診断を使い、固定検査workの予算超過は不足にする。採用CDFは64点のp0/gamma同時分布とp1 Beta積分から直接返す`POSTERIOR_QUADRATURE`で、samples/seed metadataはnull、入力samples/seedにも依存しない。有限同時モデルに対するMC誤差は0で、MC envelopeは`POSTERIOR_PATHS`だけに適用する。これは連続posterior全CDF積分誤差の証明ではなく、単一spellのsurvival収束だけで複数spellのcompletionを保証しない。短期・本人sampleの比較は実ユーザー全体の精度、校正、因果効果や理解を示さない。リアルタイム自動学習、外部転送、新個人属性、実データfit、公開migration/flag、認証設定/保護変更、merge/deployは対象外。

## Evidence / Code Map / Tests

ENGINEERING（2026-10-11、所有source/合成入力）。[対応表](../change-map.md#本人の記録から学ぶ予測227)からcanonical/数値core、service/gate、owner store/route、主表示/hookと対応testsへたどる。FE担当によるproduction hook＋実QueryClient/実部品SSR39件（INT4境界追随を含む）と型検査はPASS。加えて[専用Chrome runner](../../apps/web/tests/learning.browser-check.mjs)で実React/QueryClient/PrivateCacheGuard/LearningToday/strict HTTP reader/ConfirmDialogの7確認群はPASS（参加・不採用/明示採用・量比較・rollback・同owner確認・A→B遅延応答・解除）。auth stateとHTTP transportだけを合成化し、ADOPTABLEはUI注入fixtureで数理gateの証明ではない。MutationObserverとlayout commitで観測したDOMの境界であり、SDK・実API/DB・pixel・実データ精度の証明ではない。専用Chrome/profileの終了・一時directory削除を確認し、他process/profileは操作していない。API/mathの後続修正、最終全suite/build、実SPA/API browserは主担当による最終記録で区別する。本記録は未実施結果を成功へ置き換えない。

### 後続phase：標準主表示保持の実験比較（2026-10-11）

V2 source freeze（10:28 UTC、useLearning SHA256 `86707cc6…`、12 files）を最新main `208d481` と統合。Web 248 PASS / 1 runner案内skip、型検査・build PASS。独立境界/SSR/評価124 PASSと実Chrome9群 PASS、全session実Chrome21/21 PASS。direct query resetのcount ABAは比較専用の単調世代で失効させ、通常の並行report/Today読取を保つ。旧39件/7群・資格検証と失敗証跡は先行phaseの履歴として維持する。

本物App/Better Auth/実API/所有embedded DBを使い、8日HIGH/HIGH合成記録から別同意→実fit POST201→同量/H30比較GET200（10/20/0）→標準main/activepointer/日次記録保持→認証APIによる昨日記録訂正→fresh Appで実験不足・baseline値非流用→実ConfirmDialog解除までPASS。numeric/gate注入なし。訂正自体のUI編集は未実行。初回driverの反映待ち不足による未fit停止を別証跡に保全し、fresh専用環境で再実行した。Chrome/profile・所有API/DB/資格情報のcleanupを確認する。

390px/1280px PNG・DOM証跡を取得。親の視覚確認はdesktop全ページの標準main/両出所・H30対1095日と、SP viewportの比較操作/可読性/横はみ出しに限定する。SP pixelでは実験欄下段全体・訂正不足カードを未確認（DOM回帰は確認済み）。実データ精度改善・実80%的中・数学採用資格・実運用/削除運用の承認、Human/公開CI、merge/deployは未確認・未実行。

## Change Guidance / Reconsider When

モデルのパラメータ、prior/gamma点、分割/期間/gate、複数Goal/長期保持、source契約、最終日receiptを変える場合は新しい未見期間と理由・運用判断を先に必要とする。積分誤差保証、runtime資源上限、欠損による適用不足、利用者の誤読、解除/backupの実運用を実測し、実利用OPENへ進める判断は別に行う。合成例を採用可能にする目的で閾値やMinimumを変更しない。
