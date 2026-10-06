# Personal Context MCP 利用ガイド

初回のビルドと登録は[README](../README.md)、設定値は[設定ガイド](configuration.md)を参照してください。ここではAIから使う公開ツールと、情報の保存先を説明します。ツール名・引数の正本は、接続先の `system_get_usage_guide` と公開スキーマです。

## 作業開始時に対象タスクを読む

最初に `system_get_usage_guide` を確認し、対象タスクを `task_list_items` で探します。判断や文章作成の前に `system_prepare_work` を呼びます。

```json
{
  "tool": "system_prepare_work",
  "arguments": {
    "task_id": "example-task",
    "scope": "strict",
    "include_context_body": true,
    "query": "対象タスクの前提、決定事項、次の作業"
  }
}
```

`strict` は対象タスクに情報を限定します。Global Memoryの取得は `include_global_memory=true`、Knowledgeの取得は明示的な `knowledge_ids` が必要です。横断的な状況判断では `scope=global` と `include_global_situation=true` を指定してください。

## 作業の事実を記録する

新しいタスクは `task_create_item`、状態の変更は `task_update_item`、背景の更新は `task_update_context` を使います。途中の事実は `activity_append_entry` で記録します。

```json
{
  "tool": "activity_append_entry",
  "arguments": {
    "task_id": "example-task",
    "done": ["公開用の導入手順を確認した"],
    "next": ["設定例を検証する"],
    "idempotency_key": "example-checkpoint-001"
  }
}
```

通常の記録は `date` を省略します。作業日にはタイムゾーンと日付境界を適用します。過去の記録を取り込む場合は、日付と `backfill=true` を指定します。Activityは原本であり、公開APIで置換・削除・圧縮しません。

## セッション終了時に1回だけ確定する

1つの作業セッションの終了時に `session_finish_task` を呼びます。同じ `task_id` と `session_id` の再送は冪等です。

```json
{
  "tool": "session_finish_task",
  "arguments": {
    "task_id": "example-task",
    "session_id": "example-session-001",
    "source": "ai-client",
    "summary": "設定例の検証を完了した",
    "done": ["設定例と実装の対応を確認した"],
    "next": ["公開前チェックを行う"],
    "processing_policy": "deferred",
    "memory_policy": "skip",
    "apply_task_state": false
  }
}
```

通常の進捗ではActivityを記録し、レポート生成を後回しにします。終了状態への遷移、`processing_policy=immediate`、`memory_policy=force`、出力形式の指定などはLLM処理を伴う場合があります。途中のチェックごとにセッションを終了しないでください。

まとまった作業を委任する場合は[小チケットの手順](tickets.md)に従います。依頼元が未着手で作成し、受け手が実際の着手時に開始します。

## 必要なときにレポートを生成する

`report_generate_output` は未反映のActivityがあるタスクを要約し、レポート全体を出力します。LLMを使う操作では、利用するProviderへのデータ共有を明示的に承認してください。

```json
{
  "tool": "report_generate_output",
  "arguments": {
    "format": "text"
  }
}
```

`format` は `text`、`markdown`、`html` です。返却された `web_url` からWebを開けます。既存データの表示だけを更新する場合は `report_render_output`、生成済みの内容を読む場合は `report_get_output` を使います。

| 調整したい内容             | 操作                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| その日の表示文             | `report_update_entry` の replace / append / delete / clear_override |
| タスクのレポート対象・除外 | `report_set_task_visibility`                                        |
| 重複・不要なタスク         | `task_delete_item` で論理削除、`task_restore_item` で復元           |
| 日付ごとのレポート         | `report_get_daily`                                                  |
| 生成済み出力の一覧         | `report_list_outputs`                                               |

`blocked` と論理削除・レポート除外のタスクはレポート対象から外れます。`waiting` は外部応答などを待つ状態です。Tier一覧と日次差分は、プロジェクトごとにまとめて一定の順序で表示します。

## 記憶の種類を使い分ける

| 内容                               | 保存先と操作                                 |
| ---------------------------------- | -------------------------------------------- |
| 日付に紐づく事実・進捗             | Activity / `activity_append_entry`           |
| タスクの目的・背景・参照情報       | Context / `task_update_context`              |
| タスクで継続利用する決定・リスク   | Task Memory / `task_memory_update_state`     |
| ユーザー全体のルール・好み         | Global Memory / `global_memory_update_state` |
| 他のタスクにも使える一般化した知識 | Knowledge / `knowledge_upsert_note`          |
| 人物のプロフィール・関係・交流     | People / `people_capture_update`             |

`task_memory_promote_activity` は作業記録から長期的に必要な情報を選びます。日次の件数や作業ログをそのまま長期記憶へ写さないでください。マインドマップだけの再生成には `task_memory_generate_mindmap` を使います。

Knowledgeには主張、根拠、適用条件、限界を含めます。元タスクの名前や日付を除いても意味が通る内容が対象です。ローカルパスやURLだけを根拠の代わりに登録しないでください。`knowledge_search_graph` と `knowledge_get_note` で取得し、`knowledge_get_usage` でAIへの提供・LLM入力への注入実績を確認できます。注入実績は、生成結果がその知識に従ったことまで証明しません。

人物の新規登録前は `people_find_duplicates` で確認し、確定情報・観測・推測を区別します。内部生成へPeopleを自動投入しません。

## ブリーフィングを生成する

`briefing_generate_daily` が外部取得・入力検証・要約・保存・Web URL返却をまとめて行います。外部取得は利用者が設定したコマンドを使います。詳細は[設定ガイド](configuration.md)を参照してください。

Calendar・Mail・GitHubの取得結果とセクション1〜3はローカルで扱い、内部LLMにはセクション4〜6に必要な整理済みタスク情報、Global Memory、関連Knowledgeを渡します。設定済みスクリプトの直接実行や収集用環境変数の手動設定は不要です。

失敗時は返却されたエラーと段階を確認してください。Providerは失敗後に自動で切り替わりません。

## 保管と復元を確認する

`cleanup_archive_candidates` で候補をアーカイブし、`cleanup_restore_archive` で元へ戻せます。`cleanup_delete_archive` はアーカイブ済みのデータを永久削除します。

バックアップの自動保管は `cleanup_run_retention` とWeb設定で管理します。既定では余分な世代をアーカイブし、猶予期間を過ぎたバックアップのアーカイブを削除します。まず `dry_run=true` で確認してください。

## 用語

- Activity: 日付ごとの原本ジャーナル。
- Context: タスクの概要と前提。
- Memory: 継続利用する記憶。タスク単位とユーザー全体で分離。
- Knowledge: タスクを越えて再利用する、根拠付きの知識。
- Report: Activityと継続情報から作る日付ごとの表示データ。
- Output: ReportなどをText・Markdown・HTMLへ出力したもの。

不明な操作は `system_get_usage_guide` と公開スキーマを確認してください。公開前の確認事項は[公開前チェック](publishing.md)にまとめています。
