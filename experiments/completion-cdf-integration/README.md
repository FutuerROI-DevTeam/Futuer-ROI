# 完了CDF統合候補 #203

Supporting Artifact / Not a Source of Truth。正式な判断要約は[Architecture D-31](../../docs/architecture.md#d-31-同一モデルの完了cdf統合候補203)。基点main `041f24c557dd90034d64d630fb912e0a01696da9`。チームレビュー・公開配置・実ユーザー校正を実施済みと扱わない。

同じ固定a,bのMarkov連鎖を独立Beta事後分布で積分する。I=開始SKIPPED、m=N-I、R~BetaBinomial(m,a.beta,a.alpha)として、F(d)=Σ P(R=r)P(BetaBinomial(d-m,b.alpha,b.beta)>=r+I)。Beta-binomial漸化式の浮動小数点CDFを使い、H／探索／q-1,qの全近傍比較だけ共通整数分子・分母で閾値q-1e-12と照合する。

正整数shape<=1,000,000、N<=H<=1095に限定する。整数CDFの分母次数はday、閾値の交差積は保守的に32768bit以内、各divisionの剰余ゼロとmass合計を検査する。端数shapeを丸めない。CDFおよび比較cacheは1要求のP50/P80でだけ共有し、別user／ownerへ持ち越さない。質量・単調性・範囲gateでsamplingへ戻る経路は残る。

モデル・prior・全履歴・実量・今日の仮実行・g／完了状態・表示粒度を維持する。以前の固定seed sampling回帰は明示sampledで数値を維持し、期待日数を広げない。予測校正の正しさや全域のぶれ解消は主張しない。closedの代わりにsamplingへ戻る場合は有限Kの近似で、固定seedの再現性は全posteriorの厳密積分とは異なる。

## 公開契約の最小案

| 案 | 差分・リスク | 判断 |
| --- | --- | --- |
| 1 内部metadata／既存wire | public field追加なし。内部actualとpublic requested configの説明・serializer境界の確認が必要 | 依頼者指定の案。現FEはmetadataを使わないので最小 |
| 2 新しい明示表現版 | 新旧schema・query・router・reader・cache・両版回帰が必要 | 外部consumerが実方式を必要としたら再検討 |
| 3 同版で追加／全体reload | 初期候補では旧strict readerが新available DTOを拒否。API/FE/assets更新と旧タブ移行の運用が必要 | 現FEに用途がなく、今回選ばない |

`result.config.samples/seed`はsampling経路へ要求する設定。閉形式／境界値の内部`completion.computation.samples/seed`はnull、sampledは実K/seedとfallback理由。HTTPは内部metadataを投影して除き、legacyとr11-v1の既存field集合を保つ。public configだけから実抽選数を判断しない。現Architectureはもともとsamplesを「使うK」と説明していたため要求設定へ説明を同期する。旧数値記録は書き換えない。

## 有限work保護

samplingは確保前にH<=10000、K<=12800、K*N*H<=1e9。closedで使わない巨大Kだけを理由に拒否しない。gはalpha<=32の同じ厳密生存確率を短い積と二分探索で比較し、Hで切らない。alpha>32の旧積経路は1000日／32768bit、safe day超過もtyped RESOURCE_LIMIT。百万日g50／四百万日g80を保持する。数値改善と資源保護は別の理由・テストを持つ。上限はHTTP時間保証／rate limitの代替ではない。

## 検証と限界

所有internal Docker network、生成fixtureだけのtmpfs PostgreSQL、cached image／依存を使用し、通常checkout／既存container／本物のDB／外部公開先は対象外。API/compiler image ID `sha256:7fb3ce43ed6454393040cc476d8223ec15eaf27829a82ee9de5935fb8e29d6b4`、PostgreSQL `sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336`。新しいharnessを本CIへ大量追加せず、数値4件・API境界2件だけを既存test discoveryへ追加する。

2026-10-10 UTC、最終source／compiled hashを固定した検証：Engine77件PASS、API/Web typecheck・API build PASS、公開投影と予算失敗のAPI差分2件PASS。独立整数oracleは24ケース、106CDF点、212比較、48分位点境界、63 K/seed変形を確認。初期19集合の7近傍sampling fallbackは製品候補で0件となり、H192は105/null、H193は105/193。未検証の全入力域へこの結果を拡張しない。旧API192項目は本候補の初期段階で複数runの合格証拠を照合した（単一全green runではない）。最終193項目一括再実行とは報告しない。Web103PASS／1既存browser skip・buildは初期段階、FE製品コードは変更せず、最終reader／実DOMは下記で別確認した。

実API107チェックPASS。A/B/Cの合成30日履歴・必要44回では旧sampling 88/92・102/183・86/134日、候補88/93・105/193・87/138日をlegacy/R11双方で照合。N400の実Todayも5件すべて702/835日。他ownerのIDをGoal GET/PATCH/DELETE、Log GET/PUT、Today両表現へ渡して404、DB不変。GETだけもDB不変。最大3並行のToday/GoalGET/GoalPATCHと後続LogPUTを各サービス20要求、計40要求で確認し、mutation3Goalのrevisionは2/4/4、同日のLog3行はDONE120、その他fixture行は不変だった。HTTP証拠SHA `c857a03c341463b17001650b81ac35d45df960f99e46918520b0880ac8be47a5`。

APIは.5CPU/320MiB。以下は同じ所有DBでbaselineの後にcandidateを測った各5観測の小標本。nearest-rank P95は5件では最大値と同じで、公開SLO／処理可能人数を表さない。

| 操作 | 旧mean/P95 ms | 候補mean/P95 ms |
| --- | --- | --- |
| Today | 524.59 / 597.81 | 27.60 / 58.03 |
| Goal GET | 637.13 / 839.49 | 48.60 / 138.04 |
| Goal PATCH | 566.41 / 652.71 | 67.65 / 165.32 |
| Log PUT | 32.51 / 61.76 | 12.74 / 21.89 |

初回A legacy HTTPは旧1580.50ms／候補907.41msで、全HTTPが500ms未満とは言わない。別の実predict T-14は.5CPU/256MiB、N120/400/1095各6回で最大5.89/1.71/1.14ms、N548情報用は1.17msだった。入力はa=(14,7),b=(7,9)の固定30日履歴。単体計測とHTTPを混同しない。

旧HEAD/current strict readerの独立serializer12応答と新実HTTP17 DTOを照合し、metadata非公開、候補public数値保持、requestedとactualの区別を確認した。schemaからmetadataを戻すだけだった中間候補はstrict unionで500となり、両API wrapperの明示投影で解消した。初期の公開metadata追加による旧reader拒否とこの中間500は履歴へ保持する。

現Reactの実DOMとPNGは新HTTP正常DTO／安全な500エラーの別fixture replayで確認し、正常な予測と計算エラー時の記録ボタン、自動書込0件を照合した。安全500の原因は合成保存snapshot不正でありRESOURCE_LIMITの実HTTP誘発ではない。予算エラーの接続はtyped境界unit testで確認する。所有3container／network／tmpfsDBを撤去し、既存37containerのID/image/status/start time/exit code、通常checkoutのHEAD／変更2ファイルhash／status、旧比較ZIP3本のSHA不変を照合した。詳細harness・旧FAIL・snapshot／DOM／独立レビューはIssue #203の別Library証拠bundleへ保存する。

実APIの量・判定・認可／DB不変と、有限fixtureでのHTTP待ち時間、単体T-14を分ける。ブラウザは実HTTPの正常DTOと安全エラーを隔離fixture replayで現Reactへ渡し、予測表示と記録可否を確認する。これは実ブラウザの全HTTP認証フローやRESOURCE_LIMITの実HTTP誘発ではない。公開runtime・負荷限界・SCA全件・校正・merge/deployは未実施。技術検証の完了は独立した敵対的セルフレビュー・検証結果・最終SHAのCI確認と残余リスクの記録で判定し、方式の採択は下記の本人判断として分ける。GitHubのreview状態・merge条件は変更せず、main merge/deployは実施しない。

## 2026-10-10の採択とレビュー対応

Kaito-Iwaseの明示判断で、[PR #204](https://github.com/jogi-hack-2026-team/jogi-hack-2026/pull/204)の計算方式を採用する。正式状態とD-22の部分置換は[Architecture D-31](../../docs/architecture.md#d-31-同一モデルの完了cdf統合候補203)に記録する。同じMarkov/Betaモデルの有限Kによる数値近似差を減らし、範囲外・数値gate・明示`sampled`を残して公開DTOを維持する判断である。チーム全員の合意・Human APPROVED review・現実の予測精度・mainへのMerge・公開配置の確認とは区別する。

[レビュー #5478076801](https://github.com/jogi-hack-2026-team/jogi-hack-2026/pull/204#pullrequestreview-5478076801)のBlockingは採択状態と旧Decisionの対応であり、数式修正は求められていない。レビュー担当者241205008は独自Gauss–Legendre oracleの8ケースで最大CDF誤差2.45e-14・分位点不一致0件を報告した。本追補ではそのoracleを実行しておらず、上記の作者側検証と混同しない。

`NUMERICAL_MARGIN=1e-10`は既存の有限fixtureで観測した最大CDF誤差5.77e-15より広く、近傍の整数比較へ送る幅である。全入力の厳密な誤差上界を証明した値ではなく、`MAX_CLOSED_*`や漸化式の変更時には独立oracle・閾値境界・数値gateを再確認する。

gの短積はalphaに比例する整数積を持つため、この版は検証したalpha<=32に限定し、alpha>32の逐日積には1000日／32768bitの資源保護を残す。旧方式なら有限値が出る入力も`RESOURCE_LIMIT`になりうる。これはgの定義や完了horizonの変更ではない。全alphaへの短積拡張や上限変更は今回行わず、HTTPで極端posteriorの資源失敗を誘発したとは報告しない。

表示粒度は変更しない。上記の合成実HTTPでは旧P80=183日が193日へ変わった例があり、同じ週に収まる場合と週境界をまたぐ場合がある。有限Kの近似差が減っても、モデル上の将来行動・有限記録の不確実性は残るため、既存の週表示を維持する。sampling由来のseed差という当初の理由は[追加比較案の補足](../../docs/prediction/action-scenarios-proposal.md)で過去と現行を分ける。レビュー担当者の7ケースがすべて早めだった観測を、全入力の偏りや実ユーザー精度の改善へ一般化しない。
