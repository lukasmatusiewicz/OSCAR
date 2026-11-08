import { z } from 'zod';

// ==========================================
// 2. Common & Shared Primitives
// ==========================================

export const EntityIdSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_-]{20,36}$/,
    'Must be a valid UUIDv4 or 20-character Firestore alphanumeric ID',
  );

export type EntityId = z.infer<typeof EntityIdSchema>;

export const FirestoreTimestampSchema = z.union([
  z.string().datetime(),
  z.date().transform((d) => d.toISOString()),
  z
    .object({
      seconds: z.number().int().nonnegative(),
      nanoseconds: z.number().int().nonnegative(),
    })
    .transform((ts) =>
      new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1000000)).toISOString(),
    ),
]);

export type FirestoreTimestamp = z.infer<typeof FirestoreTimestampSchema>;

export const EncryptedPayloadSchema = z.object({
  ciphertext: z.string().min(1).describe('Base64-encoded AES-256-GCM ciphertext'),
  iv: z.string().min(1).describe('Base64-encoded 96-bit (12-byte) initialization vector'),
  authTag: z.string().min(1).describe('Base64-encoded 128-bit authentication tag'),
  keyId: z.string().default('v1').describe('Key derivation identifier for future key rotation'),
});

export type EncryptedPayload = z.infer<typeof EncryptedPayloadSchema>;

// ==========================================
// 3. Privacy Guard Contracts
// ==========================================

export const PIITypeSchema = z.enum([
  'SECRET_KEY',
  'IBAN',
  'EMAIL',
  'PHONE',
  'AMOUNT_MONEY',
  'PERSON',
  'ADDRESS',
]);

export type PIIType = z.infer<typeof PIITypeSchema>;

export const PIITokenMapSchema = z.object({
  token: z.string().regex(/^\[[A-Z_]+_\d+\]$/, 'Token must match bracketed format: [TYPE_INDEX]'),
  type: PIITypeSchema,
  originalValue: z.string().min(1, 'Original value cannot be empty'),
  startIndex: z.number().int().nonnegative('Start index must be >= 0'),
  endIndex: z.number().int().positive('End index must be > 0'),
});

export type PIITokenMap = z.infer<typeof PIITokenMapSchema>;

export const RiskLevelSchema = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const SanitizationResultSchema = z.object({
  sanitizedText: z.string().describe('Text with all detected PII replaced with synthetic tokens'),
  tokenCount: z.number().int().nonnegative().describe('Total number of replaced PII occurrences'),
  tokens: z.array(PIITokenMapSchema).describe('Ephemeral mapping dictionary for re-hydration'),
  timestamp: z.string().datetime().describe('ISO 8601 timestamp of masking operation'),
  riskLevel: RiskLevelSchema.describe(
    'Calculated privacy risk score based on token density and sensitivity',
  ),
});

export type SanitizationResult = z.infer<typeof SanitizationResultSchema>;

// ==========================================
// 4. AI Extraction & Task Contracts
// ==========================================

export const TaskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskCategorySchema = z.enum([
  'WORK',
  'INTERVIEW_PREP',
  'FINANCE',
  'PERSONAL',
  'HEALTH',
  'OTHER',
]);
export type TaskCategory = z.infer<typeof TaskCategorySchema>;

export const TaskStatusSchema = z
  .enum([
    'DRAFT', // Initial state for all AI-generated tasks (awaits human confirmation)
    'PENDING', // Confirmed active task
    'IN_PROGRESS', // Under active execution
    'COMPLETED', // Fulfilled
    'CANCELLED', // Dismissed
  ])
  .default('DRAFT');
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const AIProvenanceSchema = z.enum(['GEMINI_FLASH', 'DETERMINISTIC_FALLBACK']);
export type AIProvenance = z.infer<typeof AIProvenanceSchema>;

export const ProvenanceSchema = AIProvenanceSchema;
export type Provenance = AIProvenance;

