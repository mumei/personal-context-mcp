# Personal Context MCP

AIクライアントが、タスク・作業記録・長期記憶・ナレッジ・人物情報を共有するためのローカルMCPサーバーです。Web画面で保存内容を確認し、ブリーフィングやレポートを生成できます。

初めて使う場合は「必要環境」から「AIに使い方を伝える」まで進めてください。日常の操作は[利用ガイド](docs/usage.md)、設定値は[設定ガイド](docs/configuration.md)にまとめています。

## 必要環境

| 用途                | 必要なもの                                                       |
| ------------------- | ---------------------------------------------------------------- |
| サーバーとWeb       | Node.js 22以上、npm                                              |
| MCP接続             | stdio方式のMCPサーバーを登録できるクライアント                   |
| LLMによる生成・整理 | 利用するProviderのCLIまたはLM Studio API、対応モデルへのアクセス |
| 外部情報の取得      | 利用者が用意した収集コマンドと、そのサービスへのアクセス権       |

保存・検索などの操作はLLMを呼びません。レポートの要約や記憶の整理にはProviderが必要です。RubyやmacOSのアプリはMCP本体の必須条件ではありません。外部取得コマンドを利用する場合だけ、そのコマンドの実行環境を用意してください。

## ソースからビルドする

リポジトリを取得し、ルートディレクトリで実行します。現在の導入手順はソースからのビルドを前提としています。

```bash
git clone https://github.com/mumei/personal-context-mcp.git
cd personal-context-mcp
npm ci
npm run build
```

サーバーとVueのWeb UIが `dist/` に生成されます。ソースを更新した場合も同じビルドを実行し、接続中のMCPを再起動してください。

## MCPクライアントに登録する

### Claude Codeにはコマンドで登録する

先にソースからビルドし、クローンした`personal-context-mcp`のルートディレクトリで実行してください。npmパッケージは未公開のため、`npx personal-context-mcp`ではなく、ビルド済みの`dist/server.js`を登録します。

同名の登録がないか、まず確認します。

```bash
claude mcp get personal-context-mcp
```

登録済みなら表示されたコマンド・保存先・scopeを確認し、次の追加コマンドは実行しないでください。同名設定を勝手に上書き・削除する手順ではありません。未登録の場合だけ追加します。

```bash
claude mcp add --scope user \
  --env TASK_MCP_DATA_ROOT="$HOME/.tasks" \
  --transport stdio personal-context-mcp \
  -- node "$(pwd)/dist/server.js"
```

`$(pwd)`は現在のディレクトリの絶対パスに展開されます。別の場所から登録する場合は、自分の環境の`/absolute/path/personal-context-mcp/dist/server.js`へ置き換えてください。保存先は`TASK_MCP_DATA_ROOT`で指定します。既存の保存先を使う場合はその絶対パスへ変更してください。

`--scope user`は自分の全プロジェクトで使う設定です。`--transport stdio`はClaude Codeがローカルプロセスを起動して接続する方式で、`--`以降がサーバーの起動コマンドです。通常はClaude CodeがMCPを起動するため、別途`npm start`などでサーバーを起動する必要はありません。

登録内容と接続を確認します。

```bash
claude mcp get personal-context-mcp
claude mcp list
```

