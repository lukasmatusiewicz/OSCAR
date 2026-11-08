import { PIITokenMap, PIIType, SanitizationResult, RiskLevel } from '../types/contracts.js';

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
  PERSON: 6,
  ADDRESS: 7,
};

/**
 * Authoritative Token Pattern covering all 7 categories
 */
export const TOKEN_PATTERN =
  /\[(?:SECRET_KEY|IBAN|EMAIL|PHONE|AMOUNT_MONEY|PERSON|ADDRESS)_\d+\]/g;

export const INTERNATIONAL_CITIES = [
  'New York',
  'Kassel',
  'Berlin',
  'Paris',
  'Warsaw',
  'Warszawa',
  'Warszawie',
  'London',
  'Londynie',
  'Zurich',
  'Zürich',
  'Tokyo',
  'Tokio',
  'Vienna',
  'Wien',
  'Wiedniu',
  'Rome',
  'Roma',
  'Rzymie',
  'Madrid',
  'Madrycie',
  'Krakow',
  'Kraków',
  'Krakowie',
  'Wrocław',
  'Wrocławiu',
  'Munich',
  'München',
  'Monachium',
  'Hamburg',
  'Frankfurt',
  'Geneva',
  'Genewa',
  'Brussels',
  'Bruksela',
  'Brukseli',
  'Amsterdam',
  'Poznań',
  'Poznaniu',
  'Gdańsk',
  'Gdańsku',
];

export const EXCLUDED_NAME_WORDS = new Set([
  'new',
  'york',
  'kassel',
  'berlin',
  'paris',
  'warsaw',
  'warszawa',
  'warszawie',
  'london',
  'londynie',
  'zurich',
  'zürich',
  'tokyo',
  'tokio',
  'vienna',
  'wien',
  'wiedniu',
  'rome',
  'roma',
  'rzymie',
  'madrid',
  'madrycie',
  'krakow',
  'kraków',
  'krakowie',
  'wrocław',
  'wrocławiu',
  'munich',
  'münchen',
  'monachium',
  'hamburg',
  'frankfurt',
  'geneva',
  'genewa',
  'brussels',
  'bruksela',
  'brukseli',
  'amsterdam',
  'poznań',
  'poznaniu',
  'gdańsk',
  'gdańsku',
  'street',
  'st',
  'road',
  'rd',
  'avenue',
  'ave',
  'boulevard',
  'blvd',
  'drive',
  'dr',
  'ulica',
  'aleja',
  'plac',
  'rue',
  'chemin',
  'straße',
  'strasse',
  'weg',
  'platz',
  'gasse',
  'herrn',
  'herr',
  'frau',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'the',
  'this',
  'that',
  'these',
  'those',
  'our',
  'your',
  'their',
  'his',
  'her',
  'its',
  'prime',
  'residence',
  'office',
  'store',
  'branch',
  'hotel',
  'building',
  'deliver',
  'visit',
  'package',
  'schedule',
  'call',
  'meet',
  'meeting',
  'contact',
  'send',
  'review',
  'create',
  'update',
  'delete',
  'check',
  'follow',
  'spotkanie',
  'rozmowa',
  'zadanie',
  'notatka',
  'telefon',
  'kontakt',
  'przekaż',
]);

/**
 * Recursively re-hydrates tokens in a parsed JSON structure using atomic single-pass regex replacement.
 * Accepts either an ephemeral Map<string, string> or an array of PIITokenMap records (e.g. from SanitizationResult.tokens).
 *
 * @param target Data structure returned from AI inference or string
 * @param tokenMapOrTokens Map linking token string (e.g. "[PERSON_1]") to cleartext original value OR array of PIITokenMap records
 */
