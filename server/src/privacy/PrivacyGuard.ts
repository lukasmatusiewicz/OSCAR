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
  NATIONAL_ID: 3,
  HEALTH_DATA: 4,
  EMAIL: 5,
  PHONE: 6,
  AMOUNT_MONEY: 7,
  PERSON: 8,
  ADDRESS: 9,
};

/**
 * Authoritative Token Pattern covering all 9 GDPR categories
 */
export const TOKEN_PATTERN =
  /\[(?:SECRET_KEY|IBAN|EMAIL|PHONE|AMOUNT_MONEY|PERSON|ADDRESS|HEALTH_DATA|NATIONAL_ID)_\d+\]/g;

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
  'numer',
  'nummer',
  'number',
  'la',
  'le',
  'les',
  'du',
  'des',
  'un',
  'une',
  'facture',
]);

/**
 * Validates Polish PESEL checksum using statutory weights [1, 3, 7, 9, 1, 3, 7, 9, 1, 3].
 */
export function isValidPesel(pesel: string): boolean {
  if (!/^\d{11}$/.test(pesel)) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const digits = pesel.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += weights[i] * digits[i];
  }
  const control = (10 - (sum % 10)) % 10;
  return control === digits[10];
}

/**
 * Validates German Steuer-ID / Steueridentifikationsnummer.
 */
