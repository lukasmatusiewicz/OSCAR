import { describe, it, expect } from 'vitest';
import { DeterministicFallbackExtractor } from '../../src/agent/DeterministicFallbackExtractor.js';
import { ExtractedTaskSchema } from '../../src/types/contracts.js';

describe('DeterministicFallbackExtractor', () => {
  it('should parse a simple work memo into a valid ExtractedTask conforming to schema', () => {
    const memo = 'Standup meeting with team tomorrow\n- Review pull requests\n- Update sprint board';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(ExtractedTaskSchema.safeParse(result).success).toBe(true);
    expect(result.title).toBe('Standup meeting with team tomorrow');
    expect(result.category).toBe('WORK');
    expect(result.priority).toBe('HIGH'); // 'tomorrow' matches HIGH
    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks[0]).toEqual({ title: 'Review pull requests', completed: false });
    expect(result.subtasks[1]).toEqual({ title: 'Update sprint board', completed: false });
    expect(result.tags).toEqual(['fallback', 'work']);
  });

  it('should infer URGENT priority on emergency keywords', () => {
    const memo = 'Critical server outage ASAP!\nInvestigate root cause immediately';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.priority).toBe('URGENT');
    expect(result.category).toBe('OTHER');
  });

  it('should infer LOW priority on optional/minor keywords', () => {
    const memo = 'Someday read this minor optional book';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.priority).toBe('LOW');
  });

  it('should infer MEDIUM priority when no urgency keywords match', () => {
    const memo = 'Organize personal books at home';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.priority).toBe('MEDIUM');
    expect(result.category).toBe('PERSONAL');
  });

  it('should fallback to OTHER category when no category keywords match', () => {
    const memo = 'Read a random article';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.category).toBe('OTHER');
    expect(result.priority).toBe('MEDIUM');
  });

  it('should infer FINANCE category correctly', () => {
    const memo = 'Pay invoice 1500 USD and transfer budget to IBAN';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.category).toBe('FINANCE');
  });

  it('should infer INTERVIEW_PREP category correctly', () => {
    const memo = 'Update resume and practice algorithm coding interview prep';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.category).toBe('INTERVIEW_PREP');
  });

  it('should infer HEALTH category correctly', () => {
    const memo = 'Visit dentist and schedule workout at the gym';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.category).toBe('HEALTH');
  });

  it('should infer PERSONAL category correctly', () => {
    const memo = 'Buy groceries for family home';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.category).toBe('PERSONAL');
  });

  it('should extract scheduled ISO date when present', () => {
    const memo = 'Project sync scheduled for 2026-12-15T14:30:00Z\nDiscuss deliverables';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.scheduledDate).toBe('2026-12-15T14:30:00Z');
  });

  it('should extract scheduled simple ISO date YYYY-MM-DD', () => {
    const memo = 'Deadline is 2026-11-30 for client report';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.scheduledDate).toBe('2026-11-30');
  });

  it('should set scheduledDate to null when no ISO date is in memo', () => {
    const memo = 'General task with no specific date';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.scheduledDate).toBeNull();
  });

  it('should guarantee >= 1 subtask when no bullet points exist', () => {
    const memo = 'Single line task without any bullets';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.subtasks.length).toBeGreaterThanOrEqual(1);
    expect(result.subtasks[0].title).toContain('Review and process: Single line task without any bullets');
    expect(result.subtasks[0].completed).toBe(false);
  });

  it('should handle numbered and bulleted subtasks correctly and cap at 10 items', () => {
    const bullets = Array.from({ length: 15 }, (_, i) => `${i + 1}. Item number ${i + 1}`).join('\n');
    const memo = `Task header\n${bullets}`;
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.subtasks).toHaveLength(10);
    expect(result.subtasks[0].title).toBe('Item number 1');
    expect(result.subtasks[9].title).toBe('Item number 10');
  });

  it('should support asterisk and bullet character lists', () => {
    const memo = 'Bullet test\n* First item\n• Second item\n- Third item';
    const result = DeterministicFallbackExtractor.extract(memo);

    expect(result.subtasks).toHaveLength(3);
    expect(result.subtasks[0].title).toBe('First item');
    expect(result.subtasks[1].title).toBe('Second item');
    expect(result.subtasks[2].title).toBe('Third item');
  });

  it('should truncate titles longer than 120 characters and pad short titles < 3 chars', () => {
    const longTitle = 'A'.repeat(150);
    const resultLong = DeterministicFallbackExtractor.extract(longTitle);
    expect(resultLong.title.length).toBe(120);
    expect(resultLong.title.endsWith('...')).toBe(true);

    const shortTitle = 'Hi';
    const resultShort = DeterministicFallbackExtractor.extract(shortTitle);
    expect(resultShort.title).toBe('Hi.');
    expect(resultShort.title.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle empty or whitespace-only memo safely', () => {
    const result = DeterministicFallbackExtractor.extract('   \n  \n');

    expect(ExtractedTaskSchema.safeParse(result).success).toBe(true);
    expect(result.title).toBe('New Memo Action Item');
    expect(result.summary.length).toBeGreaterThanOrEqual(5);
    expect(result.subtasks).toHaveLength(1);
  });

  it('should return provenance and modelVersion via extractWithMetadata', () => {
    const memo = 'Prepare budget report for meeting';
    const metadata = DeterministicFallbackExtractor.extractWithMetadata(memo);

    expect(metadata.provenance).toBe('DETERMINISTIC_FALLBACK');
    expect(metadata.modelVersion).toBe('rule-based-v1');
    expect(metadata.task.category).toBe('FINANCE'); // budget
    expect(ExtractedTaskSchema.safeParse(metadata.task).success).toBe(true);
  });

  describe('Synthesized Semantic Title Invariant & Smart Metadata Extraction', () => {
    it('synthesizes clean semantic titles from conversational memos without copying raw salutations verbatim', () => {
      const conversationalMemos = [
        {
          memo: 'Hey Lukas, please remind me to schedule a meeting with [PERSON_1] tomorrow at 14:00 in [ADDRESS_1]',
          forbiddenSubstrings: ['Hey Lukas', 'please remind me to']
        },
        {
          memo: 'Cześć, pamiętaj żeby zaplanować spotkanie z dr Anną Nowak jutro o 15:00',
          forbiddenSubstrings: ['Cześć', 'pamiętaj żeby zaplanować']
        },
        {
          memo: 'Hallo, erinnere mich an das Treffen mit Herrn Schmidt in Berlin',
          forbiddenSubstrings: ['Hallo', 'erinnere mich an das']
        }
      ];

      for (const { memo, forbiddenSubstrings } of conversationalMemos) {
        const task = DeterministicFallbackExtractor.extract(memo);
        expect(task.title.length).toBeGreaterThanOrEqual(3);
        expect(task.title.length).toBeLessThanOrEqual(120);

        for (const forbidden of forbiddenSubstrings) {
          expect(task.title.toLowerCase()).not.toContain(forbidden.toLowerCase());
        }
      }
    });

    it('synthesizes concise clause titles from single-paragraph multi-sentence memos', () => {
      const memo =
        'spotkanie z kazikiem bąkiem. za tydzień o 15. berlinerstr. 123. note: 15 tys euro.';
      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.title).toBe('Spotkanie z kazikiem bąkiem');
      expect(task.summary).toContain('spotkanie z kazikiem bąkiem');
      expect(task.summary).toContain('15 tys euro');
    });

    it('extracts and populates smart metadata fields: location, contactPerson, amount, scheduledTime', () => {
      const memo =
        'Hey Lukas, remind me to meet with [PERSON_1] at [ADDRESS_1] regarding budget [AMOUNT_MONEY_1] tomorrow at 14:30.\n' +
        '- Prepare slide deck\n' +
        '- Confirm attendee list';

      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.contactPerson).toBe('[PERSON_1]');
      expect(task.location).toBe('[ADDRESS_1]');
      expect(task.amount).toBe('[AMOUNT_MONEY_1]');
      expect(task.scheduledTime).toContain('14:30');
      expect(ExtractedTaskSchema.safeParse(task).success).toBe(true);
    });

    it('extracts natural language contactPerson and location and applies LinguisticNormalizer', () => {
      const memo = 'Spotkanie z dr Janem Kowalskim na ul. marszałkowska 10 jutro o 11:00';
      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.contactPerson).toBe('dr Jan Kowalski');
      expect(task.location).toBe('ul. Marszałkowska 10');
      expect(task.scheduledTime).toContain('11:00');
    });

    it('handles preamble-only memos and pads short summaries safely', () => {
      const task = DeterministicFallbackExtractor.extract('Please remind me to');
      expect(task.title).toBe('New Memo Action Item');
      expect(task.summary).toBe('New Memo Action Item');

      const taskShort = DeterministicFallbackExtractor.extract('Do');
      expect(taskShort.title).toBe('Do.');
      expect(taskShort.summary.length).toBeGreaterThanOrEqual(5);
    });

    it('sets smart metadata fields to null when not detected in memo', () => {
      const memo = 'Review code pull request and verify unit tests';
      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.location).toBeNull();
      expect(task.contactPerson).toBeNull();
      expect(task.amount).toBeNull();
      expect(task.scheduledTime).toBeNull();
    });

    it('formats multi-line summary with bullet • prefix for metadata and notes', () => {
      const memo = 'spotkanie z [PERSON_1]. [ADDRESS_1]. note: 1231421415; kawka';
      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.summary).toContain('• 👤 Contact: [PERSON_1]');
      expect(task.summary).toContain('• 📍 Location: [ADDRESS_1]');
      expect(task.summary).toContain('• 📝 Notes: 1231421415; kawka');
    });

    it('extracts clean title without metadata prefixes when memo contains pasted card metadata markers', () => {
      const memo =
        'Spotkanie z Beatą Kozidrak\n• 👤 Contact: Beata Kozidrak\n• 📍 Location: Hamburgerstr. 123';
      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.title).toBe('Spotkanie z Beatą Kozidrak');
      expect(task.contactPerson).toBe('Beata Kozidrak');
      expect(task.location).toBe('Hamburgerstr. 123');
      expect(task.summary).toContain('• 👤 Contact: Beata Kozidrak');
      expect(task.summary).toContain('• 📍 Location: Hamburgerstr. 123');
      expect(task.summary).not.toContain('• 📝 Notes: • 👤 Contact:');
      expect(task.subtasks.some((s) => s.title.includes('👤 Contact:'))).toBe(false);
    });

    it('extracts amount and scheduledTime from card metadata markers when not in body', () => {
      const memo =
        'Quarterly business review\n• 💰 Amount: 45000 Equity Units\n• ⏰ Time: End of Day Q3 Sprint\n• 📝 Notes: Board members only';
      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.amount).toBe('45000 Equity Units');
      expect(task.scheduledTime).toBe('End of Day Q3 Sprint');
      expect(task.summary).toContain('• 💰 Amount: 45000 Equity Units');
      expect(task.summary).toContain('• ⏰ Time: End of Day Q3 Sprint');
      expect(task.summary).toContain('• 📝 Notes: Board members only');
    });

    it('skips duplicate clauses that match location, amount, scheduledTime, or metadata markers in subsequent clauses', () => {
      const memo =
        'Plan workshop in Berlin. Berlin. 100 EUR. 14:00. • 📍 Location: Berlin. • ⏰ Time: 14:00. • 💰 Amount: 100 EUR. Notes: finalize slides.';
      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.location).toBe('Berlin');
      expect(task.amount).toBe('100 EUR');
      expect(task.scheduledTime).toBe('14:00');
      expect(task.summary).toContain('• 📍 Location: Berlin');
      expect(task.summary).toContain('• 💰 Amount: 100 EUR');
      expect(task.summary).toContain('• ⏰ Time: 14:00');
      expect(task.summary).toContain('• 📝 Notes: finalize slides');
    });

    it('truncates summaries longer than 500 characters gracefully with ellipsis', () => {
      const longNote = 'A very detailed exhaustive non-repeating description of architecture review ' + 'x'.repeat(550);
      const memo = `Review system architecture. Notes: ${longNote}`;
      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.summary.length).toBeLessThanOrEqual(500);
      expect(task.summary.endsWith('...')).toBe(true);
    });

    it('handles multiple chained directive fillers and preambles', () => {
      const memo = 'Hey Alice, dear Szanowny Panie, please remind me to don\'t forget to review the pull request';
      const task = DeterministicFallbackExtractor.extract(memo);

      expect(task.title).toBe('Review the pull request');
    });

    describe('Preposition Temporal Boundary & Enhanced Time Extraction Suite', () => {
      const formatIso = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const getTomorrow = () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return formatIso(d);
      };

      const getUpcomingWednesday = () => {
        const d = new Date();
        const currentDay = d.getDay();
        let diff = (3 - currentDay + 7) % 7;
        if (diff === 0) diff = 7;
        d.setDate(d.getDate() + diff);
        return formatIso(d);
      };

      it('correctly extracts contactPerson, scheduledDate, and scheduledTime for "Spotkanie z Marcinem Jutro o 12"', () => {
        const task = DeterministicFallbackExtractor.extract('Spotkanie z Marcinem Jutro o 12');
        expect(task.contactPerson).toBe('Marcin');
        expect(task.scheduledDate).toBe(getTomorrow());
        expect(task.scheduledTime).toBe('12:00');
      });

      it('correctly extracts scheduledDate and scheduledTime for "Środa o 15"', () => {
        const task = DeterministicFallbackExtractor.extract('Środa o 15');
        expect(task.scheduledDate).toBe(getUpcomingWednesday());
        expect(task.scheduledTime).toBe('15:00');
      });

      it('correctly extracts German "Treffen mit Markus morgen um 14"', () => {
        const task = DeterministicFallbackExtractor.extract('Treffen mit Markus morgen um 14');
        expect(task.contactPerson).toBe('Markus');
        expect(task.scheduledDate).toBe(getTomorrow());
        expect(task.scheduledTime).toBe('14:00');
      });

      it('correctly extracts English "Call with Sarah tomorrow at 3pm"', () => {
        const task = DeterministicFallbackExtractor.extract('Call with Sarah tomorrow at 3pm');
        expect(task.contactPerson).toBe('Sarah');
        expect(task.scheduledDate).toBe(getTomorrow());
        expect(task.scheduledTime).toBe('15:00');
      });

      it('normalizes single-hour and prefixed times correctly across variants', () => {
        expect(DeterministicFallbackExtractor.extractScheduledTime('Spotkanie o 12')).toBe('12:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Spotkanie o 15')).toBe('15:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Kawa o 9 rano')).toBe('09:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Treffen um 14')).toBe('14:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Meeting um 9')).toBe('09:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Call at 15')).toBe('15:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Sync at 3pm')).toBe('15:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Sync at 3 pm')).toBe('15:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Breakfast at 9am')).toBe('09:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Breakfast at 9 am')).toBe('09:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Lunch o 12:30')).toBe('12:30');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Workshop um 14:00')).toBe('14:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Review at 15:30')).toBe('15:30');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Wizyta godz. 12')).toBe('12:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Wizyta godz 14:00')).toBe('14:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Standard 12:00')).toBe('12:00');
        expect(DeterministicFallbackExtractor.extractScheduledTime('Invalid o 25')).toBeNull();
      });
    });
  });
});
