import { afterEach, describe, expect, it } from 'vitest';
import {
  PrivacyGuard,
  TOKEN_PATTERN,
  isValidIban,
  isValidPesel,
  isValidSsn,
  rehydrate,
} from '../server/src/privacy/PrivacyGuard.js';
import { SanitizationResultSchema, normalizePersonToNominative } from '@oscar/shared';

describe('Adversarial Holdout — PrivacyGuard & Linguistic Normalization', () => {
  afterEach(() => {
    PrivacyGuard.setPipeline(undefined);
  });

  describe('Zero-width & format character (\\p{Cf}) evasion resistance', () => {
    it('detects and masks phone, IBAN, PESEL, and email obfuscated with ZWSP, ZWNJ, ZWJ, and BOM', () => {
      const zwsp = '\u200B';
      const zwnj = '\u200C';
      const zwj = '\u200D';
      const bom = '\uFEFF';

      const obfuscatedPhone = `601${zwsp}234${zwnj}567`;
      const obfuscatedIban = `PL61${zwsp}1090${zwnj}1014${zwj}0000${bom}071219812874`;
      const obfuscatedPesel = `9001${zwsp}011${zwnj}2349`;
      const obfuscatedEmail = `ali${zwsp}ce.no${zwnj}wak@ex${zwj}ample${bom}.com`;

      const input = [
        `Call ${obfuscatedPhone}`,
        `transfer to ${obfuscatedIban}`,
        `PESEL ${obfuscatedPesel}`,
        `mail ${obfuscatedEmail}`,
      ].join(', ');

      const result = PrivacyGuard.mask(input);
      const parsed = SanitizationResultSchema.parse(result);

      expect(parsed.tokenCount).toBeGreaterThanOrEqual(4);
      expect(parsed.riskLevel).toBe('HIGH');

      const types = new Set(parsed.tokens.map((t) => t.type));
      expect(types.has('PHONE')).toBe(true);
      expect(types.has('IBAN')).toBe(true);
      expect(types.has('NATIONAL_ID')).toBe(true);
      expect(types.has('EMAIL')).toBe(true);

      expect(parsed.sanitizedText).not.toContain('601');
      expect(parsed.sanitizedText).not.toContain('234');
      expect(parsed.sanitizedText).not.toContain('567');
      expect(parsed.sanitizedText).not.toContain('PL61');
      expect(parsed.sanitizedText).not.toContain('071219812874');
      expect(parsed.sanitizedText).not.toContain('9001');
      expect(parsed.sanitizedText).not.toContain('2349');
      expect(parsed.sanitizedText).not.toContain('example');
      expect(parsed.sanitizedText).not.toContain(obfuscatedPhone);
      expect(parsed.sanitizedText).not.toContain(obfuscatedIban);
      expect(parsed.sanitizedText).not.toContain(obfuscatedPesel);
      expect(parsed.sanitizedText).not.toContain(obfuscatedEmail);
    });

    it('falls back cleanly in maskAsync when pipeline fails and still prevents \\p{Cf} leakage', async () => {
      PrivacyGuard.setPipeline(async () => {
        throw new Error('Simulated local NER failure');
      });

      const obfuscatedIban = 'DE89\u200B3704\u200C0044\u200D0532\uFEFF013000';
      const result = await PrivacyGuard.maskAsync(`Wire funds to ${obfuscatedIban} today`);
      const parsed = SanitizationResultSchema.parse(result);

      expect(parsed.tokens.some((t) => t.type === 'IBAN')).toBe(true);
      expect(parsed.sanitizedText).not.toContain('DE89');
      expect(parsed.sanitizedText).not.toContain('3704');
      expect(parsed.sanitizedText).toContain('[IBAN_1]');
    });
  });

  describe('Unicode NFKC compatibility, fullwidth ASCII, NBSP, and NFD diacritic evasion', () => {
    it('masks fullwidth ASCII digits/letters and NBSP-separated PII without leaving raw fragments', () => {
      const nbsp = '\u00A0';
      // Fullwidth digits: ６０１ NBSP ２３４ NBSP ５６７
      const fullwidthPhone = `\uFF16\uFF10\uFF11${nbsp}\uFF12\uFF13\uFF14${nbsp}\uFF15\uFF16\uFF17`;
      // Fullwidth PESEL: ９００１０１１２３４９
      const fullwidthPesel = '\uFF19\uFF10\uFF10\uFF11\uFF10\uFF11\uFF11\uFF12\uFF13\uFF14\uFF19';
      // Fullwidth email: ｊａｎ＠ｅｘａｍｐｌｅ．ｃｏｍ
      const fullwidthEmail =
        '\uFF4A\uFF41\uFF4E\uFF20\uFF45\uFF58\uFF41\uFF4D\uFF50\uFF4C\uFF45\uFF0E\uFF43\uFF4F\uFF4D';
      // Fullwidth + NBSP IBAN: ＤＥ８９ NBSP ３７０４ NBSP ００４４ NBSP ０５３２ NBSP ０１３０ NBSP ００
      const fullwidthIban = [
        '\uFF24\uFF25\uFF18\uFF19',
        '\uFF13\uFF17\uFF10\uFF14',
        '\uFF10\uFF10\uFF14\uFF14',
        '\uFF10\uFF15\uFF13\uFF12',
        '\uFF10\uFF11\uFF13\uFF10',
        '\uFF10\uFF10',
      ].join(nbsp);

      const input = `Tel: ${fullwidthPhone}; PESEL: ${fullwidthPesel}; Email: ${fullwidthEmail}; IBAN: ${fullwidthIban}`;
      const result = PrivacyGuard.mask(input);
      const parsed = SanitizationResultSchema.parse(result);

      expect(parsed.tokens.some((t) => t.type === 'PHONE')).toBe(true);
      expect(parsed.tokens.some((t) => t.type === 'NATIONAL_ID')).toBe(true);
      expect(parsed.tokens.some((t) => t.type === 'EMAIL')).toBe(true);
      expect(parsed.tokens.some((t) => t.type === 'IBAN')).toBe(true);

      expect(parsed.sanitizedText).not.toContain(fullwidthPhone);
      expect(parsed.sanitizedText).not.toContain(fullwidthPesel);
      expect(parsed.sanitizedText).not.toContain(fullwidthEmail);
      expect(parsed.sanitizedText).not.toContain(fullwidthIban);

      const matchedTokens = parsed.sanitizedText.match(TOKEN_PATTERN) ?? [];
      expect(matchedTokens.length).toBe(4);
      for (const tok of matchedTokens) {
        expect(tok).toMatch(/^\[[A-Z_]+_\d+\]$/);
      }
    });

    it('detects NFD decomposed diacritics (a\\u0301, o\\u0301, u\\u0308) in names and locations', () => {
      const nfdText =
        'Spotkanie z Toma\u0301s\u0301em Mu\u0308llerem oraz Jo\u0301zefem Nowakiem w Krako\u0301w';
      const result = PrivacyGuard.mask(nfdText);
      const parsed = SanitizationResultSchema.parse(result);

      expect(parsed.tokens.some((t) => t.type === 'PERSON')).toBe(true);
      expect(parsed.tokens.some((t) => t.type === 'ADDRESS')).toBe(true);

      expect(parsed.sanitizedText).not.toContain('Müllerem');
      expect(parsed.sanitizedText).not.toContain('Mu\u0308llerem');
      expect(parsed.sanitizedText).not.toContain('Józefem');
      expect(parsed.sanitizedText).not.toContain('Jo\u0301zefem');
      expect(parsed.sanitizedText).not.toContain('Nowakiem');
      expect(parsed.sanitizedText).not.toContain('Kraków');
      expect(parsed.sanitizedText).not.toContain('Krako\u0301w');
    });
  });

  describe('Multi-part & hyphenated PL/DE/EN names', () => {
    it('captures full declined Polish hyphenated names, lemmatizes to nominative, and rehydrates intact', () => {
      const input =
        'Spotkanie z Anną Nowak-Kowalską oraz dr. Januszem Kowalskim-Wiśniewskim';
      const result = PrivacyGuard.mask(input);
      const parsed = SanitizationResultSchema.parse(result);

      const personTokens = parsed.tokens.filter((t) => t.type === 'PERSON');
      expect(personTokens).toHaveLength(2);
      expect(personTokens[0].originalValue).toBe('Anną Nowak-Kowalską');
      expect(personTokens[1].originalValue).toBe('dr. Januszem Kowalskim-Wiśniewskim');

      expect(parsed.sanitizedText).not.toContain('Nowak');
      expect(parsed.sanitizedText).not.toContain('Kowalską');
      expect(parsed.sanitizedText).not.toContain('Wiśniewskim');

      expect(normalizePersonToNominative(personTokens[0].originalValue)).toBe(
        'Anna Nowak-Kowalska',
      );
      expect(normalizePersonToNominative(personTokens[1].originalValue)).toBe(
        'Dr. Janusz Kowalski-Wiśniewski',
      );

      const rehydratedText = rehydrate(parsed.sanitizedText, parsed.tokens);
      expect(rehydratedText).toContain('Nowak-Kowalską');
      expect(rehydratedText).toContain('Kowalskim-Wiśniewskim');

      const rehydratedTask = rehydrate(
        {
          contactPerson: personTokens[1].token,
          summary: `Follow up with ${personTokens[0].token} and ${personTokens[1].token}`,
        },
        parsed.tokens,
      );
      expect(rehydratedTask.contactPerson).toBe('Dr. Janusz Kowalski-Wiśniewski');
      expect(rehydratedTask.summary).toContain('Nowak-Kowalską');
      expect(rehydratedTask.summary).toContain('Kowalskim-Wiśniewskim');
    });

    it('captures German compound honorifics & hyphenated surname alongside city address', () => {
      const input =
        'Termin mit Herrn Prof. Dr. Hans-Jürgen Müller-Lüdenscheidt in München';
      const result = PrivacyGuard.mask(input);
      const parsed = SanitizationResultSchema.parse(result);

      const personToken = parsed.tokens.find((t) => t.type === 'PERSON');
      const addressToken = parsed.tokens.find((t) => t.type === 'ADDRESS');

      expect(personToken).toBeDefined();
      expect(personToken?.originalValue).toBe('Herrn Prof. Dr. Hans-Jürgen Müller-Lüdenscheidt');
      expect(addressToken).toBeDefined();
      expect(addressToken?.originalValue).toBe('München');
      expect(parsed.sanitizedText).not.toContain('Hans-Jürgen');
      expect(parsed.sanitizedText).not.toContain('Müller-Lüdenscheidt');
      expect(parsed.sanitizedText).not.toContain('München');
    });

    it('captures English hyphenated and multi-part name with email address', () => {
      const input = 'Call with Dr. Alice-Marie St. Clair at john.smith@example.com';
      const result = PrivacyGuard.mask(input);
      const parsed = SanitizationResultSchema.parse(result);

      const personToken = parsed.tokens.find((t) => t.type === 'PERSON');
      const emailToken = parsed.tokens.find((t) => t.type === 'EMAIL');

      expect(emailToken?.originalValue).toBe('john.smith@example.com');
      expect(personToken).toBeDefined();
      expect(personToken?.originalValue).toBe('Dr. Alice-Marie St. Clair');
      expect(parsed.sanitizedText).not.toContain('Alice-Marie');
      expect(parsed.sanitizedText).not.toContain('Clair');
      expect(parsed.sanitizedText).not.toContain('john.smith@example.com');

      const withoutHon = PrivacyGuard.mask('Sync with Alice-Marie St. Clair tomorrow');
      expect(withoutHon.tokens.find((t) => t.type === 'PERSON')?.originalValue).toBe(
        'Alice-Marie St. Clair',
      );
      expect(withoutHon.sanitizedText).not.toContain('Clair');

      const streetNotPerson = PrivacyGuard.mask('Deliver parcel to Main St. before noon');
      expect(streetNotPerson.tokens.some((t) => t.type === 'PERSON')).toBe(false);
    });
  });

  describe('IBAN ISO 13616 MOD-97 & national ID checksum falsification', () => {
    it('accepts valid PL, DE, CH, and GB IBANs across contiguous, space, hyphen, and lowercase formats', () => {
      const validIbans = [
        'PL61109010140000071219812874',
        'PL61 1090 1014 0000 0712 1981 2874',
        'pl61-1090-1014-0000-0712-1981-2874',
        'DE89370400440532013000',
        'DE89 3704 0044 0532 0130 00',
        'de89-3704-0044-0532-0130-00',
        'CH93 0076 2011 6238 5295 7',
        'ch93-0076-2011-6238-5295-7',
        'GB29 NWBK 6016 1331 9268 19',
        'gb29nwbk60161331926819',
      ];

      for (const iban of validIbans) {
        expect(isValidIban(iban)).toBe(true);
        const res = PrivacyGuard.mask(`Settlement account: ${iban}`);
        const parsed = SanitizationResultSchema.parse(res);
        expect(parsed.tokens).toHaveLength(1);
        expect(parsed.tokens[0].type).toBe('IBAN');
        expect(parsed.tokens[0].token).toBe('[IBAN_1]');
        expect(parsed.sanitizedText).toBe('Settlement account: [IBAN_1]');
      }
    });

    it('rejects single-digit corrupted IBANs and does not emit IBAN tokens', () => {
      const corruptedIbans = ['PL60109010140000071219812874', 'DE88370400440532013000'];

      for (const badIban of corruptedIbans) {
        expect(isValidIban(badIban)).toBe(false);
        const res = PrivacyGuard.mask(`Invalid account ref ${badIban} rejected`);
        expect(res.tokens.some((t) => t.type === 'IBAN')).toBe(false);
      }
    });

    it('rejects invalid PESEL checksums and invalid US SSN ranges', () => {
      const invalidPesels = ['90010112340', '44051401358'];
      for (const badPesel of invalidPesels) {
        expect(isValidPesel(badPesel)).toBe(false);
        const res = PrivacyGuard.mask(`PESEL ${badPesel} check failed`);
        expect(res.tokens.some((t) => t.type === 'NATIONAL_ID')).toBe(false);
      }

      const invalidSsns = ['000-12-3456', '666-12-3456', '900-12-3456', '123-00-4567', '123-45-0000'];
      for (const badSsn of invalidSsns) {
        expect(isValidSsn(badSsn)).toBe(false);
        const res = PrivacyGuard.mask(`Invalid SSN ${badSsn}`);
        expect(res.tokens.some((t) => t.type === 'NATIONAL_ID')).toBe(false);
      }
    });
  });

  describe('Runtime-constructed secret & credential masking', () => {
    it('masks OpenAI, GitHub PAT, AWS, Slack, Bearer JWT, and key/value assignments as HIGH-risk SECRET_KEY', () => {
      const openAiKey = ['sk', 'a1b2c3d4e5f60718293a4b5c6d7e8f90'].join('-');
      const githubPat = ['ghp', '1234567890abcdefghijklmnopqrstuvwxyz'].join('_');
      const awsKey = ['AKIA', '1234567890ABCDEF'].join('');
      const slackToken = ['xoxb', '123456789012', '1234567890abcdef'].join('-');
      const jwtValue = [
        'eyJhbGciOiJIUzI1NiJ9',
        'eyJzdWIiOiJ1c2VyMTIzIn0',
        'signaturePart0123456789',
      ].join('.');
      const bearerJwt = ['Bearer ', jwtValue].join('');
      const apiKeyValue = 'vaultTokenAlpha98765';
      const passwordValue = 'passPhraseBeta4321';
      const apiKeyAssign = [['api', 'key'].join('_'), `"${apiKeyValue}"`].join('=');
      const passwordAssign = [['pass', 'word'].join(''), passwordValue].join('=');

      const cases = [
        { text: `Use ${openAiKey} for tests`, secretFragments: [openAiKey, 'a1b2c3d4e5f60718293a4b5c6d7e8f90'] },
        { text: `Token ${githubPat} revoked`, secretFragments: [githubPat, '1234567890abcdefghijklmnopqrstuvwxyz'] },
        { text: `IAM ${awsKey} rotated`, secretFragments: [awsKey, '1234567890ABCDEF'] },
        { text: `Bot ${slackToken} disabled`, secretFragments: [slackToken, '1234567890abcdef'] },
        { text: `Header ${bearerJwt} attached`, secretFragments: [bearerJwt, jwtValue, 'signaturePart0123456789'] },
        { text: `Config ${apiKeyAssign} loaded`, secretFragments: [apiKeyValue] },
        { text: `Login ${passwordAssign} checked`, secretFragments: [passwordValue] },
      ];

      for (const { text, secretFragments } of cases) {
        const res = PrivacyGuard.mask(text);
        const parsed = SanitizationResultSchema.parse(res);

        expect(parsed.riskLevel).toBe('HIGH');
        expect(parsed.tokens.some((t) => t.type === 'SECRET_KEY')).toBe(true);
        for (const fragment of secretFragments) {
          expect(parsed.sanitizedText).not.toContain(fragment);
        }
      }
    });
  });
});
