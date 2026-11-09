import { logger } from './logger';

const DAYS_IN_WEEK = 7;

/**
 * Maps weekday names across Polish, German, and English to day of the week (0 = Sunday, 1 = Monday, ...).
 */
const WEEKDAY_MAP: Record<string, number> = {
  // English
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  // German
  sonntag: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
  // Polish
  niedzielę: 0,
  niedziele: 0,
  poniedziałek: 1,
  wtorek: 2,
  środę: 3,
  srode: 3,
  czwartek: 4,
  piątek: 5,
  piatek: 5,
  sobotę: 6,
  sobote: 6,
};

/**
 * Formats a Date object as ISO-8601 calendar date YYYY-MM-DD.
 *
 * @param date Target date.
 * @returns YYYY-MM-DD formatted string.
 */
function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates a future or current date by adding a given number of days to referenceDate.
 *
 * @param referenceDate Base date.
 * @param days Number of days to add.
 * @returns Formatted YYYY-MM-DD string.
 */
function addDays(referenceDate: Date, days: number): string {
  const d = new Date(referenceDate.getTime());
  d.setDate(d.getDate() + days);
  return formatIsoDate(d);
}

/**
 * Calculates the upcoming weekday date (1 to 7 days ahead) from the reference date.
 *
 * @param referenceDate Base date.
 * @param targetDay Target weekday index (0 = Sunday, 1 = Monday, ... 6 = Saturday).
 * @returns Formatted YYYY-MM-DD string.
 */
function resolveUpcomingWeekday(referenceDate: Date, targetDay: number): string {
  const currentDay = referenceDate.getDay();
  let diff = (targetDay - currentDay + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  if (diff === 0) {
    diff = DAYS_IN_WEEK;
  }
  return addDays(referenceDate, diff);
}

/**
 * Deterministically resolves relative and natural language temporal date references
 * (Polish, German, English, and explicit ISO dates) into ISO calendar dates (YYYY-MM-DD).
 *
 * @param text Cleartext or sanitized memo string containing temporal cues.
 * @param referenceDate Base reference date (defaults to current date/time).
 * @returns ISO-8601 calendar date string (YYYY-MM-DD) or null if no temporal expression detected.
 */
export function resolveRelativeDate(
  text: string,
  referenceDate: Date = new Date(),
): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // 1. Explicit ISO date check: YYYY-MM-DD
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch && isoMatch[1]) {
    const candidate = isoMatch[1];
    const [_yStr, mStr, dStr] = candidate.split('-');
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      logger.debug('TemporalResolver', `Resolved explicit ISO date: ${candidate}`, {
        date: candidate,
      });
      return candidate;
    }
  }

  // 2. Day after tomorrow (+2 days)
  if (/(?<!\p{L})(?:day\s+after\s+tomorrow|pojutrze|übermorgen|ubermorgen)(?!\p{L})/iu.test(text)) {
    const resolved = addDays(referenceDate, 2);
    logger.debug('TemporalResolver', `Resolved relative +2 days date: ${resolved}`, {
      date: resolved,
    });
    return resolved;
  }

  // 3. Tomorrow (+1 day)
  if (/(?<!\p{L})(?:tomorrow|jutro|morgen)(?!\p{L})/iu.test(text)) {
    const resolved = addDays(referenceDate, 1);
    logger.debug('TemporalResolver', `Resolved relative +1 day date: ${resolved}`, {
      date: resolved,
    });
    return resolved;
  }

  // 4. Today (0 days)
  if (/(?<!\p{L})(?:today|dzisiaj|heute)(?!\p{L})/iu.test(text)) {
    const resolved = addDays(referenceDate, 0);
    logger.debug('TemporalResolver', `Resolved relative today date: ${resolved}`, {
      date: resolved,
    });
    return resolved;
  }

  // 5. Relative N days ahead
  // English: in N days
  const enDaysMatch = text.match(/(?<!\p{L})in\s+(\d+)\s*days(?!\p{L})/iu);
  if (enDaysMatch && enDaysMatch[1]) {
    const days = parseInt(enDaysMatch[1], 10);
    const resolved = addDays(referenceDate, days);
    logger.debug('TemporalResolver', `Resolved in ${days} days date: ${resolved}`, {
      date: resolved,
    });
    return resolved;
  }

  // German: in N Tagen
  const deDaysMatch = text.match(/(?<!\p{L})in\s+(\d+)\s*Tagen(?!\p{L})/iu);
  if (deDaysMatch && deDaysMatch[1]) {
    const days = parseInt(deDaysMatch[1], 10);
    const resolved = addDays(referenceDate, days);
    logger.debug('TemporalResolver', `Resolved in ${days} Tagen date: ${resolved}`, {
      date: resolved,
    });
    return resolved;
  }

  // Polish: za N dni / doba / doby / dniach
  const plDaysMatch = text.match(/(?<!\p{L})za\s+(\d+)\s*(?:dni|doba|doby|dniach)(?!\p{L})/iu);
  if (plDaysMatch && plDaysMatch[1]) {
    const days = parseInt(plDaysMatch[1], 10);
    const resolved = addDays(referenceDate, days);
    logger.debug('TemporalResolver', `Resolved za ${days} dni date: ${resolved}`, {
      date: resolved,
    });
    return resolved;
  }

  // 6. Weekdays: Upcoming weekday (1 to 7 days ahead)
  // Polish: w(?:e)?\s+(poniedziałek|wtorek|środę|srode|czwartek|piątek|piatek|sobotę|sobote|niedzielę|niedziele)
  const plWeekdayMatch = text.match(
    /(?<!\p{L})w(?:e)?\s+(poniedziałek|wtorek|środę|srode|czwartek|piątek|piatek|sobotę|sobote|niedzielę|niedziele)(?!\p{L})/iu,
  );
  if (plWeekdayMatch && plWeekdayMatch[1]) {
    const dayName = plWeekdayMatch[1].toLowerCase();
    const targetDay = WEEKDAY_MAP[dayName];
    if (targetDay !== undefined) {
      const resolved = resolveUpcomingWeekday(referenceDate, targetDay);
      logger.debug('TemporalResolver', `Resolved Polish weekday date: ${resolved}`, {
        date: resolved,
      });
      return resolved;
    }
  }

  // German: am\s+(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)
  const deWeekdayMatch = text.match(
    /(?<!\p{L})am\s+(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)(?!\p{L})/iu,
  );
  if (deWeekdayMatch && deWeekdayMatch[1]) {
    const dayName = deWeekdayMatch[1].toLowerCase();
    const targetDay = WEEKDAY_MAP[dayName];
    if (targetDay !== undefined) {
      const resolved = resolveUpcomingWeekday(referenceDate, targetDay);
      logger.debug('TemporalResolver', `Resolved German weekday date: ${resolved}`, {
        date: resolved,
      });
      return resolved;
    }
  }

  // English: (?:on\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)
  const enWeekdayMatch = text.match(
    /(?<!\p{L})(?:on\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?!\p{L})/iu,
  );
  if (enWeekdayMatch && enWeekdayMatch[1]) {
    const dayName = enWeekdayMatch[1].toLowerCase();
    const targetDay = WEEKDAY_MAP[dayName];
    if (targetDay !== undefined) {
      const resolved = resolveUpcomingWeekday(referenceDate, targetDay);
      logger.debug('TemporalResolver', `Resolved English weekday date: ${resolved}`, {
        date: resolved,
      });
      return resolved;
    }
  }

  return null;
}
