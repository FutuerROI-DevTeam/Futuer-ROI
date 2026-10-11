# Goalの量入力とTodayの保存後増分（#244）

**Supporting Doc / Not a Source of Truth.** 仕様は[Product P-23](../product-spec.md#p-23-goalの量入力と保存後の増分244)、整数分契約は[Architecture](../architecture.md#data-model)、実装への入口は[変更対応表](../change-map.md#goalとtodayの量入力保存後表示244)。

## 範囲と変更

[#244](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/244)は依頼者が先行を許可したFE変更。Goal一覧の累計・達成導線、総量／初期量の時間＋分入力、量の直後の任意質問、Todayの率と見通し、PC週履歴下／スマホ見通し後の実績グラフ、確認できた保存増分を扱う。

専用branchは`feat/244-goal-today-feedback`。開始mainは`3e5d9fb23afcd78e66e309c93c0000e6a3a8ab1d`。通常checkoutの未保存変更、既存DB・container・他worktree・実験成果には触れない。API・shared types・DB・Prediction source／数値・CI設定・権限・課金を変更しない。

時間＋分入力は整数分へ変換する。200時間→12000分、1240分↔20時間40分。表示方式の切替は量を変えず、不正な途中入力をdraftに残す。最新設定で単位が回数へ変わったときは、有効な量を整数へ戻し、不正な時間draftは補助文に保持して新しい単位での入力を求める。既存の単位／初期量／timezoneロックと、設定変更時の回答取消を保つ。回復情報のkey・bodyは再試行で作り直さない。

保存後の数値は、成功後にGoal・Today・履歴を再取得し、設定・日付・他日・保存応答が一致する場合の、取得済みsnapshotとの比較。通知に常に「保存前の表示との差」と示す。200時間の表示0→30分は+30分・+0.25パーセントポイント、表示30→20分は−10分。0差分、未保存・失敗・409・不確かな再試行・検知した別tab保存では加算表示を出さない。今回のPUTによるDB上の原子的増分を保証しない。

独立レビューの純増0なのに+30分となるケースと、実APIの表示20分→別client40分→自身30分（表示差+10分、DB上書き差−10分）は、現APIの観測限界として保持する。表示の近くに比較対象を明示するFE修正で扱い、API契約は変更しない。質問欄は未回答の「回答せずに進む」と、選択済みの「回答欄を閉じる」を分け、閉じても選択を送る旨を示す。各問の「回答しない」が明示的な取消操作であり、閉じる操作で入力を消さない。

## 検証手順

秘密やDBを用いない専用checkoutで実行する。

```powershell
npm run typecheck
npm run build --workspace=@futureroi/web
node --import ./apps/web/tests/register-contracts.mjs --test --test-concurrency=1 ./apps/web/tests/*.test.mjs
```

ブラウザ回帰は`apps/web`を作業ディレクトリにし、既存Chrome/Edgeのpathを`TEST_BROWSER`で指定できる。追加依存・CI変更を要しない。各runnerが隔離profileとloopbackの合成HTTPを作り、所有するprofileだけ終了確認後に片付ける。

```powershell
node --import ./tests/register-contracts.mjs --test tests/session-cache.browser-check.mjs
node --import ./tests/register-contracts.mjs --test tests/goal-feedback.browser-check.mjs
node --import ./tests/register-contracts.mjs --test tests/responsive-details.browser-check.mjs
```

`FEQA_ARTIFACT_DIR`を明示すれば、追加runnerは320／390／768／1440pxで一覧・作成・編集・TodayのPNG16枚、スクロールしたグラフ4枚、保存／訂正表示2枚（計22枚）と`browser-evidence.json`を保存する。合成Goalだけを使い、画面PNGに秘密や実ユーザー情報を含めない。

純粋回帰は変換・未変更PATCH・不正draftのrebase・増減・0増分・設定／他日変更・snapshot不整合・超過実績・初日の1点を検査する。実Chrome回帰はnative入力／radio切替・横はみ出し・DOM／PC配置・整数分のcreate body・任意質問の未回答・保存／訂正・通信失敗／原body再試行・409・別tab通知・focus・reduced-motionを検査する。

## 確認状況と残判断

2026-10-11の専用worktreeで、独立指摘修正後の全workspace typecheckとFE production buildは成功した。通常FE回帰は170件中169成功・0失敗・既存の設定依存browserチェック1skip。既存session browser回帰は21成功・0失敗。追加Chrome受入は22scenario・22PNGで成功し、単位radioの矢印キー操作、200時間のcreate body、未回答で進む操作と選択回答の保持、比較対象を示した保存／−10分訂正／通信失敗／原body再試行／409／別tab通知／reduced-motionを確認した。fixtureにも製品と同じ既存400／500／700 font importsを読ませる。

Dの同4probe（別clientの先行同値保存でDB純増0、HIGH選択後の閉じる操作、連打、native Tab順）は、操作順を保ち、修正後の明示ラベルを期待として再検証して成功した。mock HTTPなしの専用合成DB・実認証・実API・ビルド済SPAの縦断6項目も成功した。表示20分→別client40分→自身30分では表示差+10分とDB差−10分を観測し、表示通知に比較対象が付くことを確認した。原子的増分や実ユーザーの理解の保証へ読み替えない。所有する合成DB・API・Chromeは終了確認済み。修正後responsive detailsは11成功、Foundationは111 text files・2035 local links・環境例・7 ignore cases・差分空白で成功した。

- 既存browser fixtureは単位buttonと分だけの入力欄を前提にしていた。製品の条件やassertを緩めず、radio selectorと整数分としての量の読取／設定へ合わせた。409後の最新単位が回数へ変わる場合には、有効な時間draftを整数へ正規化する回帰も追加した。
- Playwright CLI＋Skillはこの環境に未導入。既存Vite／Chrome CDP harnessで実viewport・native入力を確認する。実ユーザーの初見理解、チームの人間レビュー、実認証／API／DBとの縦断受入は未実施。
- Log応答は旧量／log revisionを持たない。別端末や検知できない同日並行更新の原子的増分は保証できない。別tab回帰は同originの別Chrome tabから保存通知を送る合成試験であり、実際の複数端末DB同時更新の検証ではない。
- PCでは左の週履歴の直後にグラフ、記録操作はその後に配置する。小さい高さでの初見の操作発見性は人間レビューに残る。
- GitHub CIは未pushのため未実施。merge・deploy・既存Issueのclose／BLOCKED解除を行わない。元の#117等の人間受入条件をこのローカル成功で完了扱いにしない。