export function isGermanSteuerId(val: string, text: string, index: number): boolean {
  if (/^\d{2}\s\d{3}\s\d{3}\s\d{3}$/.test(val)) return true;

  const clean = val.replace(/\s+/g, '');
  if (!/^\d{11}$/.test(clean)) return false;

  const windowStart = Math.max(0, index - 30);
  const windowEnd = Math.min(text.length, index + val.length + 30);
  const context = text.substring(windowStart, windowEnd).toLowerCase();
  const taxTrigger =
    /\b(?:steuer[- ]?id|steueridentifikationsnummer|idnr|steuernummer|finanzamt|tax\s+id|tin)\b/i;
  if (taxTrigger.test(context)) return true;

  // Structural check: in first 10 digits, exactly one digit appears 2 or 3 times, others unique
  if (clean[0] !== '0') {
    const first10 = clean.slice(0, 10);
    const counts: Record<string, number> = {};
    for (const ch of first10) {
      counts[ch] = (counts[ch] || 0) + 1;
    }
    const repeated = Object.values(counts).filter((c) => c > 1);
    if (repeated.length === 1 && (repeated[0] === 2 || repeated[0] === 3)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates US Social Security Number (SSN).
 */
export function isValidSsn(ssn: string): boolean {
  const match = ssn.match(/^(\d{3})-(\d{2})-(\d{4})$/);
  if (!match) return false;
  const area = parseInt(match[1], 10);
  const group = parseInt(match[2], 10);
  const serial = parseInt(match[3], 10);
  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;
  return true;
}

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

export interface TransformersTokenEntity {
  entity_group?: string;
  entity?: string;
  word?: string;
  start?: number;
  end?: number;
  score?: number;
}

export type TransformersPipeline = (
  text: string,
) => Promise<unknown> | unknown;

export class PrivacyGuard {
  private static customPipeline: TransformersPipeline | null | undefined = undefined;
  private static cachedPipeline: TransformersPipeline | null = null;

  /**
   * Sets or mocks the Tier 2 Transformers.js pipeline (primarily for testing and in-memory injection).
   */
  public static setPipeline(pipelineInstance: TransformersPipeline | null | undefined): void {
    this.customPipeline = pipelineInstance;
  }

  /**
   * Lazy-loads local in-memory Transformers.js pipeline.
   * Strictly enforces zero-network mandate (allowRemoteModels = false).
   */
  public static async getPipeline(): Promise<TransformersPipeline | null> {
    if (this.customPipeline !== undefined) {
      return this.customPipeline;
    }
    if (this.cachedPipeline) {
      return this.cachedPipeline;
    }
    try {
      const transformers = await import('@huggingface/transformers');
      if (transformers?.env) {
        transformers.env.allowRemoteModels = false;
      }
      if (transformers && typeof transformers.pipeline === 'function') {
        const initPromise = transformers.pipeline(
          'token-classification',
          'Xenova/bert-base-multilingual-cased-ner-hrl',
        );
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('NER model load timeout > 100ms')), 100),
        );
        this.cachedPipeline = (await Promise.race([
          initPromise,
          timeoutPromise,
        ])) as TransformersPipeline;
        return this.cachedPipeline;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Asynchronously masks sensitive information using Tier 2 local in-memory Transformers.js NER
   * combined with Tier 1 and Tier 3 deterministic matchers.
   * Gracefully falls back to synchronous mask() on failure, timeout (>100ms), or offline environments.
   */
  public static async maskAsync(text: string): Promise<SanitizationResult> {
    text = text.normalize('NFC');
    try {
      const pipe =
        this.customPipeline !== undefined ? this.customPipeline : await this.getPipeline();
      if (!pipe) {
        return this.mask(text);
      }

      const inferencePromise = (async () => {
        return await pipe(text);
      })();

      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('NER pipeline timeout > 100ms')), 100),
      );

      const entityResults = await Promise.race([inferencePromise, timeoutPromise]);
      const semanticMatches: RawMatch[] = [];

      if (Array.isArray(entityResults)) {
        for (const rawItem of entityResults) {
          if (typeof rawItem === 'object' && rawItem !== null) {
            const item = rawItem as TransformersTokenEntity;
            const label = String(item.entity_group || item.entity || '');
            let matchType: PIIType | null = null;
            if (label === 'PER' || label === 'PERSON' || label.endsWith('PER')) {
              matchType = 'PERSON';
            } else if (label === 'LOC' || label === 'LOCATION' || label.endsWith('LOC')) {
              matchType = 'ADDRESS';
            }

            if (
              matchType &&
              item.word &&
              typeof item.start === 'number' &&
              typeof item.end === 'number'
            ) {
              semanticMatches.push({
                type: matchType,
                value: item.word,
                startIndex: item.start,
                endIndex: item.end,
              });
            }
          }
        }
      }

      const ruleMatches = this.collectAllMatches(text);
      const allMatches = [...ruleMatches, ...semanticMatches];

      return this.processMatches(text, allMatches);
    } catch {
      return this.mask(text);
    }
  }

  /**
   * Synchronously masks sensitive information using Tier 1 and Tier 3 matchers.
   * Guarantees 100% in-memory isolation (<50ms latency, zero network calls).
   */
  public static mask(text: string): SanitizationResult {
    text = text.normalize('NFC');
    const rawMatches: RawMatch[] = this.collectAllMatches(text);
    return this.processMatches(text, rawMatches);
  }

  /**
   * Internal processing pipeline: resolves overlaps, deduplicates entities, and executes Right-to-Left substitution.
   */
  private static processMatches(text: string, rawMatches: RawMatch[]): SanitizationResult {
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
      tokens,
      timestamp: new Date().toISOString(),
      riskLevel: this.calculateRisk(
        tokens.length,
        tokens.map((t) => t.type),
      ),
    };
  }

  /**
   * Priority-weighted overlap resolution:
   * Sorts matches primarily by priority ascending (1: SECRET_KEY before 9: ADDRESS),
   * secondarily by startIndex ascending, tertiarily by span length descending.
   * Iterates through candidates and greedily accepts candidate spans that do not
   * intersect any already-accepted span.
   */
  public static resolveOverlaps(matches: RawMatch[]): RawMatch[] {
    if (matches.length <= 1) return matches;

    const candidates = [...matches].sort((a, b) => {
      const prioDiff = CATEGORY_PRIORITY[a.type] - CATEGORY_PRIORITY[b.type];
      if (prioDiff !== 0) return prioDiff;
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return b.endIndex - b.startIndex - (a.endIndex - a.startIndex);
    });

    const accepted: RawMatch[] = [];

    for (const candidate of candidates) {
      const hasOverlap = accepted.some(
        (acc) => candidate.startIndex < acc.endIndex && candidate.endIndex > acc.startIndex,
      );

      if (!hasOverlap) {
        accepted.push(candidate);
      }
    }

    return accepted.sort((a, b) => a.startIndex - b.startIndex);
  }

  /**
   * Calculates privacy risk level based on token count and category sensitivity.
   * Inclusion of SECRET_KEY, IBAN, NATIONAL_ID, or HEALTH_DATA immediately escalates risk to HIGH.
   */
  public static calculateRisk(count: number, types: PIIType[]): RiskLevel {
    if (count === 0) return 'NONE';
    if (
      types.includes('SECRET_KEY') ||
      types.includes('IBAN') ||
      types.includes('NATIONAL_ID') ||
      types.includes('HEALTH_DATA') ||
      count >= 3
    ) {
      return 'HIGH';
    }
    if (count === 2 || types.includes('AMOUNT_MONEY') || types.includes('ADDRESS')) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  /**
   * Match collection across Tier 1 (deterministic & checksums) and Tier 3 (contextual matchers).
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

    // 3. NATIONAL_ID (Priority 3)
    // 3a. Polish PESEL (11 digits with checksum)
    const peselRegex = /\b\d{11}\b/gu;
    for (const m of text.matchAll(peselRegex)) {
      if (m.index !== undefined && isValidPesel(m[0])) {
        matches.push({
          type: 'NATIONAL_ID',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    // 3b. German Steuer-ID (formatted 03 245 678 912 or unformatted near tax context)
    const steuerFormattedRegex = /\b\d{2}\s\d{3}\s\d{3}\s\d{3}\b/gu;
    for (const m of text.matchAll(steuerFormattedRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'NATIONAL_ID',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    for (const m of text.matchAll(peselRegex)) {
      if (m.index !== undefined) {
        const alreadyMatched = matches.some(
          (existing) => m.index! < existing.endIndex && m.index! + m[0].length > existing.startIndex,
        );
        if (!alreadyMatched && isGermanSteuerId(m[0], text, m.index)) {
          matches.push({
            type: 'NATIONAL_ID',
            value: m[0],
            startIndex: m.index,
            endIndex: m.index + m[0].length,
          });
        }
      }
    }

    // 3c. US SSN (\b\d{3}-\d{2}-\d{4}\b)
    const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/gu;
    for (const m of text.matchAll(ssnRegex)) {
      if (m.index !== undefined && isValidSsn(m[0])) {
        matches.push({
          type: 'NATIONAL_ID',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    // 4. HEALTH_DATA (Priority 4)
    // 4a. German KVNR ([A-Z]\d{9})
    const kvnrRegex = /\b[A-Z]\d{9}\b/gu;
    for (const m of text.matchAll(kvnrRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'HEALTH_DATA',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    // 4b. Medical terms, diagnoses, and prescriptions in context across PL, DE, EN, FR
    const medicalRegex =
      /\b(?:diagnoza|rozpoznanie|recepta|skierowanie|leki|Diagnose|Rezept|ordonnance|diagnosis|prescription)\b(?:\s*[:-]\s*|\s+(?:na|dla|für|pour|for)\s+)[a-zA-Z0-9\p{L}\-+]+(?:\s+[a-zA-Z0-9\p{L}\-+]+){0,4}/giu;
    for (const m of text.matchAll(medicalRegex)) {
      if (m.index !== undefined) {
        matches.push({
          type: 'HEALTH_DATA',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }

    // 5. EMAIL (Priority 5)
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

    // 6. PHONE (Priority 6)
    const phoneRegex = new RegExp(
      '(?:' +
        // 1. With international prefix (+ or 00)
        '(?:\\+|00)\\d{1,3}[\\s.-]?(?:' +
          '\\d[\\s.-]?(?:\\d{2}[\\s.-]?){3}\\d{2}' +
          '|' +
          '(?:\\(?\\d{1,4}\\)?[\\s.-]?)?\\d{3,4}[\\s.-]?\\d{3,4}' +
          '|' +
          '\\d{1,4}[\\s.-]?\\d{5,8}' +
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

    // 7. AMOUNT_MONEY (Priority 7)
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

    // 8. PERSON (Priority 8)
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

    const personPrepRegex = new RegExp(
      `\\b(?:${prepPattern})\\s+(${nameWord}(?:\\s+${nameWord}){1,2})`,
      'gu',
    );

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

    const lowercasePrepositionPatterns = [
      /\b(?:[sS]potkanie z|[rR]ozmowa z|[zZ]|[zZ]e|[dD]la|[oO]d)\s+([a-ząćęłńóśźż]+(?:\s+[a-ząćęłńóśźż]+)+)\b/gu,
      /\b(?:[tT]reffen mit|[mM]it|[bB]ei|[fF]ür|[vV]on)\s+([a-zäöüß]+(?:\s+[a-zäöüß]+)+)\b/gu,
      /\b(?:[rR]endez-vous avec|[aA]vec|[pP]our|[dD]e)\s+([a-zàâçéèêëîïôûùüÿñæœ]+(?:\s+[a-zàâçéèêëîïôûùüÿñæœ]+)+)\b/gu,
      /\b(?:[mM]eeting with|[wW]ith|[fF]or|[fF]rom)\s+([a-z]+(?:\s+[a-z]+)+)\b/gu,
    ];

    for (const pattern of lowercasePrepositionPatterns) {
      for (const m of text.matchAll(pattern)) {
        if (m.index !== undefined && m[1]) {
          const lowerVal = m[1].toLowerCase();
          const words = lowerVal.split(/\s+/);
          const isCityOrExcluded =
            INTERNATIONAL_CITIES.some((c) => c.toLowerCase() === lowerVal) ||
            EXCLUDED_NAME_WORDS.has(lowerVal) ||
            words.some((w) => EXCLUDED_NAME_WORDS.has(w));
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

    // 9. ADDRESS (Priority 9)
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

    const germanCompoundStreetPattern = `\\b[a-zA-ZäöüÄÖÜß]+(?:straße|strasse|str\\.)\\s+\\d+[a-zA-Z]?(?:[/-]\\d+)?\\b`;
    const streetPattern1 = `\\b(?:\\d+[a-zA-Z]?[\\s,]+)?(?:${streetPrefixes})\\s+(?:(?:de|d'|du|des|von|van|der|am)\\s+)?\\p{Lu}[\\p{L}'-]+(?:\\s+(?:(?:de|d'|du|des|von|van|der|am)\\s+)?\\p{Lu}[\\p{L}'-]+){0,2}(?:\\s+\\d+[a-zA-Z]?(?:[/-]\\d+[a-zA-Z]?)?)?`;
    const streetPattern2 = `\\b\\p{Lu}[\\p{L}'-]*(?:straße|strasse)\\b(?:\\s+\\d+[a-zA-Z]?(?:[/-]\\d+[a-zA-Z]?)?)?`;
    const streetPattern3 = `\\b\\p{Lu}[\\p{L}'-]+(?:\\s+\\p{Lu}[\\p{L}'-]+)?\\s+(?:${streetPostfixes})(?:\\s+\\d+[a-zA-Z]?(?:[/-]\\d+[a-zA-Z]?)?)?\\b`;
    const streetPattern4 = `\\b\\d+\\s+\\p{Lu}[\\p{L}'-]+\\s+(?:${streetPostfixes})\\b`;

    const addressRegex = new RegExp(
      `(?:${germanCompoundStreetPattern}|${streetPattern1}|${streetPattern2}|${streetPattern4}|${streetPattern3}|${cityPattern})`,
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

    // Tier 3: Context-Aware Generic Matcher
    // Scan candidate 6-16 character alphanumeric tokens within +-30 chars of trigger keywords
    const candidateIdRegex = /\b[A-Za-z0-9\-_]{6,16}\b/gu;
    const healthContextKeywords =
      /\b(?:polisa|ubezpieczenie|ubezpieczenia|ubezpieczeniowa|ubezpieczeniowej|versichert|versicherung|polizze|krankenkasse|insurance|policy|health\s+card|recepta)\b/i;
    const nationalContextKeywords =
      /\b(?:dowód|dowodu|ausweis|personalausweis|reisepass|paszport|national\s+id|citizen\s+id|id\s+card|identity\s+card|steuer)\b/i;

    for (const m of text.matchAll(candidateIdRegex)) {
      if (m.index !== undefined) {
        const val = m[0];
        // Candidate must contain at least one digit
        if (!/\d/.test(val)) continue;

        // Skip if already matched
        const alreadyMatched = matches.some(
          (existing) => m.index! < existing.endIndex && m.index! + val.length > existing.startIndex,
        );
        if (alreadyMatched) continue;

        const windowStart = Math.max(0, m.index - 30);
        const windowEnd = Math.min(text.length, m.index + val.length + 30);
        const windowText = text.substring(windowStart, windowEnd);

        if (healthContextKeywords.test(windowText)) {
          matches.push({
            type: 'HEALTH_DATA',
            value: val,
            startIndex: m.index,
            endIndex: m.index + val.length,
          });
        } else if (nationalContextKeywords.test(windowText)) {
          matches.push({
            type: 'NATIONAL_ID',
            value: val,
            startIndex: m.index,
            endIndex: m.index + val.length,
          });
        }
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
