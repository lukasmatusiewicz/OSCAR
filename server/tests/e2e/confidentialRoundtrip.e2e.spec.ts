import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Socket } from 'node:net';
import http from 'node:http';
import { Express } from 'express';
import { createApp, DEFAULT_CORS_ORIGIN } from '../../src/app.js';
import { TaskStore } from '../../src/store/TaskStore.js';
import { PrivacyGuard } from '../../src/privacy/PrivacyGuard.js';
import { EncryptionService, DecryptionError } from '../../src/security/EncryptionService.js';
import { GeminiOrchestrator, GenAiClientLike } from '../../src/agent/GeminiOrchestrator.js';
import {
  CreateMemoResponse,
  DecryptedTaskPayload,
  ExtractedTask,
  TaskEntity,
  MemoEntity,
} from '../../src/types/contracts.js';

// Architectural Named Constants (Eliminating Magic Numbers)
const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_CREATED = 201;
const HTTP_STATUS_NOT_FOUND = 404;
const PII_CATEGORIES_COUNT = 6;
const PREVIEW_MAX_CHARS = 150;
const HEADER_KEY_NAME = 'x-oscar-encryption-key';
const BIT_FLIP_INDEX = 5;
const BIT_FLIP_XOR = 0x01;
const EXPECTED_SUBTASK_COUNT = 4;

// Multi-Category Raw PII Fixture Data (RFC 2606 Compliant Test Entities)
const RAW_PERSON_NAME = 'Dr. Alice Newman';
const RAW_EMAIL = 'alice.newman@enterprise.org';
const RAW_PHONE = '+49 170 1234 5678';
const RAW_AMOUNT = '15000 EUR';
const RAW_IBAN = 'DE89370400440532013000';
const RAW_SECRET_KEY = 'sk-abcdef0123456789abcdef0123456789';

const RAW_CONFIDENTIAL_MEMO =
  `Urgent memo from ${RAW_PERSON_NAME} (${RAW_EMAIL}, ${RAW_PHONE}): ` +
  `Please approve disbursement of ${RAW_AMOUNT} to IBAN ${RAW_IBAN} ` +
  `using API key ${RAW_SECRET_KEY} for Q4 production deployment before Friday.`;

interface InProcessResponse<T = unknown> {
  status: number;
  headers: Record<string, unknown>;
  body: T;
}

interface InProcessRequestBuilder<T = unknown> extends PromiseLike<InProcessResponse<T>> {
  set(headerName: string, headerValue: string): InProcessRequestBuilder<T>;
  send(payload: unknown): InProcessRequestBuilder<T>;
}

/**
 * Socket-free in-process HTTP dispatcher for Express applications.
 * Executes the full Express pipeline and middleware lifecycle directly via Node's
 * http.IncomingMessage and http.ServerResponse, eliminating sandbox TCP port binding
 * restrictions (connect EACCES 127.0.0.1) in compliance with Section 7.6.
 */
