# #81 Todayの状態ごとの表示確認（2026-10-11）

[#81](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/81) の完了条件「`insufficient`（両reason）・`not_applicable`・`completed`・`p50Days = null` の各状態の表示を確認した（スクリーンショットをPRに添付）」の証拠。表示の仕様は [Product Spec「Today Decision画面の表示仕様」](../../product-spec.md#today-decision画面の表示仕様) と P-12。

## 確認の条件

- 画面：`fix/221-dawn-finish` の `ddc4d16`（[PR #223](https://github.com/jogi-hack-2026-team/jogi-hack-2026/pull/223)、#218 を含む。青空・記録の欄の変更後）。未マージの画面であり、main の画面そのものではない。
- API・Engine：上記ブランチの API（main と同じ予測・保存の契約。#218・#223 は API と Engine を変えていない）。
- データ：ローカルの確認専用DB `futureroi_dawnqa` に作った合成Goal（実ユーザーのデータではない）。今日は 2026-10-11（Asia/Tokyo）、記録だけのモード（初期質問の回答なし）、1回の量1回。
- 各状態は、画面の表示に加えて同じGoalの `GET /api/goals/:id/today?view=r11` の `prediction` を読んで確認した。
- 撮影：実Chrome（headless）、スマートフォン幅390px（表示範囲）とデスクトップ幅1440px（ページ全体）。

## 状態ごとの結果

| 状態 | 合成Goalの記録 | APIの `coreMetric` / `completion` | 画面の表示（要点） | 画像 |
| --- | --- | --- | --- | --- |
| `insufficient`（`NO_SKIP_ORIGIN_TRANSITION`） | 総量60回。10/04〜10/10 毎日やった | core: `insufficient` NO_SKIP_ORIGIN_TRANSITION ／ completion: `insufficient` NO_SKIP_ORIGIN_TRANSITION | 中心：「まだ『休んだ翌日』の記録がありません。記録がたまると、あなたの再開傾向から推定します。」、完了：「まだ算出できません」と設定量で行う場合の残り（日数の予測ではない旨） | [390](sp-81-ins-noskip.jpg)・[1440](pc-81-ins-noskip.jpg) |
| `insufficient`（`NO_DONE_ORIGIN_TRANSITION`） | 総量60回。10/04〜10/10 毎日休んだ | core: `available`（g50=4）／ completion: `insufficient` NO_DONE_ORIGIN_TRANSITION | 中心：約4日、完了：「『取り組めた日の翌日』の材料が不足しています。」と設定量で行う場合の残り | [390](sp-81-ins-nodone.jpg)・[1440](pc-81-ins-nodone.jpg) |
| `not_applicable`（`TODAY_RECORDED`） | デモGoal。今日を記録済み | core: `not_applicable` TODAY_RECORDED ／ completion: `available`（CURRENT_STATE, p50=83日） | 「今日は記録済みです」と記録内容、中心指標は出さない。完了の目安は表示 | [390](sp-81-today-recorded.jpg)・[1440](pc-81-today-recorded.jpg) |
| `not_applicable`（`COMPLETED`）／ `completed` | 総量5回。10/05〜10/09 にやった5回で到達 | core: `not_applicable` COMPLETED ／ completion: `completed` | 「決めた総量に届きました」、5回／5回、記録開始日と届いた日。予測は出さない | [390](sp-81-completed.jpg)・[1440](pc-81-completed.jpg) |
| `p50Days = null` | 総量5,000回。10/01〜10/10 にやった・休んだを交互 | core: `available`（g50=1）／ completion: `available` TODAY_DONE, p50Days=null, p80Days=null | 完了：「約3年以内の目安なし」、「10回中8回の完了時期の目安は、計算範囲の約3年以内には収まりません。」と、目安を出さない理由（材料不足や完了できないという意味ではない） | [390](sp-81-p50null.jpg)・[1440](pc-81-p50null.jpg) |

5つとも、表示は API の状態と一致し、通信エラーやデータ不足と取り違える表示はなかった。

## 気づいた点（未対応）

- `p50Days = null` の合成Goalでは累計5回／5,000回のため、積み上げが「0%」と表示される（0.1%を整数に丸めた結果）。誤りではないが、記録があるのに0%に見える。
- 中心指標の開閉の見出しは「遅れの目安の根拠」で、見出しの「ゴールが遠ざかる日数」と呼び方が違う（文言の残件として #221 の補足に記録済みの扱い）。

## 未確認

- main にマージされた後の画面での再撮影（#218・#223 のマージ後）。
- R-11（初期質問の回答あり）の各状態。今回は記録だけのモードのみ。
- 完了条件のもう1つ（3〜5人の理解確認）は対象外。
