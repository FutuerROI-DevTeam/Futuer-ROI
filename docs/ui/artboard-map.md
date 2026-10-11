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

[旧B案](https://claude.ai/artifact/Hxs7396eZNtYn8iLYmyMi8)はWeb取得で内容を再取得できなかった。Issue本文・PR147本文・コードコメントで確かめられる対応のみを書く。表にない原画の派生IDが存在しないとは断定しない。元キャンバスのエクスポート/全アートボード一覧を確認するまで「全アートボード対応完了」は保留する。

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
| C2 | /goals/new または /goals/:id/edit | [GoalFormPage](../../apps/web/src/features/goals/GoalFormPage.tsx) | 個別番号の意味未確認。下記フォーム状態一覧と照合が必要 |
| C3 | 同上 | GoalFormPage | 同上。番号からエラー/編集等を推定しない |
| C4 | 同上 | GoalFormPage | 同上 |
| C5 | 同上 | GoalFormPage | 同上 |
| C6 | 同上 | GoalFormPage | 同上 |
| C7 | 同上 | GoalFormPage | 同上 |
| R1 | 作成/編集の任意質問を開く | GoalFormFields、[QuestionPriorFields](../../apps/web/src/features/prior/QuestionPriorFields.tsx) | 部分対応。1画面のdetails。2段階ウィザードではない |
| R2 | Today、回答由来または条件付き計画の表示条件 | [CoreMetric](../../apps/web/src/features/today/CoreMetric.tsx)、[OutlookPanel](../../apps/web/src/features/today/OutlookPanel.tsx) | 部分対応。コメントでR2を参照。原画の見出し/回答見直し導線は未照合 |
| R3 | Today、回答＋実績等の出所 | CoreMetric | 部分対応。R2/R3コメントあり。具体fixtureの原画対応未確認 |
| R4 | Today、completionがplan | OutlookPanel.PlanView | 部分対応。設定量で行う場合の残り、日数予測と区別。原画未照合 |
| R5 | Todayで回答を見直すdialog | 該当componentなし | 未実装。PR147はD-26未決として対象外扱い。現行はGoal編集へ。Issue146全アートボード条件との差を残す |
| D1 | /goals/:id、未記録/材料あり | [TodayPage](../../apps/web/src/features/today/TodayPage.tsx)、CoreMetric、[GoalMenu](../../apps/web/src/features/today/GoalMenu.tsx) | 対応コードあり。問い・指標・メニュー・記録。PR202の外観/階層へ更新 |
| D1-sheet | 今日の「量を変更」または± | [AmountEditor](../../apps/web/src/features/logs/AmountEditor.tsx)、[RecordChoiceBar](../../apps/web/src/features/logs/RecordChoiceBar.tsx) | 部分対応。量編集は操作帯内group。native modal sheetではない |
| D2 | /goals/:idのToday状態 | TodayPage、[forecast-view](../../apps/web/src/features/today/forecast-view.ts) | 番号の具体状態が未確認。材料不足等のコードはあるがD2へ断定対応しない |
| D3 | 同上 | 同上 | 番号の具体状態が未確認。原画照合が必要 |
| D4・D4b | completionのP50なし／P80だけなし等 | OutlookPanel.EstimateNote | 対応コードあり。コメントはD4/D4b/D8を群で参照。D4とD4bの個別割当は未確認 |
| D5 | 今日がDONEまたはSKIPPED | [RecordedSummary](../../apps/web/src/features/today/RecordedSummary.tsx) | 部分対応。記録済みと変更入口は存在。派生原画の一覧未確認 |
| D5-change | 今日の「記録を変更」 | RecordedSummary.ChangeHeader、RecordChoiceBar | 対応コードあり。元内容/選択、取消、上書き保存 |
| D6 | APIが達成済みを返す | RecordedSummary.AchievedPanel/AchievedFacts、TodayPage | 対応コードあり。予測非表示、累計/総量、履歴/一覧、誤記録訂正 |
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

C2〜C7の番号との対応が未確定でも、現行フォームの次の状態は[画面設計](../design.md#goal作成編集削除)から追える：新規、編集、入力不正、保存中、初回読込失敗、再取得失敗、単位/初期量/timezone固定、回答撤回/409、作成結果不明/410、削除確認/失敗、401、404。原画を取得したらこれらを照合し、存在しない機能を番号埋めのために追加しない。PR210統合後は正常な同owner・同訪問の再確認後に失敗入力/案内を復元し、確認失敗・owner変更・画面離脱では破棄する。詳細は[D-29](../architecture.md#d-29-量と作成操作の保全148)へ。

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
- 原画全一覧の取得、C2〜C7/D2/D3等の1対1照合、R5の未実装と採択範囲の整理が残る。
- 390px・1280px、未ログイン/ログイン済み/通信失敗/404/一般エラー、Tab/Enter/Escape、取消・戻る・再入場を同じ基準commitで確認する。
- 表示させるためのエラー注入は専用fixtureで行う。認証情報/実利用者のデータをPRへ添付しない。基準commit・fixture・画面幅・結果・証拠リンクを揃えてから、Issueの該当完了条件を更新する。
