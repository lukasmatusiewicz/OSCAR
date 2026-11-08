import React, { useState, useMemo } from 'react';
import { PIITokenMap, PIIType, RiskLevel } from '../../types/contracts';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { PrivacyShieldBadge } from '../atoms/PrivacyShieldBadge';
import { TokenPreviewBadge } from '../molecules/TokenPreviewBadge';

export interface MemoEditorProps {
  onSubmit: (content: string, tokens: PIITokenMap[]) => Promise<unknown> | unknown;
  isLoading?: boolean;
  className?: string;
  placeholder?: string;
}

const INTERNATIONAL_CITIES = [
  'New York',
  'Kassel',
  'Berlin',
  'Paris',
  'Warsaw',
  'Warszawa',
  'London',
  'Zurich',
  'Zürich',
  'Tokyo',
  'Vienna',
  'Wien',
  'Rome',
  'Roma',
  'Madrid',
  'Krakow',
  'Kraków',
  'Wrocław',
  'Munich',
  'München',
  'Hamburg',
  'Frankfurt',
  'Geneva',
  'Brussels',
  'Amsterdam',
  'Poznań',
  'Gdańsk',
];

const currencies = '(?:[\\$€£¥]|(?:PLN|EUR|USD|GBP|CHF|złotych|zł|euro)(?!\\p{L}))';
const multipliers = '(?:k€|k\\s*PLN|k|tys\\.?(?!\\p{L})|tysięcy|mln|milionów|mld)';
const number = '\\d+(?:[.,\\s]\\d+)*';

