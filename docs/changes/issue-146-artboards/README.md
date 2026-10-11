# #146 B案アートボードの実データ表示（2026-10-11）

[#146](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/146) の完了条件①「『B案：画面と状態』の各アートボード（D1-darkを除く）について、対応する画面・状態を実データで表示できる」の証拠。アートボードと実装の対応は [対応表](../../ui/artboard-map.md)、原画の一覧はその「原画の一覧」を参照する。

## 確認の条件

- 画面：main `208d481`（PR #229 統合後）と同じ内容のブランチで起動したローカルの画面。API・Engine は同じ main。
- データ：ローカルの確認専用DB `futureroi_dawnqa` の合成Goal・合成記録（実ユーザーのデータではない）。今日は 2026-10-11（Asia/Tokyo）。
- 失敗・保留・特定の応答は、実Chrome（headless）の要求の差し替えで作った。**保存を伴う操作はすべて保留後に失敗させるか合成応答にして、記録・Goalを変えていない**（撮影前後で合成Goalの記録数が同じことを確認）。
- 予測の状態（D4b・D8 など）は、画面と同じGoalの `GET /api/goals/:id/today?view=r11` の値で確認した。
- 撮影：スマートフォン幅390px（表示範囲）。Desk-home・Desk-today は1280px。

## アートボードごとの画像

「画面と状態」56枚のうち、対象外・不採用の2枚（D1-dark・H-B）を除く54枚すべてに画像がある（54枚、#81 の記録の4枚を含む）。

| 識別子 | 原画の題名 | 画像 | 状態の作り方 |
| --- | --- | --- | --- |
| A1-login | A1 ログイン：通常 | [390](sp-A1-login.jpg) | ログインしていない状態で /login |
| A1-signup | A1 新規登録：通常 | [390](sp-A1-signup.jpg) | 同上で「新規登録」タブ |
| A2-error | A2 入力エラー | [390](sp-A2-error.jpg) | 空欄のまま送信 |
| A3-sending | A3 送信中 | [390](sp-A3-sending.jpg) | ログイン要求を保留（送信中）。保留後は失敗させ、ログインしない |
| A4-wait | A4 試行が多すぎて待ちが必要 | [390](sp-A4-wait.jpg) | ログイン要求に429（X-Retry-After: 60）を合成 |
| A5-expired | A5 ログインの期限切れ（401） | [390](sp-A5-expired.jpg) | /login?reason=expired |
| B-account | B アカウントメニュー（ログアウト） | [390](sp-B-account.jpg) | 一覧でアカウントを開く |
| B-empty | B ホーム：Goalが0件 | [390](sp-B-empty.jpg) | 一覧APIに空配列を合成 |
| B-error | B ホーム：通信失敗 | [390](sp-B-error.jpg) | 一覧APIを通信失敗にする |
| B-home | B ホーム：通常 | [390](sp-B-home.jpg) | 確認専用DBのアカウントで /goals |
| B-loading | B ホーム：読込中 | [390](sp-B-loading.jpg) | 一覧APIを保留 |
| B-notfound | B Goalが見つからない（404） | [390](sp-B-notfound.jpg) | 存在しないGoal IDを開く |
| C1-create | C Goal作成：通常 | [390](sp-C1-create.jpg) | /goals/new |
| C2-errors | C 項目ごとの入力エラー | [390](sp-C2-errors.jpg) | 空欄のまま保存 |
| C3-saving | C 保存中 | [390](sp-C3-saving.jpg) | 作成要求を保留。保留後は失敗させ、作成しない |
| C4-failed | C 保存失敗 | [390](sp-C4-failed.jpg) | 作成要求を通信失敗にする（作成結果を確認できない） |
| C5-edit | C 編集：記録ありで一部変更不可 | [390](sp-C5-edit.jpg) | 記録のあるGoalの編集（初期量・タイムゾーン固定） |
| C6-delete | C 削除確認ダイアログ | [390](sp-C6-delete.jpg) | 編集で「このGoalを削除」（確認ダイアログまで。削除しない） |
| C7-edit-prior | R6 Goal編集：初期質問の回答を見直す | [390](sp-C7-R6-edit-prior.jpg) | 回答のあるGoalの編集で任意質問を開いた状態 |
| D1 | D1 未記録・データ十分 | [390](sp-D1.jpg) | 合成Goal「QA146：通常」（今日未記録・材料あり） |
| D1-dark | D1 ダークテーマ | — | 対象外（#146・P-17。暗色版は作らない） |
| D1-sheet | D1 「やった」の量を確認 | [390](sp-D1-sheet.jpg) | 記録の欄の「量を変更」（#199で欄の中の入力に変更） |
| D1-slow | D1 再開が遅い例（筋トレ） | [390](sp-D1-slow.jpg) | 合成Goal「QA146：再開が遅い」 |
| D1-why | D1 計算の根拠を開いた状態 | [390](sp-D1-why.jpg) | 「遅れの目安の根拠」を開く |
| D2-D3 | D2+D3 両方データ不足（読書） | [#81 休んだ翌日なし](../issue-81-states/sp-81-ins-noskip.jpg) | 休んだ翌日の記録がない（中心・完了とも insufficient） |
| D3-only | D3 完了の目安だけデータ不足 | [#81 やった翌日なし](../issue-81-states/sp-81-ins-nodone.jpg) | やった翌日の記録がない（completion insufficient） |
| D4-over3 | D4 目安も余裕をみた日付も3年以上先（例示用Goal） | [#81 3年より先](../issue-81-states/pc-81-p50null.jpg) | p50Days・p80Days とも null |
| D4b-p80-over3 | D4b 目安は出るが、余裕をみた日付は3年以上先（例示） | [390](sp-D4b-p80-over3.jpg) | 合成Goal（総量520回）：p50=1044日、p80=null をAPIで確認 |
| D5-change | D5b 今日の記録を変更 | [390](sp-D5-change.jpg) | 記録済みの今日で「記録を変更」 |
| D5-done | D5 今日は記録済み（やった） | [390](sp-D5-done.jpg) | 今日やったを記録済みのGoal |
| D5-rest | D5 今日は記録済み（休んだ） | [390](sp-D5-rest.jpg) | 今日休んだを記録済みのGoal |
| D6-achieved | D6 達成済み（筋トレ） | [#81 達成済み](../issue-81-states/sp-81-completed.jpg) | 総量に到達（completed） |
| D7-calc | D7 見込みを計算できない（500 PREDICTION_FAILED） | [390](sp-D7-calc.jpg) | TodayのAPIに500 PREDICTION_FAILED を合成 |
| D7-date | D7 記録できない日（422 LOG_DATE_OUT_OF_WINDOW） | [390](sp-D7-date.jpg) | 記録の保存に422 LOG_DATE_OUT_OF_WINDOW を合成（保存しない） |
| D7-failed | D7 保存失敗（再試行） | [390](sp-D7-failed.jpg) | 記録の保存を通信失敗にする |
| D7-network | D7 通信エラー（データ不足と区別） | [390](sp-D7-network.jpg) | TodayのAPIを通信失敗にする |
| D7-saving | D7 保存中 | [390](sp-D7-saving.jpg) | 記録の保存を保留。保留後は失敗させ、保存しない |
| D8-zero | D8 完了まで0日（今日やれば届く） | [390](sp-D8-zero.jpg) | 合成Goal（総量8回・累計7回）：TODAY_DONE の p50=0日をAPIで確認 |
| Desk-home | B ホーム デスクトップ幅 | [1280](pc-Desk-home.jpg) | 1280pxで /goals |
| Desk-today | D1 デスクトップ幅 | [1280](pc-Desk-today.jpg) | 1280pxでToday |
| E1 | E1 昨日が未記録：問いかけ | [390](sp-E1.jpg) | 昨日が未記録のGoalで問いかけを開く |
| E2 | E2 昨日「やった」の量を変更 | [390](sp-E2.jpg) | 問いかけの「量を変更」 |
| E3-failed | E3 昨日の保存失敗：再回答 | [390](sp-E3-failed.jpg) | 昨日の保存を通信失敗にする |
| E3-saving | E3 昨日の記録を保存中 | [390](sp-E3-saving.jpg) | 昨日の保存を保留。保留後は失敗させ、保存しない |
| E4 | E4 今日から記録を始めたGoal | [390](sp-E4.jpg) | 今日から記録を始めたGoal |
| F1-calendar | F 記録履歴カレンダー（任意） | [390](sp-F1-calendar.jpg) | /goals/:id/history |
| H-A | 見出しA：今日サボると | [390](sp-D1.jpg) | Todayの問い（D1と同じ画像） |
| H-B | 見出しB：今日休むと | — | 不採用（P-17でH-Aを採用） |
| P1 | 提案A 直近7日の帯から訂正 | [390](sp-P1-strip.jpg) | 直近7日の帯で昨日を押す |
| P2 | 提案B 記録ボタンの下に昨日の行 | [390](sp-P2-yesterday-row.jpg) | 記録済みの昨日の要約行 |
| P3 | 提案C ヘッダーのメニューから訂正 | [390](sp-P3-menu.jpg) | Goalのメニュー（「昨日の記録を訂正」） |
| R1-questions | R1 Goal作成：初期質問を開いた状態 | [390](sp-R1-questions.jpg) | 作成で任意質問を開く |
| R2-answer | R2 回答だけの仮の見通し（片方未回答） | [390](sp-R2-answer.jpg)・[390](sp-R2-answer-outlook.jpg) | 片方だけ回答・記録なしのGoalをAPIで作成 |
| R3-mixed | R3 回答＋実績の見通し（出所別） | [390](sp-R3-mixed.jpg) | 回答＋実績のGoal（出所の1文） |
| R4-none | R4 回答も記録もなく材料不足 | [390](sp-R4-none.jpg) | 回答も記録もないGoalをAPIで作成（設定量で行う場合の残り） |
| R5-review | R5 回答の見直し：保存を確認できない | [390](sp-R5-review.png) | Goal編集の保存を通信失敗にする（案A：保存を確認できません） |

## 原画との違い（意図したもの）

対応表に記録した判断どおり、次は原画と形が違う：D1-sheet（#199 で記録の欄の中の入力）、R1（1画面の開閉）、R5（入口はGoal編集。D-26で入口未決）、Todayの配色（#221 の青空）、昨日の記録（#221 で今日と同じ部品）。

## 未確認

- 原画との画素一致（題名と状態の対応のみを確認）
- 1280px での全状態、iOS Safari 実機、読み上げソフト
