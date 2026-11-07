import {
  PIITokenMap,
  PIIType,
  SanitizationResult,
  RiskLevel
} from '../types/contracts.js';

export interface RawMatch {
  type: PIIType;
  value: string;
  startIndex: number;
  endIndex: number;
}

export const CATEGORY_PRIORITY: Record<PIIType, number> = {
  SECRET_KEY: 1,
  IBAN: 2,
  EMAIL: 3,
  PHONE: 4,
  AMOUNT_MONEY: 5,
  PERSON: 6
};

/**
 * Authoritative Token Pattern covering all 6 categories
 */
export const TOKEN_PATTERN = /\[(?:SECRET_KEY|IBAN|EMAIL|PHONE|AMOUNT_MONEY|PERSON)_\d+\]/g;

/**
 * Recursively re-hydrates tokens in a parsed JSON structure using atomic single-pass regex replacement.
 * Accepts either an ephemeral Map<string, string> or an array of PIITokenMap records (e.g. from SanitizationResult.tokens).
 *
 * @param target Data structure returned from AI inference or string
 * @param tokenMapOrTokens Map linking token string (e.g. "[PERSON_1]") to cleartext original value OR array of PIITokenMap records
 */
export function rehydrate<T>(
  target: T,
  tokenMapOrTokens: Map<string, string> | PIITokenMap[]
): T {
  const tokenMap: Map<string, string> = Array.isArray(tokenMapOrTokens)
    ? new Map(tokenMapOrTokens.map(t => [t.token, t.originalValue]))
    : tokenMapOrTokens;

  // Base case 1: String primitive — atomic single-pass substitution
  if (typeof target === 'string') {
    const pattern = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags);
    return target.replace(pattern, (match) => {
      return tokenMap.get(match) ?? match;
    }) as unknown as T;
  }

  // Base case 2: Array elements — recursive mapping
  if (Array.isArray(target)) {
    return target.map(item => rehydrate(item, tokenMap)) as unknown as T;
  }

  // Base case 3: Nested object structures — recursive property walk
  if (target !== null && typeof target === 'object') {
    if (target instanceof Date) {
      return target;
    }
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(target)) {
      clone[key] = rehydrate(value, tokenMap);
    }
    return clone as unknown as T;
  }

  // Base case 4: Non-string primitives (numbers, booleans, null, undefined)
  return target;
}

export class PrivacyGuard {
  /**
   * Masks sensitive information using Priority Overlap Resolution and Right-to-Left replacement.
   */
  public static mask(text: string): SanitizationResult {
    const rawMatches: RawMatch[] = this.collectAllMatches(text);
    const nonOverlapping = this.resolveOverlaps(rawMatches);

    // Entity deduplication map (normalized entity value -> assigned token)
    const entityToToken = new Map<string, string>();
    const typeCounters: Record<string, number> = {};
    const tokens: PIITokenMap[] = [];

    // Assign tokens in reading order (ascending startIndex) for consistent numbering
    const matchesInOrder = [...nonOverlapping].sort((a, b) => a.startIndex - b.startIndex);

    for (const match of matchesInOrder) {
      const normalizedKey = `${match.type}:${match.value.trim().toLowerCase()}`;
      let assignedToken = entityToToken.get(normalizedKey);

      if (!assignedToken) {
        typeCounters[match.type] = (typeCounters[match.type] || 0) + 1;
        assignedToken = `[${match.type}_${typeCounters[match.type]}]`;
        entityToToken.set(normalizedKey, assignedToken);
      }

      tokens.push({
        token: assignedToken,
        type: match.type,
        originalValue: match.value,
        startIndex: match.startIndex,
        endIndex: match.endIndex
      });
    }

    // Sort descending by startIndex for safe Right-to-Left string substitution
    const rtlTokens = [...tokens].sort((a, b) => b.startIndex - a.startIndex);

    let sanitized = text;
    for (const item of rtlTokens) {
      sanitized =
        sanitized.substring(0, item.startIndex) +
        item.token +
        sanitized.substring(item.endIndex);
    }

    return {
      sanitizedText: sanitized,
      tokenCount: tokens.length,
      tokens, // In sequential order for audit and downstream processing
      timestamp: new Date().toISOString(),
      riskLevel: this.calculateRisk(tokens.length, tokens.map(t => t.type))
    };
  }

