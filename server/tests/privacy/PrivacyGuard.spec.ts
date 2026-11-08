import { describe, it, expect } from 'vitest';
import { PrivacyGuard, rehydrate, TOKEN_PATTERN } from '../../src/privacy/PrivacyGuard.js';
import {
  SanitizationResultSchema,
  PIITokenMap,
  PIIType,
  SanitizationResult
} from '../../src/types/contracts.js';

describe('PrivacyGuard Engine Suite', () => {
  // =========================================================================
  // 1. Multi-Entity Detection Across All 6 Categories
  // =========================================================================
  describe('Multi-Entity Detection Across All 6 Categories', () => {
    it('detects API and Secret Keys (Priority 1)', () => {
      const samples = [
        {
          text: 'Use auth bearer abcdef1234567890abcdef123456 for authorization',
          expectedMatch: 'bearer abcdef1234567890abcdef123456'
        },
        {
          text: 'GitHub PAT is ghp_1234567890abcdef1234567890abcdef1234 in git',
          expectedMatch: 'ghp_1234567890abcdef1234567890abcdef1234'
        },
        {
          text: 'Google AI key aiabcdef1234567890abcdef1234567890 is active',
          expectedMatch: 'aiabcdef1234567890abcdef1234567890'
        },
        {
          text: 'OpenAI key sk-1234567890abcdef1234567890abcdef12 in config',
          expectedMatch: 'sk-1234567890abcdef1234567890abcdef12'
        }
      ];

      for (const { text, expectedMatch } of samples) {
        const result = PrivacyGuard.mask(text);
        expect(result.tokens.length).toBeGreaterThanOrEqual(1);
        const secretToken = result.tokens.find(t => t.type === 'SECRET_KEY');
        expect(secretToken).toBeDefined();
        expect(secretToken?.originalValue).toBe(expectedMatch);
        expect(result.sanitizedText).not.toContain(expectedMatch);
        expect(result.sanitizedText).toContain(secretToken?.token);
      }
    });

    it('detects IBANs (Priority 2) with case-insensitivity', () => {
      const germanIban = 'DE89 3704 0044 0532 0130 00';
      const polishIban = 'PL61109010140000071219812874';
      const lowercaseGermanIban = 'de89 3704 0044 0532 0130 00';
      const lowercasePolishIban = 'pl61109010140000071219812874';

      const resDe = PrivacyGuard.mask(`Wire funds to ${germanIban} immediately.`);
      expect(resDe.tokens).toHaveLength(1);
      expect(resDe.tokens[0].type).toBe('IBAN');
      expect(resDe.tokens[0].originalValue).toBe(germanIban);
      expect(resDe.sanitizedText).toBe('Wire funds to [IBAN_1] immediately.');

      const resPl = PrivacyGuard.mask(`Bank account: ${polishIban}`);
      expect(resPl.tokens).toHaveLength(1);
      expect(resPl.tokens[0].type).toBe('IBAN');
      expect(resPl.tokens[0].originalValue).toBe(polishIban);
      expect(resPl.sanitizedText).toBe('Bank account: [IBAN_1]');

      const resDeLower = PrivacyGuard.mask(`Account: ${lowercaseGermanIban}`);
      expect(resDeLower.tokens).toHaveLength(1);
      expect(resDeLower.tokens[0].type).toBe('IBAN');
      expect(resDeLower.tokens[0].originalValue).toBe(lowercaseGermanIban);
      expect(resDeLower.sanitizedText).toBe('Account: [IBAN_1]');

      const resPlLower = PrivacyGuard.mask(`Account: ${lowercasePolishIban}`);
      expect(resPlLower.tokens).toHaveLength(1);
      expect(resPlLower.tokens[0].type).toBe('IBAN');
      expect(resPlLower.tokens[0].originalValue).toBe(lowercasePolishIban);
      expect(resPlLower.sanitizedText).toBe('Account: [IBAN_1]');
    });

    it('detects Email Addresses (Priority 3)', () => {
      const text = 'Send questions to contact@example.com or user.name+tag@sub.domain.co.uk please.';
      const result = PrivacyGuard.mask(text);

      expect(result.tokens).toHaveLength(2);
      expect(result.tokens[0].type).toBe('EMAIL');
      expect(result.tokens[0].originalValue).toBe('contact@example.com');
      expect(result.tokens[1].type).toBe('EMAIL');
      expect(result.tokens[1].originalValue).toBe('user.name+tag@sub.domain.co.uk');
      expect(result.sanitizedText).toBe('Send questions to [EMAIL_1] or [EMAIL_2] please.');
    });

    it('detects Phone Numbers (Priority 4)', () => {
      const samples = [
        '+49 170 1234567',
        '(030) 9876-5432',
        '+1-800-555-0199',
        '0044 20 7946 0999'
      ];

      for (const phone of samples) {
        const result = PrivacyGuard.mask(`Call me at ${phone} today.`);
        expect(result.tokens.length).toBeGreaterThanOrEqual(1);
        const phoneToken = result.tokens.find(t => t.type === 'PHONE');
        expect(phoneToken).toBeDefined();
        expect(phoneToken?.originalValue).toBe(phone);
        expect(result.sanitizedText).not.toContain(phone);
      }
    });

    it('detects Monetary Amounts (Priority 5) including colloquial multipliers and spacing', () => {
      const samples = [
        { text: 'Invoice of 15000 EUR is pending', val: '15000 EUR' },
        { text: 'Total is $450.00 for the license', val: '$450.00' },
        { text: 'The price was 2.500,00 € in total', val: '2.500,00 €' },
        { text: 'Fee is 49,99 PLN for shipping', val: '49,99 PLN' },
        { text: 'Pay £75.50 today', val: '£75.50' },
        { text: 'Deposit 100 USD now', val: '100 USD' },
        { text: 'Estimated cost: 50k zł for consulting', val: '50k zł' },
        { text: 'Budget exceeded 1.5 mln EUR this quarter', val: '1.5 mln EUR' },
        { text: 'Received 25 tys. PLN grant', val: '25 tys. PLN' },
        { text: 'Transferred 15 0000 PLN yesterday', val: '15 0000 PLN' },
        { text: 'Bonus is 50k€ for achievement', val: '50k€' },
        { text: 'Contract worth 10 milionów złotych', val: '10 milionów złotych' },
        { text: 'Fee: 300 CHF standard', val: '300 CHF' },
        { text: 'Cost is 100 euro per person', val: '100 euro' },
        { text: 'Price was zł 50 000 in cash', val: 'zł 50 000' },
        { text: 'Total cost ¥5000 in Tokyo', val: '¥5000' }
      ];

      for (const { text, val } of samples) {
        const result = PrivacyGuard.mask(text);
        expect(result.tokens.length).toBeGreaterThanOrEqual(1);
        const amtToken = result.tokens.find(t => t.type === 'AMOUNT_MONEY');
        expect(amtToken).toBeDefined();
        expect(amtToken?.originalValue).toBe(val);
        expect(result.sanitizedText).not.toContain(val);
      }
    });

    it('detects Person Names via Honorifics, Declined Polish Cases, and Context Markers (Priority 6)', () => {
      const honorifics = [
        'Mr. John Doe',
        'Ms. Alice Smith',
        'Mrs. Jane Miller',
        'Dr. Gregory House',
        'Prof. Charles Xavier',
        'Herr Max Mustermann',
        'Frau Erika Schmidt',
        'Pan Tomasz Nowak',
        'Pani Anna Nowak',
        'dr Piotr Wiśniewski',
        'mec. Anna Zielińska'
      ];

      for (const name of honorifics) {
        const res = PrivacyGuard.mask(`Please invite ${name} to the meeting.`);
        expect(res.tokens.length).toBeGreaterThanOrEqual(1);
        const pToken = res.tokens.find(t => t.type === 'PERSON');
        expect(pToken).toBeDefined();
        expect(pToken?.originalValue).toBe(name);
        expect(res.sanitizedText).not.toContain(name);
      }

      const relationalCases = [
        { text: 'Schedule a call with Alice Newman tomorrow.', name: 'Alice Newman' },
        { text: 'Meeting Bob Miller regarding the budget.', name: 'Bob Miller' },
        { text: 'Send report to David Copperfield immediately.', name: 'David Copperfield' },
        { text: 'This was reviewed by Grace Hopper yesterday.', name: 'Grace Hopper' },
        { text: 'Task was assigned to Alan Turing for analysis.', name: 'Alan Turing' },
        { text: 'Please contact John Carmack for guidance.', name: 'John Carmack' },
        { text: 'Spotkanie z Janem Kowalskim w biurze.', name: 'Janem Kowalskim' },
        { text: 'Rozmowa z Piotrem Wiśniewskim w poniedziałek.', name: 'Piotrem Wiśniewskim' },
        { text: 'Dokument przygotowany dla Annie Nowak.', name: 'Annie Nowak' },
        { text: 'Przekaż zadanie Markowi Wójcikowi.', name: 'Markowi Wójcikowi' },
        { text: 'Treffen mit Hans Schmidt in Berlin.', name: 'Hans Schmidt' },
        { text: 'Rendez-vous avec François Dupond à Paris.', name: 'François Dupond' }
      ];

      for (const { text, name } of relationalCases) {
        const res = PrivacyGuard.mask(text);
        expect(res.tokens.length).toBeGreaterThanOrEqual(1);
        const pToken = res.tokens.find(t => t.type === 'PERSON');
        expect(pToken).toBeDefined();
        expect(pToken?.originalValue).toBe(name);
        expect(res.sanitizedText).not.toContain(name);
      }
    });

    it('detects Physical Addresses, Street Patterns, and Major International Hubs (Priority 7)', () => {
      const streetCases = [
        { text: 'Meeting at ul. Marszałkowska 10 tomorrow', addr: 'ul. Marszałkowska 10' },
        { text: 'Office address is Friedrichstraße 42 in the center', addr: 'Friedrichstraße 42' },
        { text: 'Store located at rue de Rivoli 5 near the Louvre', addr: 'rue de Rivoli 5' },
        { text: 'Residence at Baker Street 221B is famous', addr: 'Baker Street 221B' },
        { text: 'The Prime Minister lives at 10 Downing Street in London', addr: '10 Downing Street' },
        { text: 'Visit ul. Marszałkowska 126 for the keys', addr: 'ul. Marszałkowska 126' },
        { text: 'Branch at al. Jerozolimskie 50 is open', addr: 'al. Jerozolimskie 50' },
        { text: 'Meeting at pl. Bankowy 1 on Friday', addr: 'pl. Bankowy 1' }
      ];

      for (const { text, addr } of streetCases) {
        const res = PrivacyGuard.mask(text);
        expect(res.tokens.length).toBeGreaterThanOrEqual(1);
        const addrToken = res.tokens.find(t => t.type === 'ADDRESS');
        expect(addrToken).toBeDefined();
        expect(addrToken?.originalValue).toBe(addr);
        expect(res.sanitizedText).not.toContain(addr);
      }

      const cities = [
        'New York', 'Kassel', 'Berlin', 'Paris', 'Warsaw', 'Warszawa',
        'London', 'Zurich', 'Zürich', 'Tokyo', 'Vienna', 'Wien', 'Rome',
        'Roma', 'Madrid', 'Krakow', 'Kraków', 'Wrocław', 'Munich', 'München',
        'Hamburg', 'Frankfurt'
      ];

      for (const city of cities) {
        const res = PrivacyGuard.mask(`Flight to ${city} is scheduled.`);
        expect(res.tokens.length).toBeGreaterThanOrEqual(1);
        const addrToken = res.tokens.find(t => t.type === 'ADDRESS');
        expect(addrToken).toBeDefined();
        expect(addrToken?.originalValue).toBe(city);
        expect(res.sanitizedText).not.toContain(city);
      }
    });
  });

  // =========================================================================
  // 2. Priority Overlap Resolution (1: SECRET_KEY -> 6: PERSON)
  // =========================================================================
  describe('Priority Overlap Resolution', () => {
    it('resolves overlapping candidate spans with higher priority winning', () => {
      // Direct method test on resolveOverlaps
      const overlaps = [
        {
          type: 'PERSON' as PIIType,
          value: 'John Doe',
          startIndex: 10,
          endIndex: 18
        },
        {
          type: 'SECRET_KEY' as PIIType,
          value: 'sk-1234567890abcdef1234567890abcdef',
          startIndex: 5,
          endIndex: 41
        }
      ];

      const resolved = PrivacyGuard.resolveOverlaps(overlaps);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].type).toBe('SECRET_KEY');
      expect(resolved[0].value).toBe('sk-1234567890abcdef1234567890abcdef');
    });

    it('prefers IBAN (Priority 2) over nested PHONE (Priority 4) false matches', () => {
      // IBAN contains blocks of digits that a phone pattern might overlap with
      const text = 'Transfer to DE89 3704 0044 0532 0130 00 now';
      const result = PrivacyGuard.mask(text);

      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].type).toBe('IBAN');
      expect(result.tokens[0].originalValue).toBe('DE89 3704 0044 0532 0130 00');
      expect(result.tokens.some(t => t.type === 'PHONE')).toBe(false);
    });

    it('prefers EMAIL (Priority 3) over PERSON (Priority 6) when relational marker touches an email', () => {
      // "contact alice@example.com": "contact" could trigger person lookbehind on "alice"
      const text = 'Please contact alice@example.com for support.';
      const result = PrivacyGuard.mask(text);

      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].type).toBe('EMAIL');
      expect(result.tokens[0].originalValue).toBe('alice@example.com');
      expect(result.tokens.some(t => t.type === 'PERSON')).toBe(false);
    });

    it('prefers SECRET_KEY (Priority 1) over EMAIL (Priority 3) when token looks like an email', () => {
      // bearer token containing @ or similar character overlap
      const rawMatches = [
        {
          type: 'EMAIL' as PIIType,
          value: 'key@corp.com',
          startIndex: 10,
          endIndex: 22
        },
        {
          type: 'SECRET_KEY' as PIIType,
          value: 'bearer 12345key@corp.com987654321',
          startIndex: 3,
          endIndex: 36
        }
      ];

      const resolved = PrivacyGuard.resolveOverlaps(rawMatches);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].type).toBe('SECRET_KEY');
    });

    it('returns matches unchanged when length <= 1 in resolveOverlaps', () => {
      expect(PrivacyGuard.resolveOverlaps([])).toEqual([]);
      const singleMatch = [
        {
          type: 'EMAIL' as PIIType,
          value: 'test@example.com',
          startIndex: 0,
          endIndex: 16
        }
      ];
      expect(PrivacyGuard.resolveOverlaps(singleMatch)).toEqual(singleMatch);
    });

    it('prefers PERSON (Priority 6) over ADDRESS (Priority 7) in overlapping candidate spans', () => {
      const rawMatches = [
        {
          type: 'ADDRESS' as PIIType,
          value: 'Paris Hilton',
          startIndex: 0,
          endIndex: 12
        },
        {
          type: 'PERSON' as PIIType,
          value: 'Paris Hilton',
          startIndex: 0,
          endIndex: 12
        }
      ];

      const resolved = PrivacyGuard.resolveOverlaps(rawMatches);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].type).toBe('PERSON');
    });

    it('prefers AMOUNT_MONEY (Priority 5) over ADDRESS (Priority 7) in overlapping spans', () => {
      const rawMatches = [
        {
          type: 'ADDRESS' as PIIType,
          value: 'Kassel 500 EUR',
          startIndex: 0,
          endIndex: 14
        },
        {
          type: 'AMOUNT_MONEY' as PIIType,
          value: '500 EUR',
          startIndex: 7,
          endIndex: 14
        }
      ];

      const resolved = PrivacyGuard.resolveOverlaps(rawMatches);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].type).toBe('AMOUNT_MONEY');
    });

    it('resolves ties with same priority and start index by choosing longer span', () => {
      const ties = [
        {
          type: 'PERSON' as PIIType,
          value: 'Alice',
          startIndex: 0,
          endIndex: 5
        },
        {
          type: 'PERSON' as PIIType,
          value: 'Alice Newman',
          startIndex: 0,
          endIndex: 12
        }
      ];
      const resolved = PrivacyGuard.resolveOverlaps(ties);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].value).toBe('Alice Newman');
    });
  });

  // =========================================================================
  // 3. Normalized Entity Deduplication
  // =========================================================================
  describe('Normalized Entity Deduplication', () => {
    it('assigns identical tokens to repeated occurrences of the same person name', () => {
      const text =
        'Schedule a meeting with Alice Newman. ' +
        'Please call Alice Newman beforehand. ' +
        'Send summary to Alice Newman.';

      const result = PrivacyGuard.mask(text);

      // All 3 occurrences of Alice Newman should receive [PERSON_1]
      expect(result.tokens).toHaveLength(3);
      expect(result.tokens[0].token).toBe('[PERSON_1]');
      expect(result.tokens[1].token).toBe('[PERSON_1]');
      expect(result.tokens[2].token).toBe('[PERSON_1]');

      // All original values match
      expect(result.tokens[0].originalValue).toBe('Alice Newman');
      expect(result.tokens[1].originalValue).toBe('Alice Newman');
      expect(result.tokens[2].originalValue).toBe('Alice Newman');

      // Exact indices preserved
      expect(result.tokens[0].startIndex).not.toBe(result.tokens[1].startIndex);
      expect(result.tokens[1].startIndex).not.toBe(result.tokens[2].startIndex);

      // Sanitized text should have [PERSON_1] in all 3 spots
      expect(result.sanitizedText).toBe(
        'Schedule a meeting with [PERSON_1]. ' +
        'Please call [PERSON_1] beforehand. ' +
        'Send summary to [PERSON_1].'
      );
    });

    it('normalizes entity values case-insensitively for deduplication', () => {
      const text = 'Meeting with Alice Newman and then call alice newman later.';
      const result = PrivacyGuard.mask(text);

      expect(result.tokens).toHaveLength(2);
      expect(result.tokens[0].token).toBe('[PERSON_1]');
      expect(result.tokens[1].token).toBe('[PERSON_1]');
    });

    it('assigns identical tokens to repeated occurrences of the same physical address', () => {
      const text =
        'Deliver package to Friedrichstraße 42 today. ' +
        'Second courier will also stop at Friedrichstraße 42 later.';

      const result = PrivacyGuard.mask(text);

      expect(result.tokens).toHaveLength(2);
      expect(result.tokens[0].token).toBe('[ADDRESS_1]');
      expect(result.tokens[1].token).toBe('[ADDRESS_1]');
      expect(result.tokens[0].originalValue).toBe('Friedrichstraße 42');
      expect(result.tokens[1].originalValue).toBe('Friedrichstraße 42');
      expect(result.sanitizedText).toBe(
        'Deliver package to [ADDRESS_1] today. ' +
        'Second courier will also stop at [ADDRESS_1] later.'
      );
    });

    it('increments token IDs for distinct entities in reading order', () => {
      const text =
        'Meeting with Alice Newman, then call Bob Miller, and follow up with Alice Newman.';
      const result = PrivacyGuard.mask(text);

      expect(result.tokens).toHaveLength(3);
      expect(result.tokens[0].token).toBe('[PERSON_1]');
      expect(result.tokens[0].originalValue).toBe('Alice Newman');
      expect(result.tokens[1].token).toBe('[PERSON_2]');
      expect(result.tokens[1].originalValue).toBe('Bob Miller');
      expect(result.tokens[2].token).toBe('[PERSON_1]');
      expect(result.tokens[2].originalValue).toBe('Alice Newman');
    });
  });

  // =========================================================================
  // 4. Unicode Property Escapes for International Names
  // =========================================================================
  describe('Unicode Property Escapes for International Names', () => {
    it('detects European names with umlauts and diacritics', () => {
      const cases = [
        { text: 'Set up call with Jürgen Müller tomorrow.', name: 'Jürgen Müller' },
        { text: 'Meeting with Michał Kowalski on Friday.', name: 'Michał Kowalski' },
        { text: 'Please contact François Dupond immediately.', name: 'François Dupond' },
        { text: 'Assigned to Søren Kierkegaard for review.', name: 'Søren Kierkegaard' },
        { text: 'Follow up with Zoë Kravitz next week.', name: 'Zoë Kravitz' },
        { text: 'Invite Herr Jürgen Müller to the conference.', name: 'Herr Jürgen Müller' }
      ];

      for (const { text, name } of cases) {
        const result = PrivacyGuard.mask(text);
        expect(result.tokens.length).toBeGreaterThanOrEqual(1);
        const personToken = result.tokens.find(t => t.type === 'PERSON');
        expect(personToken).toBeDefined();
        expect(personToken?.originalValue).toBe(name);
        expect(result.sanitizedText).not.toContain(name);
      }
    });
  });

  // =========================================================================
  // 5. Single-Pass Atomic Regex Re-hydration (Zero Prefix Collision & Injection)
  // =========================================================================
  describe('Single-Pass Atomic Regex Re-hydration', () => {
    it('matches TOKEN_PATTERN across all 7 PII types', () => {
      const validTokens = [
        '[SECRET_KEY_1]',
        '[IBAN_10]',
        '[EMAIL_3]',
        '[PHONE_99]',
        '[AMOUNT_MONEY_42]',
        '[PERSON_100]',
        '[ADDRESS_55]'
      ];

      for (const token of validTokens) {
        const regex = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags);
        expect(regex.test(token)).toBe(true);
      }
    });

    it('asserts zero prefix collision with >= 15 entities (e.g. [PERSON_1] vs [PERSON_10])', () => {
      // 16 distinct person mappings
      const tokenMap = new Map<string, string>();
      const names = [
        'Zero-Unused',
        'Alice One',
        'Bob Two',
        'Charlie Three',
        'Diana Four',
        'Edward Five',
        'Fiona Six',
        'George Seven',
        'Hannah Eight',
        'Ian Nine',
        'Jack Ten',
        'Kate Eleven',
        'Liam Twelve',
        'Mia Thirteen',
        'Noah Fourteen',
        'Olivia Fifteen',
        'Paul Sixteen'
      ];

      for (let i = 1; i <= 16; i++) {
        tokenMap.set(`[PERSON_${i}]`, names[i]);
      }

      // High-density test string containing [PERSON_1] through [PERSON_16]
      // In naive sequential replace, [PERSON_1] would corrupt [PERSON_10] through [PERSON_16]
      const synthesizedText =
        'Attendees: [PERSON_1], [PERSON_2], [PERSON_3], [PERSON_4], [PERSON_5], ' +
        '[PERSON_6], [PERSON_7], [PERSON_8], [PERSON_9], [PERSON_10], [PERSON_11], ' +
        '[PERSON_12], [PERSON_13], [PERSON_14], [PERSON_15], [PERSON_16].';

      const rehydrated = rehydrate(synthesizedText, tokenMap);

      // Verify Jack Ten ([PERSON_10]) was NOT mutated to "Alice One0"
      expect(rehydrated).not.toContain('Alice One0');
      expect(rehydrated).not.toContain('Alice One1');
      expect(rehydrated).not.toContain('Alice One2');
      expect(rehydrated).not.toContain('Alice One3');
      expect(rehydrated).not.toContain('Alice One4');
      expect(rehydrated).not.toContain('Alice One5');
      expect(rehydrated).not.toContain('Alice One6');

      expect(rehydrated).toContain('Alice One');
      expect(rehydrated).toContain('Jack Ten');
      expect(rehydrated).toContain('Kate Eleven');
      expect(rehydrated).toContain('Liam Twelve');
      expect(rehydrated).toContain('Mia Thirteen');
      expect(rehydrated).toContain('Noah Fourteen');
      expect(rehydrated).toContain('Olivia Fifteen');
      expect(rehydrated).toContain('Paul Sixteen');

      const expectedText =
        'Attendees: Alice One, Bob Two, Charlie Three, Diana Four, Edward Five, ' +
        'Fiona Six, George Seven, Hannah Eight, Ian Nine, Jack Ten, Kate Eleven, ' +
        'Liam Twelve, Mia Thirteen, Noah Fourteen, Olivia Fifteen, Paul Sixteen.';

      expect(rehydrated).toBe(expectedText);
    });

    it('prevents cascaded token injection when an original value contains bracketed tokens', () => {
      // If original value of PERSON_1 contains literal "[EMAIL_1]"
      const tokenMap = new Map<string, string>([
        ['[PERSON_1]', 'Attn: [EMAIL_1] User'],
        ['[EMAIL_1]', 'confidential@internal.corp']
      ]);

      const prompt = 'Meeting with [PERSON_1] regarding project.';
      const restored = rehydrate(prompt, tokenMap);

      // In atomic single-pass, [PERSON_1] is replaced with "Attn: [EMAIL_1] User".
      // The embedded "[EMAIL_1]" must NOT be recursively expanded to "confidential@internal.corp".
      expect(restored).toBe('Meeting with Attn: [EMAIL_1] User regarding project.');
    });

    it('asserts zero prefix collision with ADDRESS entities ([ADDRESS_1] vs [ADDRESS_10])', () => {
      const tokenMap = new Map<string, string>();
      for (let i = 1; i <= 15; i++) {
        tokenMap.set(`[ADDRESS_${i}]`, `Street Number ${i}`);
      }

      const input = 'Offices: [ADDRESS_1] and [ADDRESS_10]';
      const result = rehydrate(input, tokenMap);
      expect(result).toBe('Offices: Street Number 1 and Street Number 10');
      expect(result).not.toContain('Street Number 100');
    });
  });

  // =========================================================================
  // 6. Polymorphic Adapter in rehydrate()
  // =========================================================================
  describe('Polymorphic Adapter in rehydrate()', () => {
    it('accepts PIITokenMap[] array directly', () => {
      const tokens: PIITokenMap[] = [
        {
          token: '[PERSON_1]',
          type: 'PERSON',
          originalValue: 'Alice Newman',
          startIndex: 0,
          endIndex: 12
        },
        {
          token: '[AMOUNT_MONEY_1]',
          type: 'AMOUNT_MONEY',
          originalValue: '$500',
          startIndex: 20,
          endIndex: 24
        }
      ];

      const input = 'Call [PERSON_1] for [AMOUNT_MONEY_1]';
      const output = rehydrate(input, tokens);
      expect(output).toBe('Call Alice Newman for $500');
    });

    it('accepts Map<string, string> directly', () => {
      const tokenMap = new Map([
        ['[PERSON_1]', 'Alice Newman'],
        ['[EMAIL_1]', 'alice@example.com']
      ]);

      const input = 'Notify [PERSON_1] at [EMAIL_1]';
      const output = rehydrate(input, tokenMap);
      expect(output).toBe('Notify Alice Newman at alice@example.com');
    });

    it('recursively rehydrates deeply nested JSON objects conforming to AI output', () => {
      const tokenMap = new Map([
        ['[PERSON_1]', 'Alice Newman'],
        ['[AMOUNT_MONEY_1]', '15,000 EUR'],
        ['[EMAIL_1]', 'finance@example.com'],
        ['[PHONE_1]', '+49 170 1234567']
      ]);

      const aiTaskResponse = {
        title: 'Review invoice from [PERSON_1]',
        summary: 'Transfer [AMOUNT_MONEY_1] and notify [EMAIL_1]',
        category: 'FINANCE',
        priority: 'HIGH',
        scheduledDate: '2026-11-15T10:00:00.000Z',
        tags: ['billing', '[PERSON_1]'],
        subtasks: [
          { title: 'Confirm amount of [AMOUNT_MONEY_1]', completed: false },
          { title: 'Call [PERSON_1] at [PHONE_1]', completed: true }
        ],
        metadata: {
          approver: '[PERSON_1]',
          numericCost: 15000,
          verified: true,
          nestedNull: null,
          nestedUndef: undefined
        }
      };

      const rehydrated = rehydrate(aiTaskResponse, tokenMap);

      expect(rehydrated.title).toBe('Review invoice from Alice Newman');
      expect(rehydrated.summary).toBe('Transfer 15,000 EUR and notify finance@example.com');
      expect(rehydrated.tags).toEqual(['billing', 'Alice Newman']);
      expect(rehydrated.subtasks[0].title).toBe('Confirm amount of 15,000 EUR');
      expect(rehydrated.subtasks[0].completed).toBe(false);
      expect(rehydrated.subtasks[1].title).toBe('Call Alice Newman at +49 170 1234567');
      expect(rehydrated.subtasks[1].completed).toBe(true);
      expect(rehydrated.metadata.approver).toBe('Alice Newman');
      expect(rehydrated.metadata.numericCost).toBe(15000);
      expect(rehydrated.metadata.verified).toBe(true);
      expect(rehydrated.metadata.nestedNull).toBeNull();
      expect(rehydrated.metadata.nestedUndef).toBeUndefined();
    });

    it('returns non-string primitives intact', () => {
      const tokenMap = new Map([['[PERSON_1]', 'Alice']]);
      expect(rehydrate(42, tokenMap)).toBe(42);
      expect(rehydrate(true, tokenMap)).toBe(true);
      expect(rehydrate(false, tokenMap)).toBe(false);
      expect(rehydrate(null, tokenMap)).toBeNull();
      expect(rehydrate(undefined, tokenMap)).toBeUndefined();
      const testDate = new Date('2026-11-07T12:00:00.000Z');
      expect(rehydrate(testDate, tokenMap)).toBe(testDate);
    });

    it('supports static PrivacyGuard.rehydrate class method', () => {
      const tokenMap = new Map([['[PERSON_1]', 'Alice']]);
      expect(PrivacyGuard.rehydrate('Hello [PERSON_1]', tokenMap)).toBe('Hello Alice');
    });

    it('leaves unmapped tokens intact if not in tokenMap', () => {
      const tokenMap = new Map([['[PERSON_1]', 'Alice']]);
      const text = 'Hello [PERSON_1] and [PERSON_99]';
      expect(rehydrate(text, tokenMap)).toBe('Hello Alice and [PERSON_99]');
    });
  });

  // =========================================================================
  // 7. Edge Cases & Punctuation Immunity
  // =========================================================================
  describe('Edge Cases & Punctuation Immunity', () => {
    it('preserves trailing dots, commas, and parentheses without swallowing them into tokens', () => {
      const text =
        'Contact contact@example.com. ' +
        'Also Mr. John Doe, are you available? ' +
        '(Call +49 170 1234567). ' +
        'Visit ul. Marszałkowska 10, or Friedrichstraße 42. ' +
        'Fee is 50k zł, in Berlin.';

      const result = PrivacyGuard.mask(text);

      expect(result.tokens).toHaveLength(7);
      expect(result.tokens[0].originalValue).toBe('contact@example.com');
      expect(result.tokens[1].originalValue).toBe('Mr. John Doe');
      expect(result.tokens[2].originalValue).toBe('+49 170 1234567');
      expect(result.tokens[3].originalValue).toBe('ul. Marszałkowska 10');
      expect(result.tokens[4].originalValue).toBe('Friedrichstraße 42');
      expect(result.tokens[5].originalValue).toBe('50k zł');
      expect(result.tokens[6].originalValue).toBe('Berlin');

      expect(result.sanitizedText).toBe(
        'Contact [EMAIL_1]. ' +
        'Also [PERSON_1], are you available? ' +
        '(Call [PHONE_1]). ' +
        'Visit [ADDRESS_1], or [ADDRESS_2]. ' +
        'Fee is [AMOUNT_MONEY_1], in [ADDRESS_3].'
      );
    });

    it('handles empty input gracefully', () => {
      const result = PrivacyGuard.mask('');
      expect(result.sanitizedText).toBe('');
      expect(result.tokenCount).toBe(0);
      expect(result.tokens).toEqual([]);
      expect(result.riskLevel).toBe('NONE');
    });

    it('handles input with zero PII gracefully', () => {
      const text = 'This is a clean task memo about project architecture and milestones.';
      const result = PrivacyGuard.mask(text);

      expect(result.sanitizedText).toBe(text);
      expect(result.tokenCount).toBe(0);
      expect(result.tokens).toEqual([]);
      expect(result.riskLevel).toBe('NONE');
    });

    it('applies Unicode NFC normalization before masking', () => {
      // "Zürich" written in NFD (decomposed: "u" + combining diaeresis) vs NFC
      const nfdText = 'Office in Zu\u0308rich';
      const result = PrivacyGuard.mask(nfdText);

      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].type).toBe('ADDRESS');
      expect(result.tokens[0].originalValue).toBe('Zürich');
      expect(result.sanitizedText).toBe('Office in [ADDRESS_1]');
    });
  });

  // =========================================================================
  // 8. Deterministic Roundtrip Invariance
  // =========================================================================
  describe('Deterministic Roundtrip Invariance', () => {
    it('guarantees roundtrip invariance across all 7 categories: rehydrate(mask(text).sanitizedText, result.tokens) === text', () => {
      const complexText =
        'Meeting with Alice Newman to review invoice $1,500.00.\n' +
        'Please transfer to DE89 3704 0044 0532 0130 00 or notify contact@example.com.\n' +
        'Call +49 170 1234567 if bearer token bearer abcdef1234567890abcdef123456 is compromised.\n' +
        'Follow up at Friedrichstraße 42 in Berlin afterwards.';

      const maskResult = PrivacyGuard.mask(complexText);

      // Verify all 7 categories are detected
      const detectedTypes = new Set(maskResult.tokens.map(t => t.type));
      expect(detectedTypes.has('SECRET_KEY')).toBe(true);
      expect(detectedTypes.has('IBAN')).toBe(true);
      expect(detectedTypes.has('EMAIL')).toBe(true);
      expect(detectedTypes.has('PHONE')).toBe(true);
      expect(detectedTypes.has('AMOUNT_MONEY')).toBe(true);
      expect(detectedTypes.has('PERSON')).toBe(true);
      expect(detectedTypes.has('ADDRESS')).toBe(true);

      // Verify rehydrate with tokens array restores original text 100% identically
      const restored = rehydrate(maskResult.sanitizedText, maskResult.tokens);
      expect(restored).toBe(complexText);
    });
  });

  // =========================================================================
  // 9. Risk Level Calculation
  // =========================================================================
  describe('Risk Level Calculation', () => {
    it('calculates NONE when count is 0', () => {
      const res = PrivacyGuard.mask('Just regular plain text');
      expect(res.riskLevel).toBe('NONE');
    });

    it('calculates LOW when single non-critical PII is present', () => {
      const res = PrivacyGuard.mask('Call +49 170 1234567 tomorrow');
      expect(res.riskLevel).toBe('LOW');
    });

    it('calculates MEDIUM when financial data (AMOUNT_MONEY) is present even with count 1', () => {
      const res = PrivacyGuard.mask('Estimated cost is 50k zł');
      expect(res.tokens).toHaveLength(1);
      expect(res.riskLevel).toBe('MEDIUM');
    });

    it('calculates MEDIUM when physical address is present even with count 1', () => {
      const res = PrivacyGuard.mask('Office in Berlin');
      expect(res.tokens).toHaveLength(1);
      expect(res.riskLevel).toBe('MEDIUM');
    });

    it('calculates MEDIUM when exactly 2 non-critical PII items are present', () => {
      const res = PrivacyGuard.mask('Call +49 170 1234567 or send email to team@example.com');
      expect(res.tokens).toHaveLength(2);
      expect(res.riskLevel).toBe('MEDIUM');
    });

    it('calculates HIGH when count >= 3 regardless of types', () => {
      const res = PrivacyGuard.mask('Call +49 170 1234567 or +49 170 7654321 or send email to team@example.com');
      expect(res.tokens.length).toBeGreaterThanOrEqual(3);
      expect(res.riskLevel).toBe('HIGH');
    });

    it('calculates HIGH when SECRET_KEY is present even if count is 1', () => {
      const res = PrivacyGuard.mask('Token: ghp_1234567890abcdef1234567890abcdef1234');
      expect(res.tokens).toHaveLength(1);
      expect(res.riskLevel).toBe('HIGH');
    });

    it('calculates HIGH when IBAN is present even if count is 1', () => {
      const res = PrivacyGuard.mask('Account: PL61109010140000071219812874');
      expect(res.tokens).toHaveLength(1);
      expect(res.riskLevel).toBe('HIGH');
    });
  });

  // =========================================================================
  // 10. Schema Validation Contract Compliance
  // =========================================================================
  describe('Schema Validation Contract Compliance', () => {
    it('produces SanitizationResult strictly conforming to SanitizationResultSchema', () => {
      const text = 'Meeting with Alice Newman, email alice@example.com, pay $50.00';
      const result: SanitizationResult = PrivacyGuard.mask(text);

      const parsed = SanitizationResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.sanitizedText).toBeDefined();
        expect(parsed.data.tokenCount).toBe(result.tokens.length);
        expect(parsed.data.tokens).toHaveLength(result.tokens.length);
        expect(new Date(parsed.data.timestamp).getTime()).not.toBeNaN();
        expect(['NONE', 'LOW', 'MEDIUM', 'HIGH']).toContain(parsed.data.riskLevel);
      }
    });
  });
});
