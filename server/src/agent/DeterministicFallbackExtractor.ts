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
 * Implements architecture.md Section 5.2 and contracts.md Section 4.3.
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

    // Extract first clause/sentence by splitting on sentence terminators ([.?!]) or newlines
    const rawClauses = memoText
      .split(/(?:(?<!\d)[.?!](?:\s+|$)|(?<!\d)[.?!]$|\r?\n)+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const firstClause = rawClauses[0] ?? (lines[0] ?? 'New Memo Action Item');

    // Title: Synthesized semantic title invariant conforming to contracts.md Section 4.3
    let cleaned = firstClause;

    // Strip conversational preambles and directive fillers
    const preambleRegex =
      /^(?:hey|hi|hello|cześć|hej|hallo|bonjour|dear|szanowny|szanowna|panie|pani)(?:\s+[\p{L}]+)*[,\s:]+/iu;
    const directiveFillers =
      /^(?:please\s+remind\s+me\s+to|remind\s+me\s+to|don't\s+forget\s+to|remember\s+to|i\s+need\s+to|we\s+need\s+to|i\s+must|we\s+must|pamiętaj\s+żeby\s+zaplanować|pamiętaj\s+żeby|przypomnij\s+mi\s+o|muszę|musimy|zaplanuj|erinnere\s+mich\s+an\s+das|erinnere\s+mich\s+an|vergiss\s+nicht\s+zu|n'oublie\s+pas\s+de|pense\s+à|memo\s*:?|notes?\s*:?)\s+/iu;

    let changed = true;
    while (changed) {
      changed = false;
      if (preambleRegex.test(cleaned)) {
        const stripped = cleaned.replace(preambleRegex, '').trim();
        if (stripped.length > 0) {
          cleaned = stripped;
          changed = true;
        }
      }
      if (directiveFillers.test(cleaned)) {
        const stripped = cleaned.replace(directiveFillers, '').trim();
        if (stripped.length > 0) {
          cleaned = stripped;
          changed = true;
        }
      }
    }

    // Trim trailing punctuation ([.?!,:;])
    cleaned = cleaned.replace(/[.?!,:;\s]+$/, '').trim();

    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    } else {
      cleaned = 'New Memo Action Item';
    }

    let title: string;
    if (cleaned.length > 120) {
      title = `${cleaned.substring(0, 117)}...`;
    } else {
      title = cleaned.padEnd(3, '.');
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

    // Smart Metadata Extraction (location, contactPerson, amount, scheduledTime)
    let location: string | null = null;
    const addressTokenMatch = memoText.match(/\[ADDRESS_\d+\]/);
    if (addressTokenMatch) {
      location = addressTokenMatch[0];
    } else {
      const cityMatch = memoText.match(
        /\b(?:New York|Kassel|Berlin|Paris|Warsaw|Warszawa|London|Zurich|Zürich|Tokyo|Vienna|Wien|Rome|Roma|Madrid|Krakow|Kraków|Wrocław|Munich|München|Hamburg|Frankfurt)\b/i,
      );
      if (cityMatch) {
        location = cityMatch[0];
      }
    }

    let contactPerson: string | null = null;
    const personTokenMatch = memoText.match(/\[PERSON_\d+\]/);
    if (personTokenMatch) {
      contactPerson = personTokenMatch[0];
    } else {
      const personMatch = memoText.match(
        /(?:\b(?:Herr|Frau|Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.|Pan|Pani|dr|mec\.)\s+\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)|(?:(?<=\b(?:with|z|ze|mit|avec)\s+)\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)+)/u,
      );
      if (personMatch) {
        contactPerson = personMatch[0];
      }
    }

    let amount: string | null = null;
    const amountTokenMatch = memoText.match(/\[AMOUNT_MONEY_\d+\]/);
    if (amountTokenMatch) {
      amount = amountTokenMatch[0];
    } else {
      const amountMatch = memoText.match(
        /(?:\$|€|£|\b(?:PLN|EUR|USD|CHF|zł))\s?\d+(?:[.,\s]\d+)*(?:\s?(?:k|tys\.?|mln|milionów|mld))?|\b\d+(?:[.,\s]\d+)*(?:\s?(?:k|tys\.?|mln|milionów|mld))?\s?(?:€|\$|£|\b(?:PLN|EUR|USD|CHF|zł)\b)/i,
      );
      if (amountMatch) {
        amount = amountMatch[0];
      }
    }

    let scheduledTime: string | null = null;
    const timeMatch = memoText.match(
      /(?:(?:tomorrow|jutro|morgen|today|dzisiaj|heute)\s+(?:at|o|um)\s+\d{1,2}(?::\d{2})?|\b\d{1,2}:\d{2}\b)/i,
    );
    if (timeMatch) {
      scheduledTime = timeMatch[0];
    }

    const result: ExtractedTask = {
      title,
      summary,
      category,
      priority,
      scheduledDate,
      tags: ['fallback', category.toLowerCase()],
      subtasks,
      location,
      contactPerson,
      amount,
      scheduledTime,
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
