import { Router, Request, Response, NextFunction } from 'express';
import {
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
  TaskEntity,
  DecryptedTaskPayload,
  DecryptedTaskPayloadSchema,
} from '../types/contracts.js';
import { EncryptionService } from '../security/EncryptionService.js';
import { getEncryptionKeyFromRequest } from '../security/requestKey.js';
import type { ITaskRepository } from '../store/ITaskRepository.js';
import { logger } from '../utils/logger.js';

export interface TaskRouterDependencies {
  taskStore: ITaskRepository;
}

/**
 * Creates the task management router.
 *
 * @param deps Dependencies including ITaskRepository.
 * @returns Express Router mounted with /tasks endpoints.
 */
export function createTaskRouter(deps: TaskRouterDependencies): Router {
  const router = Router();

  /**
   * GET /api/tasks
   * Returns list of encrypted tasks persisted in the store.
   */
  router.get('/tasks', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const tasks = await deps.taskStore.getTasks();
      res.status(200).json(tasks);
    } catch (err: unknown) {
      next(err);
    }
  });

  /**
   * POST /api/tasks
   * Manually creates a new task: validates input, envelope-encrypts sensitive cleartext
   * using AES-256-GCM, and stores the resulting TaskEntity.
   */
  router.post('/tasks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateTaskInputSchema.parse(req.body);
      const keyBuffer = getEncryptionKeyFromRequest(req);

      const decryptedPayload: DecryptedTaskPayload = DecryptedTaskPayloadSchema.parse({
        title: input.title,
        summary: input.summary ?? input.title.padEnd(5, '.'),
        subtasks:
          input.subtasks && input.subtasks.length > 0
            ? input.subtasks
            : [{ title: `Review: ${input.title}`.substring(0, 200), completed: false }],
        location: input.location ?? null,
        contactPerson: input.contactPerson ?? null,
        amount: input.amount ?? null,
        scheduledTime: input.scheduledTime ?? null,
      });

      const encryptedPayload = await EncryptionService.encrypt(decryptedPayload, keyBuffer);
      EncryptionService.zeroKey(keyBuffer);

      const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const nowIso = new Date().toISOString();

      const taskEntity: TaskEntity = {
        id: taskId,
        memoId: `memo_manual_${taskId}`,
        userId: 'usr_session_default_01',
        encryptedPayload,
        category: input.category ?? 'OTHER',
        priority: input.priority ?? 'MEDIUM',
        status: input.status ?? 'DRAFT',
        scheduledDate: input.scheduledDate ?? null,
        tags: input.tags ?? [],
        provenance: 'DETERMINISTIC_FALLBACK',
        modelVersion: 'manual-entry-v1',
        createdAt: nowIso,
        updatedAt: nowIso,
        location: input.location ?? null,
        contactPerson: input.contactPerson ?? null,
        amount: input.amount ?? null,
        scheduledTime: input.scheduledTime ?? null,
      };

      await deps.taskStore.addTask(taskEntity);
      res.status(201).json(taskEntity);
    } catch (err: unknown) {
      next(err);
    }
  });

  /**
   * PATCH /api/tasks/:id
   * Updates task status, priority, non-sensitive metadata, or re-encrypts sensitive fields.
   */
  router.patch('/tasks/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = UpdateTaskInputSchema.parse(req.body);
      const taskId = req.params.id as string;
      const existing = await deps.taskStore.getTaskById(taskId);

      if (!existing) {
        return res.status(404).json({
          error: 'Task not found',
          message: `Task with id '${taskId}' was not found`,
        });
      }

      const updates: Partial<TaskEntity> = {};

      if (input.status !== undefined) updates.status = input.status;
      if (input.priority !== undefined) updates.priority = input.priority;
      if (input.category !== undefined) updates.category = input.category;
      if (input.scheduledDate !== undefined) updates.scheduledDate = input.scheduledDate;
      if (input.tags !== undefined) updates.tags = input.tags;
      if (input.location !== undefined) updates.location = input.location;
      if (input.contactPerson !== undefined) updates.contactPerson = input.contactPerson;
      if (input.amount !== undefined) updates.amount = input.amount;
      if (input.scheduledTime !== undefined) updates.scheduledTime = input.scheduledTime;

      // If sensitive fields or smart metadata are modified, decrypt existing, merge, and re-encrypt
      if (
        input.title !== undefined ||
        input.summary !== undefined ||
        input.subtasks !== undefined ||
        input.location !== undefined ||
        input.contactPerson !== undefined ||
        input.amount !== undefined ||
        input.scheduledTime !== undefined
      ) {
        const keyBuffer = getEncryptionKeyFromRequest(req);
        const existingDecrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
          existing.encryptedPayload,
          keyBuffer,
        );

        const mergedDecrypted: DecryptedTaskPayload = DecryptedTaskPayloadSchema.parse({
          title: input.title ?? existingDecrypted.title,
          summary: input.summary ?? existingDecrypted.summary,
          subtasks: input.subtasks ?? existingDecrypted.subtasks,
          location:
            input.location !== undefined ? input.location : (existingDecrypted.location ?? null),
          contactPerson:
            input.contactPerson !== undefined
              ? input.contactPerson
              : (existingDecrypted.contactPerson ?? null),
          amount: input.amount !== undefined ? input.amount : (existingDecrypted.amount ?? null),
          scheduledTime:
            input.scheduledTime !== undefined
              ? input.scheduledTime
              : (existingDecrypted.scheduledTime ?? null),
        });

        const newEncryptedPayload = await EncryptionService.encrypt(mergedDecrypted, keyBuffer);
        EncryptionService.zeroKey(keyBuffer);
        updates.encryptedPayload = newEncryptedPayload;
      }

      const updated = await deps.taskStore.updateTask(taskId, updates);
      res.status(200).json(updated);
    } catch (err: unknown) {
      next(err);
    }
  });

  /**
   * DELETE /api/tasks/:id
   * Removes a task from the store.
   */
  router.delete('/tasks/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = req.params.id as string;
      const deleted = await deps.taskStore.deleteTask(taskId);

      if (!deleted) {
        return res.status(404).json({
          error: 'Task not found',
          message: `Task with id '${taskId}' was not found`,
        });
      }

      logger.info('Tasks', `Deleted task ${taskId}`, { id: taskId });

      res.status(200).json({
        success: true,
        id: taskId,
        message: 'Task successfully removed',
      });
    } catch (err: unknown) {
      next(err);
    }
  });

  return router;
}
