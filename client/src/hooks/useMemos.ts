import { useState, useCallback } from 'react';
import {
  EncryptedPayload,
  MemoEntity,
  PIITokenMap,
  TaskEntity,
  DecryptedTaskPayload
} from '../types/contracts';
import { ClientCryptoService } from '../services/ClientCryptoService';

export interface UseMemosOptions {
  onTaskCreated?: (task: TaskEntity, decrypted: DecryptedTaskPayload) => void;
  onTokensDetected?: (tokens: PIITokenMap[]) => void;
}

export function useMemos(options?: UseMemosOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memos, setMemos] = useState<MemoEntity[]>([]);

  const submitMemo = useCallback(
    async (rawContent: string, tokens: PIITokenMap[]): Promise<MemoEntity> => {
      setIsSubmitting(true);
      setError(null);

      try {
        if (!ClientCryptoService.hasSessionKey()) {
          ClientCryptoService.initializeSessionKey();
        }

        // 1. Mask content for preview
        let sanitizedPreview = rawContent;
        // Sort tokens descending by startIndex to replace without offset drift
        const sortedTokens = [...tokens].sort((a, b) => b.startIndex - a.startIndex);
        for (const tok of sortedTokens) {
          sanitizedPreview =
            sanitizedPreview.substring(0, tok.startIndex) +
            tok.token +
            sanitizedPreview.substring(tok.endIndex);
        }

        // 2. Encrypt the raw cleartext with WebCrypto AES-256-GCM
        const encryptedPayload: EncryptedPayload = await ClientCryptoService.encrypt({
          rawContent,
          timestamp: new Date().toISOString()
        });

        // 3. Construct MemoEntity conformant with MemoEntitySchema
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
          updatedAt: nowIso
        };

        setMemos((prev) => [memoEntity, ...prev]);
        options?.onTokensDetected?.(tokens);

        // 4. Construct AI extracted decrypted task & encrypted task entity (simulated or gateway response)
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const firstLine = rawContent.split('\n')[0].trim();
        const title = firstLine.length > 5 ? firstLine.substring(0, 80) : 'Voice Memo Action Items';
        const summary = rawContent.length > 10 ? rawContent.substring(0, 200) : 'Extracted action items from confidential voice recording.';

        const decryptedTaskPayload: DecryptedTaskPayload = {
          title,
          summary,
          subtasks: [
            { title: 'Review memo details and verify parameters', completed: false },
            { title: 'Follow up on referenced items securely', completed: false }
          ]
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
          tags: ['voice-memo', 'shielded'],
          provenance: 'GEMINI_FLASH',
          modelVersion: 'gemini-2.5-flash-001',
          createdAt: nowIso,
          updatedAt: nowIso
        };

        options?.onTaskCreated?.(taskEntity, decryptedTaskPayload);

        return memoEntity;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to submit confidential memo';
        setError(msg);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [options]
  );

  return {
    memos,
    isSubmitting,
    error,
    submitMemo
  };
}
