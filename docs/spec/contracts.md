# OSCAR Domain & Data Contracts Specification

## 1. Overview & Mandate
This document defines the authoritative, runtime-enforced data contracts for **OSCAR**. All internal components, AI payloads, and storage entities must conform to these schemas.

Validation is strictly performed using **Zod** (`zod` v3+). These schemas serve a dual role:
1. **Application-level runtime type safety:** Validating HTTP payloads, internal messages, and database documents.
2. **AI Provider Guardrails:** Compiled directly into JSON Schemas and passed to Google Gemini's `generationConfig.responseSchema` to guarantee 100% deterministic structured outputs.

---

## 2. Common & Shared Primitives

### 2.1 Entity Identifiers (`EntityIdSchema`)
Supports both client/server UUIDv4 strings and native 20-character Firestore auto-generated document identifiers:
```typescript
import { z } from 'zod';

export const EntityIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{20,36}$/, 'Must be a valid UUIDv4 or 20-character Firestore alphanumeric ID');

export type EntityId = z.infer<typeof EntityIdSchema>;
```

### 2.2 Firestore Timestamp Coercion (`FirestoreTimestampSchema`)
Accommodates ISO 8601 strings, native JavaScript `Date` instances, and Cloud Firestore SDK `Timestamp` objects (`{ seconds: number, nanoseconds: number }`), normalizing them deterministically to standard ISO 8601 strings:
```typescript
export const FirestoreTimestampSchema = z.union([
  z.string().datetime(),
  z.date().transform(d => d.toISOString()),
  z.object({
    seconds: z.number().int().nonnegative(),
    nanoseconds: z.number().int().nonnegative()
  }).transform(ts => new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1000000)).toISOString())
]);

export type FirestoreTimestamp = z.infer<typeof FirestoreTimestampSchema>;
```

### 2.3 Client-Side AES-256-GCM Envelope Encryption (`EncryptedPayloadSchema`)
To guarantee that no cleartext personally identifiable information (PII) is ever written to Cloud Firestore, all confidential fields are encrypted in the client/trusted runtime boundary using WebCrypto AES-256-GCM prior to persistence:
```typescript
export const EncryptedPayloadSchema = z.object({
  ciphertext: z.string().min(1).describe('Base64-encoded AES-256-GCM ciphertext'),
  iv: z.string().min(1).describe('Base64-encoded 96-bit (12-byte) initialization vector'),
  authTag: z.string().min(1).describe('Base64-encoded 128-bit authentication tag'),
  keyId: z.string().default('v1').describe('Key derivation identifier for future key rotation')
});

export type EncryptedPayload = z.infer<typeof EncryptedPayloadSchema>;
```

---

## 3. Privacy Guard Contracts

### 3.1 PII TokenType & Categories
Categorizes all sensitive data types recognized by the Privacy Guard engine:
```typescript
export const PIITypeSchema = z.enum([
  'SECRET_KEY',
  'IBAN',
  'EMAIL',
  'PHONE',
  'AMOUNT_MONEY',
  'PERSON',
  'ADDRESS'
]);

export type PIIType = z.infer<typeof PIITypeSchema>;
```

#### Category Taxonomy & Sensitivity Matrix

| PII Category | Synthetic Token Format | Description & Sensitivity Classification | Overlap Weight |
| :--- | :--- | :--- | :--- |
| `SECRET_KEY` | `[SECRET_KEY_N]` | API credentials, private keys, bearer/PAT tokens. Highest criticality: immediate risk of unauthorized infrastructure access. | 60 |
| `IBAN` | `[IBAN_N]` | International Bank Account Numbers. Critical financial identifier subject to international banking confidentiality regulations. | 50 |
| `EMAIL` | `[EMAIL_N]` | Personal and corporate email addresses. Direct personal identifier subject to GDPR Art. 4(1). | 40 |
| `PHONE` | `[PHONE_N]` | International and national telephone numbers. Direct telecommunications contact identifier. | 30 |
| `AMOUNT_MONEY` | `[AMOUNT_MONEY_N]` | Transaction values, salaries, budgets, colloquial numbers (`10k zł`, `1.5 mln EUR`). Sensitive financial intelligence. | 25 |
| `PERSON` | `[PERSON_N]` | Multilingual natural person names (nominative and inflected/declined forms across EN, PL, DE, FR). Core personal identity marker. | 20 |
| `ADDRESS` | `[ADDRESS_N]` | Physical geographic locations, street addresses, avenues, and international cities/urban centers. Location data under GDPR Art. 4(1) and Recital 26/30. | 15 |

