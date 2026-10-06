/**
 * Filesystem-backed persistence facade for Personal Context MCP documents.
 *
 * This module owns layout-aware paths, serialization, backups, and the stable
 * Repository API used by application and domain code. It delegates low-level
 * atomic transactions and generated data-root documentation; it does not own
 * domain workflows or report generation.
 *
 * Personal Context MCPドキュメント向けの、ファイルシステムを使用した永続化ファサードです。
 *
 * このモジュールは、レイアウトに基づくパス、シリアライズ、バックアップ、および
 * アプリケーションコードとドメインコードが利用する安定したRepository APIを担当します。
 * 低レベルの原子的トランザクションとdata-rootドキュメントの生成は委譲し、
 * ドメインワークフローやレポート生成は担当しません。
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { parseFrontmatter, stringifyFrontmatter } from "#shared/frontmatter";
import type {
  ActivityDocument,
  AgentUpdatesDocument,
  CleanupSummariesDocument,
  FrontmatterDocument,
  GlobalMemoryDocument,
  InputsDocument,
  KnowledgeGraphIndex,
  KnowledgeNote,
  MemorySummariesDocument,
  PersonInteractionsDocument,
  PersonProfile,
  PersonRelationshipsDocument,
  ReportDocument,
  ReportSummaryDocument,
  RequestLogEntry,
  SaveResult,
  Task,
  TaskMemoryDocument,
  TaskMcpConfig,
  TasksDocument,
} from "#shared/types";
import { AtomicFileStore } from "#infra/repository/atomicFileStore";
import { buildDataRootReadme } from "#infra/repository/dataRootReadme";

/**
 * Provides the stable layout-aware persistence API for Personal Context MCP data roots.
 *
 * Domain-specific behavior remains in domain services; this class coordinates
 * common filesystem document operations without splitting by document type.
 *
 * Personal Context MCPのdata rootに対して、レイアウトを考慮した安定した永続化APIを提供します。
 *
 * ドメイン固有の振る舞いはドメインサービスに残し、このクラスはドキュメント種別ごとに
 * 分割することなく、共通のファイルシステム上のドキュメント操作を調整します。
 */
export class Repository {
  /**
   * Absolute configured data-root path.
   *
   * 設定されたdata rootの絶対パスです。
   */
  readonly root: string;
  private readonly atomicFiles: AtomicFileStore;

  /**
   * Creates a repository for the supplied runtime configuration.
   *
   * 指定された実行時設定に対応するリポジトリを作成します。
   */
  constructor(private readonly config: TaskMcpConfig) {
    this.root = resolve(config.dataRoot);
    this.atomicFiles = new AtomicFileStore(this.root);
  }

  /**
   * Resolves a configured layout entry and optional child path segments.
   *
   * 設定されたレイアウト項目と任意の子パス部分を解決します。
   */
  layoutPath(name: keyof TaskMcpConfig["layout"], ...parts: string[]): string {
    return this.pathFor(this.config.layout[name], ...parts);
  }

  /**
   * Returns the configured relative path for a layout entry.
   *
   * レイアウト項目に設定された相対パスを返します。
   */
  layoutName(name: keyof TaskMcpConfig["layout"]): string {
    return this.config.layout[name];
  }

  /**
   * Resolves a path inside the data root and rejects traversal outside it.
   *
   * data root内のパスを解決し、その外部へのパストラバーサルを拒否します。
   */
  pathFor(...parts: string[]): string {
    const fullPath = resolve(this.root, ...parts);
    const rel = relative(this.root, fullPath);
    if ((rel === "" && parts.length === 0) || rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error(`Unsafe path outside data root: ${parts.join("/")}`);
    }
    return fullPath;
  }

