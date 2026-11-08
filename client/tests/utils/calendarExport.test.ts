import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateICalendar,
  downloadICalendarFile,
  escapeIcsText,
  formatUtcToIcs,
  resolveStartAndEndDates,
} from '../../src/utils/calendarExport';
import { TaskEntity, DecryptedTaskPayload } from '../../src/types/contracts';

describe('calendarExport utility suite', () => {
  const baseTask: TaskEntity = {
    id: 'task_mock_calendar_001',
    memoId: 'memo_mock_calendar_001',
    userId: 'usr_mock_calendar_001',
    encryptedPayload: {
      ciphertext: 'ciphertext',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'v1',
    },
    category: 'WORK',
    priority: 'HIGH',
    status: 'PENDING',
    scheduledDate: '2026-11-20T14:00:00.000Z',
    tags: ['work', 'calendar'],
    provenance: 'GEMINI_FLASH',
    modelVersion: 'gemini-2.5-flash-001',
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
    location: 'Berlin Office, Room 4',
    contactPerson: 'Alice Newman',
    amount: '1500 EUR',
    scheduledTime: '14:00',
  };

  const basePayload: DecryptedTaskPayload = {
    title: 'Audit Compliance Sync, Q4; Review\\Check',
    summary: 'Executive sync on ISO compliance and security controls\nAdditional agenda items.',
    location: 'Berlin Office, Room 4',
    contactPerson: 'Alice Newman',
    amount: '1500 EUR',
    scheduledTime: '14:00',
    subtasks: [
      { title: 'Prepare access control logs, certificates; verify', completed: false },
      { title: 'Sign off NDA\\Audit document', completed: true },
    ],
  };

  describe('escapeIcsText', () => {
    it('escapes backslashes, semicolons, commas, and newlines per RFC 5545 Section 3.3.11', () => {
      const input = 'Special chars: \\ and ; and , with\nnewline and \r\ncarriage return.';
      const escaped = escapeIcsText(input);

      expect(escaped).toBe(
        'Special chars: \\\\ and \\; and \\, with\\nnewline and \\ncarriage return.',
      );
    });

    it('returns empty string unmodified', () => {
      expect(escapeIcsText('')).toBe('');
    });
  });

  describe('formatUtcToIcs', () => {
    it('formats UTC date into compact YYYYMMDDTHHMMSSZ format', () => {
      const date = new Date(Date.UTC(2026, 10, 20, 14, 30, 45));
      expect(formatUtcToIcs(date)).toBe('20261120T143045Z');
    });
  });

  describe('resolveStartAndEndDates', () => {
    it('uses task.scheduledDate when valid ISO datetime is present and adds 1 hour for DTEND', () => {
      const { startDate, endDate } = resolveStartAndEndDates(baseTask, basePayload);
      expect(startDate.toISOString()).toBe('2026-11-20T14:00:00.000Z');
      expect(endDate.toISOString()).toBe('2026-11-20T15:00:00.000Z');
    });

    it('defaults simple YYYY-MM-DD date to 10:00:00 UTC when no time is given', () => {
      const task: TaskEntity = {
        ...baseTask,
        scheduledDate: '2026-12-25',
        scheduledTime: null,
      };
      const { startDate, endDate } = resolveStartAndEndDates(task);
      expect(startDate.getUTCFullYear()).toBe(2026);
      expect(startDate.getUTCMonth()).toBe(11); // December (0-indexed)
      expect(startDate.getUTCDate()).toBe(25);
      expect(startDate.getUTCHours()).toBe(10);
      expect(endDate.getUTCHours()).toBe(11);
    });

    it('refines YYYY-MM-DD date with HH:MM from scheduledTime', () => {
      const task: TaskEntity = {
        ...baseTask,
        scheduledDate: '2026-12-25',
      };
      const payload: DecryptedTaskPayload = {
        ...basePayload,
        scheduledTime: '16:45',
      };
      const { startDate, endDate } = resolveStartAndEndDates(task, payload);
      expect(startDate.getUTCHours()).toBe(16);
      expect(startDate.getUTCMinutes()).toBe(45);
      expect(endDate.getUTCHours()).toBe(17);
      expect(endDate.getUTCMinutes()).toBe(45);
    });

    it('handles hour-only scheduledTime like "tomorrow at 15"', () => {
      const task: TaskEntity = {
        ...baseTask,
        scheduledDate: null,
      };
      const payload: DecryptedTaskPayload = {
        ...basePayload,
        scheduledTime: 'tomorrow at 15',
      };
      const { startDate } = resolveStartAndEndDates(task, payload);
      expect(startDate.getUTCHours()).toBe(15);
      expect(startDate.getUTCMinutes()).toBe(0);
    });

    it('refines existing scheduledDate with hour-only time', () => {
      const task: TaskEntity = {
        ...baseTask,
        scheduledDate: '2026-11-20',
      };
      const payload: DecryptedTaskPayload = {
        ...basePayload,
        scheduledTime: 'at 11',
      };
      const { startDate } = resolveStartAndEndDates(task, payload);
      expect(startDate.getUTCHours()).toBe(11);
    });

    it('handles HH:MM scheduledTime without scheduledDate and not today', () => {
      const task: TaskEntity = {
        ...baseTask,
        scheduledDate: null,
      };
      const payload: DecryptedTaskPayload = {
        ...basePayload,
        scheduledTime: '17:30',
      };
      const { startDate } = resolveStartAndEndDates(task, payload);
      expect(startDate.getUTCHours()).toBe(17);
      expect(startDate.getUTCMinutes()).toBe(30);
    });

    it('handles non-numeric scheduledTime without scheduledDate by defaulting to tomorrow at 10', () => {
      const task: TaskEntity = {
        ...baseTask,
        scheduledDate: null,
      };
      const payload: DecryptedTaskPayload = {
        ...basePayload,
        scheduledTime: 'morning sync',
      };
      const { startDate } = resolveStartAndEndDates(task, payload);
      expect(startDate.getUTCHours()).toBe(10);
    });

    it('handles today in scheduledTime like "today at 16:30"', () => {
      const task: TaskEntity = {
        ...baseTask,
        scheduledDate: null,
      };
      const payload: DecryptedTaskPayload = {
        ...basePayload,
        scheduledTime: 'today at 16:30',
      };
      const { startDate } = resolveStartAndEndDates(task, payload);
      const now = new Date();
      expect(startDate.getUTCDate()).toBe(now.getUTCDate());
      expect(startDate.getUTCHours()).toBe(16);
      expect(startDate.getUTCMinutes()).toBe(30);
    });

    it('defaults to tomorrow at 10:00:00 UTC when scheduledDate and scheduledTime are absent', () => {
      const task: TaskEntity = {
        ...baseTask,
        scheduledDate: null,
        scheduledTime: null,
      };
      const payload: DecryptedTaskPayload = {
        ...basePayload,
        scheduledTime: null,
      };
      const { startDate, endDate } = resolveStartAndEndDates(task, payload);
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

      expect(startDate.getUTCDate()).toBe(tomorrow.getUTCDate());
      expect(startDate.getUTCHours()).toBe(10);
      expect(startDate.getUTCMinutes()).toBe(0);
      expect(endDate.getUTCHours()).toBe(11);
    });

    it('falls back gracefully on unparseable date strings', () => {
      const task: TaskEntity = {
        ...baseTask,
        scheduledDate: 'invalid-date-string',
        scheduledTime: null,
      };
      const { startDate } = resolveStartAndEndDates(task);
      expect(startDate).toBeInstanceOf(Date);
      expect(isNaN(startDate.getTime())).toBe(false);
    });
  });

  describe('generateICalendar', () => {
    it('generates valid RFC 5545 VCALENDAR and VEVENT with strict CRLF line endings', () => {
      const ics = generateICalendar(baseTask, basePayload);

      // Strict CRLF check: must contain \r\n and must not contain bare \n
      expect(ics).toContain('\r\n');
      const linesWithoutCr = ics.replace(/\r\n/g, '');
      expect(linesWithoutCr).not.toContain('\n');

      // Mandatory RFC 5545 Headers
      expect(ics).toContain('BEGIN:VCALENDAR\r\n');
      expect(ics).toContain('VERSION:2.0\r\n');
      expect(ics).toContain('PRODID:-//OSCAR Runtime//Confidential Assistant//EN\r\n');
      expect(ics).toContain('CALSCALE:GREGORIAN\r\n');
      expect(ics).toContain('METHOD:PUBLISH\r\n');
      expect(ics).toContain('BEGIN:VEVENT\r\n');
      expect(ics).toContain(`UID:task_${baseTask.id}@oscar.local\r\n`);
      expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z\r\n/);
      expect(ics).toContain('DTSTART:20261120T140000Z\r\n');
      expect(ics).toContain('DTEND:20261120T150000Z\r\n');
      expect(ics).toContain('STATUS:CONFIRMED\r\n');
      expect(ics).toContain('END:VEVENT\r\n');
      expect(ics).toContain('END:VCALENDAR\r\n');
    });

    it('sets STATUS:COMPLETED when task.status is COMPLETED', () => {
      const completedTask: TaskEntity = {
        ...baseTask,
        status: 'COMPLETED',
      };
      const ics = generateICalendar(completedTask, basePayload);
      expect(ics).toContain('STATUS:COMPLETED\r\n');
    });

    it('escapes summary, location, and description properly', () => {
      const ics = generateICalendar(baseTask, basePayload);

      // Title escaping: commas \, semicolons \;, backslashes \\
      expect(ics).toContain('SUMMARY:Audit Compliance Sync\\, Q4\\; Review\\\\Check\r\n');

      // Location escaping
      expect(ics).toContain('LOCATION:Berlin Office\\, Room 4\r\n');

      // Description escaping and subtask checklist
      expect(ics).toContain('DESCRIPTION:');
      expect(ics).toContain('Executive sync on ISO compliance and security controls\\nAdditional agenda items.');
      expect(ics).toContain('Checklist:');
      expect(ics).toContain('- [ ] Prepare access control logs\\, certificates\\; verify');
      expect(ics).toContain('- [x] Sign off NDA\\\\Audit document');
    });

    it('handles tasks without decryptedPayload or location safely', () => {
      const minimalTask: TaskEntity = {
        ...baseTask,
        location: null,
        contactPerson: null,
        amount: null,
        scheduledTime: null,
        scheduledDate: null,
      };

      const ics = generateICalendar(minimalTask);
      expect(ics).toContain('BEGIN:VCALENDAR\r\n');
      expect(ics).toContain('LOCATION:\r\n');
      expect(ics).toContain(`UID:task_${minimalTask.id}@oscar.local\r\n`);
      expect(ics).toContain('END:VCALENDAR\r\n');
    });
  });

  describe('downloadICalendarFile', () => {
    let originalCreateObjectURL: typeof window.URL.createObjectURL;
    let originalRevokeObjectURL: typeof window.URL.revokeObjectURL;
    let createObjectURLMock: ReturnType<typeof vi.fn>;
    let revokeObjectURLMock: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      originalCreateObjectURL = window.URL.createObjectURL;
      originalRevokeObjectURL = window.URL.revokeObjectURL;

      createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost:3000/mock-uuid');
      revokeObjectURLMock = vi.fn();

      window.URL.createObjectURL = createObjectURLMock;
      window.URL.revokeObjectURL = revokeObjectURLMock;

      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
      clickSpy.mockRestore();
      vi.restoreAllMocks();
    });

    it('normalizes inflected contact person and address casing in exported iCalendar', () => {
      const task: TaskEntity = {
        ...baseTask,
        contactPerson: 'z Anną Nowak',
        location: 'ul. marszałkowska 10',
      };
      const payload: DecryptedTaskPayload = {
        ...basePayload,
        contactPerson: 'z Anną Nowak',
        location: 'ul. marszałkowska 10',
        summary: 'Spotkanie organizacyjne',
      };

      const ics = generateICalendar(task, payload);
      expect(ics).toContain('LOCATION:ul. Marszałkowska 10');
      expect(ics).toContain('👤 Contact: Anna Nowak');
    });

    it('creates a download link, triggers click, and revokes object URL without throwing', () => {
      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      downloadICalendarFile(baseTask, basePayload);

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      const blobArg = createObjectURLMock.mock.calls[0][0];
      expect(blobArg).toBeInstanceOf(Blob);

      expect(appendChildSpy).toHaveBeenCalled();
      const createdLink = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      expect(createdLink.tagName.toLowerCase()).toBe('a');
      expect(createdLink.getAttribute('download')).toBe(`task_${baseTask.id}.ics`);
      expect(createdLink.href).toBe('blob:http://localhost:3000/mock-uuid');
      expect(clickSpy).toHaveBeenCalledTimes(1);

      expect(removeChildSpy).toHaveBeenCalledWith(createdLink);
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost:3000/mock-uuid');
    });

    it('guards against execution in SSR/Node environments where window or document is undefined', () => {
      const originalWindow = global.window;
      // @ts-expect-error simulating SSR
      delete global.window;

      expect(() => {
        downloadICalendarFile(baseTask, basePayload);
      }).not.toThrow();

      global.window = originalWindow;
    });
  });
});
