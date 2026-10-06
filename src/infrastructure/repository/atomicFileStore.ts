/**
 * Atomic file replacement and data-root transaction coordination.
 *
 * This module owns temporary-file replacement, in-process serialization,
 * cross-process lock files, write snapshots, and best-effort rollback. It does
 * not know repository layouts, document formats, backups, or domain entities.
 *
 * 原子的なファイル置換とdata-rootトランザクションの調整を提供します。
 *
 * このモジュールは、一時ファイルによる置換、プロセス内の直列化、プロセス間ロックファイル、
 * 書き込みスナップショット、およびベストエフォートのロールバックを担当します。
 * リポジトリレイアウト、ドキュメント形式、バックアップ、ドメインエンティティは扱いません。
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

interface TransactionState {
  roots: Set<string>;
  snapshots: Map<string, string | null>;
  order: string[];
  rollbackArtifacts: Set<string>;
  rollingBack: boolean;
}

const transactionContext = new AsyncLocalStorage<TransactionState>();
const transactionTails = new Map<string, Promise<void>>();
const lockRetryMs = 20;
const lockTimeoutMs = 30_000;

/**
 * Coordinates atomic text writes and rollback-capable transactions for one
 * resolved data-root directory.
 *
 * 解決済みの1つのdata-rootディレクトリに対して、原子的なテキスト書き込みと
 * ロールバック可能なトランザクションを調整します。
 */
export class AtomicFileStore {
  /**
   * Creates a store scoped to an absolute data-root path.
   *
   * data rootの絶対パスをスコープとするストアを作成します。
   */
  constructor(private readonly root: string) {}

  /**
   * Atomically replaces a UTF-8 text file and records its prior value when a
   * transaction for this data root is active.
   *
   * UTF-8テキストファイルを原子的に置換し、このdata rootのトランザクションが
   * 有効な場合は置換前の値を記録します。
   */
  async replaceText(path: string, content: string): Promise<void> {
    const transaction = transactionContext.getStore();
    if (transaction?.roots.has(this.root) && !transaction.rollingBack && !transaction.snapshots.has(path)) {
      const previous = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      transaction.snapshots.set(path, previous);
      transaction.order.push(path);
    }
    await this.replaceTextWithoutSnapshot(path, content);
  }

  /**
   * Registers a file created as a side effect of the active transaction so it
   * can be removed if the transaction rolls back.
   *
   * 有効なトランザクションの副作用として作成されたファイルを登録し、
   * ロールバック時に削除できるようにします。
   */
  registerRollbackArtifact(path: string): void {
    const transaction = transactionContext.getStore();
    if (transaction?.roots.has(this.root) && !transaction.rollingBack) {
      transaction.rollbackArtifacts.add(path);
    }
  }

  /**
   * Serializes an operation for this data root and restores all snapshotted
   * text files if the operation rejects.
   *
   * このdata rootに対する処理を直列化し、処理がrejectされた場合は
   * スナップショットを取得したすべてのテキストファイルを復元します。
   */
  async withTransaction<T>(operation: () => Promise<T>): Promise<T> {
    const active = transactionContext.getStore();
    if (active?.roots.has(this.root)) {
      return operation();
    }

    const previous = transactionTails.get(this.root) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      releaseQueue = resolveGate;
    });
    const tail = previous.then(() => gate);
    transactionTails.set(this.root, tail);
    await previous;

    let releaseFileLock: (() => Promise<void>) | undefined;
    try {
      releaseFileLock = await this.acquireFileLock();
      const state: TransactionState = active ?? {
        roots: new Set(),
        snapshots: new Map(),
        order: [],
        rollbackArtifacts: new Set(),
        rollingBack: false,
      };
      state.roots.add(this.root);
      try {
        return await transactionContext.run(state, operation);
      } catch (error) {
        state.rollingBack = true;
        const rollbackErrors: Error[] = [];
        for (const path of [...state.order].reverse()) {
          try {
            const previousContent = state.snapshots.get(path);
            if (previousContent === null) await rm(path, { force: true });
            else if (previousContent !== undefined) await this.replaceTextWithoutSnapshot(path, previousContent);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError as Error);
          }
        }
        for (const path of state.rollbackArtifacts) {
          try {
            await rm(path, { force: true });
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError as Error);
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error as Error, ...rollbackErrors],
            "Transaction failed and rollback was incomplete.",
          );
        }
        throw error;
      }
    } finally {
      await releaseFileLock?.();
      releaseQueue();
      if (transactionTails.get(this.root) === tail) {
        transactionTails.delete(this.root);
      }
    }
  }

  private async replaceTextWithoutSnapshot(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, path);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async acquireFileLock(): Promise<() => Promise<void>> {
    await mkdir(this.root, { recursive: true });
    const lockPath = join(this.root, ".task-mcp.lock");
    const started = Date.now();
    while (true) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }), "utf8");
          await handle.sync();
        } catch (error) {
          await handle.close().catch(() => undefined);
          await rm(lockPath, { force: true }).catch(() => undefined);
          throw error;
        }
        return async () => {
          await handle.close().catch(() => undefined);
          await rm(lockPath, { force: true }).catch(() => undefined);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await this.removeStaleLock(lockPath)) continue;
        if (Date.now() - started >= lockTimeoutMs) {
          throw new Error(`Timed out waiting for data-root lock: ${lockPath}`);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, lockRetryMs));
      }
    }
  }

  private async removeStaleLock(lockPath: string): Promise<boolean> {
    let text: string;
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      [text, info] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      return false;
    }
    const ageMs = Date.now() - info.mtimeMs;
    let pid: number | undefined;
    try {
      const parsed = JSON.parse(text) as { pid?: unknown };
      pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
    } catch {
      // A newly-created lock may be observed before its metadata is complete.
    }
    if (pid !== undefined) {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
      }
    } else if (ageMs < lockTimeoutMs) {
      return false;
    }
    await rm(lockPath, { force: true });
    return true;
  }
}