export const SubtaskItemSchema = z.object({
  title: z.string().min(1).max(200).describe('Concise, actionable subtask checklist item'),
  completed: z.boolean().default(false).describe('Initial completion state, defaults to false'),
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
  priority: TaskPrioritySchema.describe(
    'Urgency level inferred from deadlines, keywords, and tone',
  ),
  scheduledDate: z
    .string()
    .nullable()
    .describe(
      'ISO 8601 formatted date/time string if a scheduled time or deadline is detected, otherwise null',
    ),
  tags: z
    .array(z.string().min(1).max(30))
    .max(8)
    .describe(
      'Relevant contextual tags for filtering and indexing (e.g., ["project", "operations", "budget"])',
    ),
  subtasks: z
    .array(SubtaskItemSchema)
    .min(1)
    .max(10)
    .describe('Decomposed actionable checklist steps extracted from the memo'),
});

export type ExtractedTask = z.infer<typeof ExtractedTaskSchema>;

// ==========================================
// 5. Storage & Persistence Contracts
// ==========================================

export const DecryptedSubtaskItemSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(400)
    .describe('Actionable subtask title with re-hydrated cleartext (expanded bound)'),
  completed: z.boolean().default(false),
});

export type DecryptedSubtaskItem = z.infer<typeof DecryptedSubtaskItemSchema>;

export const DecryptedTaskPayloadSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(250)
    .describe('Re-hydrated title accommodating token expansion beyond 120 chars'),
  summary: z
    .string()
    .min(5)
    .max(1000)
    .describe('Re-hydrated summary accommodating token expansion beyond 500 chars'),
  subtasks: z
    .array(DecryptedSubtaskItemSchema)
    .min(1)
    .max(10)
    .describe('Checklist with re-hydrated cleartext items'),
});

export type DecryptedTaskPayload = z.infer<typeof DecryptedTaskPayloadSchema>;

export const TaskEntitySchema = z.object({
  id: EntityIdSchema.describe('Unique document identifier (UUIDv4 or Firestore ID)'),
  memoId: EntityIdSchema.describe('Foreign key reference linking to source MemoEntity'),
  userId: EntityIdSchema.describe('Owner user identifier'),
  encryptedPayload: EncryptedPayloadSchema.describe(
    'AES-256-GCM ciphertext of { title, summary, subtasks }',
  ),
  category: TaskCategorySchema.describe('Non-PII queryable category'),
  priority: TaskPrioritySchema.describe('Non-PII queryable urgency level'),
  status: TaskStatusSchema.describe('Workflow state, defaults to DRAFT for human review'),
  scheduledDate: z.string().nullable().describe('ISO 8601 scheduled date or null'),
  tags: z.array(z.string().min(1).max(30)).max(8).describe('Contextual index tags (sanitized)'),
  provenance: AIProvenanceSchema.describe(
    'Inference engine provenance (GEMINI_FLASH or DETERMINISTIC_FALLBACK)',
  ),
  modelVersion: z
    .string()
    .min(1)
    .describe('Model or rule version identifier (e.g. "gemini-2.5-flash-001" or "fallback-v1")'),
  createdAt: FirestoreTimestampSchema.describe('Creation timestamp'),
  updatedAt: FirestoreTimestampSchema.describe('Last update timestamp'),
});

export type TaskEntity = z.infer<typeof TaskEntitySchema>;

export const MemoEntitySchema = z.object({
  id: EntityIdSchema.describe('Unique document identifier (UUIDv4 or Firestore ID)'),
  userId: EntityIdSchema.describe('Owner user identifier'),
  encryptedPayload: EncryptedPayloadSchema.describe(
    'AES-256-GCM ciphertext containing unmasked memo content',
  ),
  sanitizedContentPreview: z
    .string()
    .describe('Redacted preview safe for client-side listing (contains only synthetic tokens)'),
  hasPII: z.boolean().describe('Flag indicating if any sensitive tokens were detected and masked'),
  maskedFieldsCount: z.number().int().nonnegative().describe('Total number of masked tokens'),
  createdAt: FirestoreTimestampSchema.describe('Creation timestamp'),
  updatedAt: FirestoreTimestampSchema.describe('Last update timestamp'),
});

