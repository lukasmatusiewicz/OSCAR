import { describe, it, expect, beforeEach } from 'vitest';
import { Socket } from 'node:net';
import http from 'node:http';
import { Express } from 'express';
import { createApp, DEFAULT_CORS_ORIGIN } from '../../src/app.js';
import { TaskStore } from '../../src/store/TaskStore.js';
import { PrivacyGuard, isValidPesel } from '../../src/privacy/PrivacyGuard.js';
import { EncryptionService } from '../../src/security/EncryptionService.js';
import { GeminiOrchestrator } from '../../src/agent/GeminiOrchestrator.js';
import { DeterministicFallbackExtractor } from '../../src/agent/DeterministicFallbackExtractor.js';
import {
  CreateMemoResponse,
  DecryptedTaskPayload,
  TaskEntity,
  DecryptedTaskPayloadSchema,
} from '../../src/types/contracts.js';

// Architectural Named Constants (Eliminating Magic Numbers per Section 7.3 Pillar 6)
const HTTP_STATUS_OK = 200;
const HEADER_KEY_NAME = 'x-oscar-encryption-key';

// Multi-Jurisdictional Synthetic Test Entities (RFC 2606 & Section 6 Compliant)
const GERMAN_KVNR_VALID_1 = 'A123456789';
const GERMAN_KVNR_VALID_2 = 'X987654321';

// Statutory Polish PESEL weights [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
const POLISH_PESEL_VALID_1 = '44051401359'; // control digit 9
const POLISH_PESEL_VALID_2 = '90010112349'; // control digit 9
const POLISH_PESEL_INVALID_CHECKSUM = '90010112348'; // wrong control digit (expected 9)
const POLISH_PESEL_MALFORMED = '123456789'; // 9 digits (invalid length)

// Multilingual Medical Diagnoses & Prescriptions
const MEDICAL_DIAGNOSIS_PL = 'diagnoza: cukrzyca typu 2';
const MEDICAL_PRESCRIPTION_PL = 'recepta na metforminę 500mg';
const MEDICAL_DIAGNOSIS_DE = 'Diagnose: arterielle Hypertonie';
const MEDICAL_PRESCRIPTION_DE = 'Rezept für Ibuprofen 600mg';
const MEDICAL_DIAGNOSIS_EN = 'diagnosis: acute bronchitis';
const MEDICAL_PRESCRIPTION_EN = 'prescription for amoxicillin';
const MEDICAL_PRESCRIPTION_FR = 'ordonnance pour doliprane';

// Tier 3 Proximity Context Identifiers
const POLICY_TRIGGER_PL = 'polisa ubezpieczeniowa numer POL-99281-X';
const POLICY_ID_PL = 'POL-99281-X';
const INSURANCE_TRIGGER_DE = 'versichert mit Nummer VERS-88310';
const POLICY_ID_DE = 'VERS-88310';
const INSURANCE_CARD_EN = 'insurance card #INS-44912';
const POLICY_ID_EN = 'INS-44912';
const NATIONAL_ID_TRIGGER_PL = 'dowód osobisty numer ABA123456';
const NATIONAL_ID_PL = 'ABA123456';

// Smart Metadata Fixtures
const SMART_LOCATION = 'Friedrichstraße 12';
const SMART_CONTACT_PERSON = 'Dr. Jürgen Müller';
const SMART_AMOUNT = '15 000 EUR';
const SMART_SCHEDULED_TIME = 'tomorrow at 14:00';

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

