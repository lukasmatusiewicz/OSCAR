# OSCAR Domain & Data Contracts Specification

## 1. Overview
This document specifies the authoritative runtime data contracts for **OSCAR**. All internal modules, external AI payloads, and persistence models must strictly validate against these schemas using **Zod** (`zod` v3+).

---

## 2. Privacy Guard Contracts

### 2.1 PII TokenType
Supported categories for local masking:
```typescript
export type PIIType = 
  | 'EMAIL' 
  | 'PERSON' 
  | 'PHONE' 
  | 'AMOUNT_MONEY' 
  | 'SECRET_KEY' 
  | 'IBAN';
```

### 2.2 Token Mapping Record
Represents an individual token substitution stored in ephemeral memory:
```typescript
import { z } from 'zod';

export const PIITokenMapSchema = z.object({
  token: z.string().regex(/^\[[A-Z_]+_\d+\]$/, 'Token must match [TYPE_INDEX] format'),
  type: z.enum(['EMAIL', 'PERSON', 'PHONE', 'AMOUNT_MONEY', 'SECRET_KEY', 'IBAN']),
  originalValue: z.string().min(1),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().positive()
});

export type PIITokenMap = z.infer<typeof PIITokenMapSchema>;
```

### 2.3 Sanitization Result Contract
Output produced by `PrivacyGuard.mask(rawText)`:
```typescript
export const SanitizationResultSchema = z.object({
  sanitizedText: z.string(),
  tokenCount: z.number().int().nonnegative(),
  tokens: z.array(PIITokenMapSchema),
  timestamp: z.string().datetime(),
  riskLevel: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH'])
});

export type SanitizationResult = z.infer<typeof SanitizationResultSchema>;
```

---

## 3. AI Extraction & Task Contracts (Gemini Structured Outputs)

### 3.1 Task Priority & Category Enums
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
This contract is converted to JSON Schema and fed directly into Google Gemini API's `generationConfig.responseSchema`:
```typescript
export const SubtaskItemSchema = z.object({
  title: z.string().describe('Short actionable subtask title'),
  completed: z.boolean().default(false)
});

export const ExtractedTaskSchema = z.object({
  title: z.string().min(3).max(120).describe('Concise summary title of the action item'),
  summary: z.string().describe('One sentence explanation of what needs to be done'),
  category: TaskCategorySchema.describe('Best matching category'),
  priority: TaskPrioritySchema.describe('Urgency level based on text context'),
  scheduledDate: z.string().nullable().describe('ISO 8601 string or date expression if identified, else null'),
  tags: z.array(z.string()).describe('Extracted topical tags for indexing'),
  subtasks: z.array(SubtaskItemSchema).describe('Step-by-step checklist decomposed from the text')
});

export type ExtractedTask = z.infer<typeof ExtractedTaskSchema>;
```

---

## 4. Storage & Entity Contracts (Firestore)

### 4.1 Memo Entity
```typescript
export const MemoEntitySchema = z.object({
  id: z.string().uuid(),
  rawContent: z.string().min(1),
  hasPII: z.boolean(),
  maskedFieldsCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type MemoEntity = z.infer<typeof MemoEntitySchema>;
```

### 4.2 Task Entity
```typescript
export const TaskEntitySchema = ExtractedTaskSchema.extend({
  id: z.string().uuid(),
  memoId: z.string().uuid().describe('Reference to the source memo'),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('PENDING'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type TaskEntity = z.infer<typeof TaskEntitySchema>;
```

---

## 5. Privacy Audit Log Contract
Anonymized audit entry recorded for compliance verification:
```typescript
export const PrivacyAuditLogSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['MASK', 'UNMASK', 'REJECT']),
  detectedTypes: z.array(z.string()),
  tokenCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  timestamp: z.string().datetime()
});

export type PrivacyAuditLog = z.infer<typeof PrivacyAuditLogSchema>;
```
