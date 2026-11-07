import { GoogleGenAI } from '@google/genai';
import {
  ExtractedTask,
  ExtractedTaskSchema,
  AIProvenance,
  validateContract
} from '../types/contracts.js';
import { RateLimiter } from '../gateway/RateLimiter.js';
import { DeterministicFallbackExtractor } from './DeterministicFallbackExtractor.js';

export const GEMINI_TASK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', minLength: 3, maxLength: 120 },
    summary: { type: 'STRING', minLength: 5, maxLength: 500 },
    category: {
      type: 'STRING',
      enum: ['WORK', 'INTERVIEW_PREP', 'FINANCE', 'PERSONAL', 'HEALTH', 'OTHER']
    },
    priority: {
      type: 'STRING',
      enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
    },
    scheduledDate: { type: 'STRING', nullable: true },
    tags: {
      type: 'ARRAY',
      items: { type: 'STRING', minLength: 1, maxLength: 30 },
      maxItems: 8
    },
    subtasks: {
      type: 'ARRAY',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', minLength: 1, maxLength: 200 },
          completed: { type: 'BOOLEAN' }
        },
        required: ['title', 'completed']
      }
    }
  },
  required: ['title', 'summary', 'category', 'priority', 'scheduledDate', 'tags', 'subtasks']
};

export const SYSTEM_INSTRUCTION =
  "You are OSCAR's AI Task Orchestrator. Your role is to analyze the sanitized user memo enclosed within <user_memo> tags and extract structured task information conforming strictly to the requested schema. Decompose the memo into an action-oriented title, concise summary, appropriate category, priority, optional ISO 8601 scheduled date, contextual tags, and actionable checklist subtasks. You must preserve all synthetic PII tokens (such as [PERSON_1], [EMAIL_1], [PHONE_1], [AMOUNT_MONEY_1], [IBAN_1], [SECRET_KEY_1]) exactly as they appear without alteration or omission.";

/**
 * Escapes < and > characters and encloses text within structural boundary tags.
 * Prevents prompt injection breakouts according to architecture.md Section 5.3.
 */
export function sanitizeForPrompt(sanitizedText: string): string {
  const escaped = sanitizedText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<user_memo>\n${escaped}\n</user_memo>`;
}

export interface OrchestratorResult {
  task: ExtractedTask;
  provenance: AIProvenance;
  modelVersion: string;
}

export interface GeminiOrchestratorOptions {
  apiKey?: string;
  model?: string;
  rateLimiter?: RateLimiter;
  genAiClient?: GoogleGenAI | any;
}

/**
 * AI Orchestrator integrating with Google Gemini 2.5 Flash via official @google/genai SDK.
 * Incorporates token-bucket rate limiting, 8,000ms SLA timeouts, and deterministic fallback.
 */
export class GeminiOrchestrator {
  private readonly client: GoogleGenAI | any | null = null;
  private readonly model: string;
  private readonly rateLimiter: RateLimiter;

  constructor(options: GeminiOrchestratorOptions = {}) {
    this.model = options.model ?? 'gemini-2.5-flash';
    this.rateLimiter = options.rateLimiter ?? new RateLimiter();

    if (options.genAiClient) {
      this.client = options.genAiClient;
    } else {
      const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
      if (apiKey) {
        this.client = new GoogleGenAI({ apiKey });
      }
    }
  }

  /**
   * Extracts structured tasks from a sanitized user memo.
   * If Gemini fails, times out, or encounters quota limits, seamlessly degrades to DeterministicFallbackExtractor.
   */
  public async extractTask(
    memoText: string,
    options?: { signal?: AbortSignal }
  ): Promise<OrchestratorResult> {
    if (!this.client) {
      return DeterministicFallbackExtractor.extractWithMetadata(memoText);
    }

    try {
      return await this.rateLimiter.execute(async (signal) => {
        const prompt = sanitizeForPrompt(memoText);

        const response = await this.client.models.generateContent({
          model: this.model,
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_TASK_SCHEMA,
            abortSignal: signal
          }
        });

        const text = response?.text;
        if (!text) {
          throw new Error('Gemini response returned empty text payload');
        }

        const parsed = JSON.parse(text);
        const validation = validateContract(ExtractedTaskSchema, parsed);

        if (!validation.success) {
          throw new Error(
            `Gemini response does not satisfy ExtractedTaskSchema: ${validation.errors.message}`
          );
        }

        return {
          task: validation.data,
          provenance: 'GEMINI_FLASH' as const,
          modelVersion: this.model
        };
      }, options?.signal);
    } catch {
      // Deterministic fallback failover on error / timeout / 429
      return DeterministicFallbackExtractor.extractWithMetadata(memoText);
    }
  }
}
