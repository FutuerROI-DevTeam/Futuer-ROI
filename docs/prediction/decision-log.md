# 予測モデルの判断記録

2026-09-30のCore／「遠ざかる」表現と採択理由を保持する。2026-10-10の全面否定は公開レビューで訂正した。同じ継続傾向・設定量と再開後の経路共有ではGはモデル上の追加遅れであり、完了日P50どうしの差とは別。[Architecture D-21](../architecture.md#d-21)と[Product P-21](../product-spec.md#p-21-todayの朝焼け山並み案)を参照する。

Supporting Doc。正式な状態と結論は[Architecture](../architecture.md#architecture-decision-log)のD-19〜D-22・[D-28](../architecture.md#d-28)を正本とし、本書はその比較理由・代替案・影響を1回だけ記録する。数値の出典は[Evidence](evidence.md)。ADR番号はProduct議論で使った呼び名で、正式IDはD-19〜D-22。実行方式のD-28も比較理由を本書にまとめ、採択状態はArchitectureを参照する。

## ADR-001 M1を採用しM0/M2を不採用

- **Context**：Coreは「今日サボると、ゴールは何日遠ざかる？」。1人あたり14〜60日分の記録から、誇張せず説明できる最小のモデルが必要。
- **Requirements**：本当にある状態依存を拾う／状態依存がないときに大きな効果を作らない／少ないデータで不安定にならない／12日で実装・テストできる。
- **Candidates**：M0 iid Bernoulli（`P(DONE)=p`）、M1 2状態Markov（`a=P(D|D)`, `b=P(D|S)`）、M2 3状態Markov（SKIPPED / DONE_1 / DONE_2+、`p0, p1, p2`）。
- **Evaluation**：合成ユーザー A（依存なし 0.6/0.6/0.6）、B（継続傾向 0.30/0.55/0.80）、C（逆方向 0.70/0.60/0.45）、D（弱い継続 0.45/0.55/0.65）。各14・30・60日、記録なし10%を含む。
- **Why M1**
  - 合成Bの連続中では、完了日の期待値差Δは4.44日、再開待ちの期待値`1/p0`は3.33日で、差は約1.1日。この比較は表示する中央値g50の誤差を測ったものではない。
  - M2は不安定：30日分の記録の1日を反転すると、M2の推定は最大2.1日（P95、Beta(2,2)）動く。追加効果と同じ大きさ。
  - M2は偽の効果が多い：Aで推定が真値の2倍を超えた割合は、14日・Beta(1,1)でM2 11%に対しM1 4%。
  - 14〜60日ではモデルを選べない：同じ観測での周辺尤度比較で、事後確率0.9超で決まった割合は全ケース0〜5%（保留95〜100%）。
  - 事前分布をBeta(2,2)にそろえても、30日の平均絶対誤差はM1 / M2 = A 0.32/0.44、B 1.64/1.47、C 0.28/0.34、D 0.55/0.66。この合成比較でM2のMAEが小さいのはBだけ。平均絶対誤差から誤差の方向は分からず、表示g50や実ユーザーが常に控えめな値になるとはいえない。
  - M1なら中心指標が閉形式になる（[ADR-003](#adr-003-中心指標はbeta-geometric分布の中央値)）。
- **Why not M0**：再開しにくさ（`b < p`）を表せない。今回の合成B・DのΔ比較では、80%区間が真値を含む割合は3〜59%。M1は`a = b`でM0を含むが、モデルの表現範囲が広いことは有限標本の推定精度を保証しない。合成A・30日・Beta(1,1)ではMAEがM0 0.21日／M1 0.36日で、M1の方が悪い（[比較条件と全結果](evidence.md#m0--m1--m2の比較)）。
- **Why not M2の境界変更・4状態以上**：状態を増やすとデータ不足が悪化する。
- **Trade-offs / Consequences**：Coreの意味を「再開までの待ち日数ぶん遠ざかる」に限定する（[Product P-11](../product-spec.md#p-11-future-roiの採用とcoreの境界)）。連続日数の効果は表さない。上の約1.1日は合成Bの期待値同士の比較に限り、表示g50・実ユーザーの誤差方向と大きさは未検証。
- **Reconsider When**：実ユーザーの記録が1人60日以上たまり、M2の追加効果が推定のぶれより大きいと確認できたとき。
- **Evidence**：[モデル比較](evidence.md#m0--m1--m2の比較)、[モデル選択](evidence.md#モデル選択)。

## ADR-002 事前分布Beta(2,2)

**現行の適用範囲：** 共通Beta(2,2)は[D-20](../architecture.md#d-20)の実績由来モードで有効。[R-11のMust追加・分担](../product-spec.md#p-15-質問由来の見通しのmust追加方針)はPR #115でチーム採択済みだが、回答別初期分布・不明時のfallback・既存Goal互換性は[D-26](../architecture.md#d-26)でOPEN。この比較結果を質問由来の数値校正や採択の証拠にしない。具体契約の採択後に置き換える範囲とレビュー根拠を正本へ反映し、本節の比較履歴を残す。

- **Context**：少ない記録では事前分布の影響が大きい。「やると続く（a > b）」を事前に埋め込まないため、a・b（M2ではp0・p1・p2）に同じ対称な事前分布を使う。
- **Candidates**：Beta(0.5,0.5)（Jeffreys）、Beta(1,1)（一様）、Beta(2,2)。
- **Why Beta(2,2)**
  - Beta(0.5,0.5)は少ないデータで破綻する：M2・Bの30日で80%区間の幅が91.9日、真値の2倍超が14%。
  - Beta(2,2)は誤差・偽の効果・ぶれを最も抑えた：M2・30日の80%区間の幅はBで6.8日（Beta(1,1)は14.9日）、真値の2倍超は4%。
  - M1の中心指標でも、Beta(2,2)はBeta(1,1)と同等以上：Bの中央値の誤差は14日で1.08→0.69日、30日で0.85→0.57日（2026-10-02に分位点を厳密計算へ直して再計測）。過大（真値＋1日超）は16%→6%（14日）。
- **位置づけ**：今回の合成ユーザー・14〜60日分の記録・評価指標の範囲で選んだEngineering Prior。人の行動にとって正しい事前分布でも、実ユーザーデータから推定した母集団の事前分布でもない。
- **Consequences**：記録が少ない間は値が確率0.5側に寄る（実行率が非常に高い人の完了は遅めに、再開が非常に遅い人の遠ざかる日数は短めに出る）。
- **Reconsider When**：実ユーザーの記録から母集団の分布を推定できるとき。
- **経緯**：事前の検討（2状態・完了日P50の評価）ではBeta(1,1)を推していた。中心指標が`b`だけで決まる形に変わったため評価し直し、Beta(2,2)へ変更した。
- **Evidence**：[事前分布の感度](evidence.md#事前分布の感度)。

## ADR-003 中心指標はBeta-Geometric分布の中央値

- **Context**：「今日サボると何日遠ざかるか」を1つの数で出す。
- **Key fact**：固定した`θ = (a, b)`の条件下で`T_skip = T_done + G`、`G ~ Geometric(b)`、`G ⫫ T_done | θ`（到達日分布のDPで誤差1e−17）。`G`を`b`の事後分布で積分したものがBeta-Geometric分布：`P(G > t) = B(α, β+t) / B(α, β) = Π_{i<t} (β+i)/(α+β+i)`。α・βは整数なので、分位点は整数の比較で厳密に求める（浮動小数点の`lgamma`差では、CDFが閾値に一致する境界で1日ずれることがPR #86のレビューで見つかった）。
- **Candidates と判定**

| 候補 | 意味 | 問題 | 判定 |
| --- | --- | --- | --- |
| **Gの中央値 g50** | 半分の場合は○日以内に再開＝ずれは○日以内 | 整数の粗さ（多くの人で1〜2日） | **採用** |
| 期待値 E[G] = E[1/b] | 平均のずれ | `α ≤ 1`で発散（Beta(1,1)・14日で最大13%）、1日反転でのぶれが大きい（Bの30日で2.83日） | 不採用 |
| 完了日P50の差 | 分位点同士の差 | 期待値差と意味が異なる。乱数のノイズと3年打ち切りの影響を受ける | 不採用 |
| 期日到達確率の差 | 期日がある場合の確率差 | 期日のないGoalでは出せない | 不採用 |

- **Why**：閉形式で乱数・seed・打ち切り・浮動小数点の誤差が不要。1日反転時の変化は30日で最大1日（P95）、発散なし。「休んだ翌日にやれたのは○回中○回」という数え上げと直接つながる。
- **表示規則**：現行の実績由来モードでは`nSD + nSS = 0`（休んだ翌日の記録がない）なら事前分布だけの値を表示しない（[Product P-12](../product-spec.md#p-12-中心指標と表示の規則)）。R-11の回答由来モードを追加するScopeは採択済みだが、具体表示条件はD-26でOPEN。中心指標は閉形式の計算なので「シミュレーション」と呼ばない。
- **Evidence**：[中心指標の候補比較](evidence.md#中心指標の候補比較)。

## ADR-004 将来のMonte CarloをやめてDPで計算

2026-10-10の[D-31](../architecture.md#d-31-同一モデルの完了cdf統合候補203)により、完了の既定計算だけをBeta事後積分へ置換した。以下は旧判断の理由・当時の測定であり、将来の日々のMonte Carlo／CRNを使わない判断は維持する。事後サンプル＋DPは範囲外・数値gate・明示`sampled`で残る。週表示は維持するが、標準整数域の既定経路では有限Kの抽選を使わず、有限記録・将来行動・モデルの不確実性は残る。

- **Context**：初期案は、事後サンプルごとに将来の毎日のDONE / SKIPPEDを乱数で生成し、2つのシナリオを共通乱数法（CRN）で比べていた。
- **Candidates**：A）事後サンプル＋将来の日々もMonte Carlo、B）事後サンプル＋到達日分布をDPで厳密計算。
- **Why B**
  - 決定的：同じ入力なら同じ結果。将来部分のシミュレーションノイズがない。
  - CRNが不要：今日サボった場合は恒等式で求まるので、2つのシナリオを並べて乱数を合わせる必要がない。初期の試作で見つかった「1本の乱数列を使い回すとCRNが崩れる」問題そのものが消える。
  - 正確：漸化式・DPの期待値差は到達日分布DPの平均差と小数点以下6桁まで一致。
  - テストしやすい：恒等式・単調性を厳密に検証できる。
  - 当時の局所計測：K=200・`need = 120`で84ms（Node 24.21.0）。微小確率の打ち切りなしで、必要回数120・400・600・800・1000・1095の6条件中の最大は約260ms（need=600）。全入力・公開runtimeの実行時間上限ではない。
  - 注意：DPの途中で微小な確率を捨てると分位点が変わりうる（PR #86レビュー）。省いてよいのは、H日以内の累積確率を変えない計算だけ。
- **残る乱数**：完了の目安の事後サンプル（K=200）だけ。`splitmix32(hash(seed, m))`で抽選ごとに独立させ、seedを固定する。当時の5seedではP50が203〜212日だったため、表示は週単位に丸める。これはseed差の全入力上限ではない。将来の日々のMonte Carloノイズはなくなるが、事後抽選の近似、有限記録・モデルの不確実性、浮動小数点の丸めは残る。
- **Trade-offs**：CRN・Monte Carloを「技術的挑戦」として見せない。挑戦は「少ないデータでの誇張しない推定、閉形式の中心指標、厳密解によるテスト」。
- **Evidence**：[DPとMonte Carloの比較](evidence.md#dpとmonte-carloの比較)。

## PROPOSAL：Goal作成時の質問由来priorと条件付き計画

2026-10-04 / **未採択**。初日にも判断材料を示す案を[詳細提案](question-prior-proposal.md)と[Evidence](evidence.md#質問由来priorの局所検証2026-10-04)で比較する。現行R-06/P-12、共通Beta(2,2)のD-20、中央値のD-21、既存DPのD-22は変更しない。

- **Context**：記録0件では個人の再開・継続の予測を出せない。初日にも使える明確な前提の表示が欲しいという依頼者の要望。
- **候補**：最小の条件付きdaily計画、同じ行動の経験に限る任意質問からa/b別strength4、人口データから学ぶ共有prior、LLMによるprior生成。
- **推奨・理由**：条件付き計画を最小候補にし、質問priorは未校正の任意案に留める。質問を採るならstrength4をstrength8より先に検討する。誤回答の重みがs/(s+n)で薄まるため8は影響が長く残る。これは精度や最適強度の証明ではない。
- **Trade-offs**：質問は初日にも個人の自己申告を反映できる可能性がある一方、回答・version・訂正・出所表示・API・不足状態の回帰が増える。本人の回答が実観測ではないことを説明する必要がある。共有prior・LLMには今回の行動で校正するデータがない。
- **Invariants**：ActionLogは実際の記録のみ。初期BetaとinitialProgressを分離。D/S起点の実遷移だけで事後更新。UNKNOWNをまたがない。今日DONE仮定を実績へ書き込まない。raw訂正は両隣接遷移を再集計。BigInt整数閾値・α≥1・既存DP・H超null・微小確率を捨てない処理を保持。
- **Non-goals**：性格・習慣強度の測定、非dailyへの換算、LLM予測、本番API/DB/UIの実装、Mustや既存Issueの無断拡張、校正効果の主張。
- **採択条件・再検討**：ownerが初日表示とScope、質問・強度・出所、保存訂正・受入方法を決める。R-02/R-06/P-12/D-20/API/T-11/T-15の正式差分をレビューする。回答の誤読、校正悪化、既存Mustの遅延で再検討する。新しい正式ADR番号やDECIDED状態を与えない。
- **Evidence**：[試作と再現](https://github.com/jogi-hack-2026-team/jogi-hack-2026/blob/77c71a5f248a4dce4ce9fb8af6619b41541be9d8/experiments/question-prior-proposal/README.md)、[元調査](https://github.com/jogi-hack-2026-team/jogi-hack-2026/blob/77c71a5f248a4dce4ce9fb8af6619b41541be9d8/experiments/question-prior-proposal/historical/REPORT.md)、[一次研究と支持範囲](https://github.com/jogi-hack-2026-team/jogi-hack-2026/blob/77c71a5f248a4dce4ce9fb8af6619b41541be9d8/experiments/question-prior-proposal/SOURCES.md)。数値整合性・実ユーザー精度・理解や行動への効果を区別する。

元成果物はrepo外で準備した。今回の公開は独立Task [#107](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/107)で提案・実験だけを扱う。10/6は依頼者本人の目標で、チームの合意期限ではない。#84の技術選定・PR #105の競合解消へ追加しない。

## D-28

予測計算の実行方式の比較記録（2026-10-09）。正式な状態・採択手順は[Architecture](../architecture.md#d-28)を参照する。既存本文から理由・未検証・旧FAILを削除せず移動し、[移動manifest](../changes/issue-162-execution-mode.migration.json)で基準commitから全文とリンクの意味を確認する。

### 採択前のContextと提案（2026-10-09）

以下は当時の提案と条件の記録。現在の採択状態・方式はArchitectureを参照する。

<!-- d28-context:start -->

Context: Today APIは[engine.ts](../../apps/api/src/prediction/engine.ts)で純粋Engineを同期で呼び、計算中は同じprocessの記録PUT・Goal一覧・session確認が待つ。[#77記録](../architecture.md#2026-10-06の記録today-api77)は「workerへ移すかは#84の残判断」としたが、#84は2026-10-08にworker不採択のままCloseし、判断の持ち主がなかった（[#160](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/160)）。公開先は[D-25](../architecture.md#d-25)の第一候補のまま未採用で、Code Freezeは2026-10-12。

Decision（提案）: MVPでは同期実行を維持する。予測は要求ごとにDB接続を返してから純粋Engineを最大1回同期で呼び、HTTP・DB・時計をEngineへ混ぜない（現状維持）。同じprocessで先行する予測要求の計算時間の合計だけ、他操作も待ち得ることをKnown Limitationとして記録する。公開先の計測経路（公開先への送信手順と公開先側の計測）は未提供・未検証で、[#83](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/83)の受入条件として残す。採択は[#162](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/162)の文書PRへの別メンバー2人のApproveとし、決定者・日付・根拠を同Issueへ残す。

<!-- d28-context:end -->

<!-- d28-comparison:start -->

Alternatives: 同一process内のworker pool（候補spikeの`predict-pool.ts`相当を`runPrediction`の内側に置き、routeとDTOは変えない）。旧候補spikeの条件（Windows端末、CRUD 20 req/s、worker 2本、[10-07報告](../../experiments/architecture-verification/REAL-ENGINE-2026-10-07.md)）ではCRUD p95が約8〜13ms（session p95は約11〜23ms）だったが、今回のM5計測にはworkerとの比較がなく、公開runtimeでも未検証。worker死亡時の復旧（再生成か503か）・SIGTERM時のqueue drain・healthへの反映・回帰が必要で、Function環境でのworker_threadsの挙動も未確認。Freeze前3日で新しい失敗経路を増やす。「保留」は同期のまま判断を記録しない状態であり、再検討条件を明記する本案に吸収する。

Reason: [現行APIの実測](../../experiments/api-mixed-load/REPORT-2026-10-09.md)（Apple M5、同一多コア端末、各条件1回、[#161](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/161)）では、3人がthink time（1秒・0.5秒・1秒）を挟んで操作し続けるclosed loop（予測GoalのToday約1.13 req/s＋軽いDemo GoalのToday約1.13 req/s＝Today合計約2.26 req/s（CRUD／sessionを含む全要求は約5.65 req/s））で、Todayのp95が約0.12〜0.2秒・最大約0.3秒、他操作のp95は約10ms。この条件ではworker追加を必要とする結果は得ていない。一方、全要求が重い入力のopen loop（CRUD 20 req/s併走）ではToday 4 req/sで他操作のp95が約1回の計算時間（約90ms）に張り付き、10 req/sでCPU 0.96となるため、workerの効果が見込める領域は存在する。3人closed loopとopen loop 4 req/sは条件が異なり、「3人なら4 req/sまで余裕」とは一般化しない。要求失敗・DBの事実から同じEngine入口を直接呼んだwiring比較の不一致はない。独立した数学的oracleによる計算の再検証ではない。現在の利用想定（開発者3人の機能QAとデモ）に対しては、実装・運用コストが利点を上回ると判断する。

Consequences / Reconsider When: 公開runtimeの単コア性能が遅いほど同期ブロックは比例して伸びる（未測定）。再検討条件（提案値であり、実測で確定した公開SLO・容量限界ではない）は次のいずれかで、満たせばworker poolを再提案する。(1) 公開先のAPI processで観測した同期ブロックの最長が500ms以上。T-14の単体判定値と同じ値で、1回の同期ブロックがT-14の上限に達する状態を指す。(2) 3人closed loop相当で記録・一覧・session確認のp95が1秒以上。1操作の体感として許容する目安で、UX上の判断基準。(3) APIのprocess（instance）1つあたりで、重い入力中心のToday到着率が4 req/s相当以上の利用を想定する場合。今回のopen loopで他操作p95が約90msに張り付いた条件に対応する。同期ブロックの観測には[計測preload](../../experiments/api-mixed-load/server-metrics-preload.mjs)の`monitorEventLoopDelay`のmax（タイマーで観測したevent-loop遅延）を近似として使い、predict 1回の所要時間そのものではない。Engine単体の掃引（この端末・60日の合成記録1種類・既定Engine設定・回答なしR-11）では`requiredFutureDone` 548は84.94ms、700は83.6ms、800は75.0msで、この追加条件の最大は約85msだった。T-14の1095はhorizon短絡で約4.3〜4.8msだったため、T-14既定3入力より重いケースがあることは確認できている。全入力・回答ありR-11の最悪条件は確定していない。T-14の判定値は変えず、[公開前の最小検証](../operations/release-demo.md#公開候補の採用前に行う最小検証)で公開先の計測経路が整った時点に、T-14既定入力と`MIXED_LOAD_SIZES=548,700,800`相当の追加条件を区別して記録する。候補spikeの[旧結果](../../experiments/architecture-verification/REAL-ENGINE-2026-10-07.md)（546.83ms FAIL、CRUD p95 5秒超）はWindows端末の値として保持し、解消済みとしない。Evidence: [計測ハーネス](../../experiments/api-mixed-load/README.md)と生結果JSON（LOCAL_POC。localhost専用で公開先URLを指定できない。1 vCPU・実Cloud・長時間・多人数は未検証）。

<!-- d28-comparison:end -->

### D-28の採択方法の変更（2026-10-09）

依頼者がHuman Approveを必須とせず敵対的セルフレビューで対応を完了するよう明示したため、当初の条件を変更した。正式状態は[Architecture](../architecture.md#d-28)を参照する。親の独立精査も同期維持と再検討条件を技術的に推奨しており、性能証拠の適用範囲を拡大する変更ではない。#175後のPOSTキー・両PUT設定版へのharness追従は[PR #184](https://github.com/jogi-hack-2026-team/jogi-hack-2026/pull/184)でmainへ実装済み。作者HEAD `5c4a05a` のM5再実行、独立レビューのWindows adapter機能smoke、Windows原本の`--import`残件は[Architectureの記録](../architecture.md#d-28)で区別する。公開性能・1 vCPU・全入力の最悪値は未検証で、測定値・保存JSONは変更していない。旧計測は記録された実行元SHAの証拠として読む。

以下は変更前の手順の全文で、今回の採択・完了の必須条件ではない。[履歴保存のmanifest](../changes/issue-162-adoption-method.migration.json)で基準HEADからの全文を確認する。

<!-- d28-adoption-history:start -->

現在はPROPOSEDで、COMMENT reviewやAIの自己レビューを採択のApproveに数えない。Issue #162の担当者（引き継ぎを依頼者が承認した場合はその担当者）が、PR #172の最終変更を取り込んだPR #173の提案HEADへの別メンバー2人のHuman APPROVED reviewを確認した時点で、Issue #162へ採択対象SHA・2人の名前とreviewリンク・実際の採択日・根拠を記録する。提案内容の変更があれば、変更後の内容で採択の確認をやり直す。

その担当者がMerge前に状態反映用commitを作り、本書のD-28索引と本文を実際の採択日を添えたDECIDEDへ更新する。同じcommitで#77の実行方式欄とKnown Limitationの「提案中」、change-mapの「チームApprove待ち」を採択済みへ揃え、Issue #162の判断コメントへリンクする。Supporting Docの正式状態はArchitectureを参照させる。検証値・T-14・#83の未検証条件は状態変更だけでは変えない。push後に最終HEADのCIとrequired reviewを再確認し、古いApproveがdismissされた場合は状態反映後HEADへのHuman Approveを取り直してから人間がMergeする。提案HEADと状態反映commitは別々に記録し、状態反映push以前のreviewを最終HEADの承認として報告しない。このPRでは上記条件を満たしておらず、PROPOSEDのまま保持する。

<!-- d28-adoption-history:end -->
