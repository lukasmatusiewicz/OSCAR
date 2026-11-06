# OSCAR Domain & Data Contracts Specification

## 1. Overview & Mandate
This document defines the authoritative, runtime-enforced data contracts for **OSCAR**. All internal components, AI payloads, and storage entities must conform to these schemas.

Validation is strictly performed using **Zod** (`zod` v3+). These schemas serve a dual role:
1. **Application-level runtime type safety:** Validating HTTP payloads, internal messages, and database documents.
2. **AI Provider Guardrails:** Compiled directly into JSON Schemas and passed to Google Gemini's `generationConfig.responseSchema` to guarantee 100% deterministic structured outputs.

---

## 2. Privacy Guard Contracts

### 2.1 PII TokenType & Categories
Categorizes all sensitive data types recognized by the Privacy Guard engine:
```typescript
import { z } from 'zod';

export const PIITypeSchema = z.enum([
  'EMAIL',
  'PERSON',
  'PHONE',
  'AMOUNT_MONEY',
  'SECRET_KEY',
  'IBAN'
]);

export type PIIType = z.infer<typeof PIITypeSchema>;
```

### 2.2 Token Mapping Record (`PIITokenMapSchema`)
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

### 2.3 Sanitization Result Contract (`SanitizationResultSchema`)
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
```

---

## 3. AI Extraction & Task Contracts (Gemini Structured Outputs)

### 3.1 Task Priority & Category Enums
Standardized taxonomies for task management and organization:
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
```

### 3.2 AI Structured Response Contract (`responseSchema`)
This schema defines the exact structure expected from Google Gemini. It is converted into a standard JSON Schema object and assigned to `generationConfig.responseSchema`:
```typescript
export const SubtaskItemSchema = z.object({
  title: z.string().min(1).describe('Concise, actionable subtask checklist item'),
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
    .describe('Relevant contextual tags for filtering and indexing (e.g., ["interview", "pta", "budget"])'),
  subtasks: z
    .array(SubtaskItemSchema)
    .min(1)
    .max(10)
    .describe('Decomposed actionable checklist steps extracted from the memo')
});

export type ExtractedTask = z.infer<typeof ExtractedTaskSchema>;
```

#### Gemini API JSON Schema Representation (Reference):
When passed to `@google/genai`, the Zod schema is serialized to the standard OpenAPI/JSON Schema subset supported by Gemini:
```json
{
  "type": "OBJECT",
  "properties": {
    "title": { "type": "STRING" },
    "summary": { "type": "STRING" },
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
      "items": { "type": "STRING" }
    },
    "subtasks": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "title": { "type": "STRING" },
          "completed": { "type": "BOOLEAN" }
        },
        "required": ["title", "completed"]
      }
    }
  },
  "required": ["title", "summary", "category", "priority", "tags", "subtasks"]
}
```

---

## 4. Storage & Persistence Contracts (Firebase Firestore)

### 4.1 Memo Entity (`MemoEntitySchema`)
Stored in the `memos` collection to record the historical raw input and privacy metadata:
```typescript
export const MemoEntitySchema = z.object({
  id: z.string().uuid().describe('Unique UUIDv4 document identifier'),
  userId: z.string().min(1).describe('Owner user identifier'),
  rawContent: z.string().min(1).describe('Full unmasked memo content (stored securely)'),
  sanitizedContentPreview: z.string().describe('Redacted preview safe for client-side logging'),
  hasPII: z.boolean().describe('Flag indicating if any sensitive tokens were detected and masked'),
  maskedFieldsCount: z.number().int().nonnegative().describe('Total number of masked tokens'),
  createdAt: z.string().datetime().describe('ISO 8601 creation timestamp'),
  updatedAt: z.string().datetime().describe('ISO 8601 last update timestamp')
});

export type MemoEntity = z.infer<typeof MemoEntitySchema>;
```

### 4.2 Task Entity (`TaskEntitySchema`)
Stored in the `tasks` collection and synchronized to the React client via real-time listeners:
```typescript
export const TaskStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskEntitySchema = ExtractedTaskSchema.extend({
  id: z.string().uuid().describe('Unique UUIDv4 document identifier'),
  memoId: z.string().uuid().describe('Foreign key reference linking to source MemoEntity'),
  userId: z.string().min(1).describe('Owner user identifier'),
  status: TaskStatusSchema.default('PENDING').describe('Current workflow status'),
  createdAt: z.string().datetime().describe('ISO 8601 creation timestamp'),
  updatedAt: z.string().datetime().describe('ISO 8601 last update timestamp')
});

export type TaskEntity = z.infer<typeof TaskEntitySchema>;
```

---

## 5. Privacy Audit Log Contract (`PrivacyAuditLogSchema`)
Stored in the `privacy_audit_logs` collection. **Zero-PII Compliance Rule**: This collection records telemetry and compliance proofs, but NEVER contains actual cleartext sensitive data or token mappings:
```typescript
export const PrivacyAuditLogSchema = z.object({
  id: z.string().uuid().describe('Unique UUIDv4 audit record identifier'),
  userId: z.string().min(1).describe('Anonymized user reference'),
  action: z.enum(['MASK_SUCCESS', 'UNMASK_SUCCESS', 'VALIDATION_FAILURE', 'FALLBACK_TRIGGERED']),
  detectedTypes: z.array(PIITypeSchema).describe('List of PII categories identified in the payload'),
  tokenCount: z.number().int().nonnegative().describe('Number of sensitive items sanitized'),
  riskLevel: RiskLevelSchema.describe('Calculated risk evaluation at inference time'),
  durationMs: z.number().nonnegative().describe('Processing latency in milliseconds'),
  timestamp: z.string().datetime().describe('ISO 8601 audit timestamp')
});

export type PrivacyAuditLog = z.infer<typeof PrivacyAuditLogSchema>;
```

---

## 6. Schema Validation & Safe Parsing Helper

To ensure robust error handling without throwing uncaught exceptions, domain services use standard safe-parsing wrappers:

```typescript
export function validateContract<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}
```
