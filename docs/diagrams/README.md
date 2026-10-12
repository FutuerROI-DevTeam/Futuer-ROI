# 文書の説明図

Supporting Artifact / Not a Source of Truth。2026-10-12 に承認された構成図・利用フローの2図を使用する。構成と採択判断の正本は [Architecture](../architecture.md)、質問・保存の規則は [Product Spec](../product-spec.md)。図は新しい仕様や技術採択を定めない。

対象は [Issue #266](https://github.com/FutureROI-DevTeam/Future-ROI/issues/266)。旧版は [Issue #245](https://github.com/FutureROI-DevTeam/Future-ROI/issues/245) の記録として保持する。

## 図と確認元

| 図 | 掲載先・原本 | 確認元 |
| --- | --- | --- |
| ローカル構成 | [Architecture](../architecture.md#system構成) / [SVG](system-architecture.svg) / [draw.io](system-architecture.drawio) | [Compose](../../compose.yaml)、[Dockerfile](../../Dockerfile)、[API app](../../apps/api/src/app.ts)、[Engine adapter](../../apps/api/src/prediction/engine.ts) |
| 利用フロー | [README](../../README.md#利用の流れ) / [SVG](user-flow.svg) / [draw.io](user-flow.drawio) | [Core User Flow](../product-spec.md#core-user-flow)、[P-24](../product-spec.md#p-24-初期質問の必須化とtodayの編集入口259)、[画面設計](../design.md)、[質問UI](../../apps/web/src/features/prior/QuestionPriorFields.tsx) |

同じ構成図を別のファイルへコピーしない。README は短い概要と Architecture へのリンク、Architecture は図と責務・採択理由を持つ。予測モデルや研究の説明は [Engine README](../../packages/prediction/README.md) と [実験索引](../prediction/experiment-history.md) を参照する。

## 編集と同期

1. 対象 `.drawio` を diagrams.net で開き、ノード・矢印・境界を編集する。XML は非圧縮1ページのまま保存する。
2. 編集元と同時に表示用 SVG を出力し、文字・位置・矢印・ページ寸法を照合する。PNG は見切れや文字を確認するためのプレビューで、文書が参照する表示原本は SVG。
3. README / Architecture の説明・alt・原寸リンク・編集元リンクを確認し、repository root から次を実行する。

```powershell
pwsh -NoProfile -File scripts/check-document-diagrams.ps1
pwsh -NoProfile -File scripts/render-readme-diagrams.ps1 -Check
pwsh -NoProfile -File scripts/check-foundation.ps1
git diff --check
```

前2コマンドは同じ承認2図の**読み取り検査**。文字の論理行・font-size・中心位置・source box内のbaseline、親グループを解決した図形座標、接続端点と折れ点、矢印の方向、ページ寸法を照合し、不一致は失敗する。HTML・外部画像・script等は受け付けない。draw.io editor の実行、フォントの描画、PNGとの画素一致、製品の動作・予測精度を検査するものではない。検査対象は今回の矩形・菱形・cylinder3・明示接続の形式で、別の図形や export 形式に変える場合は検査方法も更新する。

`render-readme-diagrams.ps1` は現在の2図を自動生成しない。`-Check` で上の検査へ進み、引数なしでは書き換え前に止まる。過去形式の生成処理は `-Archived` で隔離して保持し、承認原本を上書きしない。

## 確認範囲

2026-10-12、承認された ZIP から SVG / draw.io / PNG を取り出して可読性・PNG実画像・ラベルと境界を確認した。repository の SVG / draw.io は承認原本と byte exact。構成図は1000×480、利用フローは1000×520。1000px原寸でのPNGの文字・矢印と、キャンバス端の見切れを確認した。幅の狭い画面では図が縮むため、本文の手順・altと原寸リンクも用意している。

図の「Goal を作成」は作成フォームの操作。保存前の2問選択が必須で、「回答しない」はnull、「経験がない・思い出せない」はUNKNOWNとして区別する。単位・1回の量変更に伴う撤回条件はP-24/P-13を維持する。構成図の volume はDBの保存領域で、公開候補の稼働を示すものではない。

2026-10-12、commit `bed0f63628722bd2c9840bf01602ddbf3f778b27` のREADME / Architectureを、既存のGoogle Chrome 154.0.8037.98で実表示した。専用headlessプロファイルを使い、ユーザーの既存タブ・Cookie・ログイン状態には接続していない。GitHubの1440×1000と390×844 viewportで両図の表示と横はみ出しなしを確認し、配信SVGと原本のSHA-256一致も確認した。原寸SVGでは各22個の文字の実描画境界が元の箱・キャンバス内に収まり、構成図5本・利用フロー12本の接続は原本との構造検査でも一致した。狭幅では文字が小さくなるため、本文と原寸リンクを併用する。

draw.io editorのimport/re-saveは未実施。通常インストール先・アプリ登録・VS Code拡張に安全に使えるローカルeditorが見つからず、新規インストールは行っていない。ブラウザでの表示確認をeditorでの再保存確認とは扱わない。ローカルの実アプリ・DB・Docker・公開環境の試験と、他ブラウザ・他端末フォントでの描画差は今回の対象外。

### 旧版4図の検証記録

以下は基準commit `af9836829fe911599cdc8ecb27b231836cb3806c` にある旧版4図の記録。2026-10-12の承認2図を同じブラウザ・editorで確認した記録ではない。

<details>
<summary>2026-10-11の検証記録</summary>

<!-- diagram-verification-history:start -->
## 確認範囲

2026-10-11 に XML/SVG の parse、生成同期、shape のページ境界と縦の文字配置を確認した。別 parser でも4図すべての文字・箱の座標・矢印の一致を検査した。既存 Codex In-app Browser で日本語と矢印を目視し、PC表示（SVG幅480px）と390×844px viewport（余白・scrollbar込みでSVG幅343px）の全図で横方向の文字はみ出し0を確認した。端末フォント・GitHub の表示環境による違いは残る。

再レビューでは、完了予測の説明を実装の `TODAY_DONE` / `CURRENT_STATE` 分岐へ修正した。別の一時コピーで XML serializer の読込・再保存と SVG 再生成後の文字・座標・矢印の意味的一致も確認した。これは editor での再保存確認ではない。

GitHub 上の実 README レンダリング、draw.io editor での再保存、実アプリ screenshot は未確認。ローカル editor が見つからず、外部サービスへのアップロードは行っていない。アプリ・DB・公開環境の試験はこの図の更新では再実行しない。
<!-- diagram-verification-history:end -->
</details>