const amountMoneyRegex = new RegExp(
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
  'drive',
  'dr\\.',
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

const streetPattern1 = `\\b(?:${streetPrefixes})\\s+(?:(?:de|d'|von|van)\\s+)?[\\p{Lu}\\p{Ll}'-]+(?:\\s+[\\p{Lu}\\p{Ll}'-]+)*(?:\\s+\\d+[a-zA-Z]?(?:[/-]\\d+[a-zA-Z]?)?)?`;
const streetPattern2 = `\\b\\p{Lu}[\\p{L}'-]*(?:straße|strasse)\\b(?:\\s+\\d+[a-zA-Z]?(?:[/-]\\d+[a-zA-Z]?)?)?`;
const streetPattern3 = `\\b\\p{Lu}[\\p{L}'-]+(?:\\s+\\p{Lu}[\\p{L}'-]+)?\\s+(?:${streetPostfixes})(?:\\s+\\d+[a-zA-Z]?(?:[/-]\\d+[a-zA-Z]?)?)?\\b`;
const streetPattern4 = `\\b\\d+\\s+\\p{Lu}[\\p{L}'-]+\\s+(?:${streetPostfixes})\\b`;
const cityPattern = `(?:${INTERNATIONAL_CITIES.join('|')})(?!\\p{L})`;

const addressRegex = new RegExp(
  `(?:${streetPattern1}|${streetPattern2}|${streetPattern4}|${streetPattern3}|${cityPattern})`,
  'gu',
);

const EXCLUDED_PERSON_WORDS = new Set([
  'street',
  'st',
  'road',
  'rd',
  'avenue',
  'ave',
  'boulevard',
  'blvd',
  'drive',
  'ulica',
  'aleja',
  'plac',
  'rue',
  'straße',
  'strasse',
  'weg',
  'platz',
  'gasse',
  ...INTERNATIONAL_CITIES.map((c) => c.toLowerCase()),
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
  if (index > 0 && text[index - 1] === '+') return false;

  const clean = val.replace(/\s+/g, '');
  if (!/^\d{11}$/.test(clean)) return false;

  const windowStart = Math.max(0, index - 30);
  const windowEnd = Math.min(text.length, index + val.length + 30);
  const context = text.substring(windowStart, windowEnd).toLowerCase();
  const taxTrigger =
    /\b(?:steuer[- ]?id|steueridentifikationsnummer|idnr|steuernummer|finanzamt|tax\s+id|tin)\b/i;
  if (taxTrigger.test(context)) return true;

  if (/^\d{2}\s\d{3}\s\d{3}\s\d{3}$/.test(val)) return true;

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

interface RawMatch {
  type: PIIType;
  value: string;
  startIndex: number;
  endIndex: number;
}

const CATEGORY_PRIORITY: Record<PIIType, number> = {
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

function resolveOverlaps(matches: RawMatch[]): RawMatch[] {
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

export function detectClientTokens(text: string): { tokens: PIITokenMap[]; riskLevel: RiskLevel } {
  const rawMatches: RawMatch[] = [];

  // 1. SECRET_KEY
  const secretKeyRegex =
    /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35}|[0-9a-fA-F]{32,64})/g;
  for (const m of text.matchAll(secretKeyRegex)) {
    if (m.index !== undefined) {
      rawMatches.push({
        type: 'SECRET_KEY',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 2. IBAN
  const ibanRegex = /[a-zA-Z]{2}\d{2}[a-zA-Z0-9]{4}\d{7}(?:[a-zA-Z0-9]{0,16})/giu;
  for (const m of text.matchAll(ibanRegex)) {
    if (m.index !== undefined) {
      rawMatches.push({
        type: 'IBAN',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 3. NATIONAL_ID
  // 3a. Polish PESEL
  const peselRegex = /\b\d{11}\b/gu;
  for (const m of text.matchAll(peselRegex)) {
    if (m.index !== undefined && isValidPesel(m[0])) {
      rawMatches.push({
        type: 'NATIONAL_ID',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 3b. German Steuer-ID (formatted 03 245 678 912 or unformatted in context)
  const steuerFormattedRegex = /(?<!\+)\b\d{2}\s\d{3}\s\d{3}\s\d{3}\b/gu;
  for (const m of text.matchAll(steuerFormattedRegex)) {
    if (m.index !== undefined && isGermanSteuerId(m[0], text, m.index)) {
      rawMatches.push({
        type: 'NATIONAL_ID',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }
  for (const m of text.matchAll(peselRegex)) {
    if (m.index !== undefined) {
      const alreadyMatched = rawMatches.some(
        (existing) =>
          existing.type === 'NATIONAL_ID' &&
          m.index! < existing.endIndex &&
          m.index! + m[0].length > existing.startIndex,
      );
      if (!alreadyMatched && isGermanSteuerId(m[0], text, m.index)) {
        rawMatches.push({
          type: 'NATIONAL_ID',
          value: m[0],
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }
  }

  // 3c. US SSN
  const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/gu;
  for (const m of text.matchAll(ssnRegex)) {
    if (m.index !== undefined && isValidSsn(m[0])) {
      rawMatches.push({
        type: 'NATIONAL_ID',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 4. HEALTH_DATA
  // 4a. German KVNR ([A-Z]\d{9})
  const kvnrRegex = /\b[A-Z]\d{9}\b/gu;
  for (const m of text.matchAll(kvnrRegex)) {
    if (m.index !== undefined) {
      rawMatches.push({
        type: 'HEALTH_DATA',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 4b. Medical terms, diagnoses, and prescriptions in context (PL, DE, EN, FR)
  const medicalRegex =
    /\b(?:diagnoza|rozpoznanie|recepta|skierowanie|leki|Diagnose|Rezept|ordonnance|diagnosis|prescription)\b(?:\s*[:-]\s*|\s+(?:na|dla|für|pour|for)\s+)[a-zA-Z0-9\p{L}+-]+(?:\s+[a-zA-Z0-9\p{L}+-]+){0,4}/giu;
  for (const m of text.matchAll(medicalRegex)) {
    if (m.index !== undefined) {
      rawMatches.push({
        type: 'HEALTH_DATA',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 4c. Tier 3 context matcher: 6-16 char alphanumeric IDs near policy/insurance keywords
  const candidateIdRegex = /\b[A-Za-z0-9\-_]{6,16}\b/gu;
  const healthContextKeywords =
    /\b(?:polisa|ubezpieczenie|ubezpieczenia|ubezpieczeniowa|ubezpieczeniowej|versichert|versicherung|polizze|krankenkasse|insurance|policy|card|karta|health\s+card|recepta)\b/i;
  const nationalContextKeywords =
    /\b(?:dowód|dowodu|ausweis|personalausweis|reisepass|paszport|national\s+id|citizen\s+id|id\s+card|identity\s+card|steuer)\b/i;

  for (const m of text.matchAll(candidateIdRegex)) {
    if (m.index !== undefined) {
      const val = m[0];
      if (!/\d/.test(val)) continue;

      const windowStart = Math.max(0, m.index - 30);
      const windowEnd = Math.min(text.length, m.index + val.length + 30);
      const windowText = text.substring(windowStart, windowEnd);

      if (healthContextKeywords.test(windowText)) {
        rawMatches.push({
          type: 'HEALTH_DATA',
          value: val,
          startIndex: m.index,
          endIndex: m.index + val.length,
        });
      } else if (nationalContextKeywords.test(windowText)) {
        rawMatches.push({
          type: 'NATIONAL_ID',
          value: val,
          startIndex: m.index,
          endIndex: m.index + val.length,
        });
      }
    }
  }

  // 5. EMAIL
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  for (const m of text.matchAll(emailRegex)) {
    if (m.index !== undefined) {
      rawMatches.push({
        type: 'EMAIL',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 6. PHONE
  const phoneRegex =
    /(?:\+\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{3,4}|\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b)/gu;
  for (const m of text.matchAll(phoneRegex)) {
    if (m.index !== undefined) {
      rawMatches.push({
        type: 'PHONE',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 7. AMOUNT_MONEY
  for (const m of text.matchAll(new RegExp(amountMoneyRegex.source, amountMoneyRegex.flags))) {
    if (m.index !== undefined) {
      rawMatches.push({
        type: 'AMOUNT_MONEY',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 8. PERSON
  const personRegex =
    /(?:(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Pan|Pani|Pana|Panią|dr|mec|Herr|Frau|M\.|Mme)\.?\s+)?[A-ZĄĆĘŁŃÓŚŹŻÄÖÜ][a-ząćęłńóśźżäöüß]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻÄÖÜ][a-ząćęłńóśźżäöüß]+)+/gu;
  for (const m of text.matchAll(personRegex)) {
    if (m.index !== undefined) {
      const words = m[0].split(/\s+/).map((w) => w.toLowerCase().replace(/[.,]/g, ''));
      if (words.some((w) => EXCLUDED_PERSON_WORDS.has(w))) {
        continue;
      }
      rawMatches.push({
        type: 'PERSON',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // 9. ADDRESS
  for (const m of text.matchAll(new RegExp(addressRegex.source, addressRegex.flags))) {
    if (m.index !== undefined) {
      rawMatches.push({
        type: 'ADDRESS',
        value: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  // Resolve overlapping spans by priority
  const resolved = resolveOverlaps(rawMatches);

  let tokenIndex = 1;
  const tokens: PIITokenMap[] = resolved.map((match) => ({
    token: `[${match.type}_${tokenIndex++}]`,
    type: match.type,
    originalValue: match.value,
    startIndex: match.startIndex,
    endIndex: match.endIndex,
  }));

  // Calculate risk level based on token presence
  let riskLevel: RiskLevel = 'NONE';
  if (tokens.length > 0) {
    const hasHighRisk = tokens.some(
      (t) =>
        t.type === 'SECRET_KEY' ||
        t.type === 'IBAN' ||
        t.type === 'NATIONAL_ID' ||
        t.type === 'HEALTH_DATA',
    );
    if (hasHighRisk || tokens.length >= 3) {
      riskLevel = 'HIGH';
    } else if (
      tokens.length === 2 ||
      tokens.some((t) => t.type === 'AMOUNT_MONEY' || t.type === 'ADDRESS')
    ) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }
  }

  return { tokens, riskLevel };
}

export const MemoEditor: React.FC<MemoEditorProps> = ({
  onSubmit,
  isLoading = false,
  className = '',
  placeholder = 'Speak or type your memo... Confidential details (emails, phone numbers, keys, financial data) are client-side shielded before transmission.',
}) => {
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { tokens, riskLevel } = useMemo(() => detectClientTokens(content), [content]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      setError('Please enter a memo before submitting.');
      return;
    }
    setError(null);
    try {
      await onSubmit(content, tokens);
      setContent('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit memo');
    }
  };

  return (
    <div
      className={`oscar-memo-editor ${className}`.trim()}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '1.25rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
          📝 New Confidential Voice/Text Memo
        </h3>
        <PrivacyShieldBadge riskLevel={riskLevel} isSecured={true} tokenCount={tokens.length} />
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
      >
        <Input
          isTextArea
          rows={4}
          placeholder={placeholder}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            if (error) setError(null);
          }}
          disabled={isLoading}
          error={error || undefined}
          aria-label="Confidential Memo Input"
        />

        {tokens.length > 0 && (
          <div
            data-testid="memo-token-preview-list"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
              padding: '0.5rem 0.75rem',
              backgroundColor: '#f8fafc',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
              Client Privacy Guard Shield Active ({tokens.length} tokens protected):
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {tokens.map((tok, i) => (
                <TokenPreviewBadge key={`${tok.token}-${i}`} token={tok.token} type={tok.type} />
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '0.25rem',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {content.length} characters • AES-256-GCM envelope
          </span>
          <Button type="submit" variant="primary" isLoading={isLoading} disabled={isLoading}>
            Encrypt & Process
          </Button>
        </div>
      </form>
    </div>
  );
};
