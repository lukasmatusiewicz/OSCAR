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
  'ADDRESS',
  'HEALTH_DATA',
  'NATIONAL_ID',
]);

export type PIIType = z.infer<typeof PIITypeSchema>;
```

#### Category Taxonomy & Sensitivity Matrix (9 GDPR Categories)

| PII Category | Synthetic Token Format | Description & Sensitivity Classification | Overlap Weight |
| :--- | :--- | :--- | :--- |
| `SECRET_KEY` | `[SECRET_KEY_N]` | API credentials, private keys, bearer/PAT tokens. Highest criticality: immediate risk of unauthorized infrastructure access. | 60 |
| `IBAN` | `[IBAN_N]` | International Bank Account Numbers. Critical financial identifier subject to international banking confidentiality regulations. | 50 |
| `NATIONAL_ID` | `[NATIONAL_ID_N]` | National citizen identification numbers: Polish PESEL (11 digits with checksum algorithm), German Steuer-ID / IdNr (11 digits), and US SSN (`\d{3}-\d{2}-\d{4}`). Critical government-issued identifier subject to strict statutory privacy protections. | 45 |
| `HEALTH_DATA` | `[HEALTH_DATA_N]` | Special category personal data under GDPR Art. 9: German health insurance numbers (KVNR `[A-Z]\d{9}`), medical diagnoses, physician/clinic references, treatment protocols, and context card identifiers. | 40 |
| `EMAIL` | `[EMAIL_N]` | Personal and corporate email addresses. Direct personal identifier subject to GDPR Art. 4(1). | 35 |
| `PHONE` | `[PHONE_N]` | International and national telephone numbers. Direct telecommunications contact identifier. | 30 |
| `AMOUNT_MONEY` | `[AMOUNT_MONEY_N]` | Transaction values, salaries, budgets, colloquial numbers (`10k zł`, `1.5 mln EUR`). Sensitive financial intelligence. | 25 |
| `PERSON` | `[PERSON_N]` | Multilingual natural person names (nominative and inflected/declined forms across EN, PL, DE, FR). Core personal identity marker. | 20 |
| `ADDRESS` | `[ADDRESS_N]` | Physical geographic locations, street addresses, avenues, and international cities/urban centers. Location data under GDPR Art. 4(1) and Recital 26/30. | 15 |

#### 3.1.1 Deterministic 3-Tier Architecture Overview
Privacy Guard executes a deterministic algorithmic + regex NER pipeline before any text leaves the local machine:
- **Tier 1: High-Entropy Mathematical & Checksum Regexes:** Deterministic matching for structured tokens (`SECRET_KEY`, `IBAN` with mod-97 verification, `NATIONAL_ID` with PESEL checksum $\sum w_i d_i \pmod{10}$, German Steuer-ID, US SSN, `HEALTH_DATA` German KVNR `[A-Z]\d{9}`, `EMAIL` RFC 5322, `PHONE` E.164).
- **Tier 2: Deterministic Linguistic & Morphological NER:** Algorithmic + regex NER with multilingual (PL/DE/EN) morphological lemmatization (`LinguisticNormalizer`), contextual action anchors, honorifics, and address/city lexicons for `PERSON`, `ADDRESS`, and `AMOUNT_MONEY`. An optional Tier-2 ML extension point (`maskAsync`, currently unused in production routes) falls back gracefully to the deterministic engine if unavailable.
- **Tier 3: Context-Aware Generic Matcher:** Scans for 6–16 alphanumeric candidate characters in proximity ($\pm 30$ characters) to multilingual trigger words (*karta*, *numer*, *polisa*, *ubezpieczenie*, *versichert*, *card*, *policy*) to mask unformatted insurance and policy IDs under `HEALTH_DATA` or `NATIONAL_ID`.

#### 3.1.2 NATIONAL_ID Category Specification
- **Synthetic Token Identifier:** `[NATIONAL_ID_INDEX]` where `INDEX` is 1-based sequential integer.
- **Scope & Validation:**
  - Polish PESEL: 11-digit national identity number with strict checksum validation using weights $[1, 3, 7, 9, 1, 3, 7, 9, 1, 3]$.
  - German Steuer-ID (IdNr): 11-digit tax identifier with structural digit distribution check.
  - US Social Security Number (SSN): `\b\d{3}-\d{2}-\d{4}\b`.
- **Confidentiality Classification:** Severe. Disclosure can lead to identity theft and regulatory sanctions.

#### 3.1.3 HEALTH_DATA Category Specification
- **Synthetic Token Identifier:** `[HEALTH_DATA_INDEX]` where `INDEX` is 1-based sequential integer.
- **Scope & Compliance:**
  - Governed under **GDPR Article 9 ("Processing of special categories of personal data")** which strictly prohibits unauthorized processing and third-party transmission.
  - German Krankenversichertennummer (KVNR): Format `[A-Z]\d{9}` (1 uppercase letter followed by 9 digits with checksum validation).
  - Medical diagnoses, treatments, therapy protocols, and clinician references identified via Tier 2 deterministic linguistic NER or Tier 3 contextual trigger matching.

#### 3.1.4 ADDRESS Category Specification & Synthetic Token Format
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
    .describe('Decomposed actionable checklist steps extracted from the memo'),
  location: z
    .string()
    .nullable()
    .optional()
    .describe('Extracted physical location, meeting venue, or city'),
  contactPerson: z
    .string()
    .nullable()
    .optional()
    .describe('Primary person of contact or counterparty'),
  amount: z
    .string()
    .nullable()
    .optional()
    .describe('Associated financial budget or invoice amount'),
  scheduledTime: z
    .string()
    .nullable()
    .optional()
    .describe('Colloquial or explicit time specification')
});

export type ExtractedTask = z.infer<typeof ExtractedTaskSchema>;
```

