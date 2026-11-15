import {
  ExtractedTask,
  TaskPriority,
  TaskCategory,
  SubtaskItem,
  ExtractedTaskSchema,
  normalizePersonToNominative,
  normalizeAddressCasing,
  TEMPORAL_STOP_WORDS,
  resolveRelativeDate,
  extractScheduledTime,
} from '@oscar/shared';

export { extractScheduledTime };

export interface DeterministicExtractionResult {
  task: ExtractedTask;
  provenance: 'DETERMINISTIC_FALLBACK';
  modelVersion: 'rule-based-v1';
}

const PREAMBLE_REGEX =
  /^(?:hey|hi|hello|cześć|hej|hallo|bonjour|dear|szanowny|szanowna|panie|pani)(?:\s+[\p{L}]+)*[,\s:]+/iu;

const DIRECTIVE_FILLERS_REGEX =
  /^(?:please\s+remind\s+me\s+to|remind\s+me\s+to|add\s+to\s+(?:my|the)\s+(?:to-?do\s+)?list|add\s+to\s+list|put\s+on\s+(?:my|the)\s+list|don't\s+forget\s+to|remember\s+to|i\s+need\s+to|we\s+need\s+to|i\s+must|we\s+must|dodaj\s+mi\s+do\s+listy(?:\s+zadań|\s+rzeczy\s+do\s+zrobienia)?|dodaj\s+do\s+listy(?:\s+zadań|\s+rzeczy\s+do\s+zrobienia)?|dopisz\s+do\s+listy(?:\s+zadań)?|zapisz\s+na\s+liście(?:\s+zadań)?|pamiętaj\s+(?:żeby|aby)(?:\s+zaplanować)?|przypomnij\s+mi(?:\s+(?:żeby|aby|o|że))?|muszę|musimy|zaplanuj|zanotuj|füge\s+(?:mir\s+)?(?:zur|zu\s+meiner)\s+liste\s+hinzu|erinnere\s+mich\s+(?:an\s+das|an|daran)|vergiss\s+nicht\s+zu|ajoute\s+à\s+(?:ma|la)\s+liste|n'oublie\s+pas\s+de|pense\s+à|rappelle-moi\s+de|memo|notes?)(?:\s*[:,-])?(?:\s+|$)/iu;

/**
 * Strips conversational preambles and command prefixes (e.g., "Dodaj mi do listy...",
 * "Przypomnij mi...", "Add to my list...", "Remind me to...") from a task title.
 */
