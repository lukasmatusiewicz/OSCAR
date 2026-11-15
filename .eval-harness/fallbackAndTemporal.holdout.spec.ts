import { describe, expect, it } from 'vitest';
import {
  DeterministicFallbackExtractor,
  deduplicateSummaryMetadata,
  stripCommandPrefixes,
} from '../server/src/agent/DeterministicFallbackExtractor.js';
import { PrivacyGuard } from '../server/src/privacy/PrivacyGuard.js';
import {
  ExtractedTaskSchema,
  TEMPORAL_STOP_WORDS,
  extractScheduledTime,
  resolveRelativeDate,
} from '@oscar/shared';

describe('Adversarial Holdout — Deterministic Fallback & Temporal Resolution', () => {
  describe('Multilingual command-prefix stripping & PII token preservation', () => {
    it('strips Polish, German, and English conversational preambles while preserving PII tokens', () => {
      const plInput =
        'Cześć, dodaj mi do listy zadań: przypomnij mi żeby wysłać fakturę dla [PERSON_1] jutro o 14:30';
      const deInput = 'Hallo, erinnere mich daran: Vertrag prüfen am Montag um 9';
      const enInput =
        'Hey, please remind me to: send summary to [PERSON_2] tomorrow at 3pm';

      const plStripped = stripCommandPrefixes(plInput);
      expect(plStripped).toBe('Wysłać fakturę dla [PERSON_1] jutro o 14:30');
      expect(plStripped).toContain('[PERSON_1]');

      const deStripped = stripCommandPrefixes(deInput);
      expect(deStripped).not.toMatch(/^Hallo/i);
      expect(deStripped).not.toMatch(/erinnere mich daran/i);
      expect(deStripped).toBe('Vertrag prüfen am Montag um 9');

      const enStripped = stripCommandPrefixes(enInput);
      expect(enStripped).not.toMatch(/^Hey/i);
      expect(enStripped).not.toMatch(/remind me to/i);
      expect(enStripped).toBe('Send summary to [PERSON_2] tomorrow at 3pm');
      expect(enStripped).toContain('[PERSON_2]');

      for (const sample of [plInput, deInput, enInput]) {
        const extracted = ExtractedTaskSchema.parse(DeterministicFallbackExtractor.extract(sample));
        expect(extracted.title).not.toMatch(/^(?:Cześć|Hallo|Hey)\b/i);
        expect(extracted.title.length).toBeGreaterThanOrEqual(3);
        expect(extracted.title.length).toBeLessThanOrEqual(120);
      }
    });
  });

  describe('Metadata bullet deduplication', () => {
    it('removes duplicate Contact, Location, Amount, Time, and Date bullets in deduplicateSummaryMetadata', () => {
      const noisySummary = [
        'Prepare quarterly briefing',
        '• 👤 Contact: Anna Nowak-Kowalska',
        '• 👤 Contact: Duplicate Contact',
        '• 📍 Location: Berlin',
        '• 📍 Location: Munich',
        '• 💰 Amount: 1000 EUR',
        '• 💰 Amount: 2000 EUR',
        '• ⏰ Time: 14:30',
        '• ⏰ Time: 15:00',
        '• 📅 Date: 2026-11-20',
        '• 📅 Date: 2026-11-21',
      ].join('\n');

      const deduped = deduplicateSummaryMetadata(noisySummary);
      expect(deduped.match(/👤\s*Contact:/g)).toHaveLength(1);
      expect(deduped.match(/📍\s*Location:/g)).toHaveLength(1);
      expect(deduped.match(/💰\s*Amount:/g)).toHaveLength(1);
      expect(deduped.match(/⏰\s*Time:/g)).toHaveLength(1);
      expect(deduped.match(/📅\s*Date:/g)).toHaveLength(1);
      expect(deduped).toContain('Anna Nowak-Kowalska');
      expect(deduped).not.toContain('Duplicate Contact');
    });

    it('DeterministicFallbackExtractor.extract never duplicates card metadata bullets', () => {
      const memoWithExistingBullets = [
        'Spotkanie z [PERSON_1] w Berlin o 14:30 w sprawie 5000 EUR',
        '• 👤 Contact: [PERSON_1]',
        '• 📍 Location: Berlin',
        '• 💰 Amount: 5000 EUR',
        '• ⏰ Time: 14:30',
      ].join('\n');

      const task = DeterministicFallbackExtractor.extract(memoWithExistingBullets);
      expect(task.summary.match(/👤\s*Contact:/g)).toHaveLength(1);
      expect(task.summary.match(/📍\s*Location:/g)).toHaveLength(1);
      expect(task.summary.match(/💰\s*Amount:/g)).toHaveLength(1);
      expect(task.summary.match(/⏰\s*Time:/g)).toHaveLength(1);
    });
  });

  describe('Adversarial resolveRelativeDate() edge cases', () => {
    it('handles leap-year and year-boundary transitions accurately', () => {
      const leapRef = new Date(2028, 1, 28, 12, 0, 0); // 2028-02-28 (leap year)
      expect(resolveRelativeDate('Spotkanie pojutrze', leapRef)).toBe('2028-03-01');

      const yearEndRef = new Date(2026, 11, 31, 12, 0, 0); // 2026-12-31
      expect(resolveRelativeDate('Call client jutro', yearEndRef)).toBe('2027-01-01');
    });

    it('resolves PL/DE/EN weekdays and relative N-day offsets accurately', () => {
      // 2026-11-16 is a Monday (day 1)
      const mondayRef = new Date(2026, 10, 16, 10, 0, 0);

      expect(resolveRelativeDate('Spotkanie w środę', mondayRef)).toBe('2026-11-18');
      expect(resolveRelativeDate('Termin am Freitag', mondayRef)).toBe('2026-11-20');
      expect(resolveRelativeDate('Standup on Monday', mondayRef)).toBe('2026-11-23');

      expect(resolveRelativeDate('Raport za 5 dni', mondayRef)).toBe('2026-11-21');
      expect(resolveRelativeDate('Abgabe in 3 Tagen', mondayRef)).toBe('2026-11-19');
      expect(resolveRelativeDate('Review in 10 days', mondayRef)).toBe('2026-11-26');
    });

    it('returns null for invalid ISO calendar strings like 2026-13-45', () => {
      expect(resolveRelativeDate('Due on 2026-13-45')).toBeNull();
    });
  });

  describe('Adversarial extractScheduledTime() & TEMPORAL_STOP_WORDS edge cases', () => {
    it('normalizes valid prefixed and 12h/24h time expressions to HH:mm', () => {
      expect(extractScheduledTime('Spotkanie o 9')).toBe('09:00');
      expect(extractScheduledTime('Termin um 14')).toBe('14:00');
      expect(extractScheduledTime('Call at 3pm')).toBe('15:00');
      expect(extractScheduledTime('Deploy at 12am')).toBe('00:00');
      expect(extractScheduledTime('Wyjazd godz. 7:05')).toBe('07:05');
    });

    it('returns null for currency, percentage, duration traps, and out-of-range times', () => {
      expect(extractScheduledTime('Zapłać o 15 zł')).toBeNull();
      expect(extractScheduledTime('Kosten um 12 €')).toBeNull();
      expect(extractScheduledTime('Discount at 10%')).toBeNull();
      expect(extractScheduledTime('Przesuń o 5 dni')).toBeNull();
      expect(extractScheduledTime('Invalid 25:00 time')).toBeNull();
      expect(extractScheduledTime('Invalid 12:60 time')).toBeNull();
      expect(extractScheduledTime('Spotkanie o 15:99')).toBeNull();
    });

    it('blocks weekday stop words from being captured as PERSON entities', () => {
      for (const weekday of ['poniedziałek', 'środę', 'montag', 'freitag', 'monday', 'friday']) {
        expect(TEMPORAL_STOP_WORDS.has(weekday)).toBe(true);
      }

      const maskResult = PrivacyGuard.mask('Meeting with Monday team and spotkanie z Piątek');
      expect(maskResult.tokens.some((t) => t.type === 'PERSON')).toBe(false);

      const fallback = DeterministicFallbackExtractor.extract(
        'Spotkanie z Poniedziałek oraz meeting with Friday',
      );
      expect(fallback.contactPerson).toBeNull();
    });
  });
});