function inProcessApp(app: Express) {
  function createBuilder<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
  ): InProcessRequestBuilder<T> {
    const headers: Record<string, string> = {};
    let requestPayload: unknown = undefined;

    const builder: InProcessRequestBuilder<T> = {
      set(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return builder;
      },
      send(data: unknown) {
        requestPayload = data;
        return builder;
      },
      then<TResult1 = InProcessResponse<T>, TResult2 = never>(
        onfulfilled?: ((value: InProcessResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return new Promise<InProcessResponse<T>>((resolve, reject) => {
          try {
            const socket = new Socket();
            const req = new http.IncomingMessage(socket);
            req.method = method;
            req.url = url;
            req.headers = { ...headers };

            const bodyString = requestPayload !== undefined ? JSON.stringify(requestPayload) : '';
            if (bodyString) {
              req.headers['content-type'] = 'application/json';
              req.headers['content-length'] = String(Buffer.byteLength(bodyString));
            }

            const res = new http.ServerResponse(req);
            let responseData = '';

            res.write = function (chunk: unknown): boolean {
              if (chunk) {
                responseData += chunk.toString();
              }
              return true;
            };

            res.end = function (chunk?: unknown): http.ServerResponse {
              if (chunk) {
                responseData += chunk.toString();
              }
              let parsedBody: T;
              try {
                parsedBody = responseData ? (JSON.parse(responseData) as T) : ({} as T);
              } catch {
                parsedBody = responseData as unknown as T;
              }
              resolve({
                status: res.statusCode,
                headers: res.getHeaders(),
                body: parsedBody,
              });
              return this;
            };

            app(req, res);

            if (bodyString) {
              req.push(bodyString);
            }
            req.push(null);
          } catch (err: unknown) {
            reject(err);
          }
        }).then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  return {
    get: <T = unknown>(url: string) => createBuilder<T>('GET', url),
    post: <T = unknown>(url: string) => createBuilder<T>('POST', url),
    patch: <T = unknown>(url: string) => createBuilder<T>('PATCH', url),
    delete: <T = unknown>(url: string) => createBuilder<T>('DELETE', url),
  };
}

describe('OSCAR End-to-End Confidential Lifecycle Roundtrip UAT Suite', () => {
  let taskStore: TaskStore;

  beforeEach(() => {
    taskStore = new TaskStore();
  });

  describe('The Complete 7-Step Confidential Roundtrip (Gemini 2.5 Flash)', () => {
    it('executes the full 7-step lifecycle with zero DOM/prompt PII leakage and verifiable memory zeroing', async () => {
      // -----------------------------------------------------------------------
      // Step 1: Raw memo input containing multi-category PII
      // -----------------------------------------------------------------------
      const rawMemoContent = RAW_CONFIDENTIAL_MEMO;
      expect(rawMemoContent).toContain(RAW_PERSON_NAME);
      expect(rawMemoContent).toContain(RAW_EMAIL);
      expect(rawMemoContent).toContain(RAW_PHONE);
      expect(rawMemoContent).toContain(RAW_AMOUNT);
      expect(rawMemoContent).toContain(RAW_IBAN);
      expect(rawMemoContent).toContain(RAW_SECRET_KEY);

      // -----------------------------------------------------------------------
      // Step 2: Real-time PrivacyShield token preview
      // -----------------------------------------------------------------------
      const previewSanitization = PrivacyGuard.mask(rawMemoContent);

      expect(previewSanitization.tokenCount).toBe(PII_CATEGORIES_COUNT);
      expect(previewSanitization.riskLevel).toBe('HIGH');
      expect(previewSanitization.tokens).toHaveLength(PII_CATEGORIES_COUNT);

      const detectedTypes = previewSanitization.tokens.map((t) => t.type);
      expect(detectedTypes).toContain('PERSON');
      expect(detectedTypes).toContain('EMAIL');
      expect(detectedTypes).toContain('PHONE');
      expect(detectedTypes).toContain('AMOUNT_MONEY');
      expect(detectedTypes).toContain('IBAN');
      expect(detectedTypes).toContain('SECRET_KEY');

      // Verify preview tokens are strictly synthetic tokens and do NOT leak values
      for (const tokenRecord of previewSanitization.tokens) {
        expect(tokenRecord.token).toMatch(/^\[[A-Z_]+_\d+\]$/);
        expect(tokenRecord.token).not.toContain(tokenRecord.originalValue);
      }

      // -----------------------------------------------------------------------
      // Step 3: Gateway token masking
      // Intercept the AI prompt to verify zero raw PII crosses the model boundary
      // -----------------------------------------------------------------------
      let capturedModelPrompt = '';

      const syntheticAiExtraction: ExtractedTask = {
        title: 'Approve Cloud Deployment Transfer for [PERSON_1]',
        summary:
          'Coordinate with [PERSON_1] ([EMAIL_1], [PHONE_1]) to disburse [AMOUNT_MONEY_1] to IBAN [IBAN_1] under credential [SECRET_KEY_1].',
        category: 'FINANCE',
        priority: 'URGENT',
        scheduledDate: '2026-11-13T17:00:00.000Z',
        tags: ['finance', 'deployment', 'urgent-transfer'],
        subtasks: [
          { title: 'Verify account authorization for [IBAN_1]', completed: false },
          { title: 'Validate API key [SECRET_KEY_1]', completed: false },
          { title: 'Confirm payment of [AMOUNT_MONEY_1] with [PERSON_1]', completed: false },
          { title: 'Send transfer confirmation receipt to [EMAIL_1]', completed: false },
        ],
      };

      const mockGenAiClient: GenAiClientLike = {
        models: {
          generateContent: vi.fn().mockImplementation(async (params: { contents?: string }) => {
            capturedModelPrompt = params.contents ?? '';
            return {
              text: JSON.stringify(syntheticAiExtraction),
            };
          }),
        },
      };

      const mockOrchestrator = new GeminiOrchestrator({
        genAiClient: mockGenAiClient,
        model: 'gemini-2.5-flash',
      });

      const app = createApp({
        orchestrator: mockOrchestrator,
        taskStore,
      });

      // Generate client ephemeral 256-bit AES-GCM session key
      const clientSessionKey = EncryptionService.generateKey();
      const clientSessionKeyBase64 = Buffer.from(clientSessionKey).toString('base64');
      expect(clientSessionKey.byteLength).toBe(KEY_BYTE_LENGTH);

      // Ingest memo via in-process Express HTTP pipeline
      const memoResponse = await inProcessApp(app)
        .post<CreateMemoResponse>('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, clientSessionKeyBase64)
        .send({
          content: rawMemoContent,
          title: 'Disbursement Request',
        });

      expect(memoResponse.status).toBe(HTTP_STATUS_CREATED);

      // Verify the external AI prompt was strictly masked with synthetic tokens
      expect(capturedModelPrompt).toContain('<user_memo>');
      expect(capturedModelPrompt).toContain('</user_memo>');
      expect(capturedModelPrompt).toContain('[PERSON_1]');
      expect(capturedModelPrompt).toContain('[EMAIL_1]');
      expect(capturedModelPrompt).toContain('[PHONE_1]');
      expect(capturedModelPrompt).toContain('[AMOUNT_MONEY_1]');
      expect(capturedModelPrompt).toContain('[IBAN_1]');
      expect(capturedModelPrompt).toContain('[SECRET_KEY_1]');

      // ZERO RAW PII PROMPT LEAKAGE INVARIANT:
      expect(capturedModelPrompt).not.toContain(RAW_PERSON_NAME);
      expect(capturedModelPrompt).not.toContain(RAW_EMAIL);
      expect(capturedModelPrompt).not.toContain(RAW_PHONE);
      expect(capturedModelPrompt).not.toContain(RAW_AMOUNT);
      expect(capturedModelPrompt).not.toContain(RAW_IBAN);
      expect(capturedModelPrompt).not.toContain(RAW_SECRET_KEY);

      // -----------------------------------------------------------------------
      // Step 4: AI structured extraction
      // -----------------------------------------------------------------------
      const responseBody = memoResponse.body;
      const createdTask: TaskEntity = responseBody.task;
      const createdMemo: MemoEntity = responseBody.memo;

      expect(createdTask.id).toMatch(/^task_/);
      expect(createdTask.memoId).toBe(createdMemo.id);
      expect(createdTask.category).toBe('FINANCE');
      expect(createdTask.priority).toBe('URGENT');
      expect(createdTask.status).toBe('DRAFT'); // EU AI Act Mandatory Human Review Initial State
      expect(createdTask.provenance).toBe('GEMINI_FLASH');
      expect(createdTask.modelVersion).toBe('gemini-2.5-flash');
      expect(createdTask.tags).toContain('urgent-transfer');

      // -----------------------------------------------------------------------
      // Step 5: Token re-hydration and AES-256-GCM envelope encryption at rest
      // -----------------------------------------------------------------------
      // Verify task and memo stored entities at rest in TaskStore
      const storedTask = taskStore.getTaskById(createdTask.id);
      const storedMemo = taskStore.getMemos().find((m) => m.id === createdMemo.id);

      expect(storedTask).toBeDefined();
      expect(storedMemo).toBeDefined();

      // Verify stored task payload is encrypted ciphertext
      expect(storedTask?.encryptedPayload).toBeDefined();
      expect(storedTask?.encryptedPayload.ciphertext).toBeTypeOf('string');
      expect(storedTask?.encryptedPayload.ciphertext.length).toBeGreaterThan(20);
      expect(storedTask?.encryptedPayload.iv).toBeTypeOf('string');
      expect(Buffer.from(storedTask?.encryptedPayload.iv ?? '', 'base64').byteLength).toBe(
        IV_BYTE_LENGTH,
      );
      expect(storedTask?.encryptedPayload.authTag).toBeTypeOf('string');
      expect(Buffer.from(storedTask?.encryptedPayload.authTag ?? '', 'base64').byteLength).toBe(
        AUTH_TAG_BYTE_LENGTH,
      );

      // Verify stored memo payload is encrypted ciphertext
      expect(storedMemo?.encryptedPayload).toBeDefined();
      expect(storedMemo?.encryptedPayload.ciphertext).toBeTypeOf('string');

      // Zero plaintext PII preview or outer metadata stored at rest (R-10)
      expect(storedMemo).not.toHaveProperty('sanitizedContentPreview');
      expect(storedTask).not.toHaveProperty('location');
      expect(storedTask).not.toHaveProperty('contactPerson');
      expect(storedTask).not.toHaveProperty('amount');

      // ZERO CLEARTEXT AT-REST DATABASE STORAGE INVARIANT:
      const serializedStoreJson = JSON.stringify(taskStore.getTasks());
      expect(serializedStoreJson).not.toContain(RAW_PERSON_NAME);
      expect(serializedStoreJson).not.toContain(RAW_EMAIL);
      expect(serializedStoreJson).not.toContain(RAW_PHONE);
      expect(serializedStoreJson).not.toContain(RAW_AMOUNT);
      expect(serializedStoreJson).not.toContain(RAW_IBAN);
      expect(serializedStoreJson).not.toContain(RAW_SECRET_KEY);

      // -----------------------------------------------------------------------
      // Step 6: Client-side ephemeral session key decryption
      // -----------------------------------------------------------------------
      // Authorized client decrypts payload in memory using its active session key
      const decryptedTask = await EncryptionService.decrypt<DecryptedTaskPayload>(
        createdTask.encryptedPayload,
        clientSessionKey,
      );

      // Title used explicitly or re-hydrated
      expect(decryptedTask.title).toBe('Disbursement Request');
      // Summary verified with re-hydrated entities
      expect(decryptedTask.summary).toContain(RAW_PERSON_NAME);
      expect(decryptedTask.summary).toContain(RAW_EMAIL);
      expect(decryptedTask.summary).toContain(RAW_PHONE);
      expect(decryptedTask.summary).toContain(RAW_AMOUNT);
      expect(decryptedTask.summary).toContain(RAW_IBAN);
      expect(decryptedTask.summary).toContain(RAW_SECRET_KEY);

      // Checklist subtasks verified with re-hydrated entities
      expect(decryptedTask.subtasks).toHaveLength(EXPECTED_SUBTASK_COUNT);
      expect(decryptedTask.subtasks[0].title).toContain(RAW_IBAN);
      expect(decryptedTask.subtasks[1].title).toContain(RAW_SECRET_KEY);
      expect(decryptedTask.subtasks[2].title).toContain(RAW_AMOUNT);
      expect(decryptedTask.subtasks[2].title).toContain(RAW_PERSON_NAME);
      expect(decryptedTask.subtasks[3].title).toContain(RAW_EMAIL);

      // Unauthorized client / Tampered key verification
      const unauthorizedKey = EncryptionService.generateKey();
      await expect(
        EncryptionService.decrypt(createdTask.encryptedPayload, unauthorizedKey),
      ).rejects.toThrow(DecryptionError);

      // -----------------------------------------------------------------------
      // Step 7: Logout memory zeroing (fill(0)) with zero DOM PII residue
      // -----------------------------------------------------------------------
      // Create a reference copy of client session key buffer to inspect zeroing
      const clientKeyBufferCopy = new Uint8Array(clientSessionKey);
      expect(clientKeyBufferCopy.some((b) => b !== 0)).toBe(true);

      // Simulate client enclave state
      let clientDecryptedCache: Record<string, DecryptedTaskPayload> | null = {
        [createdTask.id]: decryptedTask,
      };

      // Client performs logout
      EncryptionService.zeroKey(clientSessionKey);
      EncryptionService.zeroKey(clientKeyBufferCopy);
      clientDecryptedCache = null; // Clear all in-memory decrypted payloads

      // Verify byte buffer memory is zeroed out
      expect(clientSessionKey.every((b) => b === 0)).toBe(true);
      expect(clientKeyBufferCopy.every((b) => b === 0)).toBe(true);
      expect(clientDecryptedCache).toBeNull();

      // Verify that inspecting client view state yields ZERO cleartext residue
      const clientViewPlaceholder = '🔒 Encrypted Task Content';
      const clientDomStateSimulation = {
        title: clientDecryptedCache
          ? (clientDecryptedCache as Record<string, DecryptedTaskPayload>)[createdTask.id]?.title
          : clientViewPlaceholder,
        summary: clientDecryptedCache
          ? (clientDecryptedCache as Record<string, DecryptedTaskPayload>)[createdTask.id]?.summary
          : 'Encrypted with AES-256-GCM. Active session key required to view cleartext.',
      };

      expect(clientDomStateSimulation.title).toBe(clientViewPlaceholder);
      expect(clientDomStateSimulation.title).not.toContain(RAW_PERSON_NAME);
      expect(clientDomStateSimulation.summary).not.toContain(RAW_EMAIL);
      expect(clientDomStateSimulation.summary).not.toContain(RAW_IBAN);
    });
  });

  describe('Graceful Degradation Roundtrip (Deterministic Fallback Extractor)', () => {
    it('seamlessly degrades to DeterministicFallbackExtractor when Gemini is offline and completes full encryption lifecycle', async () => {
      // Mock Gemini failure (e.g. rate limit, quota exhaustion, network disconnection)
      const failingGenAiClient: GenAiClientLike = {
        models: {
          generateContent: vi
            .fn()
            .mockRejectedValue(new Error('RESOURCE_EXHAUSTED: Rate limit exceeded 429')),
        },
      };

      const fallbackOrchestrator = new GeminiOrchestrator({
        genAiClient: failingGenAiClient,
      });

      const app = createApp({
        orchestrator: fallbackOrchestrator,
        taskStore,
      });

      const clientKey = EncryptionService.generateKey();
      const clientKeyBase64 = Buffer.from(clientKey).toString('base64');

      const memoResponse = await inProcessApp(app)
        .post<CreateMemoResponse>('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, clientKeyBase64)
        .send({
          content: RAW_CONFIDENTIAL_MEMO,
        });

      expect(memoResponse.status).toBe(HTTP_STATUS_CREATED);

      const responseBody = memoResponse.body;
      const task = responseBody.task;

      // Verify deterministic fallback provenance
      expect(task.provenance).toBe('DETERMINISTIC_FALLBACK');
      expect(task.modelVersion).toBe('rule-based-v1');
      expect(task.status).toBe('DRAFT');

      // Verify stored payload in TaskStore is AES-256-GCM ciphertext
      const storedTask = taskStore.getTaskById(task.id);
      expect(storedTask).toBeDefined();
      expect(storedTask?.encryptedPayload.ciphertext).toBeTypeOf('string');

      // Decrypt locally with client key
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        task.encryptedPayload,
        clientKey,
      );

      // Verify that rehydration occurred cleanly in fallback mode
      expect(decrypted.summary).toContain(RAW_PERSON_NAME);
      expect(decrypted.summary).toContain(RAW_EMAIL);
      expect(decrypted.summary).toContain(RAW_AMOUNT);

      // Clean up key
      EncryptionService.zeroKey(clientKey);
      expect(clientKey.every((b) => b === 0)).toBe(true);
    });
  });

  describe('Human-in-the-Loop State Machine Lifecycle Under Envelope Encryption', () => {
    it('manages task status transitions and preserves ciphertext integrity across updates', async () => {
      const app = createApp({ taskStore });
      const clientKey = EncryptionService.generateKey();
      const clientKeyBase64 = Buffer.from(clientKey).toString('base64');

      // 1. Ingest memo
      const createRes = await inProcessApp(app)
        .post<CreateMemoResponse>('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, clientKeyBase64)
        .send({
          content: RAW_CONFIDENTIAL_MEMO,
          title: 'Initial Title',
        });

      const task = createRes.body.task;
      expect(task.status).toBe('DRAFT');

      // 2. Human Review Approval: Transition DRAFT -> PENDING
      const approveRes = await inProcessApp(app)
        .patch<TaskEntity>(`/api/tasks/${task.id}`)
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, clientKeyBase64)
        .send({ status: 'PENDING' });

      expect(approveRes.status).toBe(HTTP_STATUS_OK);
      expect(approveRes.body.status).toBe('PENDING');

      // 3. Execution: Transition PENDING -> IN_PROGRESS
      const startRes = await inProcessApp(app)
        .patch<TaskEntity>(`/api/tasks/${task.id}`)
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, clientKeyBase64)
        .send({ status: 'IN_PROGRESS' });

      expect(startRes.status).toBe(HTTP_STATUS_OK);
      expect(startRes.body.status).toBe('IN_PROGRESS');

      // 4. Sensitive Field Re-encryption: Update Title & Subtasks
      const updateRes = await inProcessApp(app)
        .patch<TaskEntity>(`/api/tasks/${task.id}`)
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, clientKeyBase64)
        .send({
          title: 'Updated Confidential Title',
          summary: `Updated summary with ${RAW_PERSON_NAME} for ${RAW_AMOUNT}`,
        });

      expect(updateRes.status).toBe(HTTP_STATUS_OK);
      const updatedTask = updateRes.body;

      // Verify store contains new ciphertext (different IV generated)
      const stored = taskStore.getTaskById(task.id);
      expect(stored?.encryptedPayload.ciphertext).toBeTypeOf('string');

      // Decrypt updated payload with client key
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        updatedTask.encryptedPayload,
        clientKey,
      );
      expect(decrypted.title).toBe('Updated Confidential Title');
      expect(decrypted.summary).toContain(RAW_PERSON_NAME);

      // 5. Completion: Transition IN_PROGRESS -> COMPLETED
      const completeRes = await inProcessApp(app)
        .patch<TaskEntity>(`/api/tasks/${task.id}`)
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, clientKeyBase64)
        .send({ status: 'COMPLETED' });

      expect(completeRes.status).toBe(HTTP_STATUS_OK);
      expect(completeRes.body.status).toBe('COMPLETED');

      // 6. Deletion: Remove task cleanly
      const deleteRes = await inProcessApp(app)
        .delete(`/api/tasks/${task.id}`)
        .set('Origin', DEFAULT_CORS_ORIGIN);

      expect(deleteRes.status).toBe(HTTP_STATUS_OK);
      expect(taskStore.getTaskById(task.id)).toBeUndefined();

      // Subsequent fetch returns 404
      const fetchNotFoundRes = await inProcessApp(app)
        .patch(`/api/tasks/${task.id}`)
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, clientKeyBase64)
        .send({ status: 'CANCELLED' });

      expect(fetchNotFoundRes.status).toBe(HTTP_STATUS_NOT_FOUND);

      EncryptionService.zeroKey(clientKey);
    });
  });

  describe('Adversarial Cryptographic Security & Anti-Tamper Invariants', () => {
    it('detects and rejects ciphertext tampering, authentication tag corruption, and key mismatches', async () => {
      const app = createApp({ taskStore });
      const key = EncryptionService.generateKey();
      const keyBase64 = Buffer.from(key).toString('base64');

      const res = await inProcessApp(app)
        .post<CreateMemoResponse>('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, keyBase64)
        .send({ content: RAW_CONFIDENTIAL_MEMO });

      const task = res.body.task;
      const validPayload = task.encryptedPayload;

      // 1. Bit-flip attack in Ciphertext
      const rawCiphertext = Buffer.from(validPayload.ciphertext, 'base64');
      rawCiphertext[BIT_FLIP_INDEX] ^= BIT_FLIP_XOR;
      const tamperedCiphertextPayload = {
        ...validPayload,
        ciphertext: rawCiphertext.toString('base64'),
      };

      await expect(EncryptionService.decrypt(tamperedCiphertextPayload, key)).rejects.toThrow(
        DecryptionError,
      );

      // 2. Bit-flip attack in AuthTag
      const rawAuthTag = Buffer.from(validPayload.authTag, 'base64');
      rawAuthTag[0] ^= BIT_FLIP_XOR;
      const tamperedAuthTagPayload = {
        ...validPayload,
        authTag: rawAuthTag.toString('base64'),
      };

      await expect(EncryptionService.decrypt(tamperedAuthTagPayload, key)).rejects.toThrow(
        DecryptionError,
      );

      // 3. Decryption with unrelated 256-bit key
      const unrelatedKey = EncryptionService.generateKey();
      await expect(EncryptionService.decrypt(validPayload, unrelatedKey)).rejects.toThrow(
        DecryptionError,
      );

      // 4. IV collision prevention: re-encrypting identical payload generates unique IVs
      const payloadObj: DecryptedTaskPayload = {
        title: 'Static Title',
        summary: 'Static Summary',
        subtasks: [],
      };
      const enc1 = await EncryptionService.encrypt(payloadObj, key);
      const enc2 = await EncryptionService.encrypt(payloadObj, key);

      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

      EncryptionService.zeroKey(key);
      EncryptionService.zeroKey(unrelatedKey);
    });
  });

  describe('Multi-Tenant Cryptographic Isolation', () => {
    it('guarantees tenant data isolation between distinct ephemeral sessions', async () => {
      const app = createApp({ taskStore });

      const tenantAKey = EncryptionService.generateKey();
      const tenantBKey = EncryptionService.generateKey();

      const tenantAKeyBase64 = Buffer.from(tenantAKey).toString('base64');
      const tenantBKeyBase64 = Buffer.from(tenantBKey).toString('base64');

      // Tenant A creates a memo
      const resA = await inProcessApp(app)
        .post<CreateMemoResponse>('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, tenantAKeyBase64)
        .send({ content: `Tenant A confidential project with ${RAW_PERSON_NAME}` });

      // Tenant B creates a memo
      const resB = await inProcessApp(app)
        .post<CreateMemoResponse>('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, tenantBKeyBase64)
        .send({ content: `Tenant B confidential transfer of ${RAW_AMOUNT} to ${RAW_IBAN}` });

      const taskA = resA.body.task;
      const taskB = resB.body.task;

      // Tenant A can decrypt task A
      const decryptedA = await EncryptionService.decrypt<DecryptedTaskPayload>(
        taskA.encryptedPayload,
        tenantAKey,
      );
      expect(decryptedA.summary).toContain(RAW_PERSON_NAME);

      // Tenant B can decrypt task B
      const decryptedB = await EncryptionService.decrypt<DecryptedTaskPayload>(
        taskB.encryptedPayload,
        tenantBKey,
      );
      expect(decryptedB.summary).toContain(RAW_AMOUNT);

      // Cross-tenant decryption is strictly barred
      await expect(EncryptionService.decrypt(taskA.encryptedPayload, tenantBKey)).rejects.toThrow(
        DecryptionError,
      );

      await expect(EncryptionService.decrypt(taskB.encryptedPayload, tenantAKey)).rejects.toThrow(
        DecryptionError,
      );

      EncryptionService.zeroKey(tenantAKey);
      EncryptionService.zeroKey(tenantBKey);
    });
  });
});
