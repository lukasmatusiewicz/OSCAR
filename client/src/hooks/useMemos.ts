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
import {
  normalizePersonToNominative,
  normalizeAddressCasing,
} from '../utils/linguisticNormalizer';

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
          const rawClauses = rawContent
            .split(/(?:(?<!\d)[.?!](?:\s+|$)|(?<!\d)[.?!]$|\r?\n)+/)
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
          const metadataMarkerRegex =
            /(?:•\s*)?(?:👤\s*Contact:|📍\s*Location:|💰\s*Amount:|⏰\s*Time:|📝\s*Notes:)[^\r\n]*/gi;
          const nonMetadataClause = rawClauses.find(
            (c) => c.replace(metadataMarkerRegex, '').trim().length > 0,
          );
          const firstClauseMatch = nonMetadataClause || rawClauses[0] || '';
          let cleanedTitle = firstClauseMatch
            .replace(metadataMarkerRegex, '')
            .replace(/[.?!,:;\s]+$/, '')
            .trim();
          if (cleanedTitle.length > 0) {
            cleanedTitle = cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1);
          }
          const title =
            cleanedTitle.length >= 3
              ? (cleanedTitle.length > 80 ? `${cleanedTitle.substring(0, 77)}...` : cleanedTitle)
              : 'Voice Memo Action Items';

          // Smart metadata extraction for offline fallback
          let contactPerson: string | null = null;
          const personTok = tokens.find((t) => t.type === 'PERSON');
          if (personTok) {
            contactPerson = personTok.originalValue || personTok.token;
          } else {
            const m = rawContent.match(
              /(?:\b(?:Herr|Frau|Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.|Pan|Pani|dr|mec\.)\s+\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)|(?:(?<=\b(?:with|z|ze|mit|avec)\s+)\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)*)/u,
            );
            if (m) contactPerson = m[0];
          }
          if (!contactPerson) {
            const cardContactMatch = rawContent.match(/(?:•\s*)?👤\s*Contact:\s*([^\r\n]+)/i);
            if (cardContactMatch && cardContactMatch[1]) {
              contactPerson = cardContactMatch[1].trim();
            }
          }
          if (contactPerson) {
            contactPerson = normalizePersonToNominative(contactPerson);
          }

          let location: string | null = null;
          const addressTok = tokens.find((t) => t.type === 'ADDRESS');
          if (addressTok) {
            location = addressTok.originalValue || addressTok.token;
          } else {
            const m = rawContent.match(
              /\b(?:New York|Kassel|Berlin|Paris|Warsaw|Warszawa|London|Zurich|Zürich|Tokyo|Vienna|Wien|Rome|Roma|Madrid|Krakow|Kraków|Wrocław|Munich|München|Hamburg|Frankfurt)\b/i,
            );
            if (m) {
              location = m[0];
            } else {
              const streetMatch = rawContent.match(
                /\b(?:(?:ul\.|al\.|pl\.|os\.|plac|rue|boulevard|bd\.?)\s+[\p{L}\d\s-]+?\d+[a-z]?|[\p{L}\d-]+(?:straße|strasse|str\.)\s*\d+[a-z]?|\d+\s+[\p{L}\s]+(?:street|st|avenue|ave|boulevard|blvd|road|rd)\b|[\p{L}\s]+(?:street|st|avenue|ave|boulevard|blvd|road|rd)\s+\d+[a-z]?)/iu,
              );
              if (streetMatch) location = streetMatch[0];
            }
          }
          if (!location) {
            const cardLocationMatch = rawContent.match(/(?:•\s*)?📍\s*Location:\s*([^\r\n]+)/i);
            if (cardLocationMatch && cardLocationMatch[1]) {
              location = cardLocationMatch[1].trim();
            }
          }
          if (location) {
            location = normalizeAddressCasing(location);
          }

          let amount: string | null = null;
          const amountTok = tokens.find((t) => t.type === 'AMOUNT_MONEY');
          if (amountTok) {
            amount = amountTok.originalValue || amountTok.token;
          } else {
            const m = rawContent.match(
              /(?:\$|€|£|\b(?:PLN|EUR|USD|CHF|zł))\s?\d+(?:[.,\s]\d+)*(?:\s?(?:k|tys\.?|mln|milionów|mld))?|\b\d+(?:[.,\s]\d+)*(?:\s?(?:k|tys\.?|mln|milionów|mld))?\s?(?:€|\$|£|\b(?:PLN|EUR|USD|CHF|zł)\b)/i,
            );
            if (m) amount = m[0];
          }
          if (!amount) {
            const cardAmountMatch = rawContent.match(/(?:•\s*)?💰\s*Amount:\s*([^\r\n]+)/i);
            if (cardAmountMatch && cardAmountMatch[1]) {
              amount = cardAmountMatch[1].trim();
            }
          }

          let scheduledTime: string | null = null;
          const timeMatch = rawContent.match(
            /(?:(?:tomorrow|jutro|morgen|today|dzisiaj|heute)\s+(?:at|o|um)\s+\d{1,2}(?::\d{2})?|\b\d{1,2}:\d{2}\b)/i,
          );
          if (timeMatch) scheduledTime = timeMatch[0];
          if (!scheduledTime) {
            const cardTimeMatch = rawContent.match(/(?:•\s*)?⏰\s*Time:\s*([^\r\n]+)/i);
            if (cardTimeMatch && cardTimeMatch[1]) {
              scheduledTime = cardTimeMatch[1].trim();
            }
          }

          // Google Calendar-Style Structured Summary (RFC 5545 format)
          const coreObjective = title;
          const summaryLines: string[] = [coreObjective];

          if (contactPerson) {
            summaryLines.push(`• 👤 Contact: ${contactPerson}`);
          }
          if (location) {
            summaryLines.push(`• 📍 Location: ${location}`);
          }
          if (amount) {
            summaryLines.push(`• 💰 Amount: ${amount}`);
          }
          if (scheduledTime) {
            summaryLines.push(`• ⏰ Time: ${scheduledTime}`);
          }

          // Notes / extra details: tokens or explicit notes
          const noteItems: string[] = [];
          const noteMatch = rawContent.match(/(?:notes?|uwag[ai]|notatka)\s*:\s*([^.\n]+)/i);
          if (noteMatch && noteMatch[1]) {
            noteItems.push(noteMatch[1].trim());
          }

          const remainingTokens = tokens.filter(
            (t) =>
              t.originalValue !== contactPerson &&
              t.token !== contactPerson &&
              t.originalValue !== location &&
              t.token !== location &&
              t.originalValue !== amount &&
              t.token !== amount,
          );
          if (remainingTokens.length > 0) {
            const tokenStr = remainingTokens.map((t) => t.originalValue || t.token).join(', ');
            if (!noteItems.includes(tokenStr)) {
              noteItems.push(tokenStr);
            }
          }

          if (noteItems.length > 0) {
            summaryLines.push(`• 📝 Notes: ${noteItems.join('; ')}`);
          }

          let summary = summaryLines.join('\n');
          if (summary.length > 500) {
            summary = summary.substring(0, 497) + '...';
          } else if (summary.length < 5) {
            summary = summary.padEnd(5, '.');
          }

          const decryptedTaskPayload: DecryptedTaskPayload = {
            title,
            summary,
            subtasks: [
              { title: 'Review memo details and verify parameters', completed: false },
              { title: 'Follow up on referenced items securely', completed: false },
            ],
            location,
            contactPerson,
            amount,
            scheduledTime,
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
            location,
            contactPerson,
            amount,
            scheduledTime,
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