export type MemoEntity = z.infer<typeof MemoEntitySchema>;

// ==========================================
// 6. Privacy Audit Log Contract
// ==========================================

export const PrivacyAuditLogSchema = z.object({
  id: EntityIdSchema.describe('Unique audit record identifier'),
  userId: EntityIdSchema.describe('Anonymized user reference'),
  action: z.enum([
    'MASK_SUCCESS',
    'UNMASK_SUCCESS',
    'ENCRYPTION_SUCCESS',
    'VALIDATION_FAILURE',
    'FALLBACK_TRIGGERED',
  ]),
  detectedTypes: z
    .array(PIITypeSchema)
    .describe('List of PII categories identified in the payload'),
  tokenCount: z.number().int().nonnegative().describe('Number of sensitive items sanitized'),
  riskLevel: RiskLevelSchema.describe('Calculated risk evaluation at inference time'),
  durationMs: z.number().nonnegative().describe('Processing latency in milliseconds'),
  timestamp: FirestoreTimestampSchema.describe('Audit timestamp'),
});

export type PrivacyAuditLog = z.infer<typeof PrivacyAuditLogSchema>;

// ==========================================
// 7. Schema Validation & Safe Parsing Helper
// ==========================================

export function validateContract<Output, Input = unknown>(
  schema: z.ZodType<Output, z.ZodTypeDef, Input>,
  data: unknown,
): { success: true; data: Output } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

// ==========================================
// 8. REST Gateway API Contracts
// ==========================================

export const MemoInputSchema = z.object({
  content: z
    .string()
    .min(1, 'Content must not be empty')
    .max(10000, 'Content exceeds maximum limit of 10000 characters')
    .describe('Raw user memo text for privacy masking and extraction'),
  title: z
    .string()
    .max(200, 'Title exceeds maximum limit of 200 characters')
    .optional()
    .describe('Optional title for the memo'),
});

export type MemoInput = z.infer<typeof MemoInputSchema>;

export const MemoPIIStatsSchema = z.object({
  detectedEntityCount: z
    .number()
    .int()
    .nonnegative()
    .describe('Total number of sensitive PII tokens identified and masked'),
  maskedTokens: z.array(PIITokenMapSchema).describe('List of ephemeral token replacement records'),
  riskLevel: RiskLevelSchema.describe('Calculated privacy risk level'),
});

export type MemoPIIStats = z.infer<typeof MemoPIIStatsSchema>;

export const CreateMemoResponseSchema = z.object({
  task: TaskEntitySchema.describe('Created task entity with AES-256-GCM encrypted payload'),
  tasks: z.array(TaskEntitySchema).describe('Collection of created tasks'),
  memo: MemoEntitySchema.describe('Created memo entity record'),
  piiStats: MemoPIIStatsSchema.describe('Sanitization and privacy telemetry metrics'),
});

export type CreateMemoResponse = z.infer<typeof CreateMemoResponseSchema>;

export const CreateTaskInputSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(250),
  summary: z.string().min(5, 'Summary must be at least 5 characters').max(1000).optional(),
  category: TaskCategorySchema.optional().default('OTHER'),
  priority: TaskPrioritySchema.optional().default('MEDIUM'),
  status: TaskStatusSchema.optional().default('DRAFT'),
  scheduledDate: z.string().nullable().optional().default(null),
  tags: z.array(z.string().min(1).max(30)).max(8).optional().default([]),
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1).max(400),
        completed: z.boolean().optional().default(false),
      }),
    )
    .max(10)
    .optional(),
});

export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = z.object({
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  category: TaskCategorySchema.optional(),
  scheduledDate: z.string().nullable().optional(),
  tags: z.array(z.string().min(1).max(30)).max(8).optional(),
  title: z.string().min(3).max(250).optional(),
  summary: z.string().min(5).max(1000).optional(),
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1).max(400),
        completed: z.boolean().default(false),
      }),
    )
    .max(10)
    .optional(),
});

export type UpdateTaskInput = z.input<typeof UpdateTaskInputSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
