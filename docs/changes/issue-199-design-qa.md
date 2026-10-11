# Issue #199 デザインQAの補助記録

> Supporting Artifact / Not a Source of Truth

対象Issue: [#199](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/199)。基準SHA: `cb39176ba5b9c43ee64d8fb5cf93ef1c45ca2f0c`、日付: 2026-10-10。基準時点はPR202のレビュー中で、技術QA成功と本人UX受入/Human Approvalを区別する。現行仕様は[Product Spec P-21](../product-spec.md#p-21-todayの朝焼け山並み案)と[Architecture](../architecture.md)が正本。本書は実測・実施/未実施と訂正前後の履歴を保持する。

2026-10-10のreview5478870347対応で配置とSupporting表記を修正し、基準時点の全文・リンク先・見出しを保存した。製品の挙動は変えていない。旧入口には元見出しと移動先への案内を残し、[移動manifest](issue-199-design-qa-migration.json)の全文検査とFoundationで確認する。前段の実画面QAを今回の実画面再実行として数えない。

<!-- issue-199-qa-preserved-begin -->

# Future ROI 朝焼け・山並み案と全画面UXの実装QA（#199）

**最新の技術QA: passed** — 以下の再開後検証を参照。人間のUX受入・Human Approval・製品完成とは区別する。

## 最新：既存Core復帰と昨日訂正の取消focus（2026-10-10）

公開レビューと訂正に基づき、Hero「今日サボると、ゴールは何日遠ざかる？」と既存Coreを復帰した。未完了Goal・同じ継続傾向と設定量・再開後の経路共有というモデル条件で、g50は再開待ちの中央値と完了が遅れる日数の中央値を兼ねる。周辺の完了日P50どうしの差、実際の因果効果、任意の今日量や設定変更の効果とは区別する。共通posteriorから共有θを引く場合も条件付き経路共有は成立し、混合後のT_doneとGは一般に依存する。前段の「完了遅延として解釈できない」という全面否定と、それに基づくCore改訂は撤回した。新しいチーム合意やHuman Approvalは主張しない。API・Engine・保存hookの契約変更はない。

YesterdayCorrectionの編集で元入口が消えるため、取消後にBODYへfocusが落ちる実Chrome再現を3入口で確認した。TodayScreenが同日・同画面の取消intentを持ち、有効な元入口へ戻す。Recent／menuなど入口が消えた場合は再表示された同日のsummary「変更」へ戻す。owner/Goal/draft世代のremountでintentを破棄し、対象日・private epoch・connected/disabled境界を確認する。成功保存の復帰は変更していない。境界guardはソースレビュー、同日復帰は実画面とnative回帰で検証した。

独立Chrome最終QAは46観測で成功、今回範囲のMust/Shouldは0。390/1440pxで公開トップ→認証→一覧→Today→履歴の月移動→編集・戻り、未記録/記録済み/条件付き/達成済み、昨日summary/Recent/menuの取消6件を確認した。Homeは320/390/1440pxで意味の切れ目に折り返し、「遠ざ／かる」の語中分断を解消。390pxでは問い・g50・完了brief・累計・バーが初期表示に収まる。320pxのバーは初期表示外だがnative wheel150で全体へ到達し、horizontal overflowはない。既存GET/PUTの合成503、保存中とSPA離脱も確認した。全SPA離脱後の古い保存失敗が新hookへ残らない既存制約は#185の証跡と区別し、今回の保存契約へ範囲を広げない。

実Goal書込0。4fixtureのGoal/Today/Log GETは前後完全一致。合成PUT attempt4は実APIへ転送していない。最終source hashは20d8fa4948bc9cdf655d6ae1f6bd7b3f77b829483e62a4294ab650ced34f56a1で前後一致し、229ファイルの現在byteも照合した。QAはd2fd574からの最終未コミットsourceで実行したため、commitとexactHEAD CIはPRで別途照合する。

最終root typecheckとbuild成功。Webは112 pass/1 skip（ブラウザを別実行するentry）、全ブラウザ回帰は17 pass/fail0/skip0。YesterdayCorrectionの実TodayPage/useTodayData/useSaveLog native回帰は390/1440px×DONE/SKIPPEDで取消focus/PUT0/pageErrors0を確認し、関連suiteは10 pass/fail0/skip0。独立関連回帰38 pass/fail0/skip0。固定θと共通posterior混合の条件付き畳み込みは独立モデル検算で照合したが、実Engine統合や因果効果の証明とは呼ばない。新fixtureの最初のmount failureはauth/router mock設定の診断であり、実ChromeのBODY再現とは別。最初のtypecheckのoptional refエラーはentryRef ?? nullで修正し、最終型検証が成功した。既存500kB chunk警告は残る。

タスク内mergeprep202-evidenceにbrowser-qa.json、browser-qa-verdict.json、browser-source-bridge.json、masked PNG、focus-implementation.md、adversarial-review.md、adversarial-model-check.json、最終typecheck/build/Web/browserログを保持する。runtime資格情報とこれらの実行データはcommitしない。前段の画像とLibraryは履歴で、復帰したHeroの最終画面とは区別する。

未検証は本人の最終UX受入、Human Approval、iOS/Safari実機、ソフトkeyboard/safe-area、読み上げ音声、本番、実daycross。実API昨日訂正はDONEのfixtureで検証し、SKIPPEDは実hook native回帰で検証した。通常checkoutの未コミットEngine/.vscode、既存worktree・container・ユーザーデータとpreviewは保全する。merge/deployは行わない。

## 前段の履歴：全画面統一と3点の情報整理（2026-10-10）

本人の追加指示と「いいね」「やろう」の承認に沿い、既存画面の用途・次操作が伝わる表示へ統一した。公開トップ、ログイン、登録、Goal一覧、作成/編集、履歴、アカウントの明るい空/森色、書体、角丸、余白、フォームをそろえる。OS暗色指定も同じ配色。トップは用途と登録/ログインを先に置き、同じ提供背景を装飾として使う。認証や戻り先の判定を変更せず、予測サンプル、認証不要Today、アカウント追加、API機能追加は行わない。Goalの3区分、今日の記録への導線、履歴の実Goal名、アカウントの短高スクロールを確認した。

Todayは累計・目標・残りと進捗バー、設定量で続けた場合の完了見込みを連続して置き、その後へ完了予測/実績の詳細をまとめる。desktop初期展開と利用者の明示開閉保持は維持する。g50の意味・問い・朝焼け風景・明朝を保ち、数字だけを最終32px/単位16pxとして補助へ下げた。最初の64px案は独立画素レビューで主従未達P2となり、該当CSSだけ修正して6断面を再確認した。予測ラベルは「設定量（1回の量）で続ける場合」、dock/editorは「今日記録する量」。設定量と異なる有効入力のときだけ予測の前提注記を表示し、同量へ戻すと説明とARIA参照を外す。TODAY_DONEの今日の仮実行、CURRENT_STATEの保存済み実績の説明差を実部品SSRでも検査する。未保存量での予測や休む完了日は作らない。

独立Chromeレビューは320/390/960/1440pxの全体37断面、Goal修正後9断面、Today4状態16断面、最終数字とdock文言6断面を確認。各採取の前後ソースhash一致、横溢れ・予期しないHTTP400+・pageerror・Goal/Log書込はいずれも0。native Enter/Space/Tab、resize保持、本文末尾、量注記の表示/消去/ARIA、390×300、文字200%、アカウントEsc/focus復帰、フォーム空送信無POSTを確認した。合成GET401/503のマスクと復帰、ログイン戻り先、NotFoundは故障注入として実API障害の受入とは分ける。通常の状態画面は専用アカウント・実API・既存専用一時DBを使用し、4fixtureを変更していない。

Goalフォームにnative Tabで入力が底の保存欄へ隠れるP2を確認（320×568の総量、390×300のタイトル）。Goal scoped CSSだけで保存欄を通常flowへ戻し、全可用fieldの可視focus・中心hit-test INPUT・末尾保存への自然scrollを再確認して解消した。共有ActionBar/Today dock/保存/validation/dirty guardは変更していない。最終独立判定は新P0/P1/P2なし。技術判定は本人UX受入の代用ではない。

最終ローカル型、本番Vite build、Web112 pass/1 skip、実Chrome14 pass/fail0/skip0を実施。実AmountEditor13ケースは設定量と異なる量での注記、同量への復帰、非保存、既存整数/連打/keyboard/IME/busy/focus境界を含む。既存hookのowner/確認/保存日/昨日跨日のassertを保全した。500kBチャンク警告は既存のまま。新exact HEAD CIはDraft PR202の検証欄へrun/HEADを記録する。main041f24cとの差分でAPI/Engine変更0、依存/lock/CI workflow変更0、通常checkoutの未保存Engineと.vscodeを保全。

追加の実操作レビューは公開入口→既存ログイン→Goal一覧→設定→Today→設定量20分の保存→訂正取消→履歴→再訪の8点を通過した。保存は追加QA Goalの同日同量再保存PUT200を1回だけ実施し、設定DTO・全記録の値と件数は前後一致。4状態fixtureの書込は0。記録変更の取消focusは見出し、量変更の取消focusは元の増量操作に復帰した。保存失敗・日付変更・超過は既存テスト証拠と区別する。

山の背景上にある「記録を変更」の境界は実画素2.789:1でShouldとなり、Today限定のボタン枠色1変数を濃くして390pxで4.063、1440pxで4.072へ改善した。採取したsolid文字の最小4.773、必要操作境界3.370、focus5.603。初期「+」の淡い装飾枠は1.318だが識別glyph自体は6.609であり、全枠3:1や全画像画素網羅の適合とは主張しない。最終再採取の5画像とhashを保持し、追加保存0、未解消Must/Should0。旧実画像・計測はbefore-border-fix-*とjourney-before-border-fix.jsonへ保全した。

5e1952cのPR Application run38026000696はResponsiveDetailsのChrome DevTools起動待ち15秒で失敗した。該当ブラウザassert開始前であり、アプリassert失敗と読み替えない。同じrunnerイメージで前回はstderr接続先と6subtestが成功しており、再発はserver開始前の停止/遅延に整合するが、CPU/背景処理/dbusの根因は未確定。専用Chrome childにPuppeteer標準のdisable-background-networkingだけを加え、起動elapsed・Browser.getVersion・hostload/メモリ・pid/exit診断を記録する最小の隔離安定化仮説とした。起動10秒/実入力/assert/保護設定は保持し、無変更retryはしない。テストやゲートは弱めず、最終push後のPR検証に加え、既存workflow_dispatchでブランチ実HEADを直接checkoutしたApplication/FoundationのrunとSHAをPRに記録する。PRの既定checkoutは合成mergeであり、PR headSha表示だけを直接HEAD検査とは呼ばない。

最終Library v4の親による実画像レビューで、390px初期画面から完了見込みが完全に外れるShouldを確認した。ProgressSummaryの見出しの横へmobile限定のCompletionBriefを再掲し、同じview.completion.p50Labelだけを使う。p50nullは約3年以内の目安なし、材料不足/conditionalはまだ算出できない、completedには出さない。desktopは非表示として既存Outlookの詳細と前提を保つ。新予測/API/draft依存の再計算は0。実部品SSR1件を加え、最終Web112 pass/1skip、型、本番build成功。前段bad0c97のPRと直接HEAD CIはともに成功し、Chrome起動6583/7200ms・実native6subtestとWeb125pass/skip0を保持する。要約後の実Chromeは390×844でbrief・累計・進捗バー・dockの全体が初期clip内に可視、320×844/568・390×300・文字200%はoverflow0/自然scroll到達、1440は非表示で既存Outlook保持。forecast/recorded/conditionalのAPI週一致、達成済みはbriefなし。非達成3状態の異量注記show/hide/ARIA・予測週不変・保存0、採取前後ソースhash一致を確認した。p50=nullのlivefixtureはなく実componentテストと区別する。最終要約コミットは別SHAで再CIを確認する。

代表実画像：[トップ390](../ui/dawn-app/home-390.png)、[トップ1440](../ui/dawn-app/home-1440.png)、[ログイン](../ui/dawn-app/login-390.png)、[Goal一覧](../ui/dawn-app/goals-390.png)、[フォーム全体](../ui/dawn-app/goal-form-390.png)、[履歴](../ui/dawn-app/history-390.png)、[アカウント](../ui/dawn-app/account-390.png)、[Today390](../ui/today-dawn/preview-mobile-390.png)、[Today1440](../ui/today-dawn/preview-desktop-1440.png)、[Today詳細までscroll](../ui/today-dawn/preview-mobile-scroll-end-390.png)。私的メール部分はマスク済み。情報階層と次操作を優先する判断は[Apple一次資料](https://developer.apple.com/videos/play/wwdc2022/10037/)の今回のUIへの適用であり、一般論だけを実機検証の代わりにしない。

タスクのdawn-ui-evidence/whole-app-uxにafter-inventory.json、goal-fixed-inventory.json、after-focus-native.json、after-interaction.json、after-route-states.json、today-final.json、today-final-closure.json、最終reviewと各画像、final-typecheck.log、final-web-tests.log、final-browser.log、final-build.logを保持。旧P2証拠はbefore-g50-hierarchy-*、after-interaction-before-focus-fix.jsonへ保全。資格情報・runtimeはPRへ含めない。

残る未確認は本人の最終UX受入、利用者Braveでログイン後のToday、iOS/Safari、実端末keyboard/safe-area、自然日跨ぎ、本番、実API超過fixture、記録済み昨日訂正のlive相互lock。動くlocalhost:61813を保持し、公開トップはログイン不要、Todayは専用既存アカウントでのログインが必要。下記の100px/Today限定/Library version2などは前段の履歴であり、今回の最終表示とは分ける。

## 前段のToday操作改善（2026-10-10、d83a9d6まで）

参照への完全一致を完成条件にせず、「今日の行動判断と未来の変化が分かる」「記録しやすい」を評価基準とした。旧HEAD eff8e5bの[修正前後の実画像](../ui/today-dawn/ux-before-after-390.png)を保存し、以前の参照比較画像は前段の証拠として保持する。新しい期限・今日目標・入力中の量によるシミュレーション契約は追加しない。

- 対象日：底dockの外側に「今日の記録」とAPIの保存日を表示。旧日なら「記録する日」とし、内部入力をスクロールしても対象日は見える。昨日の10月9日と今日の10月10日を区別でき、短高390×300／文字200%320×568でも取消へ到達した。本文clip y56〜672.5、dock y672.5〜844。初期画面の末尾切れは内容喪失と区別し、スクロール/focusで全文を読めることを検証した。主数字・2択を縮めず、スマホ装飾余白を50px減らした。山の浅いstripと明るい数字背景は同じ提供ラスターで、desktopの山並みを保持する。
- 指標の意味：g50は休んでから最初に再開する待ち日数の中央値で、完了P50の差ではない。見出しを「今日休んだら、次に再開する目安は？」に明確化した。根拠の見出しも再開/完了/記録推移へ分ける。完了予測には今日の設定量と将来も同じ量の仮定を添え、未保存入力は再計算に使わないことを記録入力内に表示・読み上げ関連付けする。保存後の実績・未記録の仮実行・保存済み達成の優先を維持する。
- 記録：量の±を初期dockへ表示。既存の「1回の量」刻みで未保存editorを開き、直接入力も保持する。分/回とも1〜2,147,483,647の整数。空・小数・超過を0へ置換せず送信しない。休むはSKIPPED/null。自動input focusと取消後の元±（無効なら量link）のfocusを局所的に追加した。連打はfunctional update、busy/IME/repeat Enterを扱う。
- desktop：予測と積み上げの実グラフを初期展開し、mobileは要約優先。未操作だけ幅に追従し、一度行ったnative click/Enter/Space開閉はリサイズ後も保持する。右側は一つの白い補助面と区切りへまとめ、左と余白・角丸・書体・色をそろえながら主役の100px数字を保つ。desktopの実績%は40pxにして完了日と競わない階層へ調整した。累計・目標量・残りを明示し、残り0下限と超過別表示で実量を失わない。

更新画面の実API/新規Chrome context撮影16ケースは横溢れ・HTTP400+・pageerror0。320/390/640/960/1440のmobile初期折畳み/desktop初期展開、Enter、実SVG幅、末尾scroll、390×568非重複のroot QAも書込0で成功。独立担当は4状態の実API累計/目標/残り、stepper上下限・無効入力非保存、昨日入力保持、短高/文字200%、resize開閉保持、GET503故障注入から実API再取得への復帰を確認した。故障注入503は期待した1件で、実API障害の受入とは分ける。独立Goal/Log書込0、pageerror0。実画素レビューは主従改善・新P0/P1/P2なし。runtime/stepper-smoke.jsonは実APIのnative keyboard・focus・境界5観測を保持する。

Web全体111 pass / 1 skip（Chromeは別入口）、量pure4件、AmountEditor実React Chrome13ケース、ResponsiveDetails native入力とProgressSummary量境界の独立専用回帰を追加した。既存owner/確認/保存日/昨日跨日の回帰assertは保全する。rootは既存の追加QA Goalだけ再保存PUT200を1回確認し、DONE20分・2026-10-10・可視の記録済み見出しfocusを保持。4つのプレビューfixture・アカウントは作り直していない。最終Chrome統合は14/14 pass・fail/skip0（外側8組＝既存hook6＋量1＋responsive1、内側native開閉/量比較subtest6）。実績量境界は7ケース。最終型・本番build・Foundation（98 text files／1475 local links）も成功。既存の500kBチャンク警告は残る。

実APIfixtureの達成済みは100/100等号で、超過の実APIケースは未検証。超過125/100・等号・未達999/1000・minutesの正確な量は実ProgressSummaryを合成propsで描いた部品回帰として分ける。記録済み昨日Correctionのlive相互lockは専用fixtureがなく未検証、コードと既存境界回帰の確認に限定する。iOS/Safari・実端末keyboard/safe-area・自然日跨ぎ・本番・本人の最終UX受入は未確認。

Library代表2枚は同じIDのversion2へ置換し、元ファイルへ全xattrsを適用した。Brave専用Today URLはログイン画面への遷移を実観測し待機タブを保持する。利用者ブラウザでログイン後のTodayは未確認。専用runtimeのlocalhost:61813を継続稼働させ、通常checkout/Docker/既存DB/userdataを保全する。

証跡：dawn-ui-evidenceのvisual-qa.json、details-scroll-qa.json、independent-integrated-ux.json、runtime/stepper-smoke.json、web-tests-core-ux-final.log、typecheck-core-ux-final.log、build-core-ux-final.log、real-resave-postfix-qa.json、ux-responsive-details/full-browser-regression.log。コードhashを伴う独立判定と同HEAD CIを、本人受入の代用にしない。

旧HEAD b95a09cのCIは新ResponsiveDetails harnessのChrome起動先取得で失敗し、UI assertionには未到達だった。owned Chrome childがstderrへ出すloopback endpointを優先し、DevToolsActivePortをfallbackにした。10秒期限・安全設定・既存assertは維持。修正後の実Chrome 7/7と解析6/6、Web全体111 pass / 1 skipを確認。旧Ubuntu失敗の具体的原因は未確定で、新exact HEAD CIの結果はPRに記録する。Product/API/Engine契約と画面ソースの変更はない。

## 前段の参照調整と比較

依頼者が選択した[Claude案](https://claude.ai/artifact/KQDeWMput5bt77NEj4J4Kb#artboard-eb122470b18c)のHTML、上部390×600、下部390×640を実際に読み、同幅の画像で比較した。取込原本のLibrary識別情報を保ち、背景の出典・加工・書体ライセンスは[assets](../../apps/web/src/features/today/assets/README.md)へ記録した。

かけ合わせ3を土台にする。参照への完全一致は採択基準ではなく、今日の判断と記録を見落とさず行えることを優先する。本文を遮る固定top、常時長い説明、使う前の大きなグラフは操作目的に合わないため、実高さを確保するdockと詳細の開閉へ変えた。API/Engine契約を横断する提案はこの変更へ入れない。

373bb4bの初回版は色・山並み・主数字を合わせたが、操作帯が見通しより前、7日の曜日が余分な段、下半分の長い説明と常時グラフが密になり、選択案の構成から離れていた。ユーザーの指摘を受け、機能テスト成功だけを視覚一致の証拠として扱わず修正した。旧版の独立比較はタスクのindependent-visual-review-373bb4b.mdに保存した。

修正後は問い・主数字→直近7日/昨日→到達見通し→積み上げ。問いは同じcopyにwbrを入れ、遠ざかるの途中の改行を避ける。7日は32pxの丸と12pxの日付だけとし、曜日は読み上げ名に残す。390pxのカード高は137.2px（参照約138px）。進捗は25%全体を明朝56pxとした。長い補足とAxisChart、累計グラフはキーボードでも開閉できる第二階層へ移し、予測不能理由・出所・予定日差は見通しの本文に残した。

空と山は提供HTMLから抽出した同じラスター。淡い朝焼け、森色の説明、右寄せの明朝主数字、白カードを保持。参照の約2日などを固定せず、実日付・約1日・25%は専用合成ユーザーの実API/Engine値を表示する。参照の固定top704px、空グラフ、Claude通知は含めない。

スマホは本文だけを底の操作dockの上でスクロールし、dockは白面・上角28px・上向き影・実高さとsafe-areaを確保する。390×844では本文clipがy56〜696、dockがy696〜844。本文のDOMrectが下へ延びてもclip後の可視面はdockに重ならない。デスクトップは左に問い・昨日・操作、右に見通し・積み上げを配置する。

## 修正後の機能回帰

2026-10-10、専用の新規Chrome context、既存の専用アカウントでの実ログイン、実APIと専用一時PostgreSQLを使用。通常checkout、Docker、既存DB、ユーザーデータは未操作。通常撮影はAPI mockなし、認証設定の緩和なし。

- 未記録予測を320/390/640/960/1024/1280/1440px、記録済み・記録不足・達成済みを390/960/1440px、計16ケースで撮影。横溢れ0、HTTP400以上0、pageerror0。Maru900/Mincho900読み込みと実進捗を確認。
- 320/390/640/960/1440pxで閉じた初期表示・Enterによる2つのdetails開閉・展開した実SVG幅を確認。本文末尾へスクロールでき、390×568でも本文clipとdockの非重複を確認。追加確認のGoal/Log書込0。
- Web型チェック、本番Vite build、Webテスト103 pass / 1 skip（別入口のブラウザ検証）、実hook Chrome回帰6 pass / 0 skipが成功。owner切替・同一人再確認・保存日付・昨日の日跨ぎ境界を含む。既存JSチャンク500kB警告は残る。依存追加・lock更新なし。
- 修正後、既存の追加QA Goalだけで「記録を変更」→「やった」→実PUT200を1回確認。DONE20分と対象日を保ち、dockが閉じて記録済み見出しへfocusが戻り、見出しが可視となる。新Goal/アカウントは作らず、4つの状態fixtureを変更していない。初回版の新規保存証拠は別に保持する。

## 独立レビュー

修正前のP1/P2指摘に基づく変更を、実装担当の回帰とは別に確認した。独立担当はsource upper/lowerと390×1100の同幅・同位置の並列画像、390内部末尾、1440実画像を実際に閲覧し、視覚P0/P1/P2なしと判定。旧r2の誤ったcropは判定から除外した。back矢印の青は元のアプリのリンク色を使う任意P3として残す。

独立操作確認は320/390/960/1440のEnter開閉・実SVG幅、今日の量49取消、昨日37の開閉保持、320×568/390×568/390×430の入力・無効Enter非保存・キーボード取消・resize draft保持が成功。横溢れ/可視面の非重複、HTTP400+/pageerror/GoalLog書込はいずれも0。作業環境のindependent-visual-review-r3.md、independent-review-state-r3.jsonは検証時のコードhashを保持し、rootのテストやCI結果と区別する。

追加の敵対的確認で320px・文字200%の「この量で記録」がnowrapの2列内で切れるP2を再現した。Today内の量保存/再試行ボタンだけnormal/anywhereで折り返し、32px文字の全文が2行で読めること、dock内部スクロールでボタンに届くこと、通常/拡大のkeyboard取消を再確認して解消した。最小高さ、保存・取消の判定は変えない。専用contextでeditor表示後のcomputed font-sizeを一度だけ2倍にする再現で、実ブラウザのtoolbar zoomやOS設定変更は行っていない。independent-review-state-final.jsonが確認時のコードhashを保持する。[修正前](../ui/today-dawn/text-enlargement-before-320.png)と[修正後](../ui/today-dawn/text-enlargement-after-320.png)は実画素確認済み。追加確認も書込/error/HTTP400+0。

## 代表画像と証跡

[390px初期表示](../ui/today-dawn/preview-mobile-390.png)、[390px本文末尾](../ui/today-dawn/preview-mobile-scroll-end-390.png)、[1440pxデスクトップ](../ui/today-dawn/preview-desktop-1440.png)、[390px参照比較](../ui/today-dawn/reference-comparison-390.png)。未記録・予測availableの実API画像。内部スクロール採用後のfullPage画像はviewportと同高になるため、末尾はスクロール後の別画像を用意した。

タスクのdawn-ui-evidenceにvisual-qa.json、details-scroll-qa.json、typecheck-postfix.log、web-tests-postfix.log、browser-regressions-postfix.log、build-postfix.log、real-resave-postfix-qa.jsonを保管。資格情報・runtimeファイルはPRに含めない。Library代表2枚は旧ファイルと同じ識別子のversion1へ置換し、元ファイルへ版のxattrsを適用した。

## 範囲と未確認

本人による修正後の見た目・操作感の受入、自然の日跨ぎ、本番、iOS/Safari/実端末は未確認。実hook/Chromeの日付回帰は実施済み。BraveのCUA接続は復帰し、専用Today URLの新規タブがログイン画面へ遷移したことを観測した。ログイン待ちタブを保持し、利用者ブラウザでログイン後のToday表示は未確認。新規アカウント作成・資格情報/権限設定変更は行っていない。

API・Engine・owner/answerRevision/settingsRevision/保存判定はUI差分で変更していない。PR197、PR195（bd9288de）、PR201（cefecf62）を指定ベースへ通常mergeした。最終事前確認でmain041f24cへの3PRのmergeを確認し、同mainとのtree比較でAPI/Engine/Testsの差分0を確認した。UI固有の初回差分はf20da95→970e5b5、373bb4bは旧画像/QA。PR201の履歴競合3件は指定PR197の境界回帰を保全し、統合固有差分がcopy・回帰・仕様・対応表の4ファイルだけであることを確認した。今回の参照一致修正はこの上のToday4ファイルと必要文書/画像に限定する。merge/deployは行わない。


## PR #202 公開レビュー対応（2026-10-10）

[レビュー](https://github.com/jogi-hack-2026-team/jogi-hack-2026/pull/202#pullrequestreview-5478074339)に対し、問い→直近記録／昨日→詳細のDOM順を視覚順と一致させ、CSS orderによる入替を除去した。desktopは左列の問い・記録を読んでから右詳細へ、mobileは縦の表示順でnative Tabを進む。未記録の2択は同じ強さとし、既存の選択済み状態を区別する。

実Chromeの未記録／記録済み390・1440でDOMとnative Tab、初期mobileの完了要約／実績／バー／dock、今日と昨日補完の量編集focusと取消復帰を確認。昨日訂正はGETを合成したfixtureでgroupへの入口focusと今日の操作lockを確認し、取消後のfocus復帰は未確認。実API GETの値と予測は不変、API書込み0。保存保留・503失敗はPUTを合成してAPIへ送らず、閉じた昨日詳細が失敗時に開いてエラー全文を示すこと、同日rerender・詳細再マウント、保存中の全量入力／ボタン無効とnative Tab退避を確認した。細部側だけのrender例外も従来の通知を保持する。scope内の未解消Must／Shouldは0。

画面全体をSPA離脱・再マウントした後に旧PUTが失敗する場合、そのfailureは旧useSaveLog hookに所属し新hookへ共有されない。昨日のdetails単体の開閉／再マウントとは別の既存保存境界で、今回hook/session/draftの共有仕様を広げていない。iOS／Safari・実端末software keyboard・読み上げソフトでの聴取・人の最終UX受入は未確認。DOM/ARIAとnative Tab確認を実読み上げ確認とは扱わない。

122の明朝WOFF2は公式5.3.0 tarballのintegrityと各原本hashが一致。Viteのfont-only別ファイル出力で、現branchのdist CSSは727,023→545,414 bytes、font data URI 62→0、参照font URL欠落0（main比較ではない）。フォント原本・unicode-range・字体は変更せず、資産READMEへ理由・保守・更新手順を同期した。検証・最終commit/CIの公開結果は[PR #202](https://github.com/jogi-hack-2026-team/jogi-hack-2026/pull/202)へ追跡する。

<!-- issue-199-qa-preserved-end -->
