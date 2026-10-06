# Small Work Tickets

## Scope

Tickets represent independently completable, substantial, delegated or blocked work under an existing Task. Short checks, commands and casual conversation are not automatically ticketed. The AI chooses when to call the API and handles IDs internally. One existing Codex task can work on multiple tickets sequentially. A new Codex task requires user authorization and a reason such as parallelism or work isolation.

Context holds parent assumptions; Task Memory holds durable decisions; Activity remains the detailed immutable journal. Tickets are not added to tasks.yaml and do not inflate report task counts.

## API

Before delegating substantial work, the sender creates a ticket in `todo` and passes its identity, revision and acceptance criteria to the worker. The sender does not start it. The worker reads the latest revision and calls `ticket_start_item` with its own assignee only when actually starting work. Receipt alone leaves the ticket `todo`; stale competing claims are rejected. Do not ticket short checks or single commands.

まとまった作業の委任前に依頼元が未着手チケットを作成し、ID・revision・完了条件を実装側へ渡します。依頼元は開始せず、実装側が実際の着手時に最新revisionを読み、自分を担当として`ticket_start_item`を呼びます。受領のみなら未着手を維持し、競合はrevisionで拒否します。短い確認や単一コマンドは対象外です。

```json
{
  "tool": "ticket_create_item",
  "arguments": {
    "task_id": "existing-parent",
    "idempotency_key": "voice-request-unique-key",
    "title": "Verify push delivery",
    "description": "Validate the agreed acceptance case",
    "acceptance": [{ "text": "Delivery verified on a real device", "done": false }],
    "priority": 2,
    "assignee": { "name": "Push investigation" }
  }
}
```

- `ticket_list_items` and `ticket_get_item` read parent-scoped tickets.
- `ticket_start_item` requires the current revision and a readable assignee.
- `ticket_update_item` accepts metadata, order and lifecycle patches with a required revision. Use `status=done`, checked `acceptance`, and `evidence` to complete.
- `waiting` means a response, dependency or specified date is expected before work resumes. `blocked` means a concrete obstruction prevents progress. Both require `stop_reason`.
- Use `discarded` with `discard_reason` when duplicate, superseded or no-longer-needed work will not be done. It remains auditable and can be restored to `todo` or `inProgress` using the latest revision. Normal operation never physically deletes a ticket.
- Dependencies must be within the parent and complete before starting/completing. Cycles fail.
- `todo` cannot jump directly to `done`. Completed tickets are immutable. A discarded ticket can be restored; a completed ticket cannot be reopened.
- Creation retries use the same parent/key and identical normalized payload. Conflicting keys fail. Update retries must reload the current revision; stale revisions never overwrite another worker.
- `activity_append_entry` accepts optional `ticket_id` and verifies parent ownership. Lifecycle writes themselves append one progress snapshot to the current operational date, transactionally with the ticket change.
- `system_prepare_work(task_id=...)` includes at most 30 open tickets; use list for the full set. Report rendering uses that date's last parent progress snapshot, never today's tickets for past dates.

## Web

`/tickets` is one cross-parent board with five active state columns and parent/project/assignee/status filters. Discarded tickets are hidden by default and appear in a dedicated column only when the discarded filter is selected. The board explains the distinction between external wait, blocked and discarded states. Cards link to the parent and display names rather than IDs. Done defaults to the last seven days. All changes use server revisions; the browser does not optimistically move cards.

SSE sends a complete snapshot on every connection and checks the canonical files every two seconds, including changes from other MCP processes. Unchanged connections receive heartbeats. Reconnection always gets a fresh full snapshot, so replay history is unnecessary. On disconnect the client uses a read fallback and retries after five seconds. Existing bearer authentication is retained. Slow consumers are disconnected instead of accumulating unbounded buffers.

## Storage And Migration

Selecting a card title opens a keyboard-accessible detail drawer. It shows live ticket fields and the matching parent/ticket Activity journal (latest 200 entries, newest first). Journal reads refresh every five seconds while open; board fields still follow SSE. Escape or the close button returns focus to the card. Real data is never modified by opening details.
Cards display a read-only status badge. Agents normally manage state; manual corrections are explicitly opened inside the drawer and use the same revision and lifecycle constraints. Completed tickets cannot be manually changed.

`tickets.yaml` is versioned (`version: 1`) and created on first write only. Existing Task/Context/Memory files need no migration and are not rewritten. Missing ticket storage means an empty list; invalid versions/content fail rather than being silently reset. Existing repository atomic writes, rollback and backup retention apply. Ticket writes and Activity writes share the repository transaction. Backups contain the previous registry; restore the matching ticket registry and Activity snapshot together when performing a full data-root restore. No automatic destructive migration or ticket cleanup runs.

The feature does not include drag-and-drop, physical ticket deletion, completed-ticket reopening, a dedicated backup-restore API, a parent-detail embedded board, or server push infrastructure beyond SSE snapshot notifications. These are separate extensions, not hidden guarantees.
