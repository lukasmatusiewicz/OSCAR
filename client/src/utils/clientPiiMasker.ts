import type { MaskedTokenSummary, PIITokenMap, PIIType } from '../types/contracts';

/**
 * Result of deterministic client-side PII masking for offline fallback.
 */
export interface ClientPiiMaskResult {
  sanitizedText: string;
  hasPII: boolean;
  maskedFieldsCount: number;
  detectedTokens: MaskedTokenSummary[];
}

interface MaskRule {
  type: PIIType;
  pattern: RegExp;
  validate?: (match: string) => boolean;
}

const MIN_PHONE_DIGITS = 7;

const MASK_RULES: readonly MaskRule[] = [
  {
    type: 'SECRET_KEY',
    pattern:
      /\b(?:sk-[a-zA-Z0-9_-]{12,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9a-zA-Z-]{10,})\b/g,
  },
  {
    type: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g,
  },
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: 'NATIONAL_ID',
    pattern: /\b(?:\d{11}|\d{3}-\d{2}-\d{4})\b/g,
  },
  {
    type: 'PHONE',
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}\b/g,
    validate: (match: string) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= MIN_PHONE_DIGITS;
    },
  },
  {
    type: 'AMOUNT_MONEY',
    pattern:
      /(?:\$|€|£|\b(?:PLN|EUR|USD|CHF|zł))\s?\d+(?:[.,\s]\d+)*(?:\s?(?:k|tys\.?|mln|milionów|mld))?|\b\d+(?:[.,\s]\d+)*(?:\s?(?:k|tys\.?|mln|milionów|mld))?\s?(?:€|\$|£|\b(?:PLN|EUR|USD|CHF|zł)\b)/gi,
  },
  {
    type: 'PERSON',
    pattern:
      /(?:\b(?:Herr|Frau|Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.|Pan|Pani|dr|mec\.)\s+\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)|(?:(?<=\b(?:with|z|ze|mit|avec|do|dla|od|for|to|from)\s+)\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)*)/gu,
  },
];

function isInsideSyntheticToken(text: string, index: number): boolean {
  const openBracket = text.lastIndexOf('[', index);
  if (openBracket === -1) return false;
  const closeBracket = text.indexOf(']', openBracket);
  return closeBracket !== -1 && index > openBracket && index < closeBracket;
}

/**
 * Applies lightweight deterministic PII masking to raw memo text on the client.
 * Preserves any pre-detected tokens and masks remaining emails, phones, IBANs,
 * national IDs, secret keys, monetary amounts, and names after prepositions.
 *
 * @param rawContent Raw memo text entered by the user.
 * @param existingTokens Optional pre-detected PII token spans.
 * @returns Sanitized text and accurate PII telemetry.
 */
export function maskClientPii(
  rawContent: string,
  existingTokens: readonly PIITokenMap[] = [],
): ClientPiiMaskResult {
  const typeCounters: Partial<Record<PIIType, number>> = {};
  const detectedTokens: MaskedTokenSummary[] = existingTokens.map(({ token, type }) => {
    const match = token.match(/_(\d+)\]$/);
    const parsedIndex = match ? Number.parseInt(match[1], 10) : 1;
    const currentMax = typeCounters[type] ?? 0;
    if (parsedIndex > currentMax) {
      typeCounters[type] = parsedIndex;
    }
    return { token, type };
  });

  let sanitizedText = rawContent;
  const sortedExisting = [...existingTokens].sort((a, b) => b.startIndex - a.startIndex);
  for (const tok of sortedExisting) {
    sanitizedText =
      sanitizedText.substring(0, tok.startIndex) +
      tok.token +
      sanitizedText.substring(tok.endIndex);
  }

  for (const rule of MASK_RULES) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    const replacements: { start: number; end: number; token: string }[] = [];

    for (const match of sanitizedText.matchAll(regex)) {
      const matchedText = match[0];
      const start = match.index ?? -1;
      if (start < 0 || !matchedText) continue;
      if (isInsideSyntheticToken(sanitizedText, start)) continue;
      if (rule.validate && !rule.validate(matchedText)) continue;

      const nextCount = (typeCounters[rule.type] ?? 0) + 1;
      typeCounters[rule.type] = nextCount;
      const token = `[${rule.type}_${nextCount}]`;
      replacements.push({ start, end: start + matchedText.length, token });
      detectedTokens.push({ token, type: rule.type });
    }

    for (let i = replacements.length - 1; i >= 0; i--) {
      const rep = replacements[i];
      sanitizedText =
        sanitizedText.substring(0, rep.start) + rep.token + sanitizedText.substring(rep.end);
    }
  }

  return {
    sanitizedText,
    hasPII: detectedTokens.length > 0,
    maskedFieldsCount: detectedTokens.length,
    detectedTokens,
  };
}
