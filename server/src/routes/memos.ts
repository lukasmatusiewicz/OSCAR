import { Router, Request, Response, NextFunction } from 'express';
import {
  MemoInputSchema,
  CreateMemoResponse,
  TaskEntity,
  MemoEntity,
  PrivacyAuditLog,
  DecryptedTaskPayload,
  DecryptedTaskPayloadSchema,
} from '../types/contracts.js';
import { PrivacyGuard } from '../privacy/PrivacyGuard.js';
import {
  normalizePersonToNominative,
  normalizeAddressCasing,
} from '../privacy/LinguisticNormalizer.js';
import { GeminiOrchestrator } from '../agent/GeminiOrchestrator.js';
import { EncryptionService } from '../security/EncryptionService.js';
import { getEncryptionKeyFromRequest } from '../security/requestKey.js';
import type { ITaskRepository } from '../store/ITaskRepository.js';
import { logger } from '../utils/logger.js';

export interface MemoRouterDependencies {
  orchestrator: GeminiOrchestrator;
  taskStore: ITaskRepository;
}

/**
 * Creates the memo processing router.
 *
 * @param deps Dependencies including GeminiOrchestrator and ITaskRepository.
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
      const requestStart = Date.now();

      // 1. Validate inbound request payload against MemoInputSchema
      const input = MemoInputSchema.parse(req.body);

      // 2. Resolve per-request encryption key
      const keyBuffer = getEncryptionKeyFromRequest(req);

      try {
        // 3. Mask PII using ECMAScript Priority Overlap Resolution
        const sanitization = PrivacyGuard.mask(input.content);
      logger.info('Memos', `Sanitized inbound memo: ${sanitization.tokenCount} token(s) detected`, {
        tokenCount: sanitization.tokenCount,
        tokenTypes: Array.from(new Set(sanitization.tokens.map((t) => t.type))),
        riskLevel: sanitization.riskLevel,
      });

      // 4. Extract structured task from sanitized prompt
      const orchestratorResult = await deps.orchestrator.extractTasks(sanitization.sanitizedText);
      logger.debug('Memos', `Extracted task via ${orchestratorResult.provenance} (${orchestratorResult.modelVersion})`, {
        category: orchestratorResult.task.category,
        priority: orchestratorResult.task.priority,
        provenance: orchestratorResult.provenance,
        modelVersion: orchestratorResult.modelVersion,
      });

      // 5. Re-hydrate synthetic tokens in the extracted task structure
      const rehydratedTask = PrivacyGuard.rehydrate(orchestratorResult.task, sanitization.tokens);

      const rawLocation = rehydratedTask.location
        ? PrivacyGuard.rehydrate(rehydratedTask.location, sanitization.tokens)
        : (rehydratedTask.location ?? null);
      const rawContactPerson = rehydratedTask.contactPerson
        ? PrivacyGuard.rehydrate(rehydratedTask.contactPerson, sanitization.tokens)
        : (rehydratedTask.contactPerson ?? null);
      const amount = rehydratedTask.amount
        ? PrivacyGuard.rehydrate(rehydratedTask.amount, sanitization.tokens)
        : (rehydratedTask.amount ?? null);
      const scheduledTime = rehydratedTask.scheduledTime
        ? PrivacyGuard.rehydrate(rehydratedTask.scheduledTime, sanitization.tokens)
        : (rehydratedTask.scheduledTime ?? null);

      const location = rawLocation ? normalizeAddressCasing(rawLocation) : null;
      const contactPerson = rawContactPerson ? normalizePersonToNominative(rawContactPerson) : null;

      let summary = rehydratedTask.summary ?? '';
      if (contactPerson) {
        const contactLine = `• 👤 Contact: ${contactPerson}`;
        const contactPattern = /(?:•\s*)?👤\s*Contact:[^\r\n]*/i;
        const lines = summary.split('\n');
        const contactIndices: number[] = [];
        lines.forEach((l, idx) => {
          if (contactPattern.test(l)) {
            contactIndices.push(idx);
          }
        });

        if (contactIndices.length > 0) {
          lines[contactIndices[0]] = contactLine;
          for (let i = contactIndices.length - 1; i >= 1; i--) {
            lines.splice(contactIndices[i], 1);
          }
          summary = lines.join('\n');
        } else {
          lines.splice(1, 0, contactLine);
          summary = lines.join('\n');
        }
      }

      if (location) {
        const locationLine = `• 📍 Location: ${location}`;
        const locationPattern = /(?:•\s*)?📍\s*Location:[^\r\n]*/i;
        const lines = summary.split('\n');
        const locationIndices: number[] = [];
        lines.forEach((l, idx) => {
          if (locationPattern.test(l)) {
            locationIndices.push(idx);
          }
        });

        if (locationIndices.length > 0) {
          lines[locationIndices[0]] = locationLine;
          for (let i = locationIndices.length - 1; i >= 1; i--) {
            lines.splice(locationIndices[i], 1);
          }
          summary = lines.join('\n');
        } else {
          const contactIdx = lines.findIndex((l) => l.includes('👤 Contact:'));
          const insertIdx = contactIdx !== -1 ? contactIdx + 1 : Math.min(1, lines.length);
          lines.splice(insertIdx, 0, locationLine);
          summary = lines.join('\n');
        }
      }

      if (summary.length < 5) {
        summary = summary.padEnd(5, '.');
      } else if (summary.length > 1000) {
        summary = `${summary.substring(0, 997)}...`;
      }

      // 6. Validate re-hydrated task against DecryptedTaskPayloadSchema (bounds expansion accommodation)
      const decryptedPayload: DecryptedTaskPayload = DecryptedTaskPayloadSchema.parse({
        title:
          input.title && input.title.trim().length > 0 ? input.title.trim() : rehydratedTask.title,
        summary,
        subtasks: rehydratedTask.subtasks,
        location,
        contactPerson,
        amount,
        scheduledTime,
      });
      logger.debug('Memos', 'Rehydrated task structure and validated payload', {
        hasLocation: Boolean(location),
        hasContactPerson: Boolean(contactPerson),
        subtasksCount: decryptedPayload.subtasks?.length ?? 0,
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

      // 8. Construct TaskEntity and MemoEntity conformant with authoritative schemas
      const memoId = `memo_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const nowIso = new Date().toISOString();

      const memoEntity: MemoEntity = {
        id: memoId,
        userId: 'usr_session_default_01',
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
        userId: 'usr_session_default_01',
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

      // 9. Persist to store atomically via commitBatch with PrivacyAuditLog
      const auditLog: PrivacyAuditLog = {
        id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
        userId: 'usr_session_default_01',
        action: 'MASK_SUCCESS',
        detectedTypes: Array.from(new Set(sanitization.tokens.map((t) => t.type))),
        tokenCount: sanitization.tokenCount,
        riskLevel: sanitization.riskLevel,
        durationMs: Date.now() - requestStart,
        timestamp: nowIso,
      };

      await deps.taskStore.commitBatch(memoEntity, taskEntity, auditLog);
      logger.info('Memos', `Atomically committed memo and task batch in ${Date.now() - requestStart}ms`, {
        memoId,
        taskId,
        durationMs: Date.now() - requestStart,
      });

      // 10. Return structured response with created tasks and redacted PII telemetry (no cleartext originalValue)
      const response: CreateMemoResponse = {
        task: taskEntity,
        tasks: [taskEntity],
        memo: memoEntity,
        piiStats: {
          detectedEntityCount: sanitization.tokenCount,
          maskedTokens: sanitization.tokens.map(({ token, type }) => ({ token, type })),
          riskLevel: sanitization.riskLevel,
        },
      };

        res.status(201).json(response);
      } finally {
        EncryptionService.zeroKey(keyBuffer);
      }
    } catch (err: unknown) {
      next(err);
    }
  });

  return router;
}