export function rehydrate<T>(target: T, tokenMapOrTokens: Map<string, string> | PIITokenMap[]): T {
  const tokenMap: Map<string, string> = Array.isArray(tokenMapOrTokens)
    ? new Map(tokenMapOrTokens.map((t) => [t.token, t.originalValue]))
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
    return target.map((item) => rehydrate(item, tokenMap)) as unknown as T;
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
    text = text.normalize('NFC');
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
        endIndex: match.endIndex,
      });
    }

    // Sort descending by startIndex for safe Right-to-Left string substitution
    const rtlTokens = [...tokens].sort((a, b) => b.startIndex - a.startIndex);

    let sanitized = text;
    for (const item of rtlTokens) {
      sanitized =
        sanitized.substring(0, item.startIndex) + item.token + sanitized.substring(item.endIndex);
    }

    return {
      sanitizedText: sanitized,
      tokenCount: tokens.length,
      tokens, // In sequential order for audit and downstream processing
      timestamp: new Date().toISOString(),
      riskLevel: this.calculateRisk(
        tokens.length,
        tokens.map((t) => t.type),
      ),
    };
  }

  /**
   * Priority-weighted overlap resolution:
   * Sorts matches primarily by priority ascending (1: SECRET_KEY before 7: ADDRESS),
   * secondarily by startIndex ascending, tertiarily by span length descending.
   * Iterates through candidates and greedily accepts candidate spans that do not
   * intersect any already-accepted span (candidate.startIndex < accepted.endIndex && candidate.endIndex > accepted.startIndex).
   * Finally, sorts accepted matches by startIndex ascending for deterministic Right-to-Left substitution.
   */
  public static resolveOverlaps(matches: RawMatch[]): RawMatch[] {
    if (matches.length <= 1) return matches;

    // Sort: 1) Priority ascending (1 to 7), 2) startIndex ascending, 3) span length descending
    const candidates = [...matches].sort((a, b) => {
      const prioDiff = CATEGORY_PRIORITY[a.type] - CATEGORY_PRIORITY[b.type];
      if (prioDiff !== 0) return prioDiff;
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return b.endIndex - b.startIndex - (a.endIndex - a.startIndex);
    });

    const accepted: RawMatch[] = [];

    for (const candidate of candidates) {
      // Check if candidate intersects with any already accepted span
      const hasOverlap = accepted.some(
        (acc) => candidate.startIndex < acc.endIndex && candidate.endIndex > acc.startIndex,
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
    if (types.includes('SECRET_KEY') || types.includes('IBAN') || count >= 3) return 'HIGH';
    if (count === 2 || types.includes('AMOUNT_MONEY') || types.includes('ADDRESS')) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Deterministic match collection across all 7 compiled ECMAScript RegExp patterns.
   */
  private static collectAllMatches(text: string): RawMatch[] {
    const matches: RawMatch[] = [];

    // 1. SECRET_KEY (Priority 1)
    const secretKeyRegex =
      /\b(?:bearer\s+[a-z0-9_.-]{20,}|ghp_[a-z0-9]{36}|ai[a-z0-9_-]{30,}|sk-[a-z0-9]{32,})\b/giu;
    for (const m of text.matchAll(secretKeyRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'SECRET_KEY',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    // 2. IBAN (Priority 2, case-insensitive giu)
    const ibanRegex = /\b[a-z]{2}[0-9]{2}(?:[ ]?[0-9]{4}){4,7}(?:[ ]?[0-9]{1,4})?\b/giu;
    for (const m of text.matchAll(ibanRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'IBAN',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
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
          endIndex: m.index + m[0].length,
        });
      }
    }

    // 4. PHONE (Priority 4)
    // Delimited international, French paired, German, Polish 9-digit, and US formatted numbers
    const phoneRegex = new RegExp(
      '(?:' +
        // 1. With international prefix (+ or 00)
        '(?:\\+|00)\\d{1,3}[\\s.-]?(?:' +
          '\\d[\\s.-]?(?:\\d{2}[\\s.-]?){3}\\d{2}' + // French +33 1 42 68 55 00
          '|' +
          '(?:\\(?\\d{1,4}\\)?[\\s.-]?)?\\d{3,4}[\\s.-]?\\d{3,4}' + // +49 170 1234567, +1-800-555-0199
          '|' +
          '\\d{1,4}[\\s.-]?\\d{5,8}' + // +49 30 123456
        ')' +
        '|' +
        // 2. Parenthesized area code: (030) 9876-5432
        '\\(\\d{2,4}\\)[\\s.-]?\\d{3,4}[\\s.-]?\\d{3,4}' +
        '|' +
        // 3. Delimited 10-digit US/CAN: 555-123-4567 or 555.123.4567
        '\\b\\d{3}[.-]\\d{3}[.-]\\d{4}' +
        '|' +
        // 4. Delimited 9-digit PL/EU: 601 234 567 or 601-234-567
        '\\b\\d{3}[\\s.-]\\d{3}[\\s.-]\\d{3}' +
      ')\\b',
      'gu',
    );
    for (const m of text.matchAll(phoneRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'PHONE',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    // 5. AMOUNT_MONEY (Priority 5)
    // Currencies: symbols ($€£¥) and codes (PLN, EUR, USD, GBP, CHF, zł, złotych, euro)
    // Multipliers: k, k€, k PLN, tys, tys., tysięcy, mln, milionów, mld
    // Spacing/typos: 15 000, 15 0000, 15.000,00
    const currencies = '(?:[\\$€£¥]|(?:PLN|EUR|USD|GBP|CHF|złotych|zł|euro)(?!\\p{L}))';
    const multipliers = '(?:k€|k\\s*PLN|k|tys\\.?(?!\\p{L})|tysięcy|mln|milionów|mld)';
    const number = '\\d+(?:[.,\\s]\\d+)*';

    const moneyRegex = new RegExp(
      '(?:' +
        currencies +
        '\\s*' +
        number +
        '(?:\\s*' +
        multipliers +
        ')?' +
        '|' +
        '(?<!\\p{L})' +
        number +
        '\\s*' +
        multipliers +
        '(?:\\s*' +
        currencies +
        ')?' +
        '|' +
        '(?<!\\p{L})' +
        number +
        '\\s*' +
        currencies +
        ')',
      'giu',
    );

    for (const m of text.matchAll(moneyRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'AMOUNT_MONEY',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    // 6. PERSON (Priority 6)
    // Multilingual contextual patterns for English, Polish, German, French
    // Honorifics: Mr., Mrs., Ms., Dr., Prof., Pan, Pani, Pana, Panią, dr, mec, Herr, Frau, M., Mme
    // Trigger prepositions: with|z|ze|mit|bei|avec|pour|meeting with|spotkanie z|rozmowa z|Treffen mit|rendez-vous avec|for|from|by|to|dla|od|przez|do|für|von|de|par|call|contact|assigned to|meeting|spotkanie|rozmowa|treffen|rendez-vous
    const honorificsList = [
      'Mr\\.',
      'Mrs\\.',
      'Ms\\.',
      'Dr\\.',
      'Prof\\.',
      'Pan',
      'Pani',
      'Pana',
      'Panią',
      'dr',
      'dr\\.',
      'mec\\.',
      'mec',
      'Herr',
      'Herrn',
      'Frau',
      'M\\.',
      'Mme\\.',
      'Mme',
    ];

    const prepWords = [
      'meeting with',
      'spotkanie z',
      'rozmowa z',
      'treffen mit',
      'rendez-vous avec',
      'meeting',
      'spotkanie',
      'rozmowa',
      'treffen',
      'rendez-vous',
      'with',
      'z',
      'ze',
      'mit',
      'bei',
      'avec',
      'pour',
      'for',
      'from',
      'by',
      'to',
      'dla',
      'od',
      'przez',
      'do',
      'für',
      'von',
      'de',
      'par',
      'call',
      'contact',
      'assigned to',
    ];

    const prepPattern = prepWords
      .map((phrase) =>
        phrase
          .split(' ')
          .map((w) => `[${w[0].toLowerCase()}${w[0].toUpperCase()}]${w.slice(1)}`)
          .join('\\s+'),
      )
      .join('|');

    const honPattern = honorificsList.join('|');
    const nameWord = '\\p{Lu}[\\p{Ll}\'-]+';

    // Contextual trigger preposition followed by 2-3 capitalized name words
    const personPrepRegex = new RegExp(
      `\\b(?:${prepPattern})\\s+(${nameWord}(?:\\s+${nameWord}){1,2})`,
      'gu',
    );

    // Honorific(s) followed by 1-3 capitalized name words
    const personHonRegex = new RegExp(
      `\\b(?:(?:${honPattern})\\s+)+${nameWord}(?:\\s+${nameWord}){0,2}`,
      'gu',
    );

    const initialPersonMatches: RawMatch[] = [];

    for (const m of text.matchAll(personHonRegex)) {
      if (m.index !== undefined) {
        initialPersonMatches.push({
          type: 'PERSON',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    for (const m of text.matchAll(personPrepRegex)) {
      if (m.index !== undefined && m[1]) {
        const lowerVal = m[1].toLowerCase();
        const isCityOrExcluded =
          INTERNATIONAL_CITIES.some((c) => c.toLowerCase() === lowerVal) ||
          EXCLUDED_NAME_WORDS.has(lowerVal) ||
          m[1].split(/\s+/).some((w) => EXCLUDED_NAME_WORDS.has(w.toLowerCase()));
        if (isCityOrExcluded) continue;

        const offset = m[0].lastIndexOf(m[1]);
        const s = m.index + offset;
        const e = s + m[1].length;
        const alreadyMatched = initialPersonMatches.some(
          (existing) => s < existing.endIndex && e > existing.startIndex,
        );
        if (!alreadyMatched) {
          initialPersonMatches.push({
            type: 'PERSON',
            value: m[1],
            startIndex: s,
            endIndex: e,
          });
        }
      }
    }

    const pairRegex = /\b(\p{Lu}[\p{Ll}'-]+)\s+(\p{Lu}[\p{Ll}'-]+)\b/gu;
    for (const m of text.matchAll(pairRegex)) {
      if (m.index !== undefined) {
        const w1 = m[1].toLowerCase();
        const w2 = m[2].toLowerCase();
        if (!EXCLUDED_NAME_WORDS.has(w1) && !EXCLUDED_NAME_WORDS.has(w2)) {
          const s = m.index;
          const e = s + m[0].length;
          const alreadyMatched = initialPersonMatches.some(
            (existing) => s < existing.endIndex && e > existing.startIndex,
          );
          if (!alreadyMatched) {
            initialPersonMatches.push({
              type: 'PERSON',
              value: m[0],
              startIndex: s,
              endIndex: e,
            });
          }
        }
      }
    }

    matches.push(...initialPersonMatches);

    // Discovered name propagation across the text for full deduplication (case-insensitive giu)
    const discoveredNames = new Set<string>();
    for (const pm of initialPersonMatches) {
      discoveredNames.add(pm.value);
      const bareName = pm.value
        .replace(
          /^(?:(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Pan|Pani|Pana|Panią|dr|dr\.|mec\.|mec|Herr|Herrn|Frau|M\.|Mme\.|Mme)\s+)+/i,
          '',
        )
        .trim();
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
          const alreadyMatched = matches.some(
            (existing) => s < existing.endIndex && e > existing.startIndex,
          );
          if (!alreadyMatched) {
            matches.push({
              type: 'PERSON',
              value: nm[0],
              startIndex: s,
              endIndex: e,
            });
          }
        }
      }
    }

    // 7. ADDRESS (Priority 7)
    // Street patterns: prefixes (ul., al., pl., os., aleja, plac, ulica, rue, bd, boulevard, avenue, av., Straße, Strasse, Str., Weg, Platz, St., Street, Ave., Avenue, Rd., Road, Blvd., Drive, Dr.)
    // followed by street name and optional number (e.g. ul. Marszałkowska 10, Friedrichstraße 42, rue de Rivoli 5, Baker Street 221B)
    // Major international cities/hubs: New York, Kassel, Berlin, Paris, Warsaw, Warszawa, London, Zurich, Zürich, Tokyo, Vienna, Wien, Rome, Roma, Madrid, Krakow, Kraków, Wrocław, Munich, München, Hamburg, Frankfurt
    const cityPattern = `(?:${INTERNATIONAL_CITIES.join('|')})(?!\\p{L})`;

    const streetPrefixWords = [
      'ul\\.',
      'ulica',
      'al\\.',
      'aleja',
      'pl\\.',
      'plac',
      'os\\.',
      'rue',
      'bd',
      'boulevard',
      'avenue',
      'av\\.',
      'straße',
      'strasse',
      'str\\.',
      'weg',
      'platz',
      'st\\.',
      'street',
      'ave\\.',
      'avenue',
      'rd\\.',
      'road',
      'blvd\\.',
    ];

    const streetPrefixes = streetPrefixWords
      .map((w) => `[${w[0].toLowerCase()}${w[0].toUpperCase()}]${w.slice(1)}`)
      .join('|');

    const streetPostfixWords = [
      'Street',
      'St\\.',
      'Avenue',
      'Ave\\.',
      'Road',
      'Rd\\.',
      'Boulevard',
      'Blvd\\.',
      'Drive',
      'Dr\\.',
      'Straße',
      'Strasse',
      'Str\\.',
      'Weg',
      'Platz',
      'Gasse',
    ];
    const streetPostfixes = streetPostfixWords.join('|');

    const streetPattern1 = `\\b(?:\\d+[a-zA-Z]?[\\s,]+)?(?:${streetPrefixes})\\s+(?:(?:de|d'|du|des|von|van|der|am)\\s+)?\\p{Lu}[\\p{L}'-]+(?:\\s+(?:(?:de|d'|du|des|von|van|der|am)\\s+)?\\p{Lu}[\\p{L}'-]+){0,2}(?:\\s+\\d+[a-zA-Z]?(?:[/-]\\d+[a-zA-Z]?)?)?`;
    const streetPattern2 = `\\b\\p{Lu}[\\p{L}'-]*(?:straße|strasse)\\b(?:\\s+\\d+[a-zA-Z]?(?:[/-]\\d+[a-zA-Z]?)?)?`;
    const streetPattern3 = `\\b\\p{Lu}[\\p{L}'-]+(?:\\s+\\p{Lu}[\\p{L}'-]+)?\\s+(?:${streetPostfixes})(?:\\s+\\d+[a-zA-Z]?(?:[/-]\\d+[a-zA-Z]?)?)?\\b`;
    const streetPattern4 = `\\b\\d+\\s+\\p{Lu}[\\p{L}'-]+\\s+(?:${streetPostfixes})\\b`;

    const addressRegex = new RegExp(
      `(?:${streetPattern1}|${streetPattern2}|${streetPattern4}|${streetPattern3}|${cityPattern})`,
      'gu',
    );

    for (const m of text.matchAll(addressRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'ADDRESS',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    return matches;
  }

  /**
   * Rehydrates synthetic tokens in target structure.
   */
  public static rehydrate<T>(target: T, tokenMapOrTokens: Map<string, string> | PIITokenMap[]): T {
    return rehydrate(target, tokenMapOrTokens);
  }
}
