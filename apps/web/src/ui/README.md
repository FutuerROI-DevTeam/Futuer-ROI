# 画面の部品とデザイントークン

**Supporting Doc / Not a Source of Truth.** 画面の仕様（表示内容・条件・文言）の正本は[Product Spec](../../../../docs/product-spec.md)、構成は[Architecture](../../../../docs/architecture.md)。ここには、デザインを公開後も調整しやすくするための置き場所と決まりだけを書く。元のデザインはデザインキャンバス「B案：画面と状態」「B案：トークンと部品」（https://claude.ai/artifact/Hxs7396eZNtYn8iLYmyMi8 ）。

画面全体の操作・状態と設計理由は[画面設計](../../../../docs/design.md)、B案との対応・未確認は[アートボード対応表](../../../../docs/ui/artboard-map.md)を参照する。現行の配色・情報階層は[P-21](../../../../docs/product-spec.md#p-21-todayの朝焼け山並み案)の朝焼け・森の実装を含む。

## どこを直せば見た目が変わるか

| 変えたいもの | 直す場所 |
| --- | --- |
| 色・文字の大きさ・余白・角丸・高さ・影（現行はlight-only） | [tokens.css](tokens.css) の `--fr-…` の値。Today専用の上書きは [today-dawn.css](../features/today/today-dawn.css) |
| ボタン・記録の2択・下に固定する帯・データ不足／エラーの枠などの形 | [components/](components/) の各部品と同じ名前の `.css` |
| 入力欄・単位の切り替え・項目ごとのエラー（Goal の作成・編集） | [FormField](components/FormField.tsx) と [FormField.css](components/FormField.css) |
| 削除などの確認ダイアログ | [ConfirmDialog](components/ConfirmDialog.tsx)（ブラウザ標準の `<dialog>`。開くと「キャンセル」にフォーカスし、閉じたら元の場所へ戻す） |
| 画面の外枠（左右の余白の打ち消し） | [page.css](page.css) |
| 記録の2択・やった量の変更・昨日の問いかけ・保存の失敗 | [features/logs/](../features/logs/) の `logs.css`。2択のボタンは [ChoiceButton](components/ChoiceButton.tsx)（保存中の表示を含む） |
| Goal の一覧・作成・編集の並び | [features/goals/](../features/goals/) の `goals.css` |
| Today 画面の並び・図 | [features/today/](../features/today/)。図の座標は [chart-geometry.ts](../features/today/chart-geometry.ts)。図は [useElementWidth](useElementWidth.ts) で測った実際の幅で描く（縮めて表示しないので、文字は狭い幅でも指定の大きさのまま） |
| 画面の文言 | [copy/](../copy/)（仕様の固定文言を変える場合は Product Spec の改訂として記録する） |

## 決まり

- 部品の CSS には色や大きさの値を直接書かず、`var(--fr-…)` だけを使う。値を変えたいときは tokens.css を直す。
- 部品は見た目の種類を props で選ぶ（例：`Button` の `variant`）。画面側で style を上書きしない。
- 部品はデータを取得しない。画面（`features/*/…Page.tsx`）が取得し、部品は渡された値を表示するだけにする。
- クラス名は `fr-` で始める（既存の `styles.css` や PR #120 の `r11-qp` と混ざらないようにするため）。CSS Modules や追加の依存は使っていない。
- 色だけで状態を伝えない（やった＝塗り＋チェック、休んだ＝塗り＋月、データ不足＝破線＋情報アイコン、エラー＝琥珀の面＋切断アイコン）。押せる場所は 44px 以上。現行Todayの一部details summaryには32px/40pxのmin-height指定があり、この規則の充足は実測で確認する。文書だけで基準を緩和しない。

## 設計の理由（要約）

- **なぜトークンと部品に分けたか**：公開後もデザインを調整する予定があるため。1か所の値を変えれば全画面にそろって反映される形にした。
- **なぜ素の CSS か**：Vite の標準機能だけで済み、依存を増やさないため。PR #120 の部品も接頭辞付きの素の CSS で、書き方をそろえた。
- **トレードオフ**：クラス名の衝突は接頭辞で避けているだけで、仕組みで防いではいない。部品が増えて衝突が問題になったら CSS Modules（Vite 標準）への切り替えを検討する。
- **書体**：Zen Maru Gothic（SIL Open Font License）を `@fontsource/zen-maru-gothic` でビルドに含め、同じ origin から配信する（外部へ通信しない、#146）。本文の400・500・700に加え、Todayでは900も使う。文字の範囲ごとに分かれたファイルのうち画面で使う分だけをブラウザが取得する。
- **現行配色と残る確認**：P-21の実装では背景・面・面2を分け、OS暗色指定でもlight-onlyで表示する。Todayには専用overrideがある。旧#121の「すべて白」を現行の事実として扱わず、区切り・コントラスト・本人UX受入は[画面設計の論点](../../../../docs/design.md#論点既知の制約)で追う。明朝数字の固定版資産・同梱理由・更新手順は[資産README](../features/today/assets/README.md)を参照する。