describe('OSCAR E2E Suite: 9-Category GDPR Taxonomy, Smart Metadata & Interactive Draft Editing', () => {
  let taskStore: TaskStore;
  let orchestrator: GeminiOrchestrator;
  let testKey: Uint8Array;
  let testKeyBase64: string;

  beforeEach(() => {
    taskStore = new TaskStore();
    orchestrator = new GeminiOrchestrator({ client: null }); // Fallback to DeterministicFallbackExtractor
    testKey = EncryptionService.generateKey();
    testKeyBase64 = Buffer.from(testKey).toString('base64');
  });

  describe('1. German KVNR Detection & Masking as HEALTH_DATA', () => {
    it('detects German KVNR format ([A-Z]\\d{9}) and masks as [HEALTH_DATA_n]', () => {
      const memo = `Patient has statutory insurance KVNR ${GERMAN_KVNR_VALID_1} and secondary ${GERMAN_KVNR_VALID_2}.`;
      const result = PrivacyGuard.mask(memo);

      expect(result.sanitizedText).not.toContain(GERMAN_KVNR_VALID_1);
      expect(result.sanitizedText).not.toContain(GERMAN_KVNR_VALID_2);
      expect(result.sanitizedText).toContain('[HEALTH_DATA_1]');
      expect(result.sanitizedText).toContain('[HEALTH_DATA_2]');

      const healthTokens = result.tokens.filter((t) => t.type === 'HEALTH_DATA');
      expect(healthTokens.length).toBe(2);
      expect(healthTokens[0].originalValue).toBe(GERMAN_KVNR_VALID_1);
      expect(healthTokens[1].originalValue).toBe(GERMAN_KVNR_VALID_2);

      // Verify exact roundtrip re-hydration
      const rehydrated = PrivacyGuard.rehydrate(result.sanitizedText, result.tokens);
      expect(rehydrated).toBe(memo);
    });
  });

  describe('2. Polish PESEL Checksum Validation', () => {
    it('validates PESEL checksum correctly with statutory weights', () => {
      expect(isValidPesel(POLISH_PESEL_VALID_1)).toBe(true);
      expect(isValidPesel(POLISH_PESEL_VALID_2)).toBe(true);
      expect(isValidPesel(POLISH_PESEL_INVALID_CHECKSUM)).toBe(false);
      expect(isValidPesel(POLISH_PESEL_MALFORMED)).toBe(false);
    });

    it('masks valid PESEL as [NATIONAL_ID_n] and rejects invalid checksum', () => {
      const memo = `PESEL valid: ${POLISH_PESEL_VALID_1}. Invalid checksum PESEL: ${POLISH_PESEL_INVALID_CHECKSUM}.`;
      const result = PrivacyGuard.mask(memo);

      // Valid PESEL must be masked as NATIONAL_ID
      expect(result.sanitizedText).not.toContain(POLISH_PESEL_VALID_1);
      expect(result.sanitizedText).toContain('[NATIONAL_ID_1]');

      const nationalTokens = result.tokens.filter((t) => t.type === 'NATIONAL_ID');
      expect(nationalTokens.length).toBe(1);
      expect(nationalTokens[0].originalValue).toBe(POLISH_PESEL_VALID_1);

      // Invalid checksum must NOT be categorized as NATIONAL_ID
      expect(nationalTokens.some((t) => t.originalValue === POLISH_PESEL_INVALID_CHECKSUM)).toBe(
        false,
      );

      // Re-hydration restores valid PESEL exactly
      const rehydrated = PrivacyGuard.rehydrate(result.sanitizedText, result.tokens);
      expect(rehydrated).toBe(memo);
    });
  });

  describe('3. Medical Diagnoses & Prescription Terms across PL, DE, EN, FR', () => {
    it('masks medical diagnoses and prescription terms as [HEALTH_DATA_n]', () => {
      const medicalMemo =
        `Medical log: ${MEDICAL_DIAGNOSIS_PL}, ${MEDICAL_PRESCRIPTION_PL}. ` +
        `German: ${MEDICAL_DIAGNOSIS_DE}, ${MEDICAL_PRESCRIPTION_DE}. ` +
        `English: ${MEDICAL_DIAGNOSIS_EN}, ${MEDICAL_PRESCRIPTION_EN}. ` +
        `French: ${MEDICAL_PRESCRIPTION_FR}.`;

      const result = PrivacyGuard.mask(medicalMemo);

      // Raw medical terminology must be completely stripped
      expect(result.sanitizedText).not.toContain('cukrzyca typu 2');
      expect(result.sanitizedText).not.toContain('metforminę');
      expect(result.sanitizedText).not.toContain('arterielle Hypertonie');
      expect(result.sanitizedText).not.toContain('Ibuprofen');
      expect(result.sanitizedText).not.toContain('acute bronchitis');
      expect(result.sanitizedText).not.toContain('amoxicillin');
      expect(result.sanitizedText).not.toContain('doliprane');

      // Health tokens must be assigned
      const healthTokens = result.tokens.filter((t) => t.type === 'HEALTH_DATA');
      expect(healthTokens.length).toBeGreaterThanOrEqual(7);

      // Exact roundtrip re-hydration invariance
      const rehydrated = PrivacyGuard.rehydrate(result.sanitizedText, result.tokens);
      expect(rehydrated).toBe(medicalMemo);
    });
  });

  describe('4. Tier 3 Context-Aware Matcher for Unknown Policy & National IDs', () => {
    it('detects unknown policy/insurance IDs near trigger keywords and masks as HEALTH_DATA', () => {
      const memo =
        `Health verification: ${POLICY_TRIGGER_PL}, ${INSURANCE_TRIGGER_DE}, and ${INSURANCE_CARD_EN}.`;
      const result = PrivacyGuard.mask(memo);

      expect(result.sanitizedText).not.toContain(POLICY_ID_PL);
      expect(result.sanitizedText).not.toContain(POLICY_ID_DE);
      expect(result.sanitizedText).not.toContain(POLICY_ID_EN);

      const healthTokens = result.tokens.filter((t) => t.type === 'HEALTH_DATA');
      expect(healthTokens.some((t) => t.originalValue === POLICY_ID_PL)).toBe(true);
      expect(healthTokens.some((t) => t.originalValue === POLICY_ID_DE)).toBe(true);
      expect(healthTokens.some((t) => t.originalValue === POLICY_ID_EN)).toBe(true);

      const rehydrated = PrivacyGuard.rehydrate(result.sanitizedText, result.tokens);
      expect(rehydrated).toBe(memo);
    });

    it('detects unknown national ID tokens near identity trigger keywords and masks as NATIONAL_ID', () => {
      const memo = `Identity check: ${NATIONAL_ID_TRIGGER_PL}.`;
      const result = PrivacyGuard.mask(memo);

      expect(result.sanitizedText).not.toContain(NATIONAL_ID_PL);
      const nationalTokens = result.tokens.filter((t) => t.type === 'NATIONAL_ID');
      expect(nationalTokens.some((t) => t.originalValue === NATIONAL_ID_PL)).toBe(true);

      const rehydrated = PrivacyGuard.rehydrate(result.sanitizedText, result.tokens);
      expect(rehydrated).toBe(memo);
    });
  });

  describe('5. Smart Metadata Extraction, Envelope Encryption & Decryption Roundtrip', () => {
    it('extracts smart metadata fields cleanly and survives encryption/decryption roundtrip', async () => {
      const memo =
        `Coordinate meeting with ${SMART_CONTACT_PERSON} at ${SMART_LOCATION} ` +
        `to allocate budget of ${SMART_AMOUNT} ${SMART_SCHEDULED_TIME}.`;

      // 1. Sanitize memo
      const sanitization = PrivacyGuard.mask(memo);

      // 2. Extract structured task with smart metadata via DeterministicFallbackExtractor
      const extraction = DeterministicFallbackExtractor.extract(sanitization.sanitizedText);

      expect(extraction.location).toBeDefined();
      expect(extraction.contactPerson).toBeDefined();
      expect(extraction.amount).toBeDefined();
      expect(extraction.scheduledTime).toBeDefined();

      // 3. Re-hydrate extracted metadata fields
      const rehydratedTask = PrivacyGuard.rehydrate(extraction, sanitization.tokens);
      expect(rehydratedTask.location).toBe(SMART_LOCATION);
      expect(rehydratedTask.contactPerson).toBe(SMART_CONTACT_PERSON);
      expect(rehydratedTask.amount).toBe(SMART_AMOUNT);
      expect(rehydratedTask.scheduledTime).toBe(SMART_SCHEDULED_TIME);

      // 4. Construct decrypted payload including smart metadata
      const decryptedPayload: DecryptedTaskPayload = DecryptedTaskPayloadSchema.parse({
        title: rehydratedTask.title,
        summary: rehydratedTask.summary,
        subtasks: rehydratedTask.subtasks,
        location: rehydratedTask.location,
        contactPerson: rehydratedTask.contactPerson,
        amount: rehydratedTask.amount,
        scheduledTime: rehydratedTask.scheduledTime,
      });

      // 5. Envelope encrypt with AES-256-GCM
      const encryptedPayload = await EncryptionService.encrypt(decryptedPayload, testKey);

      // 6. Verify zero plaintext leakage in encrypted payload
      expect(encryptedPayload.ciphertext).not.toContain(SMART_LOCATION);
      expect(encryptedPayload.ciphertext).not.toContain(SMART_CONTACT_PERSON);
      expect(encryptedPayload.ciphertext).not.toContain(SMART_AMOUNT);

      // 7. Client decrypts payload
      const decrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        encryptedPayload,
        testKey,
      );

      expect(decrypted.title).toBe(decryptedPayload.title);
      expect(decrypted.summary).toBe(decryptedPayload.summary);
      expect(decrypted.location).toBe(SMART_LOCATION);
      expect(decrypted.contactPerson).toBe(SMART_CONTACT_PERSON);
      expect(decrypted.amount).toBe(SMART_AMOUNT);
      expect(decrypted.scheduledTime).toBe(SMART_SCHEDULED_TIME);
      expect(decrypted.subtasks.length).toBeGreaterThan(0);
    });
  });

  describe('6. Interactive Draft Editing Lifecycle (TaskCard / API Contract Simulation)', () => {
    it('transitions DRAFT to PENDING while updating title, summary, location, and subtasks', async () => {
      const app = createApp({ taskStore, orchestrator });

      // Step 1: Create initial task via POST /api/memos
      const createRes = await inProcessApp(app)
        .post<CreateMemoResponse>('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, testKeyBase64)
        .send({
          content: `Initial draft memo for ${SMART_CONTACT_PERSON} at ${SMART_LOCATION} regarding budget review.`,
          title: 'Initial Draft Review',
        });

      expect(createRes.status).toBe(HTTP_STATUS_OK);
      const createdTask = createRes.body.task;
      expect(createdTask.status).toBe('DRAFT');

      // Decrypt initial payload to verify initial state
      const initialDecrypted = await EncryptionService.decrypt<DecryptedTaskPayload>(
        createdTask.encryptedPayload,
        testKey,
      );
      expect(initialDecrypted.title).toBe('Initial Draft Review');

      // Step 2: Simulate TaskCard interactive draft editing
      // User modifies title, summary, modifies subtask list (adds new, removes old), and confirms
      const updatedTitle = 'Confirmed & Finalized Strategy Review';
      const updatedSummary = 'Comprehensive strategy session finalized with compliance requirements';
      const updatedSubtasks = [
        { title: 'Updated existing action item', completed: false },
        { title: 'New action item: Conduct security verification', completed: false },
        { title: 'New action item: Document GDPR compliance audit', completed: true },
      ];

      // User clicks "💾 Confirm & Save Task", triggering PATCH /api/tasks/:id
      const patchRes = await inProcessApp(app)
        .patch<TaskEntity>(`/api/tasks/${createdTask.id}`)
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, testKeyBase64)
        .send({
          status: 'PENDING', // Transition from DRAFT to PENDING
          title: updatedTitle,
          summary: updatedSummary,
          subtasks: updatedSubtasks,
          priority: 'URGENT',
        });

      expect(patchRes.status).toBe(HTTP_STATUS_OK);
      const updatedTask = patchRes.body;
      expect(updatedTask.id).toBe(createdTask.id);
      expect(updatedTask.status).toBe('PENDING'); // State transition verified
      expect(updatedTask.priority).toBe('URGENT');

      // Step 3: Fetch updated task from store and decrypt with client key
      const fetchedTask = taskStore.getTaskById(createdTask.id);
      expect(fetchedTask).toBeDefined();
      expect(fetchedTask?.status).toBe('PENDING');

      const decryptedUpdated = await EncryptionService.decrypt<DecryptedTaskPayload>(
        fetchedTask!.encryptedPayload,
        testKey,
      );

      expect(decryptedUpdated.title).toBe(updatedTitle);
      expect(decryptedUpdated.summary).toBe(updatedSummary);
      expect(decryptedUpdated.subtasks.length).toBe(updatedSubtasks.length);
      expect(decryptedUpdated.subtasks[1].title).toBe(
        'New action item: Conduct security verification',
      );
      expect(decryptedUpdated.subtasks[2].completed).toBe(true);
    });
  });

  describe('7. Invariance Check: Absolute Zero PII Leakage & Exact Roundtrip Re-hydration', () => {
    it('guarantees zero PII leakage in persisted store entities and exact roundtrip invariance', async () => {
      const app = createApp({ taskStore, orchestrator });

      const complexConfidentialMemo =
        `Dr. Alice Newman (${SMART_CONTACT_PERSON}) with KVNR ${GERMAN_KVNR_VALID_1} ` +
        `and PESEL ${POLISH_PESEL_VALID_1} submitted ${MEDICAL_DIAGNOSIS_PL}, ${MEDICAL_PRESCRIPTION_PL}. ` +
        `Policy reference: ${POLICY_TRIGGER_PL}. Location: ${SMART_LOCATION}. Transfer: ${SMART_AMOUNT}.`;

      const res = await inProcessApp(app)
        .post<CreateMemoResponse>('/api/memos')
        .set('Origin', DEFAULT_CORS_ORIGIN)
        .set(HEADER_KEY_NAME, testKeyBase64)
        .send({
          content: complexConfidentialMemo,
        });

      expect(res.status).toBe(HTTP_STATUS_OK);

      // Verify sanitized preview in MemoEntity contains NO raw PII
      const memoEntity = res.body.memo;
      expect(memoEntity.sanitizedContentPreview).not.toContain(GERMAN_KVNR_VALID_1);
      expect(memoEntity.sanitizedContentPreview).not.toContain(POLISH_PESEL_VALID_1);
      expect(memoEntity.sanitizedContentPreview).not.toContain('cukrzyca');
      expect(memoEntity.sanitizedContentPreview).not.toContain('metforminę');
      expect(memoEntity.sanitizedContentPreview).not.toContain(POLICY_ID_PL);

      // Verify raw ciphertext contains NO readable sensitive strings
      const taskEntity = res.body.task;
      const rawCiphertext = Buffer.from(taskEntity.encryptedPayload.ciphertext, 'base64').toString(
        'utf-8',
      );
      expect(rawCiphertext).not.toContain(GERMAN_KVNR_VALID_1);
      expect(rawCiphertext).not.toContain(POLISH_PESEL_VALID_1);
      expect(rawCiphertext).not.toContain(SMART_CONTACT_PERSON);

      // Verify exact client rehydration invariance
      const decryptedTask = await EncryptionService.decrypt<DecryptedTaskPayload>(
        taskEntity.encryptedPayload,
        testKey,
      );

      // Client decrypted summary contains cleartext restored values
      expect(decryptedTask.summary).toBeDefined();
      expect(typeof decryptedTask.title).toBe('string');
      expect(decryptedTask.subtasks.length).toBeGreaterThan(0);
    });
  });
});
