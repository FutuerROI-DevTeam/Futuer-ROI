# #248 途中到達補正の設計補助

Supporting Doc / Not Source of Truth。現行契約は[Product](../product-spec.md#途中到達の個人補正比較248既定off)と[D-248](../architecture.md#d-248-途中到達による個人補正248)。2026-10-12、隔離比較実装のみCONDITIONAL。実データ利用、最終到達改善、公開運用はOPEN。検証は[Issue単位の記録](../changes/issue-248-milestone-verification.md)。

## Targetと選択

発行時累計P(a)、1回量q、最終総量Kを凍結する。途中到達は初めて将来の実DONE量がqに達するT。原点a当日のDONEはP(a)へ含め、未来へ二重加算しない。元CDFはN=1の元Engine、最終Goalの比較CDFはN=ceil((K−P(a))/q)。標準Engineの「1DONEをqとする」近似は維持するが、観測は実量を使うため、量の変動も残差へ入り得る。

直近3の未失効発行をorigin/idで選び、labelに基づいて選ばない。EVENT/INTERVAL/成熟した1日以上のCENSORがそれぞれ1episodeを供給する。PENDING/UNKNOWN/INVALIDが混じればidentityで、都合のよい旧発行への差替えはしない。H30+2での管理打切り後に実量が増えていなければ、次の発行の絶対閾値は同じにもなり得る。これは新しい条件付けのリスク区間であり、独立した到達数の増加ではない。3発行は科学的な識別や精度保証の閾値ではなく、事前に固定した比較実装gateである。

旧案の3完全H30窓は32日間隔の成熟待ちで96日かかり90日保持と両立しない。この実装は旧gateを満たしたとは述べない。最初の2管理窓と次の成熟prefixでもfit可能な新protocolである。最終Goalを増やして新しいlabelを作る、別Goal/他人のlabelを渡す、旧質問priorを更新する案は今回扱わない。

## 数式と独立計算

`Fu(p)=exp(u)*p/(1-p+exp(u)*p)`、`D(p,u)=1+p*(exp(u)-1)`とする。0/1はそのまま、u=0は入力CDFと完全一致する。

| 観測 | 確率 | 安定したNLL | u勾配 |
| --- | --- | --- | --- |
| EVENT(d) / INTERVAL(l,r) | Fu(b)−Fu(a), a=F(l), b=F(r), eventはl=d−1,r=d | log D(a,u)+log D(b,u)−u−log(b−a) | Fu(a)+Fu(b)−1 |
| CENSOR(c) | 1−Fu(F(c)) | log D(F(c),u)−log(1−F(c)) | Fu(F(c)) |

表示CDF/PMFは倍精度近似であり、微小な正の質量が差分で0へ丸まる場合がある。比較scoreは、保存元CDFと保存uに対する数学的odds変換を上表の安定解析式で評価する。丸めた候補CDFからNLLを再計算しないため、表示PMFの差分と数値的に一致しない場合がある。表示PMF=0だけで数学的な支持なしと断言しない。保存元CDFで0/1・等しい区間端点として表現される支持失敗はそのままとし、epsilon救済はしない。

本人Goalの3episodeを等重み1/3とし、平均NLLにu²/2を加える。共通切片やa/bを同時fitしない。Hessianは1＋非負の`Fu(p)*(1−Fu(p))`項なので強凸。`|u|≤ln(1.25)`で勾配の両端を確認し、内点は二分法、境界は射影KKT残差で判定する。構造的支持がないlabelはFAILED/u=0とし、tiny epsilonを入れて尤度を作らない。確率0のcensorは損失0・勾配0なので未達を必ず情報不足と呼ぶのも、必ず情報があると呼ぶのも誤りである。

独立[Python Decimal oracle](../../experiments/session-milestone-oracle/oracle.py)はTS helperを呼ばず、変換した確率を直接引いてlogを計算する。70桁・240二分で、3同一分布のEVENT（a=7/17,b=8/18）のuは0.096364823061408624…、CENSOR（F=.1）のuは−0.092017827832426496…となる。TS側の目的/勾配・内点/境界はoracleと有限差分で照合する。oracleは履歴を生成しない。

## Censoring、依存、転移の限界

同一anchorの未達を毎回`S(1)*S(2)*…`として独立投入しない。fit時点の`S(c)`一つを、成熟cutoff/hashとともに固定する。再fitはその時点のobservationに置き換える。欠測前の確定未達だけを右打切りへ使い、欠測後に既知実量だけでqへ達した場合は、最後の確定未達から最初の確定到達までの区間尤度を使う。欠測を休みとしない一方、欠測/打切り機構が非情報的という実データの仮定は未検証である。

離散生存のevent/survival尤度の一般形は[Gensheimer/Narasimhan](https://pmc.ncbi.nlm.nih.gov/articles/PMC6348952/)の式3–7を参照。リスク区間の積は行が独立という主張ではないことは[Rodríguez §7.5](https://grodri.github.io/glms/notes/c7s6)を参照。この文献は今回の個人補正の効用や欠測機構を検証したものではない。[Rindt et al.](https://proceedings.mlr.press/v151/rindt22a/rindt22a.pdf)は条件付き非情報的打切りを仮定し、[Yanagisawa](https://proceedings.mlr.press/v202/yanagisawa23a/yanagisawa23a.pdf)は打切り下のscore条件を扱う。今回のNLLは仮定付きの比較量で、無条件のaccuracy指標と宣言しない。

発行時posteriorも同じ本人ログから作られるため、複数episodeは依存する。平均重みは人数水増しを防ぐが、独立な共同尤度や有効標本数を与えない。最終Goalへ同じuを移すには、距離・状態・horizonの変化に対する残差の安定性が必要で、未検証である。

CDFのodds変換は条件付けと非可換。F(1)=1/5,F(2)=1/2,exp(u)=5/4なら、変換後に1日未達で条件付ける値は5/12、条件付け後に変換する値は3/7。元のposterior/stateに基づく各発行CDFをそれぞれ変換する本実装から、管理窓をまたぐ単一の整合的な潜在到達分布を主張しない。新しく発行した候補だけを未来の同じlabelで比較し、fitに使ったscoreを前向き成績として数えない。

## 再現と運用の境界

元のquantile計算が選んだcompletion methodを保存する。H30表現の丸め補正だけは既存1e-10 margin内で境界/単調性へ戻す。u=0のquantileは元Engineの有限H30値を保持し、補正後のmilestone quantileは保存CDF内で求める。最終Goalの元quantileは発行時に保存したsource.config.horizonDays（現既定1095日）の探索のまま、比較CDF/scoreはH30に限るため、両者を同じ探索範囲とは表示しない。

凍結候補はid/hash・参加世代・文脈・fit世代・入力receiptで照合する。GETの比較は保存せず、POST発行は明示候補がなければidentity。過去に凍結した比較は現在の候補失効でも書き換えない。fit世代変更だけでは既存発行の観測はINVALIDにならず、発行の文脈/prefixが変わる場合にINVALIDとなる。版戻しやtitleだけの編集も設定版を保守的に変える。

物理削除は`purgeExpiredMilestone`またはAPI workspaceの`npm run milestone:purge -- --confirm-milestone-purge`で行う。接続先/バックアップ方針を確認した運用者だけが実行する手順で、今回実DBには実行していない。既定OFFのままでもpurgeできる。期限切れの非表示は実際の削除時刻を保証せず、定期実行とバックアップは実利用前のOPEN条件である。


## 同意CAS・予測文脈・保持期間の追加確認

参加PUTはGET reportのconsentRevisionをexpectedConsentRevisionとして要求する。受理時にGoalの単調CAS版を消費し、撤回でも進める。同じ有効参加を作った要求の再送だけは同じ参加を返し、期限を延ばさない。撤回・期限切れ・purge後にその古い要求を再送しても409となり、改めて取得した版による明示参加だけが新世代を作る。Goal上の版は履歴やlabelではなく古い要求を識別するCAS metadataであり、Goal削除で消える。

予測contextにはunit/q/timezone/開始日/初期量/目標量/設定版/質問版とsnapshot/build/configを使い、初回DONEで変化するunitLockedは含めない。正当な観測後の編集可否markerの変化で過去の発行を無効にせず、実際の設定変更・prefix訂正の失効判定は維持する。

JSと3tableのSQL上限はともに経過2160時間であり、DB session timezoneの暦90日とは区別する。UTC/Europe/Berlin双方で参加と派生2tableの上限を合成DBで確認する。新規未公開0008だけの修正で、旧migrationや実DBは変更しない。
