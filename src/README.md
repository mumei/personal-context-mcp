# Source Structure

Personal Context MCP source code is grouped by responsibility. New modules should be placed in the narrowest directory that owns their behavior.

| Directory                    | Responsibility                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entrypoints/`               | Executable process startup for MCP stdio and the standalone Web monitor.                                                                                              |
| `mcp/`                       | MCP protocol integration, tool schemas, tool registration, and request orchestration.                                                                                 |
| `mcp/tools/`                 | MCP tool schemas grouped by user-facing capability. Business rules remain in domain/application modules.                                                              |
| `mcp/llm/`                   | MCP-specific LLM content parsing, structured-output schemas, and report-entry prompt construction.                                                                    |
| `mcp/middleware/`            | Cross-cutting MCP handler behavior such as sanitized request logging.                                                                                                 |
| `mcp/protocol/`              | MCP content-envelope conversion and protocol metadata extraction.                                                                                                     |
| `web/`                       | HTTP server, audit UI, Web API handling, and browser-facing presentation.                                                                                             |
| `web/briefing/`              | Briefing parsing, generation, and progress assessment.                                                                                                                |
| `web/tasks/`                 | Web-triggered task organization and mind-map generation.                                                                                                              |
| `web/http/`                  | Authentication, response helpers, API routes, static assets, and server lifecycle.                                                                                    |
| `web-ui/components/`         | Atomic Design-based Vue presentation components. Components own markup, interaction binding, and view-only formatting.                                                |
| `web-ui/composables/`        | Reusable Vue state and workflows. Settings composables isolate profile, Provider audit, schedule, and daily-task behavior from presentation.                          |
| `domains/`                   | Core task, activity, input, memory, report, session, and Agent Update behavior.                                                                                       |
| `domains/reports/render/`    | Report data preparation and deterministic Text, Markdown, and HTML renderers.                                                                                         |
| `application/`               | Use cases that coordinate multiple domains, such as search, validation, cleanup, import, and situation retrieval.                                                     |
| `application/cleanup/`       | Cleanup candidate discovery, summarization, archival, restoration, and archive deletion.                                                                              |
| `llm/`                       | Provider selection, Provider-owned default models, the shared generation contract, and adapters for Codex App Server, Claude, Copilot, Cursor, Gemini, and LM Studio. |
| `infrastructure/`            | File repository, runtime configuration, audit logging, and startup synchronization.                                                                                   |
| `infrastructure/repository/` | Repository facade, atomic file transactions, locking, and data-root README generation.                                                                                |
| `shared/`                    | Stable types and utilities that do not belong to one domain.                                                                                                          |

## Dependency Direction

Prefer dependencies in this direction:

```text
shared / infrastructure
          ↓
       domains
          ↓
     application
          ↓
       mcp / web
          ↓
     entrypoints
```

Domain modules must not import MCP or Web modules. MCP and Web are delivery adapters and should call domain or application functions rather than own persistent business rules.

LLM callers pass only a prompt, working directory, and optional output schema. Provider modules own default models and Provider Runtime applies environment overrides, commands, arguments, and timeouts.

## Compatibility Entrypoints

`src/server.ts` and `src/webServer.ts` are intentionally small compatibility entrypoints. Existing installations that execute `dist/server.js` or `dist/webServer.js` continue to work, while implementation lives under `mcp/` and `web/`.

## Naming

- Use `actions.ts` for commands that change one domain.
- Use `state.ts` for pure domain state predicates and selectors.
- Use `generation.ts` for LLM-backed structured generation.
- Use `render.ts` for deterministic presentation output.
- Put cross-domain workflows in `application/` or `domains/sessions/`, not in entrypoints.

## TSDoc

Every TypeScript source file starts with a responsibility-level `@packageDocumentation` block. Write the complete English explanation first, followed by the equivalent Japanese explanation. Public functions, classes, interfaces, and types follow the same English-then-Japanese order.

各TypeScriptソースファイルの先頭には、責務を示す `@packageDocumentation` を記載します。英語の説明全文を先に書き、その後に同内容の日本語を記載します。公開関数、クラス、interface、typeも同じ英語→日本語の順序にします。

## Formatting

Run `npm run format` to apply Prettier across the repository and `npm run format:check` to verify formatting without changes. ESLint owns code-quality rules, while `eslint-config-prettier` disables formatting rules that would conflict with Prettier. Vue SFCs are included in `npm run lint` and can be checked independently with `npm run lint:web`.

`npm run format` でリポジトリ全体へPrettierを適用し、`npm run format:check` で変更せずに整形状態を検証します。コード品質規則はESLintが担当し、`eslint-config-prettier` がPrettierと競合する整形規則を無効化します。Vue SFCは `npm run lint` の対象であり、`npm run lint:web` でも個別確認できます。