#### 3.1.1 ADDRESS Category Specification & Synthetic Token Format
- **Synthetic Token Identifier:** `[ADDRESS_INDEX]` where `INDEX` is a 1-based sequential integer (e.g., `[ADDRESS_1]`, `[ADDRESS_2]`), conforming strictly to the bracketed token regular expression `^\[[A-Z_]+_\d+\]$`.
- **Sensitivity Characteristics:** Physical location identifiers pose severe privacy risks:
  1. *Deanonymization Vector:* When combined with role or timing cues, residential or corporate physical addresses frequently facilitate re-identification of anonymous individuals.
  2. *Geolocational Profiling:* Transmission of physical venues to third-party model inference engines risks inadvertent location harvesting and unauthorized behavioral telemetry.
  3. *Physical Security:* Residential locations of remote employees, executives, or clients must never cross untrusted network boundaries.
- **Multilingual Recognition Scope:** Covers both structured street addresses (using language prefixes such as `ul.`, `al.`, `pl.`, `rue`, `Avenue`, `St.`, `Straße`) and major international urban agglomerations (e.g., `New York`, `Kassel`, `Berlin`, `Paris`, `Warsaw`, `London`, `Zurich`).

### 3.2 Token Mapping Record (`PIITokenMapSchema`)
Represents an individual token substitution stored in ephemeral request memory:
```typescript
export const PIITokenMapSchema = z.object({
  token: z
    .string()
    .regex(/^\[[A-Z_]+_\d+\]$/, 'Token must match bracketed format: [TYPE_INDEX]'),
  type: PIITypeSchema,
  originalValue: z.string().min(1, 'Original value cannot be empty'),
  startIndex: z.number().int().nonnegative('Start index must be >= 0'),
  endIndex: z.number().int().positive('End index must be > 0')
});

export type PIITokenMap = z.infer<typeof PIITokenMapSchema>;
```

### 3.3 Sanitization Result Contract (`SanitizationResultSchema`)
The complete result output returned by `PrivacyGuard.mask(rawText)`:
```typescript
export const RiskLevelSchema = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const SanitizationResultSchema = z.object({
  sanitizedText: z.string().describe('Text with all detected PII replaced with synthetic tokens'),
  tokenCount: z.number().int().nonnegative().describe('Total number of replaced PII occurrences'),
  tokens: z.array(PIITokenMapSchema).describe('Ephemeral mapping dictionary for re-hydration'),
  timestamp: z.string().datetime().describe('ISO 8601 timestamp of masking operation'),
  riskLevel: RiskLevelSchema.describe('Calculated privacy risk score based on token density and sensitivity')
});

export type SanitizationResult = z.infer<typeof SanitizationResultSchema>;

/**
 * Ergonomic Adapter Note:
 * The `rehydrate<T>()` engine accepts either `Map<string, string>` or directly `PIITokenMap[]`
 * (as delivered in `SanitizationResult.tokens`), automatically constructing the lookup map
 * when an array is passed to ensure developer ergonomics without manual boilerplate.
 */
```

---

## 4. AI Extraction & Task Contracts (Gemini Structured Outputs)

### 4.1 Task Priority, Category & Status Enums
Standardized taxonomies for task management and organization. In alignment with **EU AI Act Articles 13 & 14 (Human Oversight)**, all newly extracted tasks default to `'DRAFT'`, requiring user review before entering active status (`'PENDING'`):
```typescript
export const TaskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskCategorySchema = z.enum([
  'WORK',
  'INTERVIEW_PREP',
  'FINANCE',
  'PERSONAL',
  'HEALTH',
  'OTHER'
]);
export type TaskCategory = z.infer<typeof TaskCategorySchema>;

export const TaskStatusSchema = z.enum([
  'DRAFT',        // Initial state for all AI-generated tasks (awaits human confirmation)
  'PENDING',      // Confirmed active task
  'IN_PROGRESS',  // Under active execution
  'COMPLETED',    // Fulfilled
  'CANCELLED'     // Dismissed
]).default('DRAFT');
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const AIProvenanceSchema = z.enum(['GEMINI_FLASH', 'DETERMINISTIC_FALLBACK']);
export type AIProvenance = z.infer<typeof AIProvenanceSchema>;
```

