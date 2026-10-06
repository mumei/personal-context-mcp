# Personal Context MCP 設定ガイド

[README](../README.md)の登録例にある `env` へ、必要な設定を追加してください。環境変数はサーバー起動時に読み込むため、変更後はMCPの再起動が必要です。

## 保存先と日付

| 設定                                   | 既定値                                            | 用途                               |
| -------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| `TASK_MCP_DATA_ROOT`                   | `~/.tasks`                                        | 保存先。CLIの `--data-root` を優先 |
| `TASK_MCP_TIMEZONE`                    | 保存済み設定、OSのタイムゾーン、UTCの順           | 作業日の判定                       |
| `TASK_MCP_ACTIVITY_ROLLOVER_HOUR`      | `0`                                               | 日付の境界。0〜23時                |
| `TASK_MCP_LOOKBACK_DAYS`               | `7`                                               | 過去データの参照日数               |
| `TASK_MCP_DEFAULT_RENDERER`            | `markdown`                                        | 既定の出力形式                     |
| `TASK_MCP_DAILY_TASK_CONFIG_PATH`      | `<data-root>/config/daily_task.yaml`              | クライアント共通の日次実行設定     |
| `TASK_MCP_CODEX_DAILY_AUTOMATION_PATH` | `~/.codex/automations/automation/automation.toml` | Codex Automationとの同期先         |

タイムゾーン・日付境界はWeb設定でも変更できます。環境変数が設定されている場合は、その値を優先します。例えば `Asia/Tokyo` と境界 `4` では、午前4時より前のActivityを前日の作業日として扱います。

保存先の各配置は `TASK_MCP_LAYOUT_*` でも変更できます。正確な設定名は `src/infrastructure/config/config.ts`、各ディレクトリの用途は保存先に生成されるREADMEを参照してください。

## Web

| 設定                        | 既定値             | 用途                             |
| --------------------------- | ------------------ | -------------------------------- |
| `TASK_MCP_WEB_ENABLED`      | `true`             | MCPと同時にWebを起動             |
| `TASK_MCP_WEB_HOST`         | `127.0.0.1`        | 待ち受け先                       |
| `TASK_MCP_WEB_PORT`         | `8787`             | ポート                           |
| `TASK_MCP_WEB_BASE_URL`     | hostとportから生成 | MCPが返す閲覧URLの基点           |
| `TASK_MCP_WEB_ALLOW_REMOTE` | `false`            | ループバック以外の待ち受けを許可 |
| `TASK_MCP_WEB_TOKEN`        | 未設定             | Bearer認証。リモート公開時は必須 |

Webにはデータを更新するAPIがあります。既定のローカル待ち受けを基本とし、リモート利用では認証に加えてTLSとアクセス制御を利用環境側で用意してください。トークンは16〜512文字のBearer互換文字列として検証されます。

## LLM Provider

`TASK_MCP_LLM_PROVIDER=auto` はMCPクライアント名からProviderを選びます。Claude・Copilot・Cursor・Geminiには対応CLI、LM StudioにはAPI、Codex系と不明なクライアントにはCodex App Serverを選びます。Webも選択済みProviderを使います。

| Provider           | 既定モデル           | モデルの上書き                    |
| ------------------ | -------------------- | --------------------------------- |
| `codex_app_server` | `gpt-6.1-sol`        | `TASK_MCP_CODEX_APP_SERVER_MODEL` |
| `claude_cli`       | `claude-sonnet-4-6`  | `TASK_MCP_CLAUDE_MODEL`           |
| `copilot_cli`      | `gpt-5.3-codex`      | `TASK_MCP_COPILOT_MODEL`          |
| `cursor_cli`       | `gpt-5`              | `TASK_MCP_CURSOR_MODEL`           |
| `gemini_cli`       | `gemini-2.5-pro`     | `TASK_MCP_GEMINI_MODEL`           |
| `lm_studio`        | `openai/gpt-oss-20b` | `TASK_MCP_LM_STUDIO_MODEL`        |

モデル名は実装の既定値です。利用できるモデルは各Providerの版・認証・契約によります。利用環境でモデルを確認し、必要なら上書きしてください。

Codex App Serverの実行ファイルは `TASK_MCP_CODEX_APP_SERVER_COMMAND`、`CODEX_CLI_PATH`、ChatGPT App同梱CLI、PATHの `codex` の順に選びます。各CLIのコマンドは `TASK_MCP_CLAUDE_COMMAND`、`TASK_MCP_COPILOT_COMMAND`、`TASK_MCP_CURSOR_COMMAND`、`TASK_MCP_GEMINI_COMMAND` で変更できます。

LM StudioではAPIサーバーを起動し、モデルを読み込んでください。

```json
{
  "TASK_MCP_LLM_PROVIDER": "lm_studio",
  "TASK_MCP_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/v1",
  "TASK_MCP_LM_STUDIO_MODEL": "your-loaded-model"
}
```

必要なら `TASK_MCP_LM_STUDIO_API_TOKEN` を設定します。失敗後のProvider自動切り替えはありません。選択結果はWeb設定で確認できます。

## 外部取得と日次実行

`config/external_input.yaml` に収集コマンドを設定します。コマンドはshellを介さず実行され、`args` の `{date}`・`{data_root}` が展開されます。子プロセスには `TASK_MCP_COLLECTOR_STAGE_ROOT` が渡されます。

収集コマンドは、このステージング領域へ日付名のYAML入力とMarkdownのセクション1〜3を保存する必要があります。MCPが検証し、保存先へまとめて反映します。失敗時は正本を更新しません。localeの既定値は `en_US.UTF-8` です。

収集コマンドは同梱されていません。自分のCalendar・Mail・GitHubなどに対応する実装を用意してください。設定スキーマと出力検証は `src/domains/inputs/externalCollector.ts` を参照してください。

Webの日次実行設定では実行クライアントを1つ選びます。CodexはローカルAutomationへ同期します。その他のクライアントは設定手順やコマンドを表示する支援方式で、設定完了の確認が必要です。Copilot・GeminiのCLIコマンドを定期実行するには、別途スケジューラーが必要です。

日次実行を担当するクライアントのモデルと、MCP内部で要約するProviderのモデルは別の設定です。

## バックアップの保管

Web設定または `TASK_MCP_BACKUP_*` で保管期間を指定します。既定では毎日03:00に、7日間の全世代、30日までの日次、180日までの週次、365日までの月次世代を残します。アーカイブの猶予は30日です。

実行されるのはMCPまたはWebサーバーが動いている間です。停止中も実行されるOS常駐ジョブは自動作成しません。期間外のバックアップはまずアーカイブし、猶予後に削除します。操作と復元は[利用ガイド](usage.md)を参照してください。
