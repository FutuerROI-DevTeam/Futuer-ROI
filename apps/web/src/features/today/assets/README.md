# 朝焼け・山並み資産

`dawn-landscape.webp` は承認済みデザイン「かけ合わせ3：朝焼けの山並み（青空×森）」の提供 HTML (`future-roi-dawn-reference.html`) に含まれる背景を再利用したものです。

- 参照: https://claude.ai/artifact/KQDeWMput5bt77NEj4J4Kb#artboard-eb122470b18c
- 原画 HTML SHA-256: `ba78313e9f198acc1acf9bd7a5e71901a0b654a9953229d476909f3c5bc5cf4c`
- 390 px 幅で元の `.sky` 全体を描画し、`.bar` と `.hero` の編集可能な UI 文字を `visibility: hidden` にした。原画の空と3層の山を保持し、新しい CSS / SVG の描画は実装へ持ち込んでいない。
- 3倍の描画解像度: 1170 × 990 px。原画の `.sky` 実測高さは 329.4375 CSS px。
- WebP は lossless。元の PNG とデコード後の RGB 全画素が一致することを確認済み。

2026-10-10の本人追加指示により、同じ背景を公開トップの装飾にも利用する。新しい外部画像・サンプル予測を追加せず、文字は既存の実UIで描く。

### dawn-ridge.png（2026-10-11、#221）

空を青空（`#C4E4F6`→`#EEF8FB` のCSSグラデーション）に変えるため、`dawn-landscape.webp` から山並みだけを取り出した派生画像。画面では空をCSSで描き、この画像を下に重ねる。`dawn-landscape.webp` は派生元として残す（画面からは参照しない）。

- 作り方：原画の各画素を、空（R−G ≥ −10：桃〜灰）は透明、山（R−G ≤ −18：緑）は不透明に分け、その間の縁は「同じ行の空の色」と「真下の山の色」の混ざり具合から不透明度を戻した。山の色・形は原画の画素のまま。最も高い山の行（767行目）から下だけを切り出した。
- 大きさ：1170 × 223 px、PNG（透過）。
- 新しい描画（CSS / SVG の山）や外部画像は追加していない。

## Zen Old Mincho

`zen-old-mincho.css` を利用する Today・公開トップのスタイルから import し、`font-family: 'Zen Old Mincho', serif` と `font-weight: 900` を指定します。フォントは同一オリジンから配信でき、外部 CDN 接続を必要としません。

- 出典: https://fontsource.org/fonts/zen-old-mincho
- 取得元: `@fontsource/zen-old-mincho` 5.3.0 の公式 npm tarball
- https://registry.npmjs.org/@fontsource/zen-old-mincho/-/zen-old-mincho-5.3.0.tgz
- npm の SHA-512 integrity を照合済み。
- 900 の Unicode-range 分割 WOFF2 のみをそのまま収録。CSS では相対パスを `./fonts/` へ変更し、重複する WOFF fallback を省略している。
- 122 ファイル、2,705,020 bytes。ブラウザは使用する文字を含む Unicode-range のファイルを取得する。
- SIL Open Font License 1.1。全文は `zen-old-mincho-LICENSE.txt`。字体・フォントファイル内容は変更していない。


### 同梱を選んだ理由と制約

参照の明朝数字を再現し、P-17と同じく外部CDNへ通信せず同一originから配信するため、公式パッケージの固定版から900のWOFF2だけを静的資産として同梱した。既存Zen Maru Gothicは本文・UIの丸ゴシックであり、この明朝数字の代替にはならない。npm依存へ追加する案はlockによる管理が簡単だが、今回は既存取得物とライセンスを保持し、依存グラフを変えない。これは第三者フォント資産の追加であり「新しい依存が一切ない」という意味ではない。122ファイル約2.7MBの保守・差分管理コストを負う。上流はFontsource公式の固定版で追跡し、更新は上記の別Issue・照合・レビューで行い、自動更新しない。標準の@font-faceなので新しいruntime APIの学習は不要だが、Unicode-range・Networkの取得確認と原本hash照合のDebug/保守コストがある。安全性や実端末での読取効果を保証した意味ではない。

Viteの既定4KiB以下埋込みでは、未使用のUnicode-range subsetもCSSに入り、必要な文字だけ取得する利点が失われるため、[Vite設定](../../../../vite.config.ts)のassetsInlineLimitでWOFF/WOFF2だけを別ファイルにする。他の資産は既定動作を保持する（[公式仕様](https://vite.dev/config/build-options.html#build-assetsinlinelimit)）。見た目・字体・unicode-rangeは変更しない。ネットワーク取得は使用文字とcache状態に依存し、全122ファイルの一括取得を前提にしない。

### 更新手順

1. 別Issueで更新の必要性・版・配布元・ライセンス差・サイズと代替案を確認する。通常のUI修正で自動的に最新版へ変えない。
2. 公式npm metadataの対象版のdist.tarballとdist.integrityを記録し、一時ディレクトリへ取得する。現在の5.3.0は `sha512-pNvegTkx6rOQRaBMcUoxxeNoIRJajdY0TeX4ngf/26KrtsVoqY11ho6WlwPWDYHi7PY65vf88TV2xjIO+YxQ8Q==`。tarball全体のSHA-512をbase64にして一致を照合し、違えば使用しない。
3. 展開した900.cssが参照する900-normalのWOFF2だけをfontsへコピーする。CSSの相対パスを `./fonts/` に変え、WOFF fallbackだけを省く。unicode-rangeと字体ファイルは加工しない。不要になった旧subsetは対象一覧を照合して削除し、license全文とこの版・integrity・件数／合計bytesを同じcommitで更新する。
4. 各同梱ファイルをtarballの原本とhash照合し、CSS参照ファイルの欠落・余分・rangeの変更を確認する。rootのtypecheck／test、Web build、Foundationを実行し、dist CSSにfont data URIがなく、参照するfont URLが全て存在することを確認する。
5. 実Chromeで日本語・数字の表示、font loading、320/390/1440と文字拡大時の折返し・focusを確認する。実施範囲と未実施のiOS／Safari等をPRへ記録し、人のレビューを受ける。
