# #248 途中到達補正の検証記録

Supporting Artifact / Not Source of Truth。2026-10-12。正式契約は[Product](../product-spec.md#途中到達の個人補正比較248既定off)/[Architecture](../architecture.md#d-248-途中到達による個人補正248)、コード・テストは[対応表](../change-map.md#途中到達の個人補正248)。[Issue #248](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/248)の限定実装。CONDITIONAL、Human Review・実利用は未完了。

## 固定範囲

base: `3e5d9fb23afcd78e66e309c93c0000e6a3a8ab1d`、branch: `feat/248-goal-milestone-calibration`。独立worktreeにだけ変更し、main・他の作業領域・既存研究helperは編集しない。最終HEAD・変更fileのSHA256・ログhashは提出時の外部verification manifestに固定する。Node 24.21.0 / npm 11.19.0、Python Decimalは70桁で使用する。

ローカル実行時はchildprocessのDATABASE_URLを除外し、テストfixtureが新規embedded PostgreSQLを生成する。GitHub Actionsでは既存application.ymlが作る専用serviceの固定URLだけを許可し、任意の外部admin接続は拒否する。CIでもfixtureが生成した専用databaseだけを変更する。既存DB・実アカウント・実ユーザー履歴・追加の本試験/最終確認群は使用しない。0008はこの隔離合成DBでだけ適用する。小さい匿名合成例はGoal300、q10、4日の初期隣接記録、3回の途中到達とその後の1発行に限定する。数値はtest diagnosticsと固定manifestへ保存する。

## 切断前の実施状況と復旧時の読取

以下は切断前の履歴であり、最終HEADの全回帰完了を示さない。2026-10-12の復旧時に保存ログとclean worktreeを読み、関連実行プロセスが残っていないことを確認した。未完了の試験は、検証対象をcommitしてから再実行する。最終の同HEAD結果・終了code・変更file/hash・ログhashは提出時のverification manifestとDraft PRの検証欄に固定し、本履歴を成功予定の値で上書きしない。

| 確認 | 結果・範囲 |
| --- | --- |
| 初回root typecheck | policy literal / TypeBox unionの型エラーを修正。修正後PASS |
| 新規20テスト初回 | 19 PASS。既存Today responseにGoalがあると誤仮定した1テストを修正し、対象1件再実行PASS |
| 新規20テストの切断前再実行 | 保存ログで20件すべてPASSを確認。全API suiteの終了summaryとは別 |
| Pure数値8件 | 直接確率NLL・有限差分勾配・Decimal内点・±境界KKT・非ゼロ・identity/支持失敗・総重み/重複・本人Goal分離・日付選択・元method/roundoff |
| Assessment6件 | DST/d+2、実量、origin二重加算なし、欠測interval/UNKNOWN/censor、cutoff固定、後日訂正、設定/回答/build/expiry、H30管理打切り |
| 合成HTTP/DB6件 | default OFFで新tableなし、別同意、auth/owner/Goal/FK、非ゼロの前向き比較、Today一致、immutable発行、CAS/withdraw→rejoin、旧訂正・版・expiry・90日・Goal delete/purge、compare domain 409 |
| 純粋Engine | 初回76/77。追加CDF export2関数の明示一覧を既存scaffoldへ反映し、再実行77/77 PASS。既存CDF独立oracle3/3 PASS |
| 型検査・build・文書 | root全workspace型検査PASS、Vercel用build生成PASS、文書113file/2059local link PASS |
| 全workspace回帰・Vercel検証 | 全API/Web回帰とbundle検証は切断で終了summaryなし。結果を推測せず再実行する |
| 復旧後のCI事前照合 | 旧guardが既存CI専用serviceも拒否する点を修正。GITHUB_ACTIONS=trueとworkflowの固定接続の両方を要求するpure guard回帰を追加。最終実行は新規21件となる |
| 独立レビュー | 初回2指摘を修正し、source `cebb12b6`と文書の修正を独立AI reviewerが確認。新Blocking/Should Fixなし。最終提出版の引継ぎとHuman Reviewは別 |

## レビューで直した問題

元のBeta積分kernelは有効なposteriorでもCDFが`1.0000000000000002`になることがあり、初回の厳格検査では正常な発行を500にした。既存NUMERICAL_MARGIN内だけの表現補正を版付きで保存し、a=Beta(2,35)/b=Beta(35,2)とsampling/BOUNDARYの回帰を追加した。元predict・quantileは変えず、構造的支持の救済εは入れない。

compareの未記録・達成済み・near Goal・元材料不足が内部errorになった点は、発行と同じdomain error→409へ統一した。未記録/達成済みは実HTTPで回帰する。独立レビューはAIレビューでありHuman Approveの代替ではない。

設計補助の探索範囲は保存source.config.horizonDays（現既定1095日）へ、既存発行のINVALID条件は文脈/prefix変更へ訂正した。fit世代変更だけでは凍結した過去比較と観測を無効化しない。独立reviewerがこの文書修正も読取り確認した。

## 主張と未確認

小さい合成例で係数が非ゼロになり、未学習の次の途中到達のNLLが下がることは実装が動く証拠に限る。実効用、最終Goalの達成日改善、安定性/状況変化への一般化、校正保証、独立人数の増加を意味しない。fixtureの最終Goalの早期未達は構造的CDF0で、baseline/candidateのfinal scoreは一致する。

保存diagnosticsはu=0.22314355131420976、odds倍率1.25、KKT残差0。3学習発行のoriginは2026-10-04/07/10、未学習の比較発行は2026-10-13。途中到達NLLはbaseline 0.6061358035703156、candidate 0.5108256237659907。final scoreは両方0のCENSOR、標準Todayは一致した。これは匿名合成の小例で、本試験群や新しい最終確認群ではない。

UIは追加せず、実ブラウザ/初見理解は未検証。実DB migration・本番flag・purge CLIの実DB実行・公開混合負荷・自動purge/backup反映は未実施。90日のread filterと合成physical purge成功を運用保証に置き換えない。merge/deploy/Issue Done・チーム受入は実施しない。


## 復旧後の独立境界レビュー

固定70b0f403の追加レビューで、丸めた候補CDFからscoreを再計算すると、有限のNLLがInfinity→nullになるBlockingを確認した。実N=1 Engineのa=Beta(12,29)、b=Beta(29,2)、DONEではEVENT30の解析NLLは36.26679694043136だが、表示CDFの隣接点が同値に丸まる。a=Beta(2,30)、b=Beta(30,2)ではCENSOR30の解析NLLは36.95994412099131である。

候補scoreを凍結元CDF＋凍結uの既存解析式へ統一し、正のsigmoid枝を安定した補数式にした。改善後も表示CDFの隣接質量消失はあり得るため、解析scoreとの区別を契約・設計補助へ記載した。支持失敗へのepsilon救済は行わない。DBを使わない凍結payload境界oracleと真の構造的支持失敗の2テストを追加した。最終同HEADの実行結果と独立再レビューは外部manifest/PRに記録する。


## 独立レビューDの追加修正

作者側の固定70b0f403・新規専用合成DBで、Dの3再現harnessを再実行した。JOIN→撤回→同一旧JOINが204で参加を復活、HIGH/HIGH＋SKIPPED4日発行後の初回DONEでINVALID、DB session Europe/Berlinで暦90日CHECKがJSの経過90日を拒否する422を確認した。harnessのPASSは不具合再現成功であり製品受入成功ではない。

単調consentRevisionのGET/PUT CAS、unitLockedを除く明示context、SQL/JSの2160時間統一を実装した。撤回/期限/purge後の旧JOIN拒否と新しい版のrejoin、初回DONE成熟EVENT、UTC/DST両sessionの3table上限と+1ms拒否を回帰へ追加した。新規未公開0008だけを修正し、旧migration・実DBには適用しない。最終修正版の独立再レビューと試験結果は外部manifest/PRで固定する。

## 追加のGoal ID境界修正

固定0fcで、既存Goal GETが受理する大文字UUIDを新規補正APIだけが別Goalとして扱うことを、履歴を作らない新規専用合成DBで確認した。大文字URLのJOINは204・参加1行を作ったが、同じ大文字URLのGETはparticipating=false、正規小文字URLはtrueだった。SQL UUIDと文字列scope比較の表記差による不具合であり、別Goalや別本人のデータ取得ではない。

補正6endpointのGoal UUIDをroute境界で小文字へ正規化し、本人IDや係数・数式・成熟条件・版/期限の照合は変えない。既存HTTP9ケースは全endpointを大文字UUID経路で実行し、正規経路との同一参加も照合する。外部の小さい境界再現を修正後に再実行し、27件・全回帰・bundle・独立差分レビューを新しい固定版で確認してから公開する。

## 既存migration保全回帰の追加schema対応

0fcの全回帰で、後着migration保全テストの期待適用一覧が0006まで固定され、新規0008を含めていない失敗を確認した。0008を一覧へ追加し、既存Goalの追加同意CAS版が0であることを検査してから、その追加列だけを除いて旧行全体を照合する。新規補助3tableが空であることも検査する。旧Goal/log/marker/auth行の全体比較、旧0004のmigration行保全、再適用が空になる検査は維持する。runtime・migration本体・元予測は変更しない。修正後の対象別試験と全workspace回帰を新しい固定HEADで実行する。