  /**
   * Reads UTF-8 text below the data root, returning null when absent.
   *
   * data root配下のUTF-8テキストを読み込み、存在しない場合はnullを返します。
   */
  async readTextIfExists(...parts: string[]): Promise<string | null> {
    const path = this.pathFor(...parts);
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Backs up an existing file and atomically writes replacement text.
   *
   * 既存ファイルをバックアップし、置換テキストを原子的に書き込みます。
   */
  async writeText(path: string, content: string, reason: string): Promise<SaveResult> {
    await mkdir(dirname(path), { recursive: true });
    const backupPath = await this.backupIfExists(path, reason);
    await this.replaceTextAtomic(path, content);
    return { changed: true, path, backupPath };
  }

  /**
   * Atomically replaces text, participating in any active transaction.
   *
   * 有効なトランザクションに参加しながら、テキストを原子的に置換します。
   */
  async replaceTextAtomic(path: string, content: string): Promise<void> {
    await this.atomicFiles.replaceText(path, content);
  }

  /**
   * Runs an operation under the data-root transaction lock with rollback.
   *
   * ロールバックを備えたdata-rootトランザクションロック内で処理を実行します。
   */
  async withTransaction<T>(operation: () => Promise<T>): Promise<T> {
    return this.atomicFiles.withTransaction(operation);
  }

  /**
   * Copies an existing file into the dated backup area, if it exists.
   *
   * ファイルが存在する場合、日付別バックアップ領域へコピーします。
   */
  async backupIfExists(path: string, reason: string): Promise<string | undefined> {
    try {
      await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }

    const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32) || "update";
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 17);
    const date = new Date().toISOString().slice(0, 10);
    const backupDir = this.pathFor(this.config.layout.backups, date);
    await mkdir(backupDir, { recursive: true });
    const backupPath = join(backupDir, `${basename(path)}.${timestamp}.${randomUUID()}.${safeReason}.bak`);
    await copyFile(path, backupPath);
    this.atomicFiles.registerRollbackArtifact(backupPath);
    return backupPath;
  }

  /**
   * Loads a YAML document or returns the supplied fallback when absent.
   *
   * YAMLドキュメントを読み込み、存在しない場合は指定されたフォールバック値を返します。
   */
  async loadYaml<T>(fallback: T, ...parts: string[]): Promise<T> {
    const text = await this.readTextIfExists(...parts);
    if (text === null) {
      return fallback;
    }
    const parsed = YAML.parse(text) as T | null;
    return parsed ?? fallback;
  }

  /**
   * Serializes a value as YAML and writes it with backup protection.
   *
   * 値をYAMLとしてシリアライズし、バックアップ保護付きで書き込みます。
   */
  async saveYaml(path: string, value: unknown, reason: string): Promise<SaveResult> {
    return this.writeText(path, YAML.stringify(value), reason);
  }

  /**
   * Loads the canonical task registry.
   *
   * 正規のタスクレジストリを読み込みます。
   */
  async loadTasks(): Promise<TasksDocument> {
    return this.loadYaml<TasksDocument>({ tasks: [] }, this.config.layout.tasks);
  }

  /**
   * Saves the canonical task registry.
   *
   * 正規のタスクレジストリを保存します。
   */
  async saveTasks(doc: TasksDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.tasks), doc, reason);
  }

  /**
   * Resolves the configured or default Markdown context path for a task.
   *
   * タスクに設定された、または既定のMarkdownコンテキストパスを解決します。
   */
  contextPathFor(task: Task): string {
    const contextPath = task.context ?? `${this.config.layout.contexts}/${task.id}.md`;
    return this.pathFor(contextPath);
  }

  /**
   * Loads a task's frontmatter Markdown context.
   *
   * タスクのfrontmatter付きMarkdownコンテキストを読み込みます。
   */
  async loadTaskContext(task: Task): Promise<FrontmatterDocument> {
    const text = await this.readTextIfExists(relative(this.root, this.contextPathFor(task)));
    return parseFrontmatter(text ?? "");
  }

  /**
   * Saves a task's frontmatter Markdown context.
   *
   * タスクのfrontmatter付きMarkdownコンテキストを保存します。
   */
  async saveTaskContext(task: Task, doc: FrontmatterDocument, reason: string): Promise<SaveResult> {
    return this.writeText(this.contextPathFor(task), stringifyFrontmatter(doc), reason);
  }

  /**
   * Loads external inputs for an operational date.
   *
   * 運用日付の外部入力を読み込みます。
   */
  async loadInputs(date: string): Promise<InputsDocument> {
    return this.loadYaml<InputsDocument>({ date, items: [] }, this.config.layout.inputs, `${date}.yaml`);
  }

  /**
   * Saves external inputs for an operational date.
   *
   * 運用日付の外部入力を保存します。
   */
  async saveInputs(date: string, doc: InputsDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.inputs, `${date}.yaml`), doc, reason);
  }

  /**
   * Loads activity entries for an operational date.
   *
   * 運用日付のアクティビティ項目を読み込みます。
   */
  async loadActivity(date: string): Promise<ActivityDocument> {
    return this.loadYaml<ActivityDocument>({ date, entries: [] }, this.config.layout.activities, `${date}.yaml`);
  }

  /**
   * Saves activity entries for an operational date.
   *
   * 運用日付のアクティビティ項目を保存します。
   */
  async saveActivity(date: string, doc: ActivityDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.activities, `${date}.yaml`), doc, reason);
  }

  /**
   * Loads report data for an operational date.
   *
   * 運用日付のレポートデータを読み込みます。
   */
  async loadReport(date: string): Promise<ReportDocument> {
    return this.loadYaml<ReportDocument>({ date, entries: [] }, this.config.layout.reports, `${date}.yaml`);
  }

  /**
   * Saves report data for an operational date.
   *
   * 運用日付のレポートデータを保存します。
   */
  async saveReport(date: string, doc: ReportDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.reports, `${date}.yaml`), doc, reason);
  }

  /**
   * Loads durable memory for one task.
   *
   * 1件のタスクに関する永続メモリを読み込みます。
   */
  async loadTaskMemory(taskId: string): Promise<TaskMemoryDocument> {
    return this.loadYaml<TaskMemoryDocument>({ task_id: taskId }, this.config.layout.taskMemory, `${taskId}.yaml`);
  }

  /**
   * Saves durable memory for one task.
   *
   * 1件のタスクに関する永続メモリを保存します。
   */
  async saveTaskMemory(taskId: string, doc: TaskMemoryDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.taskMemory, `${taskId}.yaml`), doc, reason);
  }

  /**
   * Loads user-wide durable memory.
   *
   * ユーザー全体の永続メモリを読み込みます。
   */
  async loadGlobalMemory(): Promise<GlobalMemoryDocument> {
    return this.loadYaml<GlobalMemoryDocument>({}, this.config.layout.globalMemory);
  }

  /**
   * Saves user-wide durable memory.
   *
   * ユーザー全体の永続メモリを保存します。
   */
  async saveGlobalMemory(doc: GlobalMemoryDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.globalMemory), doc, reason);
  }

  /**
   * Resolves the canonical Markdown path for one knowledge note.
   *
   * 1件のKnowledgeノートに対する正規Markdownパスを解決します。
   */
  knowledgeNotePath(id: string): string {
    if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(id)) throw new Error(`Unsafe knowledge note id: ${id}`);
    return this.pathFor(this.config.layout.knowledge, "notes", `${id}.md`);
  }

  /**
   * Loads one canonical Markdown-backed knowledge note, returning null when absent.
   *
   * Markdownを正本とするKnowledgeノートを1件読み込み、存在しない場合はnullを返します。
   */
  async loadKnowledgeNote(id: string): Promise<KnowledgeNote | null> {
    const text = await this.readTextIfExists(relative(this.root, this.knowledgeNotePath(id)));
    if (text === null) return null;
    return knowledgeNoteFromFrontmatter(parseFrontmatter(text), id);
  }

  /**
   * Loads every canonical knowledge note in stable id order.
   *
   * すべての正規Knowledgeノートを安定したID順で読み込みます。
   */
  async loadKnowledgeNotes(): Promise<KnowledgeNote[]> {
    const directory = this.pathFor(this.config.layout.knowledge, "notes");
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(
      names
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map(async (name) => {
          const id = name.slice(0, -3);
          const note = await this.loadKnowledgeNote(id);
          if (!note) throw new Error(`Knowledge note disappeared while loading: ${id}`);
          return note;
        }),
    );
  }

  /**
   * Saves one canonical knowledge note as Markdown with YAML frontmatter.
   *
   * 1件の正規KnowledgeノートをYAML frontmatter付きMarkdownとして保存します。
   */
  async saveKnowledgeNote(note: KnowledgeNote, reason: string): Promise<SaveResult> {
    const { body, ...data } = note;
    return this.writeText(this.knowledgeNotePath(note.id), stringifyFrontmatter({ data, body }), reason);
  }

  /**
   * Loads the rebuildable knowledge graph index, returning an empty index when absent.
   *
   * 再構築可能なKnowledge Graph索引を読み込み、存在しない場合は空の索引を返します。
   */
  async loadKnowledgeGraphIndex(): Promise<KnowledgeGraphIndex> {
    const index = await this.loadYaml<Partial<KnowledgeGraphIndex>>(
      { version: 2, generated_at: "", nodes: [], edges: [] },
      this.config.layout.knowledge,
      "graph-index.json",
    );
    if (index.version !== 2 || !Array.isArray(index.nodes) || !Array.isArray(index.edges)) {
      return { version: 2, generated_at: "", nodes: [], edges: [] };
    }
    return index as KnowledgeGraphIndex;
  }

  /**
   * Atomically replaces the derived knowledge graph index without creating canonical-data backups.
   *
   * 正規データのバックアップを作らず、派生Knowledge Graph索引を原子的に置換します。
   */
  async saveKnowledgeGraphIndex(index: KnowledgeGraphIndex): Promise<SaveResult> {
    const path = this.pathFor(this.config.layout.knowledge, "graph-index.json");
    await mkdir(dirname(path), { recursive: true });
    await this.replaceTextAtomic(path, `${JSON.stringify(index, null, 2)}\n`);
    return { changed: true, path };
  }

  /** Resolves the canonical YAML path for one person profile. 1件の人物プロフィールの正規YAMLパスを解決します。 */
  personProfilePath(id: string): string {
    if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(id)) throw new Error(`Unsafe person id: ${id}`);
    return this.pathFor(this.config.layout.people, "profiles", `${id}.yaml`);
  }

  /** Loads one person profile, returning null when absent. 人物プロフィールを1件読み込み、存在しない場合はnullを返します。 */
  async loadPersonProfile(id: string): Promise<PersonProfile | null> {
    const text = await this.readTextIfExists(relative(this.root, this.personProfilePath(id)));
    if (text === null) return null;
    const parsed = YAML.parse(text) as Partial<PersonProfile> | null;
    if (!parsed || parsed.id !== id || typeof parsed.display_name !== "string") {
      throw new Error(`Invalid person profile: ${id}`);
    }
    return {
      ...parsed,
      id,
      display_name: parsed.display_name,
      aliases: Array.isArray(parsed.aliases) ? parsed.aliases : [],
      organizations: Array.isArray(parsed.organizations) ? parsed.organizations : [],
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
      relationship_status: parsed.relationship_status === "inactive" ? "inactive" : "active",
      preferred_channels: Array.isArray(parsed.preferred_channels) ? parsed.preferred_channels : [],
      languages: Array.isArray(parsed.languages) ? parsed.languages : [],
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      created_at: typeof parsed.created_at === "string" ? parsed.created_at : "",
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : "",
    };
  }

  /** Loads all canonical person profiles in stable id order. 正規の人物プロフィールをID順ですべて読み込みます。 */
  async loadPersonProfiles(): Promise<PersonProfile[]> {
    const directory = this.pathFor(this.config.layout.people, "profiles");
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const profiles = await Promise.all(
      names
        .filter((name) => name.endsWith(".yaml"))
        .sort()
        .map((name) => this.loadPersonProfile(name.slice(0, -5))),
    );
    return profiles.filter((profile): profile is PersonProfile => profile !== null);
  }

  /** Saves one canonical person profile. 正規の人物プロフィールを1件保存します。 */
  async savePersonProfile(profile: PersonProfile, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.personProfilePath(profile.id), profile, reason);
  }

  /** Loads the canonical person-to-person relationship registry. 人物間関係の正規レジストリを読み込みます。 */
  async loadPersonRelationships(): Promise<PersonRelationshipsDocument> {
    return this.loadYaml<PersonRelationshipsDocument>(
      { relationships: [] },
      this.config.layout.people,
      "relationships.yaml",
    );
  }

  /** Saves the canonical person-to-person relationship registry. 人物間関係の正規レジストリを保存します。 */
  async savePersonRelationships(doc: PersonRelationshipsDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.people, "relationships.yaml"), doc, reason);
  }

  /** Loads append-only person interactions for one operational date. 1運用日の追記型人物接点履歴を読み込みます。 */
  async loadPersonInteractions(date: string): Promise<PersonInteractionsDocument> {
    return this.loadYaml<PersonInteractionsDocument>(
      { date, interactions: [] },
      this.config.layout.people,
      "interactions",
      `${date}.yaml`,
    );
  }

  /** Lists operational dates that have person interaction journals. 人物接点履歴が存在する運用日を一覧します。 */
  async listPersonInteractionDates(): Promise<string[]> {
    const directory = this.pathFor(this.config.layout.people, "interactions");
    try {
      return (await readdir(directory))
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.yaml$/.test(name))
        .map((name) => name.slice(0, -5))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  /** Saves person interactions for one operational date. 1運用日の人物接点履歴を保存します。 */
  async savePersonInteractions(date: string, doc: PersonInteractionsDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.people, "interactions", `${date}.yaml`), doc, reason);
  }

  /**
   * Loads the internal report summary for an operational date.
   *
   * 運用日付の内部レポート要約を読み込みます。
   */
  async loadReportSummary(date: string): Promise<ReportSummaryDocument> {
    return this.loadYaml<ReportSummaryDocument>({ date }, this.config.layout.reportSummaries, `${date}.yaml`);
  }

  /**
   * Saves the internal report summary for an operational date.
   *
   * 運用日付の内部レポート要約を保存します。
   */
  async saveReportSummary(date: string, doc: ReportSummaryDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.reportSummaries, `${date}.yaml`), doc, reason);
  }

  /**
   * Loads legacy memory-summary history for an operational date.
   *
   * 運用日付の旧形式メモリ要約履歴を読み込みます。
   */
  async loadMemorySummaries(date: string): Promise<MemorySummariesDocument> {
    return this.loadYaml<MemorySummariesDocument>(
      { date, summaries: [] },
      this.config.layout.memorySummaries,
      `${date}.yaml`,
    );
  }

  /**
   * Saves legacy memory-summary history for an operational date.
   *
   * 運用日付の旧形式メモリ要約履歴を保存します。
   */
  async saveMemorySummaries(date: string, doc: MemorySummariesDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.memorySummaries, `${date}.yaml`), doc, reason);
  }

  /**
   * Loads cleanup archive summaries for an operational date.
   *
   * 運用日付のクリーンアップアーカイブ要約を読み込みます。
   */
  async loadCleanupSummaries(date: string): Promise<CleanupSummariesDocument> {
    return this.loadYaml<CleanupSummariesDocument>(
      { date, summaries: [] },
      this.config.layout.cleanupSummaries,
      `${date}.yaml`,
    );
  }

  /**
   * Saves cleanup archive summaries for an operational date.
   *
   * 運用日付のクリーンアップアーカイブ要約を保存します。
   */
  async saveCleanupSummaries(date: string, doc: CleanupSummariesDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.cleanupSummaries, `${date}.yaml`), doc, reason);
  }

  /**
   * Loads a rendered output file when it exists.
   *
   * レンダリング済み出力ファイルが存在する場合に読み込みます。
   */
  async loadOutput(renderer: string, date: string, extension = "txt"): Promise<string | null> {
    return this.readTextIfExists(this.config.layout.outputs, renderer, `${date}.${extension}`);
  }

  /**
   * Saves a rendered output file.
   *
   * レンダリング済み出力ファイルを保存します。
   */
  async saveOutput(
    renderer: string,
    date: string,
    text: string,
    reason: string,
    extension = "txt",
  ): Promise<SaveResult> {
    return this.writeText(this.pathFor(this.config.layout.outputs, renderer, `${date}.${extension}`), text, reason);
  }

  /**
   * Appends one JSON object to the dated request audit log.
   *
   * 日付別リクエスト監査ログにJSONオブジェクトを1件追記します。
   */
  async appendRequestLog(date: string, entry: RequestLogEntry): Promise<SaveResult> {
    const path = this.pathFor(this.config.layout.requestLogs, `${date}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
    return { changed: true, path };
  }

  /**
   * Returns generated documentation for the configured data-root layout.
   *
   * 設定されたdata-rootレイアウト向けに生成したドキュメントを返します。
   */
  dataRootReadmeContent(): string {
    return buildDataRootReadme(this.config.layout);
  }

  /**
   * Creates or refreshes the generated data-root README when needed.
   *
   * 必要に応じて、生成されるdata-root READMEを作成または更新します。
   */
  async ensureDataRootReadme(): Promise<SaveResult> {
    const path = this.pathFor("README.md");
    const existing = await this.readTextIfExists("README.md");
    const content = this.dataRootReadmeContent();
    if (existing === content) {
      return { changed: false, path };
    }
    await this.replaceTextAtomic(path, content);
    return { changed: true, path };
  }

  /**
   * Loads legacy agent-update records for an operational date.
   *
   * 運用日付の旧形式エージェント更新記録を読み込みます。
   */
  async loadAgentUpdates(date: string): Promise<AgentUpdatesDocument> {
    return this.loadYaml<AgentUpdatesDocument>({ date, updates: [] }, this.config.layout.agentUpdates, `${date}.yaml`);
  }

  /**
   * Saves legacy agent-update records for an operational date.
   *
   * 運用日付の旧形式エージェント更新記録を保存します。
   */
  async saveAgentUpdates(date: string, doc: AgentUpdatesDocument, reason: string): Promise<SaveResult> {
    return this.saveYaml(this.pathFor(this.config.layout.agentUpdates, `${date}.yaml`), doc, reason);
  }

  /**
   * Lists sorted dates represented by YAML files in a data-root folder.
   *
   * data-rootフォルダ内のYAMLファイルが表す日付をソートして列挙します。
   */
  async listYamlDates(folder: string): Promise<string[]> {
    const dir = this.pathFor(folder);
    try {
      const names = await readdir(dir);
      return names
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.yaml$/.test(name))
        .map((name) => name.slice(0, 10))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * Lists sorted dates represented by renderer output files.
   *
   * レンダラー出力ファイルが表す日付をソートして列挙します。
   */
  async listOutputDates(renderer: string, extension?: string): Promise<string[]> {
    const dir = this.pathFor(this.config.layout.outputs, renderer);
    try {
      const names = await readdir(dir);
      const pattern = extension
        ? new RegExp(`^\\d{4}-\\d{2}-\\d{2}\\.${extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
        : /^\d{4}-\d{2}-\d{2}\.[^.]+$/;
      return names
        .filter((name) => pattern.test(name))
        .map((name) => name.slice(0, 10))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

/**
 * Converts parsed frontmatter into a typed knowledge note while preserving the Markdown body.
 *
 * 解析済みfrontmatterをMarkdown本文を保持した型付きKnowledgeノートへ変換します。
 */
function knowledgeNoteFromFrontmatter(document: FrontmatterDocument, expectedId: string): KnowledgeNote {
  const data = document.data as Partial<Omit<KnowledgeNote, "body">>;
  if (data.id !== expectedId) {
    throw new Error(`Knowledge note id mismatch: filename=${expectedId}, frontmatter=${String(data.id)}`);
  }
  if (typeof data.title !== "string" || typeof data.type !== "string") {
    throw new Error(`Knowledge note is missing title or type: ${expectedId}`);
  }
  const summary = typeof data.summary === "string" ? data.summary : "";
  const storedEvidence = Array.isArray(data.evidence) && data.evidence.length > 0 ? data.evidence : undefined;
  const legacy = extractLegacyEvidence(document.body);
  const body = (storedEvidence ? document.body.trim() : legacy.body) || summary.trim() || data.title;
  return {
    id: expectedId,
    title: data.title,
    type: data.type,
    aliases: Array.isArray(data.aliases) ? data.aliases : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    summary: summary.trim() || data.title,
    evidence: storedEvidence ?? [
      {
        statement: summary.trim() || data.title,
        rationale: legacy.rationale || body || summary.trim() || data.title,
      },
    ],
    relations: Array.isArray(data.relations) ? data.relations : [],
    created_at: typeof data.created_at === "string" ? data.created_at : "",
    updated_at: typeof data.updated_at === "string" ? data.updated_at : "",
    body,
  };
}

function extractLegacyEvidence(body: string): { body: string; rationale: string } {
  const lines = body.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => /^##\s+(?:根拠|Evidence)\s*$/u.test(line));
  if (headingIndex < 0) return { body: body.trim(), rationale: "" };
  const evidenceLines = lines.slice(headingIndex + 1);
  const nextHeadingIndex = evidenceLines.findIndex((line) => /^##\s+/u.test(line));
  const endIndex = nextHeadingIndex < 0 ? lines.length : headingIndex + 1 + nextHeadingIndex;
  return {
    body: [...lines.slice(0, headingIndex), ...lines.slice(endIndex)].join("\n").trim(),
    rationale: lines
      .slice(headingIndex + 1, endIndex)
      .join("\n")
      .trim(),
  };
}
