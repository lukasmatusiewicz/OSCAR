import { describe, it, expect } from 'vitest';
import { resolveRelativeDate } from '../../src/agent/TemporalResolver.js';

describe('TemporalResolver Agent Unit Suite', () => {
  // Reference date: Monday, November 9, 2026 at 12:00:00 (midday local)
  const refDate = new Date(2026, 10, 9, 12, 0, 0);

  describe('Explicit ISO Dates', () => {
    it('extracts explicit ISO dates directly', () => {
      expect(resolveRelativeDate('Important milestone on 2026-12-25', refDate)).toBe('2026-12-25');
      expect(resolveRelativeDate('Deadlines: 2027-01-15 before close of business', refDate)).toBe(
        '2027-01-15',
      );
    });

    it('ignores invalid dates that match regex structure but fail date parsing', () => {
      // 2026-02-31 is invalid date in calendar, Date('2026-02-31') becomes NaN or rolled over
      const res = resolveRelativeDate('Invalid 2026-99-99 date', refDate);
      expect(res).toBeNull();
    });
  });

  describe('Polish Relative Expressions', () => {
    it('resolves Polish today, tomorrow, and day after tomorrow', () => {
      expect(resolveRelativeDate('Musimy to wysłać dzisiaj!', refDate)).toBe('2026-11-09');
      expect(resolveRelativeDate('Spotkanie jutro o 10:00', refDate)).toBe('2026-11-10');
      expect(resolveRelativeDate('Prezentacja pojutrze rano', refDate)).toBe('2026-11-11');
    });

    it('resolves Polish relative N days expressions', () => {
      expect(resolveRelativeDate('Zadzwoń za 5 dni', refDate)).toBe('2026-11-14');
      expect(resolveRelativeDate('Zaplanuj za 1 doba', refDate)).toBe('2026-11-10');
      expect(resolveRelativeDate('Powrót za 2 doby do biura', refDate)).toBe('2026-11-11');
      expect(resolveRelativeDate('Rozliczenie za 4 dniach', refDate)).toBe('2026-11-13');
    });

    it('resolves Polish upcoming weekdays (1 to 7 days ahead)', () => {
      // Current day is Monday Nov 9
      expect(resolveRelativeDate('Spotkanie we wtorek', refDate)).toBe('2026-11-10');
      expect(resolveRelativeDate('Zadzwoń w środę', refDate)).toBe('2026-11-11');
      expect(resolveRelativeDate('Zadzwoń w srode', refDate)).toBe('2026-11-11');
      expect(resolveRelativeDate('Warsztaty w czwartek', refDate)).toBe('2026-11-12');
      expect(resolveRelativeDate('Deadline w piątek', refDate)).toBe('2026-11-13');
      expect(resolveRelativeDate('Deadline w piatek', refDate)).toBe('2026-11-13');
      expect(resolveRelativeDate('Wyjazd w sobotę', refDate)).toBe('2026-11-14');
      expect(resolveRelativeDate('Wyjazd w sobote', refDate)).toBe('2026-11-14');
      expect(resolveRelativeDate('Odpoczynek w niedzielę', refDate)).toBe('2026-11-15');
      expect(resolveRelativeDate('Odpoczynek w niedziele', refDate)).toBe('2026-11-15');
      // Upcoming Monday (7 days ahead)
      expect(resolveRelativeDate('Spotkanie w poniedziałek', refDate)).toBe('2026-11-16');
    });
  });

  describe('German Relative Expressions', () => {
    it('resolves German heute, morgen, and übermorgen', () => {
      expect(resolveRelativeDate('Wir müssen das heute abschließen', refDate)).toBe('2026-11-09');
      expect(resolveRelativeDate('Termin morgen um 14 Uhr', refDate)).toBe('2026-11-10');
      expect(resolveRelativeDate('Besprechung übermorgen im Konferenzraum', refDate)).toBe(
        '2026-11-11',
      );
    });

    it('resolves German in N Tagen', () => {
      expect(resolveRelativeDate('Lieferung in 3 Tagen', refDate)).toBe('2026-11-12');
      expect(resolveRelativeDate('Rechnung fällig in 14 Tagen', refDate)).toBe('2026-11-23');
    });

    it('resolves German upcoming weekdays (1 to 7 days ahead)', () => {
      // Current day is Monday Nov 9
      expect(resolveRelativeDate('Präsentation am Dienstag', refDate)).toBe('2026-11-10');
      expect(resolveRelativeDate('Audit am Mittwoch', refDate)).toBe('2026-11-11');
      expect(resolveRelativeDate('Sprint Review am Donnerstag', refDate)).toBe('2026-11-12');
      expect(resolveRelativeDate('Release am Freitag', refDate)).toBe('2026-11-13');
      expect(resolveRelativeDate('Wartung am Samstag', refDate)).toBe('2026-11-14');
      expect(resolveRelativeDate('Bereitschaft am Sonntag', refDate)).toBe('2026-11-15');
      // Upcoming Monday
      expect(resolveRelativeDate('Kickoff am Montag', refDate)).toBe('2026-11-16');
    });
  });

  describe('English Relative Expressions', () => {
    it('resolves English today, tomorrow, and day after tomorrow', () => {
      expect(resolveRelativeDate('Submit security compliance report today', refDate)).toBe(
        '2026-11-09',
      );
      expect(resolveRelativeDate('Review pull requests tomorrow morning', refDate)).toBe(
        '2026-11-10',
      );
      expect(resolveRelativeDate('Execute disaster recovery drill day after tomorrow', refDate)).toBe(
        '2026-11-11',
      );
    });

    it('resolves English in N days', () => {
      expect(resolveRelativeDate('Certificate expires in 7 days', refDate)).toBe('2026-11-16');
      expect(resolveRelativeDate('Follow up with stakeholders in 2 days', refDate)).toBe(
        '2026-11-11',
      );
    });

    it('resolves English upcoming weekdays with and without on', () => {
      // Current day is Monday Nov 9
      expect(resolveRelativeDate('Executive briefing on Tuesday', refDate)).toBe('2026-11-10');
      expect(resolveRelativeDate('Team retrospective Wednesday', refDate)).toBe('2026-11-11');
      expect(resolveRelativeDate('Architecture review on Thursday', refDate)).toBe('2026-11-12');
      expect(resolveRelativeDate('Deployment window Friday', refDate)).toBe('2026-11-13');
      expect(resolveRelativeDate('Data migration on Saturday', refDate)).toBe('2026-11-14');
      expect(resolveRelativeDate('Maintenance window Sunday', refDate)).toBe('2026-11-15');
      // Upcoming Monday
      expect(resolveRelativeDate('Sprint planning on Monday', refDate)).toBe('2026-11-16');
    });
  });

  describe('Fallback and Boundary Cases', () => {
    it('returns null when text does not contain any recognizable temporal references', () => {
      expect(resolveRelativeDate('Review confidential document', refDate)).toBeNull();
      expect(resolveRelativeDate('', refDate)).toBeNull();
      expect(resolveRelativeDate(null as unknown as string, refDate)).toBeNull();
    });

    it('uses current date as default reference when referenceDate is omitted', () => {
      const today = new Date();
      const expectedTomorrow = new Date(today.getTime());
      expectedTomorrow.setDate(expectedTomorrow.getDate() + 1);
      const year = expectedTomorrow.getFullYear();
      const month = String(expectedTomorrow.getMonth() + 1).padStart(2, '0');
      const day = String(expectedTomorrow.getDate()).padStart(2, '0');
      const expectedStr = `${year}-${month}-${day}`;

      expect(resolveRelativeDate('tomorrow')).toBe(expectedStr);
    });
  });
});
