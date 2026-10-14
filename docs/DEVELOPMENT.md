# 開発の構成

| 場所 | 役割 |
| --- | --- |
| `apps/study` | 学習画面・スタイル・PWA |
| `shared/bootstrap.js` | モードと設定の読み込み・起動 |
| `shared/data-loader.mjs` | デモ項目の生成・教材検証 |
| `shared/demo-runtime.mjs` | 外部接続なしの実行環境 |
| `tools` / `tests` | 開発サーバー・公開範囲と動作の検査 |

検査はGit管理対象を読むため、追加・削除をステージしてから実行します。クラシックスクリプトの構文確認は `vm.Script` を使います。

Connectedの認証・同期サーバーは別途必要です。`courseId` はサーバー側と一致させてください。`speechLanguage` は教材に合った言語を設定します。既存APIとの互換性は個別に検証してください。
