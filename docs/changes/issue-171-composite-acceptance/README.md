# 合成HEADの画面・操作の部分受入

**Supporting Artifact / Not a Source of Truth.** [画面設計](../../design.md)・[アートボード対応表](../../ui/artboard-map.md)の比較材料。仕様の正本は[Product Spec](../../product-spec.md)・[Architecture](../../architecture.md)。

## 実行対象と証拠の出所

撮影対象はローカル合成HEAD `f106496863d47a2f2ebeec2f3e845ecc3117684d`（2026-10-10）。main `86b396d5ae15e1b3e735a4df310e9e4216a086e4` に、未mergeの[PR210](https://github.com/jogi-hack-2026-team/jogi-hack-2026/pull/210) `a173c131b7a5e58470060dd4c8296d64cfe1585b` と[PR214](https://github.com/jogi-hack-2026-team/jogi-hack-2026/pull/214) `11fe8283bd68648a789bcaca5d3addd62d981bbe`を含む。3commitが合成HEADの祖先であることをGitで照合した。**main単独の実操作証拠ではない。** PR216 `c041e54e4807b74406ed37e2ec31d90cb16f3e4d` と文書PR217は撮影対象に含まれない。

C担当の専用Chrome・新規embedded PostgreSQL 18.4・UTC・合成アカウントA・production API/Webによる観測を再利用する。操作・HTTP/DB結果は[Issue146の部分受入記録](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/146#issuecomment-6099592886)、[昨日の訂正/取消](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/80#issuecomment-6099577418)、[Goal保存失敗](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/185#issuecomment-6099645359)と引継ぎREADMEで確認した。生HTTP/DBログは本資産に含まず、本文書担当は実操作を再実行していない。静止画像だけを再試行・focus・書込0の証明と扱わない。

元Libraryは `libfile_238b946b785081918eb33e804d078489` version0、`product-acceptance-f106496-390-1280-evidence.zip`（1,604,988 bytes）。取得ZIPのSHA-256は `d62bedf232ac70889ffe6219153d56d909772ea4ceaa893a3505c879fac59a5e`。元[screen-map.json](screen-map.json)とCSVの28行が一致し、各PNGのSHA・bytes・幅を独立照合した。匿名化済みPNGを再編集せずコピーし、28枚をcontact sheetで状態とmaskに照合した。PNG chunkはIHDR/IDAT/IENDのみ。認証/account欄はmask、Goal名は架空ラベルで、実利用者の情報・資格情報・Cookie・UUID・loopback URLは同梱しない。

## 部分受入として読める範囲

Cの最終集約は25成功記録（重複1を除く24種類）・実API変更10回という報告値。認証、Goal作成/編集、今日DONE/SKIPPED、昨日補完/保存済み訂正と取消、履歴、達成/使い捨てGoal削除、404、下記503復帰を観測した。操作の画面幅は個別記録に従い、全状態が両幅で成功したと一般化しない。

- 昨日は実UI作成Goalの開始日を専用DBで2日前へ調整したfixture。DONE11補完→未送信訂正cancel（PUT0、入口focus）→DONE12訂正を実PUT200で確認し、今日SKIPPEDを保持。製品UIから開始日を遡る操作や、保存済み記録をUNKNOWNへ削除する操作の確認ではない。
- 503は一覧GET・session GET・Today GET・Today PUT・Goal PATCHの5種類の確認で、ブラウザの`route.fulfill`により各確認で1回ずつ注入したとCが報告している。復帰は実API。Today保存は同じ17分の明示PUT200、Goal編集は明示PATCH200だけで回復。自動再送0は1.5秒の観測窓。本物の障害・commit後応答喪失・同owner再確認後の全失敗条件まで確認した意味ではない。
- 元[screen-map.json](screen-map.json)の`observedChecks.interceptedNotForwarded`は`3`だが、ZIPに集計receiptや計算規則はなく、対象操作・再実行分の扱いを特定できない。これを503注入全体の回数やmutationだけの件数と解釈しない。元mapの値は改変せず保持し、上記5種類の確認とは集計範囲を対応付けない。
- C報告の合成HEAD検証はtypecheck/build、Web通常136 pass / browser-wrapper skip1（別実行18 browser成功）、Engine77、API198（失敗/skip0）、Foundation103 text / 1580 links / 7 ignore、生成後Vercel9件成功。本PRのFoundation/CI、各PR単体CIとは別の実行で、合成HEADのGitHub CI・公開deployは未実施。

## 画像と観測状態

390pxは21枚、1280pxは6枚。削除確認の1枚は追加1440pxで、1280pxの代用にしない。下表はPNG実寸。元mapはviewportの幅だけを記録しているため、画像の高さをviewport高と断定しない。create/edit等の画像は画面の一部で、写っていない欄・全scroll到達性は画像だけから判断しない。

| 画像 | PNG実寸 | 表示状態 | 関連操作・結果（Cの観測記録） | 通信条件 |
| --- | --- | --- | --- | --- |
| [real-home-390.png](screenshots/real-home-390.png) | 390×844 | public home | home→Goal一覧 | actual UI |
| [real-home-1280.png](screenshots/real-home-1280.png) | 1280×900 | public home | home→Goal一覧 | actual UI |
| [real-register-validation-390.png](screenshots/real-register-validation-390.png) | 390×844 | register validation | empty submit; auth POST0 | actual UI |
| [real-auth-required-390.png](screenshots/real-auth-required-390.png) | 390×900 | login required | anonymous /goals→/login, redirect=/goals | actual UI |
| [real-empty-goals-390.png](screenshots/real-empty-goals-390.png) | 390×844 | empty Goals | registration/login→empty list | actual API/UI |
| [real-create-390.png](screenshots/real-create-390.png) | 390×844 | Goal create | form input→POST201 | actual API/UI |
| [real-goals-edited-390.png](screenshots/real-goals-edited-390.png) | 390×844 | Goal list | title PATCH200, today SKIPPED preserved | actual API/UI |
| [real-goals-1280.png](screenshots/real-goals-1280.png) | 1280×900 | Goal list desktop | list→Today | actual API/UI |
| [real-today-insufficient-390.png](screenshots/real-today-insufficient-390.png) | 390×844 | Today insufficient | fresh Goal no usable transitions | actual API/UI |
| [real-today-done23-390.png](screenshots/real-today-done23-390.png) | 390×844 | Today recorded DONE | amount23 PUT200 | actual API/UI |
| [real-today-skipped-390.png](screenshots/real-today-skipped-390.png) | 390×844 | Today recorded SKIPPED | DONE→SKIPPED PUT200 | actual API/UI |
| [real-today-recorded-1280.png](screenshots/real-today-recorded-1280.png) | 1280×900 | Today recorded desktop | recorded two-column; viewport=scrollWidth1280 | actual API/UI |
| [real-yesterday-done11-390.png](screenshots/real-yesterday-done11-390.png) | 390×900 | yesterday completed | missing→DONE11 PUT200 | actual API/UI, dedicated start-date fixture |
| [real-yesterday-corrected12-390.png](screenshots/real-yesterday-corrected12-390.png) | 390×900 | yesterday corrected | saved11→cancel PUT0/focus→DONE12 PUT200 | actual API/UI, dedicated start-date fixture |
| [real-history-390.png](screenshots/real-history-390.png) | 390×844 | history | start-month boundary | actual API/UI |
| [real-history-1280.png](screenshots/real-history-1280.png) | 1280×900 | history desktop | Today→history | actual API/UI |
| [real-edit-1280.png](screenshots/real-edit-1280.png) | 1280×900 | Goal edit desktop | edit→cancel PATCH0 | actual API/UI |
| [real-achieved-390.png](screenshots/real-achieved-390.png) | 390×900 | achieved | disposable Goal initialProgress=totalRequired | actual API/UI |
| [real-achieved-1280.png](screenshots/real-achieved-1280.png) | 1280×900 | achieved desktop | disposable Goal initialProgress=totalRequired | actual API/UI |
| [real-delete-confirm-1440.png](screenshots/real-delete-confirm-1440.png) | 1440×900 | delete confirmation | disposable Goal cancel0→DELETE204→GET404 | actual API/UI, extra PC width1440 |
| [real-route404-390.png](screenshots/real-route404-390.png) | 390×900 | unknown route 404 | undefined URL→Japanese404 | actual route |
| [real-goal404-390.png](screenshots/real-goal404-390.png) | 390×900 | missing Goal404 | nonexistent Goal→Goal-specific404 | actual API/UI |
| [injected-goals503-390.png](screenshots/injected-goals503-390.png) | 390×900 | list GET error | 503 panel→explicit retry realGET200 | Playwright route.fulfill503; actual API recovery |
| [injected-session503-390.png](screenshots/injected-session503-390.png) | 390×900 | session communication error | protected URL retained→healthy actual session | Playwright route.fulfill503; actual API recovery |
| [injected-save503-390.png](screenshots/injected-save503-390.png) | 390×900 | Today save error | DB unchanged, auto resend0/1.5s→same17 retry PUT200 once | Playwright route.fulfill503; actual API recovery |
| [injected-today-get503-390.png](screenshots/injected-today-get503-390.png) | 390×900 | Today GET error | protected URL retained→explicit realGET200 | Playwright route.fulfill503; actual API recovery |
| [injected-goal-patch503-390.png](screenshots/injected-goal-patch503-390.png) | 390×900 | Goal edit save error | raw title held, auto resend0/1.5s→explicit PATCH200 once | Playwright route.fulfill503; actual API recovery, viewport portion |
| [real-goal-patch-recovered-390.png](screenshots/real-goal-patch-recovered-390.png) | 390×900 | Goal edit recovered | title saved, logs unchanged | actual API/UI recovery |

## 残る受入

原画全一覧と見た目/番号の1対1照合、R5、P-21の個別了承/最終UX、main基準commit単独での全画面・全状態390/1280は未完。通常記録由来のforecast、calculation/consistencyエラー、実期限切れ/429、一般router error、account/logout故障（PR216）、未記録昨日の量cancel、iOS/読み上げ/公開環境も今回未検証。A3/A4/A5やC2〜C7/D2/D3へ画像を推定で割り当てない。既存#146の別commitの検証を今回の実行へ合算しない。

この部分受入で正式DecisionやIssueの全完了条件を変更しない。#171/#146等はOpenのまま、merge/deployとは別に追跡する。
