import { describe, it, expect } from 'vitest';
import {
  PrivacyGuard,
  rehydrate,
  TOKEN_PATTERN,
  isValidPesel,
  isGermanSteuerId,
  isValidSsn,
} from '../../src/privacy/PrivacyGuard.js';
import { normalizePersonToNominative } from '../../src/privacy/LinguisticNormalizer.js';
import {
  SanitizationResultSchema,
  PIITokenMap,
  PIIType,
  SanitizationResult
} from '../../src/types/contracts.js';

describe('PrivacyGuard Engine Suite', () => {
  // =========================================================================
  // 1. Multi-Entity Detection Across All 9 GDPR Categories
  // =========================================================================
  describe('Multi-Entity Detection Across All 9 GDPR Categories', () => {
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

    it('detects National Identifiers (Priority 3): Polish PESEL with 11-digit checksum, German Steuer-ID, US SSN', () => {
      // Polish PESEL: 90010112349, 44051401359 are valid statutory checksums
      const validPesels = ['90010112349', '44051401359'];
      for (const pesel of validPesels) {
        const res = PrivacyGuard.mask(`PESEL obywatela: ${pesel} do weryfikacji.`);
        expect(res.tokens.length).toBeGreaterThanOrEqual(1);
        const token = res.tokens.find((t) => t.type === 'NATIONAL_ID');
        expect(token).toBeDefined();
        expect(token?.originalValue).toBe(pesel);
        expect(res.sanitizedText).toContain('[NATIONAL_ID_1]');
        expect(res.sanitizedText).not.toContain(pesel);
      }

      // Invalid PESEL checksum must NOT be masked as NATIONAL_ID
      const invalidPesel = '90010112348'; // Incorrect control digit (should be 9)
      const resInvalid = PrivacyGuard.mask(`Numer PESEL ${invalidPesel} jest błędny.`);
      expect(resInvalid.tokens.some((t) => t.type === 'NATIONAL_ID')).toBe(false);

      // German Steuer-ID / Steueridentifikationsnummer (formatted or with trigger)
      const germanSteuerFormatted = '03 245 678 912';
      const resSteuerForm = PrivacyGuard.mask(`Steuernummer ist ${germanSteuerFormatted} bitte eintragen.`);
      expect(resSteuerForm.tokens.length).toBeGreaterThanOrEqual(1);
      const steuerToken1 = resSteuerForm.tokens.find((t) => t.type === 'NATIONAL_ID');
      expect(steuerToken1).toBeDefined();
      expect(steuerToken1?.originalValue).toBe(germanSteuerFormatted);

      const resSteuerTrig = PrivacyGuard.mask('Steuer-ID: 03245678912 für das Finanzamt.');
      expect(resSteuerTrig.tokens.length).toBeGreaterThanOrEqual(1);
      const steuerToken2 = resSteuerTrig.tokens.find((t) => t.type === 'NATIONAL_ID');
      expect(steuerToken2).toBeDefined();
      expect(steuerToken2?.originalValue).toBe('03245678912');

      // US SSN
      const usSsn = '123-45-6789';
      const resSsn = PrivacyGuard.mask(`Social Security Number is ${usSsn} confidential.`);
      expect(resSsn.tokens.length).toBeGreaterThanOrEqual(1);
      const ssnToken = resSsn.tokens.find((t) => t.type === 'NATIONAL_ID');
      expect(ssnToken).toBeDefined();
      expect(ssnToken?.originalValue).toBe(usSsn);
      expect(resSsn.sanitizedText).toContain('[NATIONAL_ID_1]');
    });

    it('detects Health Data (Priority 4): German KVNR and multilingual medical terms/prescriptions/diagnoses', () => {
      // German KVNR: [A-Z]\d{9} (e.g. A123456789, T123456789)
      const kvnrSamples = ['A123456789', 'T123456789'];
      for (const kvnr of kvnrSamples) {
        const res = PrivacyGuard.mask(`KVNR: ${kvnr} der Versicherten.`);
        expect(res.tokens.length).toBeGreaterThanOrEqual(1);
        const hToken = res.tokens.find((t) => t.type === 'HEALTH_DATA');
        expect(hToken).toBeDefined();
        expect(hToken?.originalValue).toBe(kvnr);
        expect(res.sanitizedText).toContain('[HEALTH_DATA_1]');
        expect(res.sanitizedText).not.toContain(kvnr);
      }

      // Medical terms, diagnoses, and prescriptions in context across PL, DE, EN, FR
      const medicalCases = [
        { text: 'diagnoza: nadciśnienie tętnicze u pacjenta', expectedTerm: 'diagnoza: nadciśnienie tętnicze' },
        { text: 'Wystawiono recepta na ibuprofen 400mg rano', expectedTerm: 'recepta na ibuprofen 400mg' },
        { text: 'Patientenakte Diagnose: Hypertonie chronisch', expectedTerm: 'Diagnose: Hypertonie chronisch' },
        { text: 'Der Arzt gab Rezept: Ibuprofen 600mg', expectedTerm: 'Rezept: Ibuprofen 600mg' },
        { text: 'Patient prescription for amoxicillin capsules', expectedTerm: 'prescription for amoxicillin capsules' },
        { text: 'Médecin a donné ordonnance: Doliprane 1000mg', expectedTerm: 'ordonnance: Doliprane 1000mg' }
      ];

      for (const { text, expectedTerm } of medicalCases) {
        const res = PrivacyGuard.mask(text);
        expect(res.tokens.length).toBeGreaterThanOrEqual(1);
        const hToken = res.tokens.find((t) => t.type === 'HEALTH_DATA');
        expect(hToken).toBeDefined();
        expect(res.sanitizedText).toContain('[HEALTH_DATA_1]');
      }
    });

    it('detects Email Addresses (Priority 5)', () => {
      const text = 'Send questions to contact@example.com or user.name+tag@sub.domain.co.uk please.';
      const result = PrivacyGuard.mask(text);

      expect(result.tokens).toHaveLength(2);
      expect(result.tokens[0].type).toBe('EMAIL');
      expect(result.tokens[0].originalValue).toBe('contact@example.com');
      expect(result.tokens[1].type).toBe('EMAIL');
      expect(result.tokens[1].originalValue).toBe('user.name+tag@sub.domain.co.uk');
      expect(result.sanitizedText).toBe('Send questions to [EMAIL_1] or [EMAIL_2] please.');
    });

    it('detects Phone Numbers (Priority 6)', () => {
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

    it('detects Monetary Amounts (Priority 7) including colloquial multipliers and spacing', () => {
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

    it('detects Person Names via Honorifics, Declined Polish Cases, and Context Markers (Priority 8)', () => {
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

    it('detects lowercase names after contextual prepositions and German compound street abbreviations', () => {
      const plLowerRes = PrivacyGuard.mask('spotkanie z janem kowalskim');
      const plPerson = plLowerRes.tokens.find(t => t.type === 'PERSON');
      expect(plPerson).toBeDefined();
      expect(plPerson?.originalValue).toBe('janem kowalskim');

      const deLowerRes = PrivacyGuard.mask('treffen mit hans müller');
      const dePerson = deLowerRes.tokens.find(t => t.type === 'PERSON');
      expect(dePerson).toBeDefined();
      expect(dePerson?.originalValue).toBe('hans müller');

      const deStreetRes = PrivacyGuard.mask('Büro in berlinerstr. 123');
      const deAddr = deStreetRes.tokens.find(t => t.type === 'ADDRESS');
      expect(deAddr).toBeDefined();
      expect(deAddr?.originalValue).toBe('berlinerstr. 123');

      const deStreetHaupt = PrivacyGuard.mask('Besuch in hauptstr. 5');
      const deAddrHaupt = deStreetHaupt.tokens.find(t => t.type === 'ADDRESS');
      expect(deAddrHaupt).toBeDefined();
      expect(deAddrHaupt?.originalValue).toBe('hauptstr. 5');
    });

    it('excludes Slavic, German, French, and English pronouns and reflexive stop-words from lowercase preposition NER', () => {
      const input = 'kawa z albertem szyszka. jego nr 123412412. note: wziąć ze sobą pasztet.';
      const res = PrivacyGuard.mask(input);

      // Must mask ONLY "albertem szyszka" as PERSON and 123412412 as PHONE
      expect(res.tokens).toHaveLength(2);

      const personToken = res.tokens.find((t) => t.type === 'PERSON');
      expect(personToken).toBeDefined();
      expect(personToken?.originalValue).toBe('albertem szyszka');

      const phoneToken = res.tokens.find((t) => t.type === 'PHONE');
      expect(phoneToken).toBeDefined();
      expect(phoneToken?.originalValue).toBe('123412412');

      // Must NOT mask "sobą pasztet" as PERSON
      expect(res.tokens.some((t) => t.originalValue.includes('sobą'))).toBe(false);
      expect(res.tokens.some((t) => t.originalValue.includes('pasztet'))).toBe(false);

      expect(res.sanitizedText).toBe('kawa z [PERSON_1]. jego nr [PHONE_1]. note: wziąć ze sobą pasztet.');
    });

    it('detects Physical Addresses, Street Patterns, and Major International Hubs (Priority 9)', () => {
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

    it('prefers PERSON (Priority 8) over ADDRESS (Priority 9) in overlapping candidate spans', () => {
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

    it('prefers AMOUNT_MONEY (Priority 7) over ADDRESS (Priority 9) in overlapping spans', () => {
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

    it('prefers NATIONAL_ID (Priority 3) over PHONE (Priority 6) in overlapping spans', () => {
      const rawMatches = [
        {
          type: 'PHONE' as PIIType,
          value: '90010112349',
          startIndex: 0,
          endIndex: 11
        },
        {
          type: 'NATIONAL_ID' as PIIType,
          value: '90010112349',
          startIndex: 0,
          endIndex: 11
        }
      ];

      const resolved = PrivacyGuard.resolveOverlaps(rawMatches);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].type).toBe('NATIONAL_ID');
    });

    it('prefers HEALTH_DATA (Priority 4) over EMAIL (Priority 5) and PERSON (Priority 8)', () => {
      const overlappingWithEmail = [
        {
          type: 'EMAIL' as PIIType,
          value: 'patient@clinic.de',
          startIndex: 5,
          endIndex: 22
        },
        {
          type: 'HEALTH_DATA' as PIIType,
          value: 'A123456789',
          startIndex: 0,
          endIndex: 10
        }
      ];

      const resolvedEmail = PrivacyGuard.resolveOverlaps(overlappingWithEmail);
      expect(resolvedEmail).toHaveLength(1);
      expect(resolvedEmail[0].type).toBe('HEALTH_DATA');

      const nonOverlapping = [
        {
          type: 'HEALTH_DATA' as PIIType,
          value: 'A123456789',
          startIndex: 0,
          endIndex: 10
        },
        {
          type: 'EMAIL' as PIIType,
          value: 'patient@clinic.de',
          startIndex: 15,
          endIndex: 32
        }
      ];
      expect(PrivacyGuard.resolveOverlaps(nonOverlapping)).toHaveLength(2);

      const overlappingMatches = [
        {
          type: 'PERSON' as PIIType,
          value: 'A123456789 Dr',
          startIndex: 0,
          endIndex: 13
        },
        {
          type: 'HEALTH_DATA' as PIIType,
          value: 'A123456789',
          startIndex: 0,
          endIndex: 10
        }
      ];

      const resolvedOverlap = PrivacyGuard.resolveOverlaps(overlappingMatches);
      expect(resolvedOverlap).toHaveLength(1);
      expect(resolvedOverlap[0].type).toBe('HEALTH_DATA');
    });

    it('strictly enforces all 9 priority tiers (1: SECRET_KEY down to 9: ADDRESS)', () => {
      const all9Types: PIIType[] = [
        'SECRET_KEY',
        'IBAN',
        'NATIONAL_ID',
        'HEALTH_DATA',
        'EMAIL',
        'PHONE',
        'AMOUNT_MONEY',
        'PERSON',
        'ADDRESS'
      ];

      for (let i = 0; i < all9Types.length - 1; i++) {
        const higherType = all9Types[i];
        const lowerType = all9Types[i + 1];

        const candidateMatches = [
          {
            type: lowerType,
            value: 'CandidateOverlapValue',
            startIndex: 0,
            endIndex: 21
          },
          {
            type: higherType,
            value: 'CandidateOverlapValue',
            startIndex: 0,
            endIndex: 21
          }
        ];

        const resolved = PrivacyGuard.resolveOverlaps(candidateMatches);
        expect(resolved).toHaveLength(1);
        expect(resolved[0].type).toBe(higherType);
      }
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
  // Tier 3: Context-Aware Generic Matcher
  // =========================================================================
  describe('Tier 3: Context-Aware Generic Matcher', () => {
    it('detects unformatted health/policy cards within proximity (+-30 chars) of keywords', () => {
      const healthSamples = [
        { text: 'Numer polisa 83726194 w aktach', expectedId: '83726194' },
        { text: 'Ubezpieczenie zdrowotne POL-982341 dla pracownika', expectedId: 'POL-982341' },
        { text: 'Versichert bei Versicherung DE982341 gültig', expectedId: 'DE982341' },
        { text: 'Krankenkasse Nummer: KK-847291 sofort vorlegen', expectedId: 'KK-847291' },
        { text: 'Insurance policy ID: POL83726194 on file', expectedId: 'POL83726194' }
      ];

      for (const { text, expectedId } of healthSamples) {
        const res = PrivacyGuard.mask(text);
        expect(res.tokens.length).toBeGreaterThanOrEqual(1);
        const token = res.tokens.find((t) => t.type === 'HEALTH_DATA');
        expect(token).toBeDefined();
        expect(token?.originalValue).toBe(expectedId);
        expect(res.sanitizedText).toContain('[HEALTH_DATA_1]');
        expect(res.sanitizedText).not.toContain(expectedId);
      }
    });

    it('detects citizen / national identity cards within proximity (+-30 chars) of keywords', () => {
      const nationalSamples = [
        { text: 'Numer dowód osobisty: ABC123456 w rejestrze', expectedId: 'ABC123456' },
        { text: 'Personalausweis Nummer XY765432 bitte angeben', expectedId: 'XY765432' },
        { text: 'National citizen ID card 83726194 for entry', expectedId: '83726194' }
      ];

      for (const { text, expectedId } of nationalSamples) {
        const res = PrivacyGuard.mask(text);
        expect(res.tokens.length).toBeGreaterThanOrEqual(1);
        const token = res.tokens.find((t) => t.type === 'NATIONAL_ID');
        expect(token).toBeDefined();
        expect(token?.originalValue).toBe(expectedId);
        expect(res.sanitizedText).toContain('[NATIONAL_ID_1]');
        expect(res.sanitizedText).not.toContain(expectedId);
      }
    });

    it('ignores dictionary words of 6-16 characters far from trigger keywords', () => {
      const cleanText = 'This is an important regular sentence without card numbers or credentials.';
      const res = PrivacyGuard.mask(cleanText);
      expect(res.tokens).toHaveLength(0);
      expect(res.sanitizedText).toBe(cleanText);
    });
  });

  // =========================================================================
  // Tier 2: Transformers.js Local In-Memory Semantic NER & Graceful Fallback
  // =========================================================================
  describe('Tier 2: Transformers.js Local In-Memory Semantic NER & Graceful Fallback', () => {
    it('provides maskAsync that returns SanitizationResult', async () => {
      const text = 'Spotkanie z dr Anną Nowak w Warszawie jutro o 15:00.';
      const result = await PrivacyGuard.maskAsync(text);

      expect(result).toBeDefined();
      expect(result.sanitizedText).toBeDefined();
      expect(result.tokens.length).toBeGreaterThanOrEqual(1);
      expect(result.riskLevel).toBeDefined();
    });

    it('gracefully falls back to Tier 1 and Tier 3 when model fails or environment is offline', async () => {
      // Mock pipeline to simulate model failure/rejection
      PrivacyGuard.setPipeline(async () => {
        throw new Error('ONNX runtime offline or model file not found');
      });

      const text = 'Meeting with Alice Newman, email alice@example.com, PESEL 90010112349';
      const result = await PrivacyGuard.maskAsync(text);

      expect(result).toBeDefined();
      expect(result.sanitizedText).toContain('[EMAIL_1]');
      expect(result.sanitizedText).toContain('[NATIONAL_ID_1]');
      expect(result.sanitizedText).not.toContain('90010112349');
      expect(result.sanitizedText).not.toContain('alice@example.com');

      // Reset pipeline
      PrivacyGuard.setPipeline(null);
    });

    it('gracefully times out and falls back when pipeline takes > 100ms', async () => {
      // Mock pipeline to simulate excessive delay > 100ms
      PrivacyGuard.setPipeline(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return [];
      });

      const text = 'Transfer to DE89 3704 0044 0532 0130 00 today';
      const result = await PrivacyGuard.maskAsync(text);

      expect(result).toBeDefined();
      expect(result.sanitizedText).toBe('Transfer to [IBAN_1] today');
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].type).toBe('IBAN');

      // Reset pipeline
      PrivacyGuard.setPipeline(null);
    });

    it('ensures synchronous mask() remains 100% operational with pure zero-network isolation', () => {
      const text = 'Meeting with Dr. Gregory House in Berlin, budget 50k zł';
      const start = performance.now();
      const result = PrivacyGuard.mask(text);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50); // < 50ms requirement
      expect(result.tokens.length).toBeGreaterThanOrEqual(2);
      expect(result.sanitizedText).toContain('[AMOUNT_MONEY_1]');
      expect(result.sanitizedText).toContain('[ADDRESS_1]');
    });

    it('integrates semantic token classification outputs (PER, LOC) from in-memory NER pipeline', async () => {
      PrivacyGuard.setPipeline(async (_text: string) => [
        { entity_group: 'PER', word: 'Alice Newman', start: 13, end: 25 },
        { entity_group: 'LOC', word: 'Berlin', start: 29, end: 35 },
        { entity_group: 'MISC', word: 'IgnoredMisc', start: 0, end: 11 },
        { entity_group: 'PER', word: '', start: 0, end: 0 },
        { entity_group: 'LOC', word: 'Invalid', start: null, end: null },
      ]);

      const text = 'Meeting with Alice Newman in Berlin';
      const result = await PrivacyGuard.maskAsync(text);

      expect(result.tokens).toHaveLength(2);
      expect(result.tokens[0].token).toBe('[PERSON_1]');
      expect(result.tokens[1].token).toBe('[ADDRESS_1]');
      expect(result.sanitizedText).toBe('Meeting with [PERSON_1] in [ADDRESS_1]');

      PrivacyGuard.setPipeline(null);
    });

    it('handles non-array output from NER pipeline gracefully', async () => {
      PrivacyGuard.setPipeline(async () => ({ unexpected: true }));

      const text = 'Meeting with Alice Newman';
      const result = await PrivacyGuard.maskAsync(text);
      expect(result).toBeDefined();
      expect(result.tokens.length).toBeGreaterThanOrEqual(1);

      PrivacyGuard.setPipeline(null);
    });

    it('returns cached pipeline from getPipeline when cachedPipeline is already set', async () => {
      (PrivacyGuard as any).cachedPipeline = async () => [];
      const pipe = await PrivacyGuard.getPipeline();
      expect(pipe).toBeDefined();
      (PrivacyGuard as any).cachedPipeline = null;
    });

    it('validates standalone national identifier helpers: isValidPesel, isGermanSteuerId, isValidSsn', () => {
      // isValidPesel
      expect(isValidPesel('90010112349')).toBe(true);
      expect(isValidPesel('90010112348')).toBe(false);
      expect(isValidPesel('123')).toBe(false);
      expect(isValidPesel('abcdefghijk')).toBe(false);

      // isGermanSteuerId
      expect(isGermanSteuerId('03 245 678 912', 'plain text', 0)).toBe(true);
      expect(isGermanSteuerId('03245678912', 'Steuer-ID 03245678912 hier', 10)).toBe(true);
      expect(isGermanSteuerId('11234567890', 'Text without triggers', 0)).toBe(true);
      expect(isGermanSteuerId('11123456789', 'Text without triggers', 0)).toBe(true);
      expect(isGermanSteuerId('01234567890', 'Text without triggers', 0)).toBe(false);
      expect(isGermanSteuerId('11223456789', 'Text without triggers', 0)).toBe(false);
      expect(isGermanSteuerId('12345678901', 'Text without triggers', 0)).toBe(false);
      expect(isGermanSteuerId('12345', 'Text', 0)).toBe(false);

      // isValidSsn
      expect(isValidSsn('123-45-6789')).toBe(true);
      expect(isValidSsn('000-12-3456')).toBe(false);
      expect(isValidSsn('666-12-3456')).toBe(false);
      expect(isValidSsn('900-12-3456')).toBe(false);
      expect(isValidSsn('123-00-4567')).toBe(false);
      expect(isValidSsn('123-45-0000')).toBe(false);
      expect(isValidSsn('not-a-ssn')).toBe(false);
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
    it('matches TOKEN_PATTERN across all 9 PII types', () => {
      const validTokens = [
        '[SECRET_KEY_1]',
        '[IBAN_10]',
        '[NATIONAL_ID_7]',
        '[HEALTH_DATA_12]',
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

    it('asserts zero prefix collision with NATIONAL_ID and HEALTH_DATA entities ([NATIONAL_ID_1] vs [NATIONAL_ID_10])', () => {
      const tokenMap = new Map<string, string>();
      for (let i = 1; i <= 15; i++) {
        tokenMap.set(`[NATIONAL_ID_${i}]`, `ID-NUMBER-${i}`);
        tokenMap.set(`[HEALTH_DATA_${i}]`, `HEALTH-CARD-${i}`);
      }

      const input = 'IDs: [NATIONAL_ID_1], [NATIONAL_ID_10], [HEALTH_DATA_1], [HEALTH_DATA_10]';
      const result = rehydrate(input, tokenMap);
      expect(result).toBe('IDs: ID-NUMBER-1, ID-NUMBER-10, HEALTH-CARD-1, HEALTH-CARD-10');
      expect(result).not.toContain('ID-NUMBER-100');
      expect(result).not.toContain('HEALTH-CARD-100');
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
    it('guarantees roundtrip invariance across all 9 GDPR categories: rehydrate(mask(text).sanitizedText, result.tokens) === text', () => {
      const complexText =
        'Meeting with Alice Newman to review invoice $1,500.00.\n' +
        'Please transfer to DE89 3704 0044 0532 0130 00 or notify contact@example.com.\n' +
        'Call +49 170 1234567 if bearer token bearer abcdef1234567890abcdef123456 is compromised.\n' +
        'Follow up at Friedrichstraße 42 in Berlin afterwards.\n' +
        'PESEL obywatela: 90010112349, KVNR: A123456789 oraz diagnoza: nadciśnienie tętnicze.';

      const maskResult = PrivacyGuard.mask(complexText);

      // Verify all 9 categories are detected
      const detectedTypes = new Set(maskResult.tokens.map((t) => t.type));
      expect(detectedTypes.has('SECRET_KEY')).toBe(true);
      expect(detectedTypes.has('IBAN')).toBe(true);
      expect(detectedTypes.has('NATIONAL_ID')).toBe(true);
      expect(detectedTypes.has('HEALTH_DATA')).toBe(true);
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

    it('calculates HIGH when NATIONAL_ID is present even if count is 1', () => {
      const res = PrivacyGuard.mask('Numer PESEL to 90010112349 poufny');
      expect(res.tokens.length).toBeGreaterThanOrEqual(1);
      expect(res.tokens.some((t) => t.type === 'NATIONAL_ID')).toBe(true);
      expect(res.riskLevel).toBe('HIGH');
    });

    it('calculates HIGH when HEALTH_DATA is present even if count is 1', () => {
      const res = PrivacyGuard.mask('KVNR: A123456789');
      expect(res.tokens).toHaveLength(1);
      expect(res.tokens[0].type).toBe('HEALTH_DATA');
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

  // =========================================================================
  // 11. Smart Task Metadata Re-hydration
  // =========================================================================
  describe('Smart Task Metadata Re-hydration', () => {
    it('recursively rehydrates smart metadata fields (location, contactPerson, amount, scheduledTime)', () => {
      const tokens: PIITokenMap[] = [
        {
          token: '[PERSON_1]',
          type: 'PERSON',
          originalValue: 'Dr. Anna Nowak',
          startIndex: 0,
          endIndex: 14
        },
        {
          token: '[ADDRESS_1]',
          type: 'ADDRESS',
          originalValue: 'Warszawa, ul. Marszałkowska 10',
          startIndex: 20,
          endIndex: 50
        },
        {
          token: '[AMOUNT_MONEY_1]',
          type: 'AMOUNT_MONEY',
          originalValue: '1,500 EUR',
          startIndex: 60,
          endIndex: 69
        }
      ];

      const rawTask = {
        title: 'Spotkanie z [PERSON_1]',
        summary: 'Konsultacja w [ADDRESS_1] na kwotę [AMOUNT_MONEY_1]',
        location: '[ADDRESS_1]',
        contactPerson: '[PERSON_1]',
        amount: '[AMOUNT_MONEY_1]',
        scheduledTime: 'jutro o 15:00',
        subtasks: [
          { title: 'Przygotować dokumenty dla [PERSON_1]', completed: false }
        ]
      };

      const rehydrated = rehydrate(rawTask, tokens);

      expect(rehydrated.title).toBe('Spotkanie z Dr. Anna Nowak');
      expect(rehydrated.summary).toBe('Konsultacja w Warszawa, ul. Marszałkowska 10 na kwotę 1,500 EUR');
      expect(rehydrated.location).toBe('Warszawa, ul. Marszałkowska 10');
      expect(rehydrated.contactPerson).toBe('Dr. Anna Nowak');
      expect(rehydrated.amount).toBe('1,500 EUR');
      expect(rehydrated.scheduledTime).toBe('jutro o 15:00');
      expect(rehydrated.subtasks[0].title).toBe('Przygotować dokumenty dla Dr. Anna Nowak');
    });
  });

  // =========================================================================
  // 12. Multilingual Prepositions, Phone Formats, Deduplication & Pipeline Edge Coverage
  // =========================================================================
  describe('Multilingual Prepositions, Phone Formats, and Deduplication Branch Coverage', () => {
    it('detects lowercase person names after prepositions across German, French, and English', () => {
      const deResult = PrivacyGuard.mask('treffen mit max mustermann');
      expect(deResult.tokens.some((t) => t.type === 'PERSON')).toBe(true);

      const deBei = PrivacyGuard.mask('bei hans schmidt');
      expect(deBei.tokens.some((t) => t.type === 'PERSON')).toBe(true);

      const frResult = PrivacyGuard.mask('rendez-vous avec jean dupont');
      expect(frResult.tokens.some((t) => t.type === 'PERSON')).toBe(true);

      const frPour = PrivacyGuard.mask('pour pierre dubois');
      expect(frPour.tokens.some((t) => t.type === 'PERSON')).toBe(true);

      const enResult = PrivacyGuard.mask('meeting with john doe');
      expect(enResult.tokens.some((t) => t.type === 'PERSON')).toBe(true);

      const enFrom = PrivacyGuard.mask('from charlie chaplin');
      expect(enFrom.tokens.some((t) => t.type === 'PERSON')).toBe(true);
    });

    it('ignores excluded pronouns and stop words after prepositions across German, French, and English', () => {
      // German stop words / pronouns
      const deStop1 = PrivacyGuard.mask('treffen mit mir dir');
      expect(deStop1.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

      const deStop2 = PrivacyGuard.mask('bei uns euch');
      expect(deStop2.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

      // French stop words / pronouns
      const frStop1 = PrivacyGuard.mask('rendez-vous avec moi toi');
      expect(frStop1.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

      const frStop2 = PrivacyGuard.mask('pour lui elle');
      expect(frStop2.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

      // English stop words / pronouns
      const enStop1 = PrivacyGuard.mask('meeting with him her');
      expect(enStop1.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

      const enStop2 = PrivacyGuard.mask('for me you');
      expect(enStop2.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

      // International cities after prepositions
      const cityDe = PrivacyGuard.mask('treffen mit Berlin');
      expect(cityDe.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

      const cityFr = PrivacyGuard.mask('rendez-vous avec Paris');
      expect(cityFr.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

      const cityEn = PrivacyGuard.mask('meeting with London');
      expect(cityEn.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);
    });

    it('detects diverse phone number patterns: continuous, dashed, parenthesized, and international', () => {
      // Continuous 9-digit
      const res9 = PrivacyGuard.mask('Call 601234567 regarding the report');
      expect(res9.tokens.some((t) => t.type === 'PHONE')).toBe(true);

      // Parenthesized area code
      const resParen = PrivacyGuard.mask('Office phone: (030) 9876-5432');
      expect(resParen.tokens.some((t) => t.type === 'PHONE')).toBe(true);

      // Delimited US 10-digit
      const resUs = PrivacyGuard.mask('Direct line: 555-123-4567');
      expect(resUs.tokens.some((t) => t.type === 'PHONE')).toBe(true);

      // International prefix with periods
      const resIntlDot = PrivacyGuard.mask('Mobile: +49.170.1234567');
      expect(resIntlDot.tokens.some((t) => t.type === 'PHONE')).toBe(true);
    });

    it('deduplicates recurring entities and assigns identical tokens in processMatches', () => {
      const text = 'Call Dr. Alice Smith today. Later remind Dr. Alice Smith about the agreement.';
      const res = PrivacyGuard.mask(text);

      const personTokens = res.tokens.filter((t) => t.type === 'PERSON');
      expect(personTokens.length).toBe(2);
      expect(personTokens[0].token).toBe(personTokens[1].token);
      expect(res.sanitizedText).not.toContain('Dr. Alice Smith');
    });

    it('exercises cached pipeline branches in getPipeline and maskAsync', async () => {
      const mockPipe = ((text: string) => Promise.resolve([{ entity_group: 'PER', word: 'Alice', start: 0, end: 5 }])) as unknown as any;
      PrivacyGuard.setPipeline(mockPipe);

      const pipe1 = await PrivacyGuard.getPipeline();
      expect(pipe1).toBe(mockPipe);

      const result = await PrivacyGuard.maskAsync('Alice attended the meeting');
      expect(result.tokens.length).toBeGreaterThanOrEqual(1);

      // Reset custom pipeline and test fallback
      PrivacyGuard.setPipeline(null);
      const fallbackResult = await PrivacyGuard.maskAsync('Alice attended the meeting');
      expect(fallbackResult).toBeDefined();

      // Restore pipeline undefined
      PrivacyGuard.setPipeline(undefined);
    });
  });

  // =========================================================================
  // 13. Single-Word Names after Prepositions with Dictionary & Stop-Word Guards
  // =========================================================================
  describe('Single-Word Names after Prepositions with Dictionary & Stop-Word Guards', () => {
    it('masks single Polish inflected names after prepositions and rehydrates to nominative', () => {
      // 1. "kawa z markiem o 12:00" -> masks "markiem" as PERSON, rehydrates to nominative "Marek"
      const resMarek = PrivacyGuard.mask('kawa z markiem o 12:00');
      expect(resMarek.tokens).toHaveLength(1);
      expect(resMarek.tokens[0].type).toBe('PERSON');
      expect(resMarek.tokens[0].originalValue).toBe('markiem');
      expect(resMarek.sanitizedText).toBe('kawa z [PERSON_1] o 12:00');

      const rehydratedMarek = rehydrate({ contactPerson: resMarek.tokens[0].token }, resMarek.tokens);
      expect(rehydratedMarek.contactPerson).toBe('Marek');
      expect(normalizePersonToNominative(resMarek.tokens[0].originalValue)).toBe('Marek');

      // 2. "spotkanie z beatą" -> masks "beatą" as PERSON, rehydrates to nominative "Beata"
      const resBeata = PrivacyGuard.mask('spotkanie z beatą');
      expect(resBeata.tokens).toHaveLength(1);
      expect(resBeata.tokens[0].type).toBe('PERSON');
      expect(resBeata.tokens[0].originalValue).toBe('beatą');
      expect(resBeata.sanitizedText).toBe('spotkanie z [PERSON_1]');

      const rehydratedBeata = rehydrate({ contactPerson: resBeata.tokens[0].token }, resBeata.tokens);
      expect(rehydratedBeata.contactPerson).toBe('Beata');
      expect(normalizePersonToNominative(resBeata.tokens[0].originalValue)).toBe('Beata');
    });

    it('rejects standalone non-name nouns and pronouns following prepositions', () => {
      // 3. "kawa ze sobą" -> rejects sobą
      const resSoba = PrivacyGuard.mask('kawa ze sobą');
      expect(resSoba.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);
      expect(resSoba.sanitizedText).toBe('kawa ze sobą');

      // 4. "kawa z mlekiem" -> rejects mlekiem
      const resMleko = PrivacyGuard.mask('kawa z mlekiem');
      expect(resMleko.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);
      expect(resMleko.sanitizedText).toBe('kawa z mlekiem');

      // Additional stop-word / object tests
      const resChleb = PrivacyGuard.mask('kanapka z masłem i chlebem');
      expect(resChleb.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

      const resCukier = PrivacyGuard.mask('herbata z cukrem');
      expect(resCukier.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);
    });

    it('detects single first names in German and English after prepositions', () => {
      const deRes = PrivacyGuard.mask('treffen mit frank');
      expect(deRes.tokens.some((t) => t.type === 'PERSON' && t.originalValue === 'frank')).toBe(true);

      const enRes = PrivacyGuard.mask('meeting with john');
      expect(enRes.tokens.some((t) => t.type === 'PERSON' && t.originalValue === 'john')).toBe(true);

      const deHans = PrivacyGuard.mask('bei hans');
      expect(deHans.tokens.some((t) => t.type === 'PERSON' && t.originalValue === 'hans')).toBe(true);
    });
  });
});
