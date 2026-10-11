# README の説明図

Supporting Artifact / Not a Source of Truth。対象は [Issue #245](https://github.com/jogi-hack-2026-team/jogi-hack-2026/issues/245)。2026-10-11 の main `3e5d9fb23afcd78e66e309c93c0000e6a3a8ab1d` を基準に、正式仕様を入口から読める形に要約する。新しい仕様・技術採択を定めない。

## 図と確認元

| 図 | 編集元 / 表示用 | 説明・実装の確認元 |
| --- | --- | --- |
| ローカル構成 | [draw.io](system-architecture.drawio) / [SVG](system-architecture.svg) | [Architecture](../architecture.md#system構成)、[Compose](../../compose.yaml)、[Dockerfile](../../Dockerfile)、[API app](../../apps/api/src/app.ts)、[Engine adapter](../../apps/api/src/prediction/engine.ts) |
| 利用の流れ | [draw.io](user-flow.drawio) / [SVG](user-flow.svg) | [Core User Flow](../product-spec.md#core-user-flow)、[routes](../../apps/web/src/router.tsx)、[画面設計](../design.md) |
| 2つの目安 | [draw.io](today-meaning.drawio) / [SVG](today-meaning.svg) | [表示仕様](../product-spec.md#today-decision画面の表示仕様)、[P-21](../product-spec.md#p-21-todayの朝焼け山並み案)、[再開待ち](../../packages/prediction/src/recovery.ts)、[完了の条件](../../packages/prediction/src/completion-scenario.ts) |
| 予測へのデータフロー | [draw.io](prediction-data-flow.drawio) / [SVG](prediction-data-flow.svg) | [短い trace](../change-map.md#コードを読むための短いtrace)、[DB snapshot](../../apps/api/src/prediction/store.ts)、[観測](../../packages/prediction/src/observations.ts)、[予測](../../packages/prediction/src/predict.ts)、[R-11](../../packages/prediction/src/question-prior.ts) |

## 編集と同期

1. diagrams.net の「デバイスから開く」で対象 `.drawio` を開く。各箱・文字・矢印は個別に編集できる。保存する XML は非圧縮で、図は1ページにする。
2. 正式仕様・実装に照合し、README の要約・alt・関連リンクも確認する。ローカル構成の図へ、未配備の Vercel/Neon を接続済みとして追加しない。
3. repository root で PowerShell 7 を使い、同じ XML から SVG を再生成する。追加パッケージや外部通信は不要。

```powershell
pwsh -NoProfile -File scripts/render-readme-diagrams.ps1
pwsh -NoProfile -File scripts/render-readme-diagrams.ps1 -Check
pwsh -NoProfile -File scripts/check-foundation.ps1
git diff --check
```

最初のコマンドは4図の SVG だけを書き換える。`-Check` は XML を読み、文字・座標・矢印から再生成した SVG と既存 SVG の一致を検査して、差があれば失敗する。改行を LF に正規化した元 XML の UTF-8 SHA-256 も SVG に埋め込む。比較も LF にそろえ、Git checkout の OS 別改行で差が出ないようにする。Foundation は本文とローカルリンクを確認する。これらは製品の予測精度や画面の動作確認ではない。

この exporter は今回の図に用いた、直下の plain-text 四角形と明示座標の矢印だけを扱う。HTML文字・グループ・自動接続線などへ変更するときは exporter も対応させるか、diagrams.net から SVG を正式に export し、同期の確認方式も更新する。未対応形式を黙って省略して成功扱いにしない。矢印は独立した座標なので、箱を移動した場合は矢印の端点も編集する。

幅480pxの縦構成で、主要ラベルは20px。日本語フォントは端末の Yu Gothic / Meiryo / Noto Sans JP へフォールバックする。各図の文字列と本文はテキストでも読め、README には内容を説明する alt と編集元リンクを付ける。

## 確認範囲

2026-10-11 に XML/SVG の parse、生成同期、shape のページ境界と縦の文字配置を確認した。別 parser でも4図すべての文字・箱の座標・矢印の一致を検査した。既存 Codex In-app Browser で日本語と矢印を目視し、PC表示（SVG幅480px）と390×844px viewport（余白・scrollbar込みでSVG幅343px）の全図で横方向の文字はみ出し0を確認した。端末フォント・GitHub の表示環境による違いは残る。

GitHub 上の実 README レンダリング、draw.io editor での再保存、実アプリ screenshot は未確認。アプリ・DB・公開環境の試験はこの図の更新では再実行しない。
