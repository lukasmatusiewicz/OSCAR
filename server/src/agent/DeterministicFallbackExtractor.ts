import {
  ExtractedTask,
  TaskPriority,
  TaskCategory,
  SubtaskItem,
  ExtractedTaskSchema,
} from '../types/contracts.js';

export interface DeterministicExtractionResult {
  task: ExtractedTask;
  provenance: 'DETERMINISTIC_FALLBACK';
  modelVersion: 'rule-based-v1';
}

/**
 * DeterministicFallbackExtractor provides rule-based structured extraction
 * for user memos when upstream AI providers fail, timeout, or hit rate limits.
 * Implements architecture.md Section 5.2.
 */
export class DeterministicFallbackExtractor {
  public static readonly PROVENANCE = 'DETERMINISTIC_FALLBACK' as const;
  public static readonly MODEL_VERSION = 'rule-based-v1' as const;

  /**
   * Deterministically parses a sanitized or raw memo into ExtractedTask without AI inference.
   */
  public static extract(memoText: string): ExtractedTask {
    const rawTrimmed = memoText.trim();
    const lines = memoText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const firstLine = lines[0] ?? 'New Memo Action Item';

    // Title: First line truncated between 3 and 120 chars
    let title: string;
    if (firstLine.length > 120) {
      title = `${firstLine.substring(0, 117)}...`;
    } else {
      title = firstLine.padEnd(3, '.');
    }

    // Priority Inference via Keyword Lexicon
    const lower = memoText.toLowerCase();
    let priority: TaskPriority = 'MEDIUM';
    if (/\b(?:urgent|asap|emergency|critical|immediately)\b/i.test(lower)) {
      priority = 'URGENT';
    } else if (/\b(?:high|important|deadline|today|tomorrow)\b/i.test(lower)) {
      priority = 'HIGH';
    } else if (/\b(?:low|someday|optional|minor)\b/i.test(lower)) {
      priority = 'LOW';
    }

    // Category Inference via Domain Lexicon
    let category: TaskCategory = 'OTHER';
    if (/\b(?:eur|usd|\$|€|budget|invoice|payment|iban|tax|salary)\b/i.test(lower)) {
      category = 'FINANCE';
    } else if (/\b(?:interview|resume|cv|hiring|prep|algorithm)\b/i.test(lower)) {
      category = 'INTERVIEW_PREP';
    } else if (/\b(?:meeting|client|report|project|jira|standup|sprint)\b/i.test(lower)) {
      category = 'WORK';
    } else if (/\b(?:health|doctor|dentist|gym|workout|medicine)\b/i.test(lower)) {
      category = 'HEALTH';
    } else if (/\b(?:home|family|groceries|shopping|personal)\b/i.test(lower)) {
      category = 'PERSONAL';
    }

    // Scheduled Date extraction (ISO or common date patterns)
    const dateMatch = memoText.match(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?\b/);
    const scheduledDate = dateMatch ? dateMatch[0] : null;

    // Subtasks: Bullet items or line items, guaranteeing min(1) subtask
    const subtaskCandidates: SubtaskItem[] = lines
      .filter((l) => /^[-*•\d.]+\s+/.test(l))
      .map((l) => ({
        title: l
          .replace(/^[-*•\d.]+\s+/, '')
          .trim()
          .substring(0, 200),
        completed: false,
      }))
      .filter((s) => s.title.length > 0);

    const subtasks: SubtaskItem[] =
      subtaskCandidates.length > 0
        ? subtaskCandidates.slice(0, 10)
        : [{ title: `Review and process: ${title}`.substring(0, 200), completed: false }];

    // Summary: at least 5 chars, max 500 chars
    const summaryCandidate = rawTrimmed.length > 0 ? rawTrimmed.substring(0, 500) : title;
    const summary = summaryCandidate.padEnd(5, '.');

    const result: ExtractedTask = {
      title,
      summary,
      category,
      priority,
      scheduledDate,
      tags: ['fallback', category.toLowerCase()],
      subtasks,
    };

    // Validate against contract to guarantee 100% schema compliance
    return ExtractedTaskSchema.parse(result);
  }

  /**
   * Extracts task and attaches standard provenance metadata.
   */
  public static extractWithMetadata(memoText: string): DeterministicExtractionResult {
    return {
      task: this.extract(memoText),
      provenance: this.PROVENANCE,
      modelVersion: this.MODEL_VERSION,
    };
  }
}