  /**
   * Priority-weighted overlap resolution:
   * Sorts matches primarily by priority ascending (1: SECRET_KEY before 6: PERSON),
   * secondarily by startIndex ascending, tertiarily by span length descending.
   * Iterates through candidates and greedily accepts candidate spans that do not
   * intersect any already-accepted span (candidate.startIndex < accepted.endIndex && candidate.endIndex > accepted.startIndex).
   * Finally, sorts accepted matches by startIndex ascending for deterministic Right-to-Left substitution.
   */
  public static resolveOverlaps(matches: RawMatch[]): RawMatch[] {
    if (matches.length <= 1) return matches;

    // Sort: 1) Priority ascending (1 to 6), 2) startIndex ascending, 3) span length descending
    const candidates = [...matches].sort((a, b) => {
      const prioDiff = CATEGORY_PRIORITY[a.type] - CATEGORY_PRIORITY[b.type];
      if (prioDiff !== 0) return prioDiff;
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
    });

    const accepted: RawMatch[] = [];

    for (const candidate of candidates) {
      // Check if candidate intersects with any already accepted span
      const hasOverlap = accepted.some(
        acc => candidate.startIndex < acc.endIndex && candidate.endIndex > acc.startIndex
      );

      if (!hasOverlap) {
        accepted.push(candidate);
      }
    }

    // Sort by startIndex ascending for reading order and subsequent RTL substitution
    return accepted.sort((a, b) => a.startIndex - b.startIndex);
  }

  /**
   * Calculates privacy risk level based on token count and category sensitivity.
   */
  public static calculateRisk(count: number, types: PIIType[]): RiskLevel {
    if (count === 0) return 'NONE';
    if (types.includes('SECRET_KEY') || types.includes('IBAN')) return 'HIGH';
    if (count >= 3) return 'HIGH';
    if (count === 2) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Deterministic match collection across all 6 compiled ECMAScript RegExp patterns.
   */
  private static collectAllMatches(text: string): RawMatch[] {
    const matches: RawMatch[] = [];

    // 1. SECRET_KEY (Priority 1)
    const secretKeyRegex = /\b(?:bearer\s+[a-z0-9_.-]{20,}|ghp_[a-z0-9]{36}|ai[a-z0-9_-]{30,}|sk-[a-z0-9]{32,})\b/giu;
    for (const m of text.matchAll(secretKeyRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'SECRET_KEY',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length
        });
      }
    }

    // 2. IBAN (Priority 2)
    const ibanRegex = /\b[A-Z]{2}[0-9]{2}(?:[ ]?[0-9]{4}){4,7}(?:[ ]?[0-9]{1,4})?\b/gu;
    for (const m of text.matchAll(ibanRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'IBAN',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length
        });
      }
    }

    // 3. EMAIL (Priority 3)
    const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/giu;
    for (const m of text.matchAll(emailRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'EMAIL',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length
        });
      }
    }

    // 4. PHONE (Priority 4)
    const phoneRegex = /(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/gu;
    for (const m of text.matchAll(phoneRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'PHONE',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length
        });
      }
    }

    // 5. AMOUNT_MONEY (Priority 5)
    const moneyRegex = /(?:(?:\$|€|£|\b(?:PLN|EUR|USD))\s?\d+(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\b\d+(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\s?(?:€|\$|£|(?:PLN|EUR|USD)\b))/giu;
    for (const m of text.matchAll(moneyRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'AMOUNT_MONEY',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length
        });
      }
    }

    // 6. PERSON (Priority 6)
    const personRegex = /(?:\b(?:Herr|Frau|Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)\s+\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)|(?:(?<=\b(?:[wW]ith|[mM]eeting|[cC]all|[fF]or|[fF]rom|[bB]y|[tT]o|[cC]ontact|[aA]ssigned [tT]o)\s+)\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)+)/gu;
    const initialPersonMatches: RawMatch[] = [];
    for (const m of text.matchAll(personRegex)) {
      if (m.index !== undefined) {
        initialPersonMatches.push({
          type: 'PERSON',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length
        });
      }
    }

    matches.push(...initialPersonMatches);

    // Propagate detected person entities across the text (case-insensitively for entity deduplication)
    const discoveredNames = new Set<string>();
    for (const pm of initialPersonMatches) {
      discoveredNames.add(pm.value);
      const bareName = pm.value.replace(/^(?:Herr|Frau|Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)\s+/i, '').trim();
      if (bareName.includes(' ')) {
        discoveredNames.add(bareName);
      }
    }

    for (const name of discoveredNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nameRegex = new RegExp(`\\b${escaped}\\b`, 'giu');
      for (const nm of text.matchAll(nameRegex)) {
        if (nm.index !== undefined) {
          const s = nm.index;
          const e = s + nm[0].length;
          const alreadyMatched = matches.some(existing => s < existing.endIndex && e > existing.startIndex);
          if (!alreadyMatched) {
            matches.push({
              type: 'PERSON',
              value: nm[0],
              startIndex: s,
              endIndex: e
            });
          }
        }
      }
    }

    return matches;
  }

  /**
   * Rehydrates synthetic tokens in target structure.
   */
  public static rehydrate<T>(
    target: T,
    tokenMapOrTokens: Map<string, string> | PIITokenMap[]
  ): T {
    return rehydrate(target, tokenMapOrTokens);
  }
}
