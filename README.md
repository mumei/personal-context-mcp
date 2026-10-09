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

### 最新ソースへ更新する

クローンしたリポジトリのルートで、作業中の変更と現在のブランチを確認します。

```bash
git status --short
git branch --show-current
```

変更がなく、ブランチが`main`である場合だけ、次へ進んでください。変更がある場合や別のブランチにいる場合は、先に内容を確認し、上書きや破棄をしないでください。

```bash
git pull --ff-only origin main
```

履歴が分岐していると、このコマンドは停止します。強制更新せず、分岐の理由を確認してください。取得後は、接続中のMCPをクライアント側で停止してから再ビルドします。

```bash
npm ci
npm run build
```

ビルド後にクライアント側でMCPを再起動し、利用ガイド取得やWeb表示を確認してください。ビルドは`dist`を作り直すため、起動したまま実行しないでください。

## MCPクライアントに登録する

### Codexにはコマンドで登録する

ビルド済みリポジトリのルートで、同名の登録がないか確認します。

```bash
codex mcp get personal-context-mcp
```

登録済みなら起動コマンドと保存先を確認し、追加や削除はしないでください。未登録の場合だけ、ビルド済みサーバーを登録します。

```bash
codex mcp add personal-context-mcp \
  --env TASK_MCP_DATA_ROOT="$HOME/.tasks" \
  -- node "$(pwd)/dist/server.js"
```

`$(pwd)`はリポジトリの絶対パスに展開されます。別の場所から実行する場合は、ビルド済みサーバーの絶対パスへ置き換えてください。保存先は`TASK_MCP_DATA_ROOT`で変更できます。通常の保存先は`~/.tasks`です。

登録を確認します。

```bash
codex mcp get personal-context-mcp
codex mcp list
```

これらは登録内容の確認で、接続成功を保証するものではありません。Codexを再起動したあと、AIに`system_get_usage_guide`を呼ばせて接続を確認してください。Codex CLIの会話画面では`/mcp`も使えます。通常の設定ファイルは`~/.codex/config.toml`です。詳しくは[OpenAI公式MCPガイド](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)を参照してください。MCPはCodex側が起動するため、別途サーバーを手動起動する必要はありません。

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

## 週次・週途中レポート

日次レポートは従来どおり利用できます。Webの「週次レポート」で開始日〜終了日から対象週を選択し、保存済みの内容を閲覧します。未生成の期間は「未生成」と表示され、生成ボタンで過去の活動から手動生成できます。ページ表示や週の切り替えで自動生成は行いません。設定画面では週の締め曜日を選択します（未設定時は日曜締めの月曜〜日曜）。既存の `config/report.yaml` の `week_start_day` は締め曜日の翌曜日として保存するため、従来設定を変更せず利用できます。日付境界の設定とは独立しています。

MCPでは `report_generate_weekly` がTextとMarkdownをまとめて生成し、`report_get_weekly` が既存の成果物を読み込みます。`week` は対象週に含まれる日付、`through` は集計に含める最終日です。例えば `week=2026-10-05, through=2026-10-07` は、月曜開始なら月曜〜水曜の途中版になります。省略時は現在の週を、当日または週末まで集計します。未来の作業日は指定できません。

週次は設定タイムゾーンと既存の作業日切替時刻を使います。カレンダー表示の暦日とは異なり、例えば切替が4時なら午前3時の作業は前日の作業日に属します。当日を含む版と途中版には暫定状態を表示し、対象週、集計範囲、生成時点、未記録日を明示します。未記録日は「作業なし」とは扱いません。

要約は対象期間のActivityを優先し、Activityがないタスク・日には日付付きレポートを使用します。現在のタスク状態を過去の実績として扱わず、重複した監視記録や累積値を加算しません。通常の除外設定、URL、ユーザー共通のレポートルールを引き継ぎます。通常のProviderを利用し、LLM失敗時の代替生成は行いません。

成果物は `outputs/weekly/<週開始日>_<集計終了日>/report.json`、`report.txt`、`report.md` に保存します。異なる集計終了日の版は共存し、同じ範囲の再生成だけが上書き対象になります。生成はActivity・日次レポート・タスク・長期記憶を変更しません。MCPの結果には範囲を指定したWeb URLを含みます。

通常の生成は過去週なら締め日まで、現在週なら現在の作業日までを対象とします。「途中版を生成」から任意の集計終了日を指定できます。保存済みの途中版は版の選択欄から閲覧できます。締め曜日を変更しても旧期間の成果物は元の日付範囲で読み込み、現在の曜日設定で再解釈しません。旧曜日の期間は閲覧専用です。

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
