# 実Chrome起動予算と有限cleanupの検証（#213）

Supporting Artifact / Not a Source of Truth。対象は[Issue #213](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/213)。2026-10-10、起点main `86b396d5ae15e1b3e735a4df310e9e4216a086e4`。現行の検証責務は[Architecture](../architecture.md#test-strategy)、実行方法は[開発ガイド](../DEVELOPMENT_GUIDE.md#検証)、コードと回帰の入口は[対応表](../change-map.md#開発基盤と作業手順)を参照する。

## 原因と改善を分ける

- [失敗run 38058430158/job 114231560389](https://github.com/jogi-hack-2026-team/jogi-hack-2026/actions/runs/38058430158/job/114231560389)は10084msでendpointなし・DevToolsActivePort ENOENT・子process生存・stderr空。UI assertは未到達。4CPU/load1.19/free15.1GB。後続7 dump-dom Chromeは成功。
- [直前成功run 38055901737/job 114224309043](https://github.com/jogi-hack-2026-team/jogi-hack-2026/actions/runs/38055901737/job/114224309043)は同じubuntu24.04/image20261004.327.1/Chrome154.0.8037.97で、起動から最初のCDPまで6492ms、responsive全体9912ms。
- #202の同一HEAD `e9d34444060a80fbb1189fc03501fe2f380bffe7`にも10022msの起動前失敗があり、別実行5764/6189msでは成功。DBusログ2行だけを根因としない。入口は逐次で、多重Chromeの証拠なし。
- 上記は依頼元の独立診断で確認した履歴。今回Linux失敗をローカルWindowsで再現したとは扱わない。10秒を越えた同一Chromeが30秒以内にreadyになるか、遅れの根因は未確認。

同じprocessの起動を30秒まで待つ候補を実装し、10秒の診断を残した。独立した10秒待ちを各段階へ追加すると総時間が膨らむため、endpoint/HTTP/WS/最初CDPに単一deadlineを使う。30秒は根因を証明する値ではなく、失敗待ちを最大20秒増やす限定した猶予。期限・異常終了を成功へ置換せず、再spawn・自動retry・skip・assert変更はない。全test180秒と通常UI/CDP10秒を維持する。

cleanupは別の固定猶予でBrowser.closeと正常exitを待ち、必要時にSIGTERM→SIGKILLへ進む。所有した親子関係のうち直接spawnした子のexitを観測し、終了できない場合はprofileを残して失敗する。未知の子孫全体の停止保証や広いprocess検索・killは導入していない。

## ローカル検証

Windows、Node24.21.0/npm11.19.0、Chrome154.0.8037.98。独立worktree・専用一時profileのみ使用。ユーザーのDB/session/.envと通常checkoutには触れていない。

| 検査 | 実行・結果 |
| --- | --- |
| 合成起動・終了 | `node --test apps/web/tests/browser-startup.test.mjs apps/web/tests/browser-debug-endpoint.test.mjs`。28/28成功（新startup22、既存endpoint6）、fail/cancel/skip 0。実fake子と実loopback停止HTTP/WSを含む |
| 実Chrome | `npm run test:browser --workspace=@futureroi/web`。17/17成功、fail/cancel/skip 0。responsive9subtestsすべて到達・成功。起動832ms、Browser.close応答後正常exit0、SIGTERMなし。最初の個別実行も9scenario成功（起動611ms） |
| 型 | root `npm run typecheck` 成功 |
| build | root `npm run build` 成功。既存のbundleサイズ/JS callback時間warningあり |
| Web通常 | `npm run test --workspace=@futureroi/web`。135件中134成功/fail0/cancel0/既存browser入口skip1。skipは未実行として上の全browser17件で補完 |
| Foundation | `pwsh -NoProfile -File scripts/check-foundation.ps1`と`git diff --check`成功。文書・設定検査でありアプリ検査とは別 |

### 初期FAILと訂正

1. 初回合成26件は21成功/5失敗。Node timersのAbortErrorが期限/exit理由を覆ったため原因を保持するよう修正。fake WSがCONNECTINGでもCDPを受け付ける誤りも修正。
2. 追加の共有deadline回帰はWindowsのtimer量子/20ms pollingに対して段階到達の余裕が不足し、WS段階で期限になった。各段階で新deadlineを与えていないことは維持し、最初CDPの停止が確実に期限を越す設定へ修正。
3. 実WS停止回帰はクライアント中断後もfixture側upgrade socketのFINを未読のまま保持し失敗（通常Web初回も同じ1失敗）。serverのHTTP処理から外れたupgrade socketをfixture自身が読むよう修正し、FIN後destroyを観測。HTTP idle keepaliveと当該upgrade requestを区別した。製品WS実装変更やassert削除で成功へ置換していない。
4. セルフレビューでBrowser.close応答とexitを分離し、正常終了の猶予を待たずSIGTERMを送る初期実装を修正。実Chrome再確認ではexit0を観測。

## 敵対的セルフレビューと限界

endpoint/profile不在、read停止、HTTP本体/body停止、page不在、WS停止/異常、CDP停止、spawn error、早期exit、test abort、kill失敗、SIGTERM無視、最終残存を負例で確認。ready/stop二重呼出しは同じPromiseに束縛する。HTTPはredirect拒否、WS targetはowned loopback endpointと同一originに限定。失敗した元testとcleanup失敗を残し、profile削除は終了確認後。秘密の環境値やCookie/storageは診断へ収集しない。

コード変更はbrowser harnessだけ。既存9scenarioのUI/native入力/assertは維持し、Engine/API/認証/UIソース・依存版・workflow/test総timeout・required check・設定権限は変更しない。正式Product仕様への影響がないためProduct Specの更新と新P/D採択は不要。AIセルフレビューはHuman Reviewの代替ではない。

Linux CIの新HEAD結果、PR source HEADと合成merge SHA、初回attemptはIssue/PRへ記録する。根因確定・長期flake消失・実認証/DB E2E・公開環境・未知の子孫全停止・速度改善は未検証。merge/deployは今回行わない。

## 追加レビュー：中断後の新規起動を防ぐ

初期HEAD `6fdccba6232d43c95b617279a734a2ae01cf8e4d`の[Application初回CI](https://github.com/jogi-hack-2026-team/jogi-hack-2026/actions/runs/38061780566)はEngine77/API198/Web151件・fail/cancel/skip各0で成功。同じChrome PIDが10013msの途中診断後12261msでready、UI9シナリオ成功・exit0を観測した。ただしendpointは9419msで検出され、元の10秒endpoint不在失敗は再現していない。上記ローカル検証時点の未確認事項のうち、10秒診断後の実Chrome readyはこの初回CIで確認できた。

その後の独立レビューでShould Fixが1件確定した。build中にtestがtimeoutし、session未作成のafterが完了した後、buildの遅延完了からChromeを新規spawnできた。これは元のCI起動遅延とは別のabort/cleanup保証の穴であり、初回CI成功でも検出できなかった。

spawn直前にsignalの中断を確認し、実responsive harnessのbuild完了直後・server生成前にも確認を加えた。事前中断と遅延buildの2回帰は修正前に2/2失敗し、修正後に成功。後者は別Nodeで実際のharness本文を実行し、buildだけをゲートで止め、abort→after完了→build解放を再現する。HTTP/Chromeを合成adapterへ置換し、server生成0・spawn0と中断理由を確認する。test timeout180秒・UI/assert本体は保持した。

追加後の合成起動/endpoint回帰は30/30成功（startup24＋既存endpoint6）、通常Webは137件中136成功/fail0/cancel0/既存browser入口skip1。全実Chrome17/17・responsive9シナリオ成功、startup2292ms・exit0・Browser.closeのみ。Foundation102文書/1573リンク/7ignoreも成功。最終HEADのCIはIssue/PRへ記録し、初期HEADの成功をその代替にしない。
