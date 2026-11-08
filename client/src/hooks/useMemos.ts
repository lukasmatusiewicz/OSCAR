import { useState, useCallback } from 'react';
import {
  EncryptedPayload,
  MemoEntity,
  PIITokenMap,
  TaskEntity,
  DecryptedTaskPayload,
} from '../types/contracts';
import { ClientCryptoService } from '../services/ClientCryptoService';
import { gatewayClient } from '../services/GatewayClient';

export interface UseMemosOptions {
  onTaskCreated?: (task: TaskEntity, decrypted: DecryptedTaskPayload) => void;
  onTokensDetected?: (tokens: PIITokenMap[]) => void;
}

/**
 * Custom hook for managing memo submission and reactive state.
 * Connects to the backend GatewayClient with automatic fallback to local WebCrypto
 * offline mock processing if the backend service is unreachable.
 */
export function useMemos(options?: UseMemosOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isOfflineFallback, setIsOfflineFallback] = useState(false);
  const [memos, setMemos] = useState<MemoEntity[]>([]);

  const submitMemo = useCallback(
    async (rawContent: string, tokens: PIITokenMap[] = []): Promise<MemoEntity> => {
      setIsSubmitting(true);
      setError(null);

      try {
        if (!ClientCryptoService.hasSessionKey()) {
          ClientCryptoService.initializeSessionKey();
        }

        // Attempt submission via GatewayClient
        try {
          const gatewayResponse = await gatewayClient.submitMemo(rawContent);

          // Decrypt the created task payload with client session key
          const decryptedTask = await ClientCryptoService.decrypt<DecryptedTaskPayload>(
            gatewayResponse.task.encryptedPayload,
          );

          setIsOfflineFallback(false);
          setWarning(null);
          setMemos((prev) => [gatewayResponse.memo, ...prev]);
          options?.onTokensDetected?.(gatewayResponse.piiStats.maskedTokens);
          options?.onTaskCreated?.(gatewayResponse.task, decryptedTask);

          return gatewayResponse.memo;
        } catch (err: unknown) {
          // eslint-disable-next-line no-console
          console.error('[useMemos] Gateway submission error:', err);
          // Graceful fallback to offline deterministic mode when gateway is unavailable (EU AI Act Article 13)
          setIsOfflineFallback(true);
          setWarning(
            'Backend gateway unreachable. Deterministic rule-based fallback was used to generate this task (EU AI Act Article 13 transparency).',
          );

          let sanitizedPreview = rawContent;
          const sortedTokens = [...tokens].sort((a, b) => b.startIndex - a.startIndex);
          for (const tok of sortedTokens) {
            sanitizedPreview =
              sanitizedPreview.substring(0, tok.startIndex) +
              tok.token +
              sanitizedPreview.substring(tok.endIndex);
          }

          const encryptedPayload: EncryptedPayload = await ClientCryptoService.encrypt({
            rawContent,
            timestamp: new Date().toISOString(),
          });

          const memoId = `memo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const nowIso = new Date().toISOString();

          const memoEntity: MemoEntity = {
            id: memoId,
            userId: 'usr_mock_session_active',
            encryptedPayload,
            sanitizedContentPreview: sanitizedPreview.substring(0, 150),
            hasPII: tokens.length > 0,
            maskedFieldsCount: tokens.length,
            createdAt: nowIso,
            updatedAt: nowIso,
          };

          setMemos((prev) => [memoEntity, ...prev]);
          options?.onTokensDetected?.(tokens);

          const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const firstClauseMatch =
            rawContent
              .split(/(?:(?<!\d)[.?!](?:\s+|$)|(?<!\d)[.?!]$|\r?\n)+/)
              .map((c) => c.trim())
              .filter((c) => c.length > 0)[0] || '';
          let cleanedTitle = firstClauseMatch.replace(/[.?!,:;\s]+$/, '').trim();
          if (cleanedTitle.length > 0) {
            cleanedTitle = cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1);
          }
          const title =
            cleanedTitle.length >= 3
              ? (cleanedTitle.length > 80 ? `${cleanedTitle.substring(0, 77)}...` : cleanedTitle)
              : 'Voice Memo Action Items';
          const summary =
            rawContent.length > 10
              ? rawContent.substring(0, 200)
              : 'Extracted action items from confidential voice recording.';

          const decryptedTaskPayload: DecryptedTaskPayload = {
            title,
            summary,
            subtasks: [
              { title: 'Review memo details and verify parameters', completed: false },
              { title: 'Follow up on referenced items securely', completed: false },
            ],
          };

          const encryptedTaskPayload = await ClientCryptoService.encrypt(decryptedTaskPayload);

          const taskEntity: TaskEntity = {
            id: taskId,
            memoId: memoId,
            userId: 'usr_mock_session_active',
            encryptedPayload: encryptedTaskPayload,
            category: 'WORK',
            priority: tokens.some((t) => t.type === 'SECRET_KEY') ? 'URGENT' : 'MEDIUM',
            status: 'DRAFT', // EU AI Act human review initial state
            scheduledDate: null,
            tags: ['voice-memo', 'shielded', 'offline-fallback'],
            provenance: 'DETERMINISTIC_FALLBACK',
            modelVersion: 'rule-based-v1',
            createdAt: nowIso,
            updatedAt: nowIso,
          };

          options?.onTaskCreated?.(taskEntity, decryptedTaskPayload);

          return memoEntity;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to submit confidential memo';
        setError(msg);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [options],
  );

  return {
    memos,
    isSubmitting,
    error,
    warning,
    isOfflineFallback,
    submitMemo,
  };
}
