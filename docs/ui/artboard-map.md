# B案アートボードと現行実装の対応

**Supporting Doc / Not a Source of Truth.** 要件・表示・採択は[Product Spec](../product-spec.md)、技術契約は[Architecture](../architecture.md)。本表は[Issue #146](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/146)の対応表で、[画面設計](../design.md)から参照する。

現行コードの基準は main `2b4757873d441360337d7c2c1019770356bfde79`（2026-10-11）。PR147のB案構造にPR202の表示変更が入り、PR214・210・216・212も統合済み。初稿の基準main `86b396d5ae15e1b3e735a4df310e9e4216a086e4` ではPR210/216は未統合候補だった。初稿の制約と現行コードを区別し、撮影対象f106496・原画未照合・最終受入の残件は保全する。

## 証拠の区別

- **対応コードあり**：コードの分岐や原アートボードへのコメント参照がある。表示の成功・実データ・画像一致を確認した意味ではない。
- **部分対応**：関連する実装はあるが、元の番号と状態の1対1対応や画面差分が未確認。
- **未実装**：対象の操作/画面がコードにない。
- **対象外**：P-17/Issue146の明示対象外。未実装と受入失敗を混同しない。
- **合成実表示・操作の部分確認**：[C担当証拠](../changes/issue-171-composite-acceptance/README.md)は撮影当時のmain86b396d＋未merge PR210/214の合成HEAD `f106496`。下表のコード読取とは基準を分け、観測された状態だけを部分受入とする。
- **原画/基準main単独の実表示未確認**：全行の原画一致・番号割当・両幅の全状態受入は未完。合成の画像を原画IDへ推定割当しない。

[旧B案](https://claude.ai/artifact/Hxs7396eZNtYn8iLYmyMi8)は、2026-10-11にArtifactの読取り（`project/canvas.json`、版 `1791300556-3f22`）で全アートボードの識別子と題名を取得した（下の[原画の一覧](#原画の一覧2026-10-11取得)）。以前の記述（Web取得で再取得できなかった）は、この取得で解消した。題名による1対1の対応はコード読取りで行い、各アートボードの絵と画面の画素一致は確認していない。

## 原画の一覧（2026-10-11取得）

「B案：画面と状態」ページの全56枚（ファイル名から `v2-` と拡張子を除いた識別子と、キャンバス上の題名）。ほかに「トークンと部品」「分布の表し方（比較）」ページの8枚があり、#146の対象外。

| 識別子 | 題名 |
| --- | --- |
| A1-login | A1 ログイン：通常 |
| A1-signup | A1 新規登録：通常 |
| A2-error | A2 入力エラー |
| A3-sending | A3 送信中 |
| A4-wait | A4 試行が多すぎて待ちが必要 |
| A5-expired | A5 ログインの期限切れ（401） |
| B-account | B アカウントメニュー（ログアウト） |
| B-empty | B ホーム：Goalが0件 |
| B-error | B ホーム：通信失敗 |
| B-home | B ホーム：通常 |
| B-loading | B ホーム：読込中 |
| B-notfound | B Goalが見つからない（404） |
| C1-create | C Goal作成：通常 |
| C2-errors | C 項目ごとの入力エラー |
| C3-saving | C 保存中 |
| C4-failed | C 保存失敗 |
| C5-edit | C 編集：記録ありで一部変更不可 |
| C6-delete | C 削除確認ダイアログ |
| C7-edit-prior | R6 Goal編集：初期質問の回答を見直す |
| D1 | D1 未記録・データ十分 |
| D1-dark | D1 ダークテーマ |
| D1-sheet | D1 「やった」の量を確認 |
| D1-slow | D1 再開が遅い例（筋トレ） |
| D1-why | D1 計算の根拠を開いた状態 |
| D2-D3 | D2+D3 両方データ不足（読書） |
| D3-only | D3 完了の目安だけデータ不足 |
| D4-over3 | D4 目安も余裕をみた日付も3年以上先（例示用Goal） |
| D4b-p80-over3 | D4b 目安は出るが、余裕をみた日付は3年以上先（例示） |
| D5-change | D5b 今日の記録を変更 |
| D5-done | D5 今日は記録済み（やった） |
| D5-rest | D5 今日は記録済み（休んだ） |
| D6-achieved | D6 達成済み（筋トレ） |
| D7-calc | D7 見込みを計算できない（500 PREDICTION_FAILED） |
| D7-date | D7 記録できない日（422 LOG_DATE_OUT_OF_WINDOW） |
| D7-failed | D7 保存失敗（再試行） |
| D7-network | D7 通信エラー（データ不足と区別） |
| D7-saving | D7 保存中 |
| D8-zero | D8 完了まで0日（今日やれば届く） |
| Desk-home | B ホーム デスクトップ幅 |
| Desk-today | D1 デスクトップ幅 |
| E1 | E1 昨日が未記録：問いかけ |
| E2 | E2 昨日「やった」の量を変更 |
| E3-failed | E3 昨日の保存失敗：再回答 |
| E3-saving | E3 昨日の記録を保存中 |
| E4 | E4 今日から記録を始めたGoal |
| F1-calendar | F 記録履歴カレンダー（任意） |
| H-A | 見出しA：今日サボると |
| H-B | 見出しB：今日休むと |
| P1 | 提案A 直近7日の帯から訂正 |
| P2 | 提案B 記録ボタンの下に昨日の行 |
| P3 | 提案C ヘッダーのメニューから訂正 |
| R1-questions | R1 Goal作成：初期質問を開いた状態 |
| R2-answer | R2 回答だけの仮の見通し（片方未回答） |
| R3-mixed | R3 回答＋実績の見通し（出所別） |
| R4-none | R4 回答も記録もなく材料不足 |
| R5-review | R5 回答の見直し：保存を確認できない |

## 対応表

| 原画の識別子/群 | 現行routeと表示させる条件 | コード入口 | コード上の対応／原画照合 |
| --- | --- | --- | --- |
| A1 | /login または /register、通常 | [AuthPage](../../apps/web/src/routes/AuthPage.tsx) | 対応コードあり。通常・切替・パスワード表示。原画未照合 |
| A2 | 同上、空欄/不正入力で送信 | AuthPage、[auth/form](../../apps/web/src/auth/form.ts) | 対応コードあり。項目/まとめエラー、focus |
| A3 | 同上、認証送信が保留中 | AuthPage | 対応コードあり。busy、入力/送信停止 |
| A4 | 同上、429応答 | AuthPage | 対応コードあり。再開時刻、送信待ち |
| A5 | /login?reason=expired、再認証入口 | AuthPage | 対応コードあり。期限切れ理由を登録切替でも保持 |
| B-home | /goals、Goalが1件以上 | [GoalListPage](../../apps/web/src/features/goals/GoalListPage.tsx) | 対応コードあり。累計/総量/進捗/今日状態/Today入口。外観はPR202で更新 |
| B・0件状態 | /goals、一覧が空 | GoalListPage.EmptyGoals | 対応コードあり。原画の厳密な派生IDは未確認 |
| B-loading | route確認が遅い、または一覧取得中 | [RouteStates](../../apps/web/src/routes/RouteStates.tsx)、GoalListPage.ListLoading | 対応コードあり。route pendingと一覧skeletonを分ける |
| B-error・通信失敗 | sessionまたはデータ取得を失敗させる | RouteStates、[GoalStates](../../apps/web/src/features/goals/GoalStates.tsx) | 対応コードあり。未ログインへ誤送しない入口、再読込 |
| B-notfound | 未定義URL | RouteStates.NotFoundPage | 対応コードあり。Goal固有404とは別 |
| B-account | 一覧のアカウント、desktop共通バーから開く | [AccountMenu](../../apps/web/src/features/account/AccountMenu.tsx) | 対応コードあり。メール、logout、閉じる/失敗。PR216の削除失敗/結果不明は503・Cookie保持・明示再試行（[正本](../architecture.md#ログアウトの失敗と明示再試行215)）。元f106496画像はこの変更を含まない |
| C1 | /goals/new、任意質問を折り畳んだフォーム | [GoalFormFields](../../apps/web/src/features/goals/form/GoalFormFields.tsx) | 部分対応。C1/R1コメントあり。C1全構成は原画未照合 |
| C2「項目ごとの入力エラー」 | /goals/new・/goals/:id/edit、空欄・範囲外で保存 | [GoalFormPage](../../apps/web/src/features/goals/GoalFormPage.tsx)、[goal-form](../../apps/web/src/features/goals/goal-form.ts) | 対応コードあり。項目ごとのエラーとまとめ、最初の誤りへfocus |
| C3「保存中」 | 同上、保存の応答待ち | GoalFormPage | 対応コードあり。保存ボタンのbusy、入力停止 |
| C4「保存失敗」 | 同上、POST/PATCHの失敗 | GoalFormPage.SaveFailure | 対応コードあり。入力を残し明示再試行。409は最新を読み込む |
| C5「編集：記録ありで一部変更不可」 | /goals/:id/edit、記録が1件以上 | [GoalFormFields](../../apps/web/src/features/goals/form/GoalFormFields.tsx) | 対応コードあり。単位・初期量・timezoneを固定し理由を表示 |
| C6「削除確認ダイアログ」 | 編集の「このGoalを削除」 | GoalFormPage（deleteOpen） | 対応コードあり。確認・取消・失敗 |
| C7（題名「R6 Goal編集：初期質問の回答を見直す」） | /goals/:id/edit、任意質問を開く | GoalFormFields、[QuestionPriorFields](../../apps/web/src/features/prior/QuestionPriorFields.tsx) | 対応コードあり。保存済み回答を開いた状態で見直し、単位/1回の量変更時は回答を取り消す案内 |
| R1 | 作成/編集の任意質問を開く | GoalFormFields、[QuestionPriorFields](../../apps/web/src/features/prior/QuestionPriorFields.tsx) | 部分対応。1画面のdetails。2段階ウィザードではない |
| R2 | Today、回答由来または条件付き計画の表示条件 | [CoreMetric](../../apps/web/src/features/today/CoreMetric.tsx)、[OutlookPanel](../../apps/web/src/features/today/OutlookPanel.tsx) | 部分対応。コメントでR2を参照。原画の見出し/回答見直し導線は未照合 |
| R3 | Today、回答＋実績等の出所 | CoreMetric | 部分対応。R2/R3コメントあり。具体fixtureの原画対応未確認 |
| R4 | Today、completionがplan | OutlookPanel.PlanView | 部分対応。設定量で行う場合の残り、日数予測と区別。原画未照合 |
| R5「回答の見直し：保存を確認できない」 | Goal編集（回答を含む）の保存結果が分からない（通信の失敗・5xx・応答の形の違い） | GoalFormPage.SaveFailure、[goal-form](../../apps/web/src/features/goals/goal-form.ts) の `isEditSaveResultUnknown` | 対応（2026-10-11、依頼者判断の案A）。入口は原画のTodayのシートではなくGoal編集のまま（入口はD-26で未決）。結果不明のときは「保存を確認できません」と「最新の内容を読み込む」を出し、はっきり断られた（4xx）ときだけ「まだ保存されていません」 |
| D1 | /goals/:id、未記録/材料あり | [TodayPage](../../apps/web/src/features/today/TodayPage.tsx)、CoreMetric、[GoalMenu](../../apps/web/src/features/today/GoalMenu.tsx) | 対応コードあり。問い・指標・メニュー・記録。PR202の外観/階層へ更新 |
| D1-why「計算の根拠を開いた状態」 | Today、中心指標の開閉を開く | CoreMetric.WhyDetails | 対応コードあり。見出しは現行「遅れの目安の根拠」 |
| D1-slow「再開が遅い例（筋トレ）」 | Today、再開が遅い記録のGoal | CoreMetric | 対応コードあり（同じ部品で数字が大きい例）。原画の例示値は製品へ持ち込まない |
| D1-sheet | 今日の「量を変更」または± | [AmountEditor](../../apps/web/src/features/logs/AmountEditor.tsx)、[RecordChoiceBar](../../apps/web/src/features/logs/RecordChoiceBar.tsx) | 部分対応。量編集は操作帯内group。native modal sheetではない |
| D2+D3「両方データ不足」 | Today、休んだ翌日の記録がない（中心・完了とも `insufficient`） | CoreMetric、OutlookPanel、[forecast-view](../../apps/web/src/features/today/forecast-view.ts) | 対応コードあり。実表示は[#81の状態確認（PR #228）](https://github.com/jogi-hack-2026-team/jogi-hack-2026/pull/228)の「休んだ翌日なし」 |
| D3-only「完了の目安だけデータ不足」 | Today、やった翌日の記録がない（completion `insufficient` NO_DONE_ORIGIN） | OutlookPanel.PlanView | 対応コードあり。実表示は同上の「やった翌日なし」 |
| D4「目安も余裕をみた日付も3年以上先」・D4b「余裕をみた日付だけ3年以上先」 | completionのP50なし／P80だけなし | OutlookPanel.EstimateNote | 対応コードあり。D4の実表示は同上の「3年より先」。D4b単独の実表示は未撮影 |
| D5「今日は記録済み（やった）」・D5「同（休んだ）」 | 今日がDONEまたはSKIPPED | [RecordedSummary](../../apps/web/src/features/today/RecordedSummary.tsx) | 対応コードあり。実表示は同上の「今日は記録済み」 |
| D5-change | 今日の「記録を変更」 | RecordedSummary.ChangeHeader、RecordChoiceBar | 対応コードあり。元内容/選択、取消、上書き保存 |
| D6 | APIが達成済みを返す | RecordedSummary.AchievedPanel/AchievedFacts、TodayPage | 対応コードあり。予測非表示、累計/総量、履歴/一覧、誤記録訂正 |
| D7-network「通信エラー（データ不足と区別）」 | Todayの取得が通信失敗 | TodayPage.FetchError | 対応コードあり。データ不足と別の表示 |
| D7-calc「見込みを計算できない（500 PREDICTION_FAILED）」 | APIが計算失敗を返す | TodayPage.FetchError（`PREDICTION_FAILED`） | 対応コードあり。通信失敗・データ不足と区別 |
| D7・保存中 | 今日の保存を保留 | RecordChoiceBar | 対応コードあり。保存中・二重送信停止。原画の文言差未確認 |
| D7-failed | 今日の保存の通信/サーバー失敗 | [SaveFailure](../../apps/web/src/features/logs/SaveFailure.tsx) | 対応コードあり。未保存の内容、再試行/選び直し |
| D7-date | 保存窓を外れる/旧日の入力 | SaveFailure、RecordChoiceBar | 対応コードあり。対象日を表示し、画面を新しくする |
| D8 | TODAY_DONEでP50が0日となる条件等 | OutlookPanel.EstimateNote | 群の対応コードあり。D4/D4b/D8の全原画照合は未実施 |
| E1 | yesterdayMissingの案内を開く | [YesterdayPrompt](../../apps/web/src/features/logs/YesterdayPrompt.tsx) | 部分対応。E1〜E3群の参照。初期折畳みはP-21で更新 |
| E2 | 昨日の量を変更 | AmountEditor、YesterdayPrompt | 対応コードあり。補足末尾の原画との差は未確認 |
| E3・E3-failed | 昨日の保存中/保存失敗 | YesterdayPrompt、SaveFailure | 対応コードあり。失敗で案内を消さず、詳細を展開 |
| E4 | 記録開始日が今日 | TodayPageのfirst-day表示 | 対応コードあり。開始日前の扱いを説明 |
| P1 | 直近7日の昨日を押す。記録済みで訂正可能なとき | [RecentDays](../../apps/web/src/features/history/RecentDays.tsx) | 対応コードあり。古い日付は閲覧のみ |
| P2 | 昨日の要約行の「変更」 | [YesterdayCorrection](../../apps/web/src/features/logs/YesterdayCorrection.tsx) | 対応コードあり。Issue146の「昨日の行」に対応 |
| P3 | Goalメニューの昨日訂正 | GoalMenu | 対応コードあり。訂正可能な場合だけ出す |
| Desk-home | /goals、1280px | GoalListPage、[goals.css](../../apps/web/src/features/goals/goals.css)、[AppShell](../../apps/web/src/routes/AppShell.tsx) | 部分対応。共通バーと広い枠。現行一覧カードは1列で、原画Desk-homeの配置との一致は未確認 |
| Desk-today | /goals/:id、1280px | [today-dawn.css](../../apps/web/src/features/today/today-dawn.css) | 対応コードあり。2列、左列内の操作帯sticky。左列全体が固定という説明はしない |
| F1 | /goals/:id/history | [HistoryPage](../../apps/web/src/features/history/HistoryPage.tsx) | 対応コードあり。月送り・凡例・カレンダー、当日以前の状態 |
| Desk-create・Desk-edit・Desk-history | 各route、1280px | [DeskHeader](../../apps/web/src/ui/components/DeskHeader.tsx)、[page.css](../../apps/web/src/ui/page.css) | コードコメントに対応名あり。全画面共通バーは1段にする規則。原画未照合 |
| H-A | Today未記録の問い | [copy/today](../../apps/web/src/copy/today.ts) | 現行採用。P-17/P-21の既存コピー |
| H-B | 比較用の「今日休むと」 | 該当の問いは未採用 | P-17のH-Aを維持。ボタン「今日は休む」とは別 |
| D1-dark | 暗色版 | — | #146/P-17で対象外。現行light-onlyの理由と残条件はP-21 |
| Dist 0〜5 | 分布表現比較 | — | #146で対象外 |
| トークンと部品ページ | デザイン比較用ページ | [ui/README](../../apps/web/src/ui/README.md) | ページ再現は#146対象外。実装済み部品/トークンを使う |

C2〜C7の意味は上の題名で確定した（2026-10-11）。現行フォームはこのほか、初回読込失敗、再取得失敗、回答撤回/409、作成結果不明/410、削除失敗、401、404も扱う（[画面設計](../design.md#goal作成編集削除)）。原画にない機能を番号埋めのために追加しない。PR210統合後は正常な同owner・同訪問の再確認後に失敗入力/案内を復元し、確認失敗・owner変更・画面離脱では破棄する。詳細は[D-29](../architecture.md#d-29-量と作成操作の保全148)へ。

## 合成環境での部分受入

実行対象・元SHA・画像実寸・fixture・操作/通信条件は[C担当の画像map](../changes/issue-171-composite-acceptance/README.md)を参照する。28画像をmapへ照合したが、本担当の再実操作ではない。以下の群は観測状態との関係を示し、原アートボードとの1対1照合を完了した意味ではない。

| 画面・状態の群 | 合成で観測された部分 | 未確認を維持する範囲 |
| --- | --- | --- |
| 公開トップ、認証（A群） | Home390/1280、未ログイン→login、登録入力不正。登録/login成功はCの操作記録 | authのPC画像、A3 busy・A4 429・A5実期限切れ、原画一致 |
| 一覧・例外（B群） | 空/1件一覧、一覧1280、GET/session503復帰、route404/Goal404 | 一般route error、B-account全状態、原画一致 |
| Goalフォーム（C群） | 作成390、編集1280取消PATCH0、title保存・PATCH503明示復帰。削除確認は追加1440 | C2〜C7の番号、作成1280/全欄、409/422/410等の全回復、削除1280 |
| Today未記録 | 新Goalの材料不足390 | D1の通常記録由来forecast、D2/D3番号、R2/R3/R4の全fixture |
| 今日記録済み・達成（D5/D6群） | DONE23/SKIPPED390、記録済み1280、達成390/1280 | 原画派生ID、達成までの通常予測の網羅 |
| 保存失敗（D7群） | PUT503を注入→同じ17分の明示PUT200で回復、自動再送0は1.5秒観測 | busy/日付変更/consistency/calculation/範囲外等の全状態 |
| 昨日補完・訂正（E/P群） | 専用DB開始日fixtureでDONE11補完、昨日行の未送信訂正cancel（PUT0/focus）、DONE12保存。今日SKIPPED維持 | 未記録昨日の量cancel、P1/P2/P3全入口、原画番号/文言 |
| 履歴・desktop（F/Desk群） | 履歴390/1280と開始月境界、一覧/Today/編集1280。画像上の編集/履歴の共通バー1段 | 全画面/全状態の両幅、Tab順/拡大/iOS/読み上げ、Desk原画配置 |

503はブラウザ`route.fulfill`、回復側は実API。元f106496の撮影はPR216/212を含まず、PR210/214も当時は未mergeだった。これらのPRが統合された後も、画像を新基準main単独・logout故障・cut軸・公開環境の実操作証拠へ読み替えない。コード読取と固定SHAの部分受入は別に扱う。

PR212統合後の遠い到達予定日のcut軸は、[P-19](../product-spec.md#p-19-到達予定日b案)・[chart-geometry](../../apps/web/src/features/today/chart-geometry.ts)・[実SVG回帰](../../apps/web/tests/outlook-axis.native.tsx)へ追跡する。原画のD番号へ新しい割当を推定せず、元f106496の予測画像や実操作結果へ加算しない。

## 朝焼け参照との関係

[朝焼け参照](https://claude.ai/artifact/KQDeWMput5bt77NEj4J4Kb#artboard-eb122470b18c)について、引継ぎ調査で確認された提供HTMLは390pxのToday1枚。HTMLのSHA-256と[資産README](../../apps/web/src/features/today/assets/README.md)の一致は引継ぎの報告であり、本PRでの原HTML再取得・再照合は未実施。B案全状態の代替資料ではない。

| 参照HTMLの要素 | 基準mainの実装 | 差の理由・追跡 |
| --- | --- | --- |
| 空・3層の山・森色の説明面・白カード | 既存背景WebPとCSS | P-21、assets/README |
| 100pxの明朝数字 | 32pxのCore数字、進捗40px | 進捗と完了見込みを連続して読む階層。P-21の個別UX確認は残る |
| 見通し→進捗の順 | 進捗→見通し→詳細。mobileに既存完了要約 | P-21の追加フィードバック |
| 空のchart箱 | API由来の実グラフを開閉詳細へ | サンプル/架空値を製品へ持ち込まない |
| 固定top704pxのdock | 本文と操作帯の高さ分離、desktopは左列sticky | 画面高/拡大で内容を覆わない |
| やったの強い塗り | 未記録の2択は同じ強さ、変更中は実選択を区別 | P-21。原画の見た目だけで操作誘導を固定しない |
| フォントCDNリンク | 同origin配信 | P-17と資産README |
| 原画の仮のGoal名・日付・数字 | APIのGoal/対象日/予測/記録 | 原画サンプルを固定表示しない |

## #146の残る受入

- [合成環境の部分受入](../changes/issue-171-composite-acceptance/README.md)を記録した。全アートボード/原画一致・基準main単独の全行実表示とは別で、全体の受入は未完。
- 原画の全一覧は2026-10-11に取得し、題名による1対1の対応を確定した。2026-10-11に、対象外・不採用（D1-dark・H-B）を除く54枚すべてを確認専用DBの合成データで表示し、[アートボードごとの画像](../changes/issue-146-artboards/README.md)に記録した（#81 の4状態を含む）。原画との画素一致は未確認。R5は2026-10-11にGoal編集の結果不明の表示として対応した（入口はD-26で未決のためGoal編集のまま）。
- 390px・1280px、未ログイン/ログイン済み/通信失敗/404/一般エラー、Tab/Enter/Escape、取消・戻る・再入場を同じ基準commitで確認する。 ルートの移動と既定の画面（未ログイン・ログイン済み・通信失敗/503・404・一般エラー）は[routes回帰](../../apps/web/tests/routes.browser.tsx)で実router上の回帰テストにした（2026-10-11）。
- 表示させるためのエラー注入は専用fixtureで行う。認証情報/実利用者のデータをPRへ添付しない。基準commit・fixture・画面幅・結果・証拠リンクを揃えてから、Issueの該当完了条件を更新する。
