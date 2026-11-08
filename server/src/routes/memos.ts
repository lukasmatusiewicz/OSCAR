import { Router, Request, Response, NextFunction } from 'express';
import {
  MemoInputSchema,
  CreateMemoResponse,
  TaskEntity,
  MemoEntity,
  DecryptedTaskPayload,
  DecryptedTaskPayloadSchema,
} from '../types/contracts.js';
import { PrivacyGuard } from '../privacy/PrivacyGuard.js';
import { GeminiOrchestrator } from '../agent/GeminiOrchestrator.js';
import { EncryptionService } from '../security/EncryptionService.js';
import { getEncryptionKeyFromRequest } from '../security/requestKey.js';
import { TaskStore } from '../store/TaskStore.js';

export interface MemoRouterDependencies {
  orchestrator: GeminiOrchestrator;
  taskStore: TaskStore;
}

/**
 * Creates the memo processing router.
 *
 * @param deps Dependencies including GeminiOrchestrator and TaskStore.
 * @returns Express Router mounted with /memos endpoints.
 */
export function createMemoRouter(deps: MemoRouterDependencies): Router {
  const router = Router();

  /**
   * POST /api/memos
   * Ingests confidential user memo, sanitizes PII with PrivacyGuard,
   * invokes GeminiOrchestrator for structured task extraction,
   * re-hydrates tokens, envelope-encrypts sensitive fields with AES-256-GCM,
   * and persists encrypted entities into the TaskStore.
   */
  router.post('/memos', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Validate inbound request payload against MemoInputSchema
      const input = MemoInputSchema.parse(req.body);

      // 2. Resolve per-request encryption key
      const keyBuffer = getEncryptionKeyFromRequest(req);

      // 3. Mask PII using ECMAScript Priority Overlap Resolution
      const sanitization = PrivacyGuard.mask(input.content);

      // 4. Extract structured task from sanitized prompt
      const orchestratorResult = await deps.orchestrator.extractTasks(sanitization.sanitizedText);

      // 5. Re-hydrate synthetic tokens in the extracted task structure
      const rehydratedTask = PrivacyGuard.rehydrate(orchestratorResult.task, sanitization.tokens);

      const location = rehydratedTask.location
        ? PrivacyGuard.rehydrate(rehydratedTask.location, sanitization.tokens)
        : (rehydratedTask.location ?? null);
      const contactPerson = rehydratedTask.contactPerson
        ? PrivacyGuard.rehydrate(rehydratedTask.contactPerson, sanitization.tokens)
        : (rehydratedTask.contactPerson ?? null);
      const amount = rehydratedTask.amount
        ? PrivacyGuard.rehydrate(rehydratedTask.amount, sanitization.tokens)
        : (rehydratedTask.amount ?? null);
      const scheduledTime = rehydratedTask.scheduledTime
        ? PrivacyGuard.rehydrate(rehydratedTask.scheduledTime, sanitization.tokens)
        : (rehydratedTask.scheduledTime ?? null);

      // 6. Validate re-hydrated task against DecryptedTaskPayloadSchema (bounds expansion accommodation)
      const decryptedPayload: DecryptedTaskPayload = DecryptedTaskPayloadSchema.parse({
        title:
          input.title && input.title.trim().length > 0 ? input.title.trim() : rehydratedTask.title,
        summary: rehydratedTask.summary,
        subtasks: rehydratedTask.subtasks,
        location,
        contactPerson,
        amount,
        scheduledTime,
      });

      // 7. Envelope encrypt sensitive task & memo payloads with AES-256-GCM
      const encryptedTaskPayload = await EncryptionService.encrypt(decryptedPayload, keyBuffer);
      const encryptedMemoPayload = await EncryptionService.encrypt(
        {
          rawContent: input.content,
          timestamp: sanitization.timestamp,
        },
        keyBuffer,
      );

      // Securely zero out the key buffer in memory
      EncryptionService.zeroKey(keyBuffer);

      // 8. Construct TaskEntity and MemoEntity conformant with authoritative schemas
      const memoId = `memo_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const nowIso = new Date().toISOString();

      const memoEntity: MemoEntity = {
        id: memoId,
        userId: 'usr_session_default',
        encryptedPayload: encryptedMemoPayload,
        sanitizedContentPreview: sanitization.sanitizedText.substring(0, 150),
        hasPII: sanitization.tokenCount > 0,
        maskedFieldsCount: sanitization.tokenCount,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const taskEntity: TaskEntity = {
        id: taskId,
        memoId,
        userId: 'usr_session_default',
        encryptedPayload: encryptedTaskPayload,
        category: rehydratedTask.category,
        priority: rehydratedTask.priority,
        status: 'DRAFT', // EU AI Act human review initial state
        scheduledDate: rehydratedTask.scheduledDate,
        tags: rehydratedTask.tags,
        provenance: orchestratorResult.provenance,
        modelVersion: orchestratorResult.modelVersion,
        createdAt: nowIso,
        updatedAt: nowIso,
        location,
        contactPerson,
        amount,
        scheduledTime,
      };

      // 9. Persist to store
      deps.taskStore.addMemo(memoEntity);
      deps.taskStore.addTask(taskEntity);

      // 10. Return structured response with created tasks and PII telemetry
      const response: CreateMemoResponse = {
        task: taskEntity,
        tasks: [taskEntity],
        memo: memoEntity,
        piiStats: {
          detectedEntityCount: sanitization.tokenCount,
          maskedTokens: sanitization.tokens,
          riskLevel: sanitization.riskLevel,
        },
      };

      res.status(200).json(response);
    } catch (err: unknown) {
      next(err);
    }
  });

  return router;
}