### 4.2 AI Structured Response Contract (`ExtractedTaskSchema`)
This schema defines the exact structure expected from Google Gemini inference. It is converted into a standard JSON Schema object and assigned to `generationConfig.responseSchema`:
```typescript
export const SubtaskItemSchema = z.object({
  title: z.string().min(1).max(200).describe('Concise, actionable subtask checklist item'),
  completed: z.boolean().default(false).describe('Initial completion state, defaults to false')
});

export type SubtaskItem = z.infer<typeof SubtaskItemSchema>;

export const ExtractedTaskSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(120)
    .describe('Concise, action-oriented title summarizing the user memo'),
  summary: z
    .string()
    .min(5)
    .max(500)
    .describe('One or two sentence summary detailing the core objective and context'),
  category: TaskCategorySchema.describe('Best matching category from the predefined taxonomy'),
  priority: TaskPrioritySchema.describe('Urgency level inferred from deadlines, keywords, and tone'),
  scheduledDate: z
    .string()
    .nullable()
    .describe('ISO 8601 formatted date/time string if a scheduled time or deadline is detected, otherwise null'),
  tags: z
    .array(z.string().min(1).max(30))
    .max(8)
    .describe('Relevant contextual tags for filtering and indexing (e.g., ["project", "operations", "budget"])'),
  subtasks: z
    .array(SubtaskItemSchema)
    .min(1)
    .max(10)
    .describe('Decomposed actionable checklist steps extracted from the memo')
});

export type ExtractedTask = z.infer<typeof ExtractedTaskSchema>;
```

#### Gemini API OpenAPI JSON Schema Representation:
When passed to `@google/genai`, the Zod schema compiles to this exact OpenAPI 3.0-compliant subset. Every field including `"scheduledDate"` is listed in `"required"` (with `"nullable": true`), and boundary constraints (`minLength`, `maxLength`, `minItems`, `maxItems`) match `ExtractedTaskSchema` 1:1:
```json
{
  "type": "OBJECT",
  "properties": {
    "title": { "type": "STRING", "minLength": 3, "maxLength": 120 },
    "summary": { "type": "STRING", "minLength": 5, "maxLength": 500 },
    "category": {
      "type": "STRING",
      "enum": ["WORK", "INTERVIEW_PREP", "FINANCE", "PERSONAL", "HEALTH", "OTHER"]
    },
    "priority": {
      "type": "STRING",
      "enum": ["LOW", "MEDIUM", "HIGH", "URGENT"]
    },
    "scheduledDate": { "type": "STRING", "nullable": true },
    "tags": {
      "type": "ARRAY",
      "items": { "type": "STRING", "minLength": 1, "maxLength": 30 },
      "maxItems": 8
    },
    "subtasks": {
      "type": "ARRAY",
      "minItems": 1,
      "maxItems": 10,
      "items": {
        "type": "OBJECT",
        "properties": {
          "title": { "type": "STRING", "minLength": 1, "maxLength": 200 },
          "completed": { "type": "BOOLEAN" }
        },
        "required": ["title", "completed"]
      }
    }
  },
  "required": ["title", "summary", "category", "priority", "scheduledDate", "tags", "subtasks"]
}
```

---

## 5. Storage & Persistence Contracts (Firebase Firestore)

### 5.1 Memo Entity (`MemoEntitySchema`)
Stored in the `memos` collection. To prevent PII leakage to the database, `rawContent` is **never stored in cleartext**—it is encrypted at rest using AES-256-GCM via `encryptedPayload`:
```typescript
export const MemoEntitySchema = z.object({
  id: EntityIdSchema.describe('Unique document identifier (UUIDv4 or Firestore ID)'),
  userId: EntityIdSchema.describe('Owner user identifier'),
  encryptedPayload: EncryptedPayloadSchema.describe('AES-256-GCM ciphertext containing unmasked memo content'),
  sanitizedContentPreview: z.string().describe('Redacted preview safe for client-side listing (contains only synthetic tokens)'),
  hasPII: z.boolean().describe('Flag indicating if any sensitive tokens were detected and masked'),
  maskedFieldsCount: z.number().int().nonnegative().describe('Total number of masked tokens'),
  createdAt: FirestoreTimestampSchema.describe('Creation timestamp'),
  updatedAt: FirestoreTimestampSchema.describe('Last update timestamp')
});

export type MemoEntity = z.infer<typeof MemoEntitySchema>;
```

### 5.2 Task Entities (Domain vs. Persisted Representation)

#### A. In-Memory Decrypted Task (`DecryptedTaskPayloadSchema`)
Used in the frontend application state after local client-side decryption of the `encryptedPayload`.

