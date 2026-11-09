import type { TaskEntity, MemoEntity, PrivacyAuditLog } from '../types/contracts.js';

/**
 * Universal repository contract for task, memo, and privacy audit log persistence.
 * Implementations can provide either synchronous in-memory storage or asynchronous
 * distributed database storage (e.g., Google Cloud Firestore).
 */
export interface ITaskRepository {
  /**
   * Retrieves all persisted tasks, sorted by creation date descending.
   */
  getTasks(): Promise<TaskEntity[]> | TaskEntity[];

  /**
   * Retrieves a single task by its unique identifier.
   *
   * @param id Unique document identifier.
   */
  getTaskById(id: string): Promise<TaskEntity | undefined> | TaskEntity | undefined;

  /**
   * Persists a newly created task.
   *
   * @param task Task entity to persist.
   */
  addTask(task: TaskEntity): Promise<void> | void;

  /**
   * Updates an existing task with partial property changes.
   *
   * @param id Unique document identifier.
   * @param updates Partial task properties to apply.
   */
  updateTask(
    id: string,
    updates: Partial<TaskEntity>,
  ): Promise<TaskEntity | undefined> | TaskEntity | undefined;

  /**
   * Deletes a task by its unique identifier.
   *
   * @param id Unique document identifier.
   */
  deleteTask(id: string): Promise<boolean> | boolean;

  /**
   * Persists a newly created memo.
   *
   * @param memo Memo entity to persist.
   */
  addMemo(memo: MemoEntity): Promise<void> | void;

  /**
   * Retrieves all persisted memos, sorted by creation date descending.
   */
  getMemos(): Promise<MemoEntity[]> | MemoEntity[];

  /**
   * Atomically writes memo, task, and optional privacy audit log records in a single transactional batch.
   *
   * @param memo Memo entity to persist.
   * @param task Task entity to persist.
   * @param auditLog Optional privacy audit log entry.
   */
  commitBatch(memo: MemoEntity, task: TaskEntity, auditLog?: PrivacyAuditLog): Promise<void> | void;

  /**
   * Removes all persisted records (used for test teardown and ephemeral resets).
   */
  clear?(): Promise<void> | void;
}
