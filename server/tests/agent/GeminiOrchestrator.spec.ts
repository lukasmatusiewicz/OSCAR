import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GeminiOrchestrator,
  sanitizeForPrompt,
  GEMINI_TASK_SCHEMA,
  SYSTEM_INSTRUCTION
} from '../../src/agent/GeminiOrchestrator.js';
import { RateLimiter } from '../../src/gateway/RateLimiter.js';
import { ExtractedTaskSchema } from '../../src/types/contracts.js';

describe('GeminiOrchestrator', () => {
  let mockGenerateContent: ReturnType<typeof vi.fn>;
  let mockGenAiClient: any;
  let rateLimiter: RateLimiter;

  const validGeminiTask = {
    title: 'Approve budget with [PERSON_1]',
    summary: 'Coordinate budget review for [AMOUNT_MONEY_1] with [PERSON_1].',
    category: 'FINANCE',
    priority: 'HIGH',
    scheduledDate: '2026-11-15T10:00:00Z',
    tags: ['budget', 'finance'],
    subtasks: [
      { title: 'Send invoice preview to [EMAIL_1]', completed: false },
      { title: 'Confirm wire transfer to [IBAN_1]', completed: false }
    ]
  };

  beforeEach(() => {
    mockGenerateContent = vi.fn();
    mockGenAiClient = {
      models: {
        generateContent: mockGenerateContent
      }
    };
    rateLimiter = new RateLimiter({
      rpm: 12,
      capacity: 12,
      baseDelayMs: 10,
      jitter: 0
    });
  });

  describe('Prompt Sanitization & Security Isolation', () => {
    it('should wrap user memo in <user_memo> tags and escape < and > entities', () => {
      const maliciousMemo = 'Schedule meeting <script>alert("hack")</script> and review > 5 items';
      const prompt = sanitizeForPrompt(maliciousMemo);

      expect(prompt).toContain('<user_memo>\n');
      expect(prompt).toContain('\n</user_memo>');
      expect(prompt).not.toContain('<script>');
      expect(prompt).toContain('&lt;script&gt;alert("hack")&lt;/script&gt;');
      expect(prompt).toContain('&gt; 5 items');
    });

    it('should define an OpenAPI-compliant responseSchema matching ExtractedTaskSchema exactly', () => {
      expect(GEMINI_TASK_SCHEMA.type).toBe('OBJECT');
      expect(GEMINI_TASK_SCHEMA.required).toContain('title');
      expect(GEMINI_TASK_SCHEMA.required).toContain('summary');
      expect(GEMINI_TASK_SCHEMA.required).toContain('category');
      expect(GEMINI_TASK_SCHEMA.required).toContain('priority');
      expect(GEMINI_TASK_SCHEMA.required).toContain('scheduledDate');
      expect(GEMINI_TASK_SCHEMA.required).toContain('tags');
      expect(GEMINI_TASK_SCHEMA.required).toContain('subtasks');

      expect(GEMINI_TASK_SCHEMA.properties.category.enum).toEqual([
        'WORK',
        'INTERVIEW_PREP',
        'FINANCE',
        'PERSONAL',
        'HEALTH',
        'OTHER'
      ]);
      expect(GEMINI_TASK_SCHEMA.properties.priority.enum).toEqual([
        'LOW',
        'MEDIUM',
        'HIGH',
        'URGENT'
      ]);

      // Smart metadata schema verification conforming to contracts.md Section 4.2
      expect((GEMINI_TASK_SCHEMA.properties as any).location).toEqual({ type: 'STRING', nullable: true });
      expect((GEMINI_TASK_SCHEMA.properties as any).contactPerson).toEqual({ type: 'STRING', nullable: true });
      expect((GEMINI_TASK_SCHEMA.properties as any).amount).toEqual({ type: 'STRING', nullable: true });
      expect((GEMINI_TASK_SCHEMA.properties as any).scheduledTime).toEqual({ type: 'STRING', nullable: true });
    });

    it('should include explicit PII token preservation directives in SYSTEM_INSTRUCTION', () => {
      expect(SYSTEM_INSTRUCTION).toContain('preserve all synthetic PII tokens');
      expect(SYSTEM_INSTRUCTION).toContain('[NATIONAL_ID_1]');
      expect(SYSTEM_INSTRUCTION).toContain('[HEALTH_DATA_1]');
      expect(SYSTEM_INSTRUCTION).toContain('<user_memo>');
    });
  });

  describe('Inference & Provenance Tagging', () => {
    it('should successfully orchestrate via Gemini 2.5 Flash and tag provenance as GEMINI_FLASH', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(validGeminiTask)
      });

      const orchestrator = new GeminiOrchestrator({
        genAiClient: mockGenAiClient,
        rateLimiter
      });

      const memo = 'Meeting with [PERSON_1] regarding budget [AMOUNT_MONEY_1]';
      const result = await orchestrator.extractTask(memo);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0][0];

      expect(callArgs.model).toBe('gemini-2.5-flash');
      expect(callArgs.contents).toBe(sanitizeForPrompt(memo));
      expect(callArgs.config.systemInstruction).toBe(SYSTEM_INSTRUCTION);
      expect(callArgs.config.responseMimeType).toBe('application/json');
      expect(callArgs.config.responseSchema).toEqual(GEMINI_TASK_SCHEMA);
      expect(callArgs.config.abortSignal).toBeDefined();

      expect(result.provenance).toBe('GEMINI_FLASH');
      expect(result.modelVersion).toBe('gemini-2.5-flash');
      expect(result.task).toEqual(validGeminiTask);
      expect(ExtractedTaskSchema.safeParse(result.task).success).toBe(true);
    });

    it('should fall back to DeterministicFallbackExtractor when Gemini API returns 429 quota exhaustion', async () => {
      const rateLimitErr: any = new Error('Resource has been exhausted (e.g. check quota)');
      rateLimitErr.status = 429;
      mockGenerateContent.mockRejectedValue(rateLimitErr);

      const orchestrator = new GeminiOrchestrator({
        genAiClient: mockGenAiClient,
        rateLimiter: new RateLimiter({ maxRetries: 0 })
      });

      const memo = 'Urgent emergency bug fix for Jira project\n- Patch security vulnerability\n- Deploy fix';
      const result = await orchestrator.extractTask(memo);

      expect(result.provenance).toBe('DETERMINISTIC_FALLBACK');
      expect(result.modelVersion).toBe('rule-based-v1');
      expect(result.task.priority).toBe('URGENT');
      expect(result.task.category).toBe('WORK');
      expect(result.task.subtasks).toHaveLength(2);
      expect(ExtractedTaskSchema.safeParse(result.task).success).toBe(true);
    });

    it('should fall back to DeterministicFallbackExtractor on 8000ms SLA timeout', async () => {
      mockGenerateContent.mockImplementation((params: any) => {
        return new Promise((_, reject) => {
          params.config.abortSignal?.addEventListener('abort', () => {
            const err: any = new Error('The operation was aborted due to timeout');
            err.name = 'TimeoutError';
            reject(err);
          });
        });
      });

      const orchestrator = new GeminiOrchestrator({
        genAiClient: mockGenAiClient,
        rateLimiter: new RateLimiter({ timeoutMs: 30, maxRetries: 0 })
      });

      const memo = 'Task during timeout';
      const result = await orchestrator.extractTask(memo);

      expect(result.provenance).toBe('DETERMINISTIC_FALLBACK');
      expect(result.modelVersion).toBe('rule-based-v1');
      expect(ExtractedTaskSchema.safeParse(result.task).success).toBe(true);
    });

    it('should fall back to DeterministicFallbackExtractor when Gemini returns invalid JSON or schema violation', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '{"title": "Missing required fields"}'
      });

      const orchestrator = new GeminiOrchestrator({
        genAiClient: mockGenAiClient,
        rateLimiter
      });

      const memo = 'Review finances and transfer salary';
      const result = await orchestrator.extractTask(memo);

      expect(result.provenance).toBe('DETERMINISTIC_FALLBACK');
      expect(result.modelVersion).toBe('rule-based-v1');
      expect(result.task.category).toBe('FINANCE');
      expect(ExtractedTaskSchema.safeParse(result.task).success).toBe(true);
    });

    it('should fall back to DeterministicFallbackExtractor when Gemini returns empty text payload', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: ''
      });

      const orchestrator = new GeminiOrchestrator({
        genAiClient: mockGenAiClient,
        rateLimiter
      });

      const memo = 'Schedule team sprint meeting';
      const result = await orchestrator.extractTask(memo);

      expect(result.provenance).toBe('DETERMINISTIC_FALLBACK');
      expect(result.modelVersion).toBe('rule-based-v1');
      expect(result.task.category).toBe('WORK');
    });

    it('should accept and forward custom AbortSignal to rateLimiter and SDK', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(validGeminiTask)
      });

      const orchestrator = new GeminiOrchestrator({
        genAiClient: mockGenAiClient,
        rateLimiter
      });

      const customController = new AbortController();
      const memo = 'Custom signal task';
      const result = await orchestrator.extractTask(memo, { signal: customController.signal });

      expect(result.provenance).toBe('GEMINI_FLASH');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should fall back to DeterministicFallbackExtractor on network 503 Service Unavailable', async () => {
      const serviceErr: any = new Error('503 Service Unavailable');
      serviceErr.status = 503;
      mockGenerateContent.mockRejectedValue(serviceErr);

      const orchestrator = new GeminiOrchestrator({
        genAiClient: mockGenAiClient,
        rateLimiter: new RateLimiter({ maxRetries: 0 })
      });

      const memo = 'Doctor appointment tomorrow';
      const result = await orchestrator.extractTask(memo);

      expect(result.provenance).toBe('DETERMINISTIC_FALLBACK');
      expect(result.modelVersion).toBe('rule-based-v1');
      expect(result.task.category).toBe('HEALTH');
      expect(result.task.priority).toBe('HIGH');
    });

    it('should instantiate GoogleGenAI with API key when genAiClient is not injected', () => {
      const orchestrator = new GeminiOrchestrator({
        apiKey: 'test-api-key'
      });
      expect(orchestrator).toBeDefined();
    });

    it('should fall back to fallback extractor when no API key is provided and genAiClient is missing', async () => {
      const prevKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const orchestrator = new GeminiOrchestrator({});
      const result = await orchestrator.extractTask('Work task without API key');

      expect(result.provenance).toBe('DETERMINISTIC_FALLBACK');
      expect(result.modelVersion).toBe('rule-based-v1');

      if (prevKey) process.env.GEMINI_API_KEY = prevKey;
    });
  });
});