> [!NOTE]
> **Post-Rehydration Bounds Expansion:**
> AI model inference produces structured output constrained by `ExtractedTaskSchema` (e.g., 120 chars for `title`, 500 chars for `summary`, 200 chars for subtasks) while containing compact synthetic tokens (e.g., `[PERSON_1]`, `[AMOUNT_MONEY_1]`). During atomic re-hydration, tokens are replaced with cleartext values (such as lengthy full names, compound email addresses, or formatted monetary amounts), expanding the overall character count. The decrypted schema relaxes these upper bounds (`title` to 250, `summary` to 1000, and `subtasks.title` to 400) to safely absorb expansion without validation errors.

```typescript
export const DecryptedSubtaskItemSchema = z.object({
  title: z.string().min(1).max(400).describe('Actionable subtask title with re-hydrated cleartext (expanded bound)'),
  completed: z.boolean().default(false)
});

export type DecryptedSubtaskItem = z.infer<typeof DecryptedSubtaskItemSchema>;

export const DecryptedTaskPayloadSchema = z.object({
  title: z.string().min(3).max(250).describe('Re-hydrated title accommodating token expansion beyond 120 chars'),
  summary: z.string().min(5).max(1000).describe('Re-hydrated summary accommodating token expansion beyond 500 chars'),
  subtasks: z.array(DecryptedSubtaskItemSchema).min(1).max(10).describe('Checklist with re-hydrated cleartext items')
});

export type DecryptedTaskPayload = z.infer<typeof DecryptedTaskPayloadSchema>;
```

#### B. Persisted Task Document (`TaskEntitySchema`)
Stored in the `tasks` collection. Sensitive fields (`title`, `summary`, `subtasks`) are envelope-encrypted in `encryptedPayload`, while non-PII queryable metadata remains unencrypted for database indexing and real-time reactive filtering:
```typescript
export const TaskEntitySchema = z.object({
  id: EntityIdSchema.describe('Unique document identifier (UUIDv4 or Firestore ID)'),
  memoId: EntityIdSchema.describe('Foreign key reference linking to source MemoEntity'),
  userId: EntityIdSchema.describe('Owner user identifier'),
  encryptedPayload: EncryptedPayloadSchema.describe('AES-256-GCM ciphertext of { title, summary, subtasks }'),
  category: TaskCategorySchema.describe('Non-PII queryable category'),
  priority: TaskPrioritySchema.describe('Non-PII queryable urgency level'),
  status: TaskStatusSchema.describe('Workflow state, defaults to DRAFT for human review'),
  scheduledDate: z.string().nullable().describe('ISO 8601 scheduled date or null'),
  tags: z.array(z.string().min(1).max(30)).max(8).describe('Contextual index tags (sanitized)'),
  provenance: AIProvenanceSchema.describe('Inference engine provenance (GEMINI_FLASH or DETERMINISTIC_FALLBACK)'),
  modelVersion: z.string().min(1).describe('Model or rule version identifier (e.g. "gemini-2.5-flash-001" or "fallback-v1")'),
  createdAt: FirestoreTimestampSchema.describe('Creation timestamp'),
  updatedAt: FirestoreTimestampSchema.describe('Last update timestamp')
});

export type TaskEntity = z.infer<typeof TaskEntitySchema>;
```

---

## 6. Privacy Audit Log Contract (`PrivacyAuditLogSchema`)
Stored in the `privacy_audit_logs` collection. **Zero-PII Compliance Rule**: This collection records telemetry and compliance proofs, but NEVER contains actual cleartext sensitive data, decrypted payloads, or token mappings:
```typescript
export const PrivacyAuditLogSchema = z.object({
  id: EntityIdSchema.describe('Unique audit record identifier'),
  userId: EntityIdSchema.describe('Anonymized user reference'),
  action: z.enum([
    'MASK_SUCCESS',
    'UNMASK_SUCCESS',
    'ENCRYPTION_SUCCESS',
    'VALIDATION_FAILURE',
    'FALLBACK_TRIGGERED'
  ]),
  detectedTypes: z.array(PIITypeSchema).describe('List of PII categories identified in the payload'),
  tokenCount: z.number().int().nonnegative().describe('Number of sensitive items sanitized'),
  riskLevel: RiskLevelSchema.describe('Calculated risk evaluation at inference time'),
  durationMs: z.number().nonnegative().describe('Processing latency in milliseconds'),
  timestamp: FirestoreTimestampSchema.describe('Audit timestamp')
});

export type PrivacyAuditLog = z.infer<typeof PrivacyAuditLogSchema>;
```

---

## 7. Schema Validation & Safe Parsing Helper

To ensure robust error handling without throwing uncaught runtime exceptions, domain services invoke standard safe-parsing wrappers:

```typescript
export function validateContract<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}
```