#### Gemini API OpenAPI JSON Schema Representation:
When passed to `@google/genai`, the Zod schema compiles to this exact OpenAPI 3.0-compliant subset. Every core field is listed in `"required"`, and smart metadata fields are typed with `"nullable": true`:
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
    },
    "location": { "type": "STRING", "nullable": true },
    "contactPerson": { "type": "STRING", "nullable": true },
    "amount": { "type": "STRING", "nullable": true },
    "scheduledTime": { "type": "STRING", "nullable": true }
  },
  "required": ["title", "summary", "category", "priority", "scheduledDate", "tags", "subtasks"]
}
```

### 4.3 Smart Task Metadata & Synthesized Semantic Title Invariant

To ensure consistent high quality and utility of extracted tasks, the inference pipeline enforces three fundamental invariants:

1. **Synthesized Semantic Title Invariant:**
   - The model must NEVER produce a title that is a raw, mechanical substring or naive truncation of the user memo (e.g., "Hi Lukas, please remind me to...").
   - The title must ALWAYS be an active, synthesized, imperative semantic statement encapsulating the primary action and intent (e.g., "Schedule follow-up consultation with Dr. Weber", "Transfer retainer of 1,500 EUR to Acme Corp").
   - Character length is strictly bounded between 3 and 120 characters in masked space, expanding up to 250 characters post re-hydration.

2. **Smart Task Metadata Isolation Invariant:**
   - Spatial, interpersonal, financial, and colloquial temporal attributes must be disentangled from the free-form `summary` and extracted into typed metadata fields:
     * `location`: Physical meeting place, venue, street, or city (e.g. `Kassel`, `Room 4B`).
     * `contactPerson`: Primary counterparty or attendee (e.g. `Anna Nowak`, `Dr. Schmidt`).
     * `amount`: Explicit currency amount, budget ceiling, or fee (e.g. `500 EUR`, `10k zł`).
     * `scheduledTime`: Colloquial or explicit time specification (e.g. `tomorrow at 15:00`, `next Tuesday morning`).
   - If a metadata dimension is absent in the source memo, the field is set to `null`.

3. **Privacy Masking & Re-hydration Invariance Across Metadata:**
   - Any sensitive entities detected within smart metadata fields are masked using synthetic tokens identical to those in the body (e.g., `contactPerson: "[PERSON_1]"`, `location: "[ADDRESS_1]"`).
   - Recursive re-hydration automatically traverses and restores cleartext across both core task properties and smart metadata fields before envelope encryption.

---

## 5. Storage & Persistence Contracts (Firebase Firestore)

### 5.1 Memo Entity (`MemoEntitySchema`)
Stored in the `memos` collection. To prevent PII leakage to the database, `rawContent` is **never stored in cleartext**—it is encrypted at rest using AES-256-GCM via `encryptedPayload`:
```typescript
export const MemoEntitySchema = z.object({
  id: EntityIdSchema.describe('Unique document identifier (UUIDv4 or Firestore ID)'),
  userId: EntityIdSchema.describe('Owner user identifier'),
  encryptedPayload: EncryptedPayloadSchema.describe('AES-256-GCM ciphertext containing unmasked memo content'),
  sanitizedContentPreview: z.string().optional().describe('Optional redacted preview (omitted at rest for zero plaintext PII)'),
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
  subtasks: z.array(DecryptedSubtaskItemSchema).min(1).max(10).describe('Checklist with re-hydrated cleartext items'),
  scheduledDate: z.string().nullable().optional().describe('ISO 8601 scheduled deadline or null'),
  location: z.string().nullable().optional().describe('Extracted physical location, meeting venue, or city'),
  contactPerson: z.string().nullable().optional().describe('Primary person of contact or counterparty'),
  amount: z.string().nullable().optional().describe('Associated financial budget or invoice amount'),
  scheduledTime: z.string().nullable().optional().describe('Colloquial or explicit time specification')
});