Claude Codeの会話画面でも`/mcp`で状態を確認できます。接続後はAIに`system_get_usage_guide`を呼ばせてください。stdioとscopeの仕様は[Claude Code公式ガイド](https://code.claude.com/docs/en/mcp)を参照してください。このコマンドはClaude Code向けで、Claude Desktopの設定とは別です。

### 設定ファイルで登録する

クライアントのMCP設定に、Node.jsとビルド済みのサーバーを登録します。次のパスは、自分の環境の絶対パスへ置き換えてください。JSON中の `~` はクライアントが展開しない場合があります。

```json
{
  "mcpServers": {
    "personal-context-mcp": {
      "command": "node",
      "args": ["/absolute/path/personal-context-mcp/dist/server.js"],
      "env": {
        "TASK_MCP_DATA_ROOT": "/absolute/path/personal-context-data"
      }
    }
  }
}
```

TOML形式のクライアントでは、同じ内容を次のように指定します。

```toml
[mcp_servers.personal-context-mcp]
command = "node"
args = ["/absolute/path/personal-context-mcp/dist/server.js"]

[mcp_servers.personal-context-mcp.env]
TASK_MCP_DATA_ROOT = "/absolute/path/personal-context-data"
```

保存先を省略すると `~/.tasks` を使用します。CLIでは `--data-root` でも指定できます。製品名変更後も、この保存先と `TASK_MCP_*` の設定名を維持しています。

接続後、AIから `system_get_usage_guide` を呼び、ツールが利用できることを確認してください。登録名によってクライアント側のツール接頭辞が変わるため、ガイドではMCPが公開するツール名を使います。

## Webで保存内容を確認する

MCP起動時にWebサーバーも起動します。既定URLは [http://127.0.0.1:8787](http://127.0.0.1:8787) です。

| 画面           | 確認できる内容                         |
| -------------- | -------------------------------------- |
| 概要           | 当日のブリーフィング、タスク表、進捗   |
| レポート       | Text・Markdownの表示、生成、コピー     |
| タスク詳細     | 現在の状況、Context、長期記憶          |
| アクティビティ | 作業記録のカレンダー                   |
| ナレッジ       | 再利用できる知識と関係グラフ           |
| 人物           | プロフィール、関係、交流履歴           |
| 作業ボード     | 親タスクに紐づく小チケット             |
| 設定・ヘルプ   | Provider、日付境界、日次実行、利用方法 |

Webでは閲覧に加えて、生成・整理・設定変更などの操作もできます。LLMへ送信する操作はデータ共有の承認を伴います。画面の表示言語は日本語・英語に対応し、保存本文は自動翻訳しません。

Webだけを起動する場合は、次のコマンドを使います。

```bash
node dist/webServer.js --data-root ~/.tasks
```

同じポートを別プロセスが使用している場合、新しく起動したMCPはWeb起動の競合をログに残して継続します。既存のWebが同じ保存先を参照しているとは限らないため、接続先と保存先を確認してください。

## AIに使い方を伝える

クライアントの共通指示に、次の内容を登録してください。

```text
Personal Context MCPを記憶と作業記録の保存先として使ってください。
最初にsystem_get_usage_guideを確認してください。
作業開始前はsystem_prepare_workで対象タスクの情報を取得してください。
途中の記録はactivity_append_entry、作業セッション終了時は
session_finish_taskを1回だけ使ってください。
レポートが必要なときはreport_generate_outputを使ってください。
日次の事実はActivity、タスクの継続情報はTask Memory、
ユーザー全体のルールはGlobal Memory、一般化した知識はKnowledge、
人物のプロフィールや関係はPeopleに保存してください。
```

AIがすべての会話で自動保存する保証はありません。ツール呼び出しと保存内容はWebや監査ログで確認してください。[利用ガイド](docs/usage.md)に操作例、[小チケット](docs/tickets.md)に委任時の手順があります。

## 保存先とデータの役割

| 保存先                          | 役割                                       |
| ------------------------------- | ------------------------------------------ |
| `tasks.yaml`、`contexts/`       | タスクの現在状態と背景                     |
| `activities/`                   | 追記型の原本となる作業記録                 |
| `task_memory/`                  | タスクに紐づく長期記憶                     |
| `global_memory.yaml`            | 全タスクに共通するルール・好み             |
| `knowledge/`                    | 根拠・適用条件を含む独立した知識           |
| `people/`                       | 人物、関係、交流履歴                       |
| `tickets.yaml`                  | 親タスクの小チケット                       |
| `inputs/`                       | 日付ごとの外部入力                         |
| `reports/`、`report_summaries/` | 日付ごとのレポートデータ                   |
| `outputs/`                      | Text・Markdown・HTMLとブリーフィングの出力 |
| `config/`                       | 日付境界、日次実行、外部取得、保管設定     |
| `request_logs/`、`backups/`     | 監査ログと変更前のバックアップ             |

起動時に保存先の `README.md` も同期されます。詳細な配置と保管処理は、この生成READMEと[設定ガイド](docs/configuration.md)を参照してください。

Peopleは内部のLLM生成へ自動投入されません。ただし人物情報をMCPで取得したクライアントはその内容を受け取るため、クライアント側のデータ取り扱いも確認してください。

## 開発と検証

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
```

`npm run format` はプロジェクト全体を整形します。TypeScriptとVueはLint対象です。開発時のMCPは `npm run dev`、Web単独は `npm run web` で起動できます。

ソースは責務ごとに分かれています。[ソース構成](src/README.md)に配置と依存関係の方針、[Contextの分離](docs/context-isolation.md)に検索範囲の説明があります。

## 公開前に確認する

本プロジェクトは[MITライセンス](LICENSE)を採用しています。著作権表記は`Copyright (c) 2026 mumei`です。依存ライブラリには、それぞれのライセンスが適用されます。

ソースの配布先は[GitHub](https://github.com/mumei/personal-context-mcp)です。npmレジストリへの公開はまだ行っていません。公開ソースの取り出し方とnpm梱包の検証結果は[公開前チェック](docs/publishing.md)にまとめています。既存の作業ディレクトリには過去の設計・検証記録が残るため、そのまま公開せず許可したファイルだけを取り出してください。

不具合は[GitHub Issues](https://github.com/mumei/personal-context-mcp/issues)へ報告してください。バージョン、OS、起動方法、Provider、秘密情報を除いたエラーを添えてください。
