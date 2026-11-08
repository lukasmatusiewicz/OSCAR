import { TaskEntity, MemoEntity } from '../types/contracts.js';

/**
 * In-memory store for TaskEntity and MemoEntity records.
 * Provides synchronized CRUD operations for development, integration testing,
 * and ephemeral single-instance runtime execution.
 */
export class TaskStore {
  private readonly tasks: Map<string, TaskEntity> = new Map();
  private readonly memos: Map<string, MemoEntity> = new Map();

  /**
   * Retrieves all tasks currently persisted in the store, sorted by createdAt descending.
   *
   * @returns Array of TaskEntity records.
   */
  public getTasks(): TaskEntity[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * Retrieves a single task by its unique identifier.
   *
   * @param id Unique task identifier.
   * @returns TaskEntity if found, undefined otherwise.
   */
  public getTaskById(id: string): TaskEntity | undefined {
    return this.tasks.get(id);
  }

  /**
   * Adds a new TaskEntity to the store.
   *
   * @param task TaskEntity instance to persist.
   */
  public addTask(task: TaskEntity): void {
    this.tasks.set(task.id, task);
  }

  /**
   * Updates an existing task with partial properties.
   *
   * @param id Unique task identifier.
   * @param updates Partial properties to apply to the task.
   * @returns Updated TaskEntity if found, undefined otherwise.
   */
  public updateTask(id: string, updates: Partial<TaskEntity>): TaskEntity | undefined {
    const existing = this.tasks.get(id);
    if (!existing) {
      return undefined;
    }
    const updated: TaskEntity = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(id, updated);
    return updated;
  }

  /**
   * Deletes a task by its unique identifier.
   *
   * @param id Unique task identifier to remove.
   * @returns True if the task was found and deleted, false otherwise.
   */
  public deleteTask(id: string): boolean {
    return this.tasks.delete(id);
  }

  /**
   * Adds a new MemoEntity to the store.
   *
   * @param memo MemoEntity instance to persist.
   */
  public addMemo(memo: MemoEntity): void {
    this.memos.set(memo.id, memo);
  }

  /**
   * Retrieves all memos currently persisted in the store, sorted by createdAt descending.
   *
   * @returns Array of MemoEntity records.
   */
  public getMemos(): MemoEntity[] {
    return Array.from(this.memos.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * Clears all tasks and memos from the store.
   */
  public clear(): void {
    this.tasks.clear();
    this.memos.clear();
  }
}

export const taskStore = new TaskStore();

