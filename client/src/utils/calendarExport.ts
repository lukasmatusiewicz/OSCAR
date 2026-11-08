import { TaskEntity, DecryptedTaskPayload } from '../types/contracts';
import {
  normalizePersonToNominative,
  normalizeAddressCasing,
} from './linguisticNormalizer';

/**
 * Escapes characters for RFC 5545 iCalendar TEXT properties.
 * In accordance with RFC 5545 Section 3.3.11:
 * - Backslashes ('\') -> '\\'
 * - Semicolons (';') -> '\;'
 * - Commas (',') -> '\,'
 * - Newlines ('\r\n', '\r', '\n') -> '\n'
 */
export function escapeIcsText(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Formats a Date object into UTC compact iCalendar timestamp: YYYYMMDDTHHMMSSZ
 */
export function formatUtcToIcs(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Resolves start and end UTC timestamps from task and payload metadata.
 * Defaults to tomorrow at 10:00:00 UTC if no valid date is detected.
 * End time is always DTSTART + 1 hour.
 */
export function resolveStartAndEndDates(
  task: TaskEntity,
  payload?: DecryptedTaskPayload,
): { startDate: Date; endDate: Date } {
  let startDate: Date | null = null;

  // 1. Try parsing task.scheduledDate (ISO date / datetime string)
  if (task.scheduledDate) {
    const parsed = new Date(task.scheduledDate);
    if (!isNaN(parsed.getTime())) {
      startDate = parsed;
      // If task.scheduledDate is solely YYYY-MM-DD, set default hour 10:00 UTC unless time is specified
      if (/^\d{4}-\d{2}-\d{2}$/.test(task.scheduledDate.trim())) {
        startDate.setUTCHours(10, 0, 0, 0);
      }
    }
  }

  // 2. Refine or determine start time with scheduledTime
  const timeSpec = payload?.scheduledTime || task.scheduledTime;
  if (timeSpec) {
    const timeMatch = timeSpec.match(/(\d{1,2}):(\d{2})/);
    const hourOnlyMatch = timeSpec.match(/(?:at|o|um)\s+(\d{1,2})\b/i);

    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      if (startDate) {
        startDate.setUTCHours(hours, minutes, 0, 0);
      } else {
        const isToday = /today|dzisiaj|heute/i.test(timeSpec);
        const base = new Date();
        if (!isToday) {
          base.setUTCDate(base.getUTCDate() + 1);
        }
        base.setUTCHours(hours, minutes, 0, 0);
        startDate = base;
      }
    } else if (hourOnlyMatch) {
      const hours = parseInt(hourOnlyMatch[1], 10);
      if (startDate) {
        startDate.setUTCHours(hours, 0, 0, 0);
      } else {
        const isToday = /today|dzisiaj|heute/i.test(timeSpec);
        const base = new Date();
        if (!isToday) {
          base.setUTCDate(base.getUTCDate() + 1);
        }
        base.setUTCHours(hours, 0, 0, 0);
        startDate = base;
      }
    } else if (!startDate) {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(10, 0, 0, 0);
      startDate = tomorrow;
    }
  }

  // 3. Fallback: tomorrow at 10:00:00 UTC
  if (!startDate || isNaN(startDate.getTime())) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(10, 0, 0, 0);
    startDate = tomorrow;
  }

  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  return { startDate, endDate };
}

/**
 * Generates an RFC 5545 compliant iCalendar (.ics) string for a TaskEntity.
 */
export function generateICalendar(task: TaskEntity, payload?: DecryptedTaskPayload): string {
  const nowUtc = formatUtcToIcs(new Date());
  const { startDate, endDate } = resolveStartAndEndDates(task, payload);
  const startUtc = formatUtcToIcs(startDate);
  const endUtc = formatUtcToIcs(endDate);

  const titleVal =
    payload?.title || (task as unknown as { title?: string }).title || 'OSCAR Action Item';
  const escapedTitle = escapeIcsText(titleVal);

  const rawLocation = payload?.location || task.location || '';
  const locationVal = rawLocation ? normalizeAddressCasing(rawLocation) : '';
  const escapedLocation = escapeIcsText(locationVal);

  const status = task.status === 'COMPLETED' ? 'COMPLETED' : 'CONFIRMED';

  // Compose description including structured details and subtask checklist
  const descParts: string[] = [];
  if (payload?.summary) {
    descParts.push(payload.summary);
  }

  const rawContact = payload?.contactPerson || task.contactPerson;
  const contact = rawContact ? normalizePersonToNominative(rawContact) : null;
  const loc = locationVal || null;
  const amt = payload?.amount || task.amount;
  const schedTime = payload?.scheduledTime || task.scheduledTime;

  const currentDesc = descParts.join('\n');
  const structuredAdditions: string[] = [];

  if (contact && !currentDesc.includes(contact)) {
    structuredAdditions.push(`👤 Contact: ${contact}`);
  }
  if (loc && !currentDesc.includes(loc)) {
    structuredAdditions.push(`📍 Location: ${loc}`);
  }
  if (amt && !currentDesc.includes(amt)) {
    structuredAdditions.push(`💰 Amount: ${amt}`);
  }
  if (schedTime && !currentDesc.includes(schedTime)) {
    structuredAdditions.push(`⏰ Time: ${schedTime}`);
  }

  if (structuredAdditions.length > 0) {
    if (descParts.length > 0) descParts.push('');
    descParts.push(...structuredAdditions);
  }

  const subtasks = payload?.subtasks;
  if (subtasks && subtasks.length > 0) {
    descParts.push('');
    descParts.push('Checklist:');
    for (const st of subtasks) {
      descParts.push(`- [${st.completed ? 'x' : ' '}] ${st.title}`);
    }
  }

  const rawDescription = descParts.join('\n').trim() || titleVal;
  const escapedDescription = escapeIcsText(rawDescription);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OSCAR Runtime//Confidential Assistant//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:task_${task.id}@oscar.local`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${escapedTitle}`,
    `DESCRIPTION:${escapedDescription}`,
    `LOCATION:${escapedLocation}`,
    `STATUS:${status}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ];

  return lines.join('\r\n');
}

/**
 * Downloads an RFC 5545 iCalendar (.ics) file directly in the browser.
 * Safe for SSR / Node environments.
 */
export function downloadICalendarFile(task: TaskEntity, payload?: DecryptedTaskPayload): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  const icsContent = generateICalendar(task, payload);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const filename = `task_${task.id || 'export'}`;

  if (typeof window.URL?.createObjectURL === 'function') {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${filename}.ics`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof window.URL?.revokeObjectURL === 'function') {
      window.URL.revokeObjectURL(url);
    }
  }
}