export function stripCommandPrefixes(rawTitle: string): string {
  if (!rawTitle || typeof rawTitle !== 'string') return rawTitle;
  let cleaned = rawTitle.trim();
  let changed = true;
  while (changed) {
    changed = false;
    if (PREAMBLE_REGEX.test(cleaned)) {
      const next = cleaned.replace(PREAMBLE_REGEX, '').trim();
      if (next.length >= 3) {
        cleaned = next;
        changed = true;
      }
    }
    if (DIRECTIVE_FILLERS_REGEX.test(cleaned)) {
      const next = cleaned.replace(DIRECTIVE_FILLERS_REGEX, '').trim();
      if (next.length >= 3) {
        cleaned = next;
        changed = true;
      }
    }
  }
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Deduplicates repeated card metadata bullet lines (Contact, Location, Amount, Time, Date)
 * inside a structured task summary so each metadata bullet appears at most once.
 */
export function deduplicateSummaryMetadata(summary: string): string {
  if (!summary || typeof summary !== 'string') return summary;
  const markerPatterns = [
    /(?:•\s*)?👤\s*Contact:/i,
    /(?:•\s*)?📍\s*Location:/i,
    /(?:•\s*)?💰\s*Amount:/i,
    /(?:•\s*)?⏰\s*Time:/i,
    /(?:•\s*)?📅\s*Date:/i,
  ];
  const seen = new Set<number>();
  const lines = summary.split('\n');
  const filtered: string[] = [];

  for (const line of lines) {
    const markerIdx = markerPatterns.findIndex((p) => p.test(line));
    if (markerIdx !== -1) {
      if (seen.has(markerIdx)) {
        continue;
      }
      seen.add(markerIdx);
    }
    filtered.push(line);
  }

  return filtered.join('\n');
}

/**
 * DeterministicFallbackExtractor provides rule-based structured extraction
 * for user memos when upstream AI providers fail, timeout, or hit rate limits.
 * Implements architecture.md Section 5.2 and contracts.md Section 4.3.
 */
export class DeterministicFallbackExtractor {
  public static readonly PROVENANCE = 'DETERMINISTIC_FALLBACK' as const;
  public static readonly MODEL_VERSION = 'rule-based-v1' as const;
  public static readonly CARD_METADATA_MARKER_REGEX =
    /(?:•\s*)?(?:👤\s*Contact:|📍\s*Location:|💰\s*Amount:|⏰\s*Time:|📝\s*Notes:)[^\r\n]*/gi;

  public static extractScheduledTime(text: string): string | null {
    return extractScheduledTime(text);
  }

  /**
   * Deterministically parses a sanitized or raw memo into ExtractedTask without AI inference.
   */
  public static extract(memoText: string): ExtractedTask {
    const lines = memoText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Extract first clause/sentence by splitting on sentence terminators ([.?!]) or newlines
    const rawClauses = memoText
      .split(/(?:(?<!\d)[.?!](?:\s+|$)|(?<!\d)[.?!]$|\r?\n)+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const nonMetadataClause = rawClauses.find(
      (c) =>
        c
          .replace(
            /(?:•\s*)?(?:👤\s*Contact:|📍\s*Location:|💰\s*Amount:|⏰\s*Time:|📝\s*Notes:)[^\r\n]*/gi,
            '',
          )
          .trim().length > 0,
    );
    const firstClause = nonMetadataClause ?? rawClauses[0] ?? (lines[0] ?? 'New Memo Action Item');

    // Title: Synthesized semantic title invariant conforming to contracts.md Section 4.3
    let cleaned = firstClause
      .replace(
        /(?:•\s*)?(?:👤\s*Contact:|📍\s*Location:|💰\s*Amount:|⏰\s*Time:|📝\s*Notes:)[^\r\n]*/gi,
        '',
      )
      .trim();

    // Strip conversational preambles and directive fillers
    let changed = true;
    while (changed) {
      changed = false;
      if (PREAMBLE_REGEX.test(cleaned)) {
        cleaned = cleaned.replace(PREAMBLE_REGEX, '').trim();
        changed = true;
      }
      if (DIRECTIVE_FILLERS_REGEX.test(cleaned)) {
        cleaned = cleaned.replace(DIRECTIVE_FILLERS_REGEX, '').trim();
        changed = true;
      }
    }

    // Strip card metadata markers again if exposed after preamble/filler removal
    cleaned = cleaned
      .replace(
        /(?:•\s*)?(?:👤\s*Contact:|📍\s*Location:|💰\s*Amount:|⏰\s*Time:|📝\s*Notes:)[^\r\n]*/gi,
        '',
      )
      .trim();

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
    let scheduledDate = dateMatch ? dateMatch[0] : null;
    if (!scheduledDate) {
      scheduledDate = resolveRelativeDate(memoText);
    }

    // Subtasks: Bullet items or line items, guaranteeing min(1) subtask
    const subtaskCandidates: SubtaskItem[] = lines
      .filter((l) => /^[-*•\d.]+\s+/.test(l))
      .filter(
        (l) =>
          l
            .replace(/^[-*•\d.]+\s+/, '')
            .replace(
              /(?:•\s*)?(?:👤\s*Contact:|📍\s*Location:|💰\s*Amount:|⏰\s*Time:|📝\s*Notes:)[^\r\n]*/gi,
              '',
            )
            .trim().length > 0,
      )
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
        location = normalizeAddressCasing(cityMatch[0]);
      } else {
        const streetMatch = memoText.match(
          /\b(?:(?:ul\.|al\.|pl\.|os\.|plac|rue|boulevard|bd\.?)\s+[\p{L}\d\s-]+?\d+[a-z]?|[\p{L}\d-]+(?:straße|strasse|str\.)\s*\d+[a-z]?|\d+\s+[\p{L}\s]+(?:street|st|avenue|ave|boulevard|blvd|road|rd)\b|[\p{L}\s]+(?:street|st|avenue|ave|boulevard|blvd|road|rd)\s+\d+[a-z]?)/iu,
        );
        if (streetMatch) {
          location = normalizeAddressCasing(streetMatch[0]);
        }
      }
    }
    if (!location) {
      const cardLocationMatch = memoText.match(/(?:•\s*)?📍\s*Location:\s*([^\r\n]+)/i);
      if (cardLocationMatch && cardLocationMatch[1]) {
        location = normalizeAddressCasing(cardLocationMatch[1].trim());
      }
    }

    let contactPerson: string | null = null;
    const personTokenMatch = memoText.match(/\[PERSON_\d+\]/);
    if (personTokenMatch) {
      contactPerson = personTokenMatch[0];
    } else {
      const personMatch = memoText.match(
        /(?:\b(?:Herr|Frau|Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.|Pan|Pani|dr|mec\.)\s+\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)*)?)|(?:(?<=\b(?:with|z|ze|mit|avec)\s+)\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)*)*)/u,
      );
      if (personMatch) {
        const words = personMatch[0].split(/\s+/);
        while (words.length > 1) {
          const lastWord = words[words.length - 1].toLowerCase().replace(/[.,]/g, '');
          if (TEMPORAL_STOP_WORDS.has(lastWord)) {
            words.pop();
          } else {
            break;
          }
        }
        if (words.length > 0 && !TEMPORAL_STOP_WORDS.has(words[0].toLowerCase().replace(/[.,]/g, ''))) {
          contactPerson = normalizePersonToNominative(words.join(' '));
        }
      }
    }
    if (!contactPerson) {
      const cardContactMatch = memoText.match(/(?:•\s*)?👤\s*Contact:\s*([^\r\n]+)/i);
      if (cardContactMatch && cardContactMatch[1]) {
        contactPerson = normalizePersonToNominative(cardContactMatch[1].trim());
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
    if (!amount) {
      const cardAmountMatch = memoText.match(/(?:•\s*)?💰\s*Amount:\s*([^\r\n]+)/i);
      if (cardAmountMatch && cardAmountMatch[1]) {
        amount = cardAmountMatch[1].trim();
      }
    }

    let scheduledTime: string | null = extractScheduledTime(memoText);
    if (!scheduledTime) {
      const cardTimeMatch = memoText.match(/(?:•\s*)?⏰\s*Time:\s*([^\r\n]+)/i);
      if (cardTimeMatch && cardTimeMatch[1]) {
        scheduledTime = cardTimeMatch[1].trim();
      }
    }

    // Google Calendar-Style Structured Summary (RFC 5545 alignment)
    // 1. Core objective / description
    let coreObjective = cleaned;
    const firstClauseCleaned = firstClause
      .replace(
        /(?:•\s*)?(?:👤\s*Contact:|📍\s*Location:|💰\s*Amount:|⏰\s*Time:|📝\s*Notes:)[^\r\n]*/gi,
        '',
      )
      .replace(/[.?!,:;\s]+$/, '')
      .trim();
    if (
      firstClauseCleaned.length > 0 &&
      cleaned.toLowerCase() === firstClauseCleaned.toLowerCase()
    ) {
      coreObjective = firstClauseCleaned;
    }

    const summaryLines: string[] = [coreObjective];

    if (contactPerson) {
      summaryLines.push(`• 👤 Contact: ${contactPerson}`);
    }
    if (location) {
      summaryLines.push(`• 📍 Location: ${location}`);
    }
    if (amount) {
      summaryLines.push(`• 💰 Amount: ${amount}`);
    }
    if (scheduledTime) {
      summaryLines.push(`• ⏰ Time: ${scheduledTime}`);
    }

    // Notes / extra details (explicit notes, remaining PII tokens, and subsequent clauses)
    const noteItems: string[] = [];
    const noteMatch = memoText.match(/(?:notes?|uwag[ai]|notatka)\s*:\s*([^.\n]+)/i);
    if (noteMatch && noteMatch[1]) {
      const explicitNote = noteMatch[1].trim();
      if (explicitNote.length > 0) {
        noteItems.push(explicitNote);
      }
    }

    // Remaining tokens to guarantee zero PII drop and full rehydration
    const allTokens = memoText.match(/\[[A-Z_]+_\d+\]/g) || [];
    const remainingTokens = allTokens.filter(
      (t) => t !== contactPerson && t !== location && t !== amount,
    );
    if (remainingTokens.length > 0) {
      const tokenStr = remainingTokens.join(', ');
      if (!noteItems.includes(tokenStr)) {
        noteItems.push(tokenStr);
      }
    }

    // Extra clauses from multi-sentence memos
    for (const clause of rawClauses.slice(1)) {
      const trimmedClause = clause.replace(/[.?!,:;\s]+$/, '').trim();
      if (!trimmedClause) continue;
      // Skip clauses that are card metadata markers
      if (
        trimmedClause
          .replace(
            /(?:•\s*)?(?:👤\s*Contact:|📍\s*Location:|💰\s*Amount:|⏰\s*Time:|📝\s*Notes:)[^\r\n]*/gi,
            '',
          )
          .trim().length === 0
      ) {
        continue;
      }
      if (noteMatch && trimmedClause.toLowerCase().includes(noteMatch[1].trim().toLowerCase()))
        continue;
      if (contactPerson && trimmedClause.toLowerCase() === contactPerson.toLowerCase()) continue;
      if (location && trimmedClause.toLowerCase() === location.toLowerCase()) continue;
      if (amount && trimmedClause.toLowerCase() === amount.toLowerCase()) continue;
      if (scheduledTime && trimmedClause.toLowerCase() === scheduledTime.toLowerCase()) continue;
      if (scheduledDate && trimmedClause.toLowerCase() === scheduledDate.toLowerCase()) continue;
      if (!noteItems.some((n) => n.includes(trimmedClause))) {
        noteItems.push(trimmedClause);
      }
    }

    if (noteItems.length > 0) {
      summaryLines.push(`• 📝 Notes: ${noteItems.join('; ')}`);
    }

    let summary = summaryLines.join('\n');
    if (summary.length > 500) {
      summary = summary.substring(0, 497) + '...';
    } else if (summary.length < 5) {
      summary = summary.padEnd(5, '.');
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
