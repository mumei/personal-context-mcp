# Work Context Isolation

## Cause

Previously, `system_prepare_work(task_id=...)` called `getUserSituation` with the task ID as a ranking preference. It did not filter active tasks, activity, pending agent updates, memory decisions, or handoff diagnostics. A task-specific drafting request therefore received other projects' facts alongside its own context. Keyword Knowledge search also expanded graph neighbors.

This explains an exposure path, not proof of which model tokens caused an individual document error.

## Current Contract

- A supplied `task_id` defaults to `scope=strict`.
- Strict scope returns only that task's context, memory, activities and situation. Missing/deleted tasks fail.
- Set `include_context_body=true` when drafting from the task specification.
- Strict Knowledge retrieval requires explicit `knowledge_ids` and never expands graph neighbors.
- Global Memory requires `include_global_memory=true`.
- Cross-task situation requires both `scope=global` and `include_global_situation=true`.
- Strict scope rejects `include_global_situation=true` instead of silently widening the response.
- Without a task ID, global situation is still omitted unless explicitly requested. Query-based Knowledge search remains available outside strict scope.
- Related tasks are not inferred from project names, keywords, or arbitrary links. Fetch a related task explicitly in a separate strict call only when the task sources establish its relevance. Automatic parent/child expansion is not implemented because there is no validated parent/child contract in the current task model.

## Drafting Example

```json
{
  "task_id": "delivery-voip",
  "query": "VoIP concurrency",
  "scope": "strict",
  "include_context_body": true
}
```

Knowledge is general guidance, never proof that a feature or requirement exists in the target task. A task assertion must be traceable to its own context, activities, memory or explicitly supplied source material.

## Remaining Controls

This is retrieval isolation, not authorization. Previously injected conversation content remains in the client context; use a fresh task/conversation for sensitive drafting after cross-project work. Other cross-task tools remain intentionally available.

For output validation, prefer claim-to-source checks: attach a source identifier to task-specific assertions and flag assertions with no target-source support. A secondary exact-match check against explicitly maintained project/entity aliases can flag foreign names without returning other projects' underlying data. Neither substring matching nor an LLM review alone proves absence of contamination; synonyms and generic words make both false positives and false negatives possible. These output checks are proposals, not implemented guarantees.

## Verification

Regression tests cover task-scoped activity/next-action isolation, no unrelated task payload in the MCP response, Global Memory exclusion, explicit Knowledge selection without neighbor expansion, explicit global access, invalid scope combinations, and preservation of persisted state. Restart the client-managed MCP after rebuilding; existing connections do not hot-reload server code.