export type DecryptedTaskPayload = z.infer<typeof DecryptedTaskPayloadSchema>;
```

#### B. Persisted Task Document (`TaskEntitySchema`)
Stored in the `tasks` collection. All potentially sensitive fields (`title`, `summary`, `subtasks`, `location`, `contactPerson`, `amount`, `scheduledTime`) are envelope-encrypted inside `encryptedPayload` (zero plaintext PII at rest), while non-PII operational/queryable metadata (`category`, `priority`, `status`, `scheduledDate`, `tags`, `provenance`, `modelVersion`, `createdAt`, `updatedAt`) remains unencrypted for database indexing and filtering:
```typescript
export const TaskEntitySchema = z.object({
  id: EntityIdSchema.describe('Unique document identifier (UUIDv4 or Firestore ID)'),
  memoId: EntityIdSchema.describe('Foreign key reference linking to source MemoEntity'),
  userId: EntityIdSchema.describe('Owner user identifier'),
  encryptedPayload: EncryptedPayloadSchema.describe('AES-256-GCM ciphertext of { title, summary, subtasks, location, contactPerson, amount, scheduledTime }'),
  category: TaskCategorySchema.describe('Non-PII queryable category'),
  priority: TaskPrioritySchema.describe('Non-PII queryable urgency level'),
  status: TaskStatusSchema.describe('Workflow state, defaults to DRAFT for human review'),
  scheduledDate: z.string().nullable().describe('ISO 8601 scheduled date or null'),
  tags: z.array(z.string().min(1).max(30)).max(8).describe('Contextual index tags (sanitized)'),
  provenance: AIProvenanceSchema.describe('Inference engine provenance (GEMINI_FLASH or DETERMINISTIC_FALLBACK)'),
  modelVersion: z.string().min(1).describe('Model or rule version identifier (e.g. "gemini-2.5-flash-001" or "fallback-v1")'),
  createdAt: FirestoreTimestampSchema.describe('Creation timestamp'),
  updatedAt: FirestoreTimestampSchema.describe('Last update timestamp'),
  scheduledTime: z.string().nullable().optional().describe('Optional colloquial or explicit time specification')
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

## 7. REST Gateway Contracts

The Express REST Gateway validates all inbound HTTP payloads and serializes responses using these authoritative Zod schemas (synchronized with `docs/spec/openapi.yaml`):

```typescript
export const MemoInputSchema = z.object({
  content: z.string().min(1).max(10000).describe('Raw user memo text for privacy masking and extraction'),
  title: z.string().max(200).optional().describe('Optional title for the memo')
});
export type MemoInput = z.infer<typeof MemoInputSchema>;

export const MaskedTokenSummarySchema = z.object({
  token: z.string().regex(/^\[[A-Z_]+_\d+\]$/),
  type: PIITypeSchema
});
export type MaskedTokenSummary = z.infer<typeof MaskedTokenSummarySchema>;

export const MemoPIIStatsSchema = z.object({
  detectedEntityCount: z.number().int().nonnegative(),
  maskedTokens: z.array(MaskedTokenSummarySchema),
  riskLevel: RiskLevelSchema
});
export type MemoPIIStats = z.infer<typeof MemoPIIStatsSchema>;

export const CreateMemoResponseSchema = z.object({
  task: TaskEntitySchema,
  tasks: z.array(TaskEntitySchema),
  memo: MemoEntitySchema,
  piiStats: MemoPIIStatsSchema
});
export type CreateMemoResponse = z.infer<typeof CreateMemoResponseSchema>;

export const CreateTaskInputSchema = z.object({
  title: z.string().min(3).max(250),
  summary: z.string().min(5).max(1000).optional(),
  category: TaskCategorySchema.default('OTHER'),
  priority: TaskPrioritySchema.default('MEDIUM'),
  status: TaskStatusSchema.default('DRAFT'),
  scheduledDate: z.string().nullable().default(null),
  tags: z.array(z.string().min(1).max(30)).max(8).default([]),
  subtasks: z.array(DecryptedSubtaskItemSchema).max(10).optional(),
  location: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  amount: z.string().nullable().optional(),
  scheduledTime: z.string().nullable().optional()
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = z.object({
  title: z.string().min(3).max(250).optional(),
  summary: z.string().min(5).max(1000).optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  category: TaskCategorySchema.optional(),
  scheduledDate: z.string().nullable().optional(),
  tags: z.array(z.string().min(1).max(30)).max(8).optional(),
  subtasks: z.array(DecryptedSubtaskItemSchema).max(10).optional(),
  location: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  amount: z.string().nullable().optional(),
  scheduledTime: z.string().nullable().optional()
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime()
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
```

---

## 8. Schema Validation & Safe Parsing Helper

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
