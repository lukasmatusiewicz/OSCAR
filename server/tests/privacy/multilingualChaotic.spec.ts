import { describe, it, expect } from 'vitest';
import { PrivacyGuard, rehydrate, TOKEN_PATTERN } from '../../src/privacy/PrivacyGuard.js';
import {
  SanitizationResultSchema,
  PIIType,
  SanitizationResult,
} from '../../src/types/contracts.js';

/**
 * Validates that no raw PII substring from the original detected tokens remains in the sanitized text.
 */
function assertZeroRawPiiLeakage(result: SanitizationResult): void {
  for (const token of result.tokens) {
    expect(
      result.sanitizedText.includes(token.originalValue),
      `Sanitized text leaked raw PII: "${token.originalValue}" (type: ${token.type})`,
    ).toBe(false);
  }
}

/**
 * Validates 100% deterministic roundtrip re-hydration invariance:
 * rehydrate(result.sanitizedText, result.tokens) === originalText
 */
function assertRoundtripInvariance(originalText: string, result: SanitizationResult): void {
  const restored = PrivacyGuard.rehydrate(result.sanitizedText, result.tokens);
  expect(restored).toBe(originalText);

  // Also test standalone rehydrate function
  const restoredDirect = rehydrate(result.sanitizedText, result.tokens);
  expect(restoredDirect).toBe(originalText);
}

/**
 * Validates strict contract schema compliance against Zod SanitizationResultSchema.
 */
function assertSchemaCompliance(result: SanitizationResult): void {
  const parseResult = SanitizationResultSchema.safeParse(result);
  expect(parseResult.success, 'SanitizationResult failed schema validation').toBe(true);
}

describe('Exhaustive Multilingual and Chaotic Writing Privacy Guard Test Suite', () => {
  // =========================================================================
  // Scenario 1: Polish Memo
  // =========================================================================
  describe('Scenario 1: Polish Memo (Declined Names, Honorifics, Colloquial Amounts, Street Addresses)', () => {
    const polishMemoText =
      'Pilne: spotkanie z dr Janem Kowalskim w Warszawie na ul. Marszałkowskiej 10 w sprawie 25 tys. PLN zaliczki, tel: 601 234 567. Klucz: sk-abcdef0123456789abcdef0123456789';

    it('detects all Polish entity types with correct categories and values', () => {
      const result = PrivacyGuard.mask(polishMemoText);

      // Verify PERSON: dr Janem Kowalskim
      const personTokens = result.tokens.filter((t) => t.type === 'PERSON');
      expect(personTokens.length).toBeGreaterThanOrEqual(1);
      expect(personTokens.some((t) => t.originalValue === 'dr Janem Kowalskim')).toBe(true);

      // Verify ADDRESS: Warszawie and ul. Marszałkowskiej 10
      const addressTokens = result.tokens.filter((t) => t.type === 'ADDRESS');
      expect(addressTokens.length).toBeGreaterThanOrEqual(2);
      expect(addressTokens.some((t) => t.originalValue === 'Warszawie')).toBe(true);
      expect(addressTokens.some((t) => t.originalValue === 'ul. Marszałkowskiej 10')).toBe(true);

      // Verify AMOUNT_MONEY: 25 tys. PLN
      const amountTokens = result.tokens.filter((t) => t.type === 'AMOUNT_MONEY');
      expect(amountTokens.length).toBeGreaterThanOrEqual(1);
      expect(amountTokens.some((t) => t.originalValue === '25 tys. PLN')).toBe(true);

      // Verify PHONE: 601 234 567
      const phoneTokens = result.tokens.filter((t) => t.type === 'PHONE');
      expect(phoneTokens.length).toBeGreaterThanOrEqual(1);
      expect(phoneTokens.some((t) => t.originalValue === '601 234 567')).toBe(true);

      // Verify SECRET_KEY: sk-abcdef0123456789abcdef0123456789
      const secretTokens = result.tokens.filter((t) => t.type === 'SECRET_KEY');
      expect(secretTokens.length).toBeGreaterThanOrEqual(1);
      expect(
        secretTokens.some((t) => t.originalValue === 'sk-abcdef0123456789abcdef0123456789'),
      ).toBe(true);
    });

    it('ensures zero raw PII leakage in sanitized text for Polish memo', () => {
      const result = PrivacyGuard.mask(polishMemoText);
      assertZeroRawPiiLeakage(result);
    });

    it('guarantees exact deterministic roundtrip re-hydration for Polish memo', () => {
      const result = PrivacyGuard.mask(polishMemoText);
      assertRoundtripInvariance(polishMemoText, result);
    });

    it('validates schema compliance for Polish memo result', () => {
      const result = PrivacyGuard.mask(polishMemoText);
      assertSchemaCompliance(result);
    });

    it('handles additional Polish declined cases and currency variants', () => {
      const additionalPolish =
        'Rozmowa z mec. Anną Nowak w Krakowie w biurze na al. Jerozolimskie 50. ' +
        'Kwota: 10 milionów złotych lub 50k zł. Przelew na PL61109010140000071219812874. ' +
        'Kontakt telefoniczny: 501-222-333.';

      const result = PrivacyGuard.mask(additionalPolish);

      expect(result.tokens.some((t) => t.type === 'PERSON' && t.originalValue === 'mec. Anną Nowak')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'ADDRESS' && t.originalValue === 'Krakowie')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'ADDRESS' && t.originalValue === 'al. Jerozolimskie 50')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'AMOUNT_MONEY' && t.originalValue === '10 milionów złotych')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'AMOUNT_MONEY' && t.originalValue === '50k zł')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'IBAN' && t.originalValue === 'PL61109010140000071219812874')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'PHONE' && t.originalValue === '501-222-333')).toBe(true);

      assertZeroRawPiiLeakage(result);
      assertRoundtripInvariance(additionalPolish, result);
    });
  });

  // =========================================================================
  // Scenario 2: German Memo
  // =========================================================================
  describe('Scenario 2: German Memo (Honorifics, Prepositions, Compound Street, Colloquial Multiplier, Lowercase IBAN)', () => {
    const germanMemoText =
      'Wichtig: Treffen mit Herrn Dr. Hans Müller in Berlin in der Friedrichstraße 42 wegen 150k€ Überweisung an IBAN de89370400440532013000. Email: hans.mueller@unternehmen.de, Tel: +49 30 123456.';

    it('detects all German entity types including compound titles and lowercase IBAN', () => {
      const result = PrivacyGuard.mask(germanMemoText);

      // Verify PERSON: Herrn Dr. Hans Müller
      const personTokens = result.tokens.filter((t) => t.type === 'PERSON');
      expect(personTokens.length).toBeGreaterThanOrEqual(1);
      expect(personTokens.some((t) => t.originalValue.includes('Hans Müller'))).toBe(true);

      // Verify ADDRESS: Berlin and Friedrichstraße 42
      const addressTokens = result.tokens.filter((t) => t.type === 'ADDRESS');
      expect(addressTokens.length).toBeGreaterThanOrEqual(2);
      expect(addressTokens.some((t) => t.originalValue === 'Berlin')).toBe(true);
      expect(addressTokens.some((t) => t.originalValue === 'Friedrichstraße 42')).toBe(true);

      // Verify AMOUNT_MONEY: 150k€
      const amountTokens = result.tokens.filter((t) => t.type === 'AMOUNT_MONEY');
      expect(amountTokens.length).toBeGreaterThanOrEqual(1);
      expect(amountTokens.some((t) => t.originalValue === '150k€')).toBe(true);

      // Verify IBAN: de89370400440532013000 (lowercase)
      const ibanTokens = result.tokens.filter((t) => t.type === 'IBAN');
      expect(ibanTokens.length).toBeGreaterThanOrEqual(1);
      expect(ibanTokens.some((t) => t.originalValue === 'de89370400440532013000')).toBe(true);

      // Verify EMAIL: hans.mueller@unternehmen.de
      const emailTokens = result.tokens.filter((t) => t.type === 'EMAIL');
      expect(emailTokens.length).toBeGreaterThanOrEqual(1);
      expect(emailTokens.some((t) => t.originalValue === 'hans.mueller@unternehmen.de')).toBe(true);

      // Verify PHONE: +49 30 123456
      const phoneTokens = result.tokens.filter((t) => t.type === 'PHONE');
      expect(phoneTokens.length).toBeGreaterThanOrEqual(1);
      expect(phoneTokens.some((t) => t.originalValue === '+49 30 123456')).toBe(true);
    });

    it('ensures zero raw PII leakage in sanitized text for German memo', () => {
      const result = PrivacyGuard.mask(germanMemoText);
      assertZeroRawPiiLeakage(result);
    });

    it('guarantees exact deterministic roundtrip re-hydration for German memo', () => {
      const result = PrivacyGuard.mask(germanMemoText);
      assertRoundtripInvariance(germanMemoText, result);
    });

    it('validates schema compliance for German memo result', () => {
      const result = PrivacyGuard.mask(germanMemoText);
      assertSchemaCompliance(result);
    });

    it('handles German female honorifics, spaced IBAN, and city variations', () => {
      const additionalGerman =
        'Treffen mit Frau Dr. Erika Schmidt in München am Marienplatz 1. ' +
        'Zahlung von 1.5 mln EUR auf IBAN de89 3704 0044 0532 0130 00. ' +
        'Rückfragen unter erika.schmidt@berlin-tech.de oder (030) 9876-5432.';

      const result = PrivacyGuard.mask(additionalGerman);

      expect(result.tokens.some((t) => t.type === 'PERSON' && t.originalValue.includes('Erika Schmidt'))).toBe(true);
      expect(result.tokens.some((t) => t.type === 'ADDRESS' && t.originalValue === 'München')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'AMOUNT_MONEY' && t.originalValue === '1.5 mln EUR')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'IBAN' && t.originalValue === 'de89 3704 0044 0532 0130 00')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'EMAIL' && t.originalValue === 'erika.schmidt@berlin-tech.de')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'PHONE' && t.originalValue === '(030) 9876-5432')).toBe(true);

      assertZeroRawPiiLeakage(result);
      assertRoundtripInvariance(additionalGerman, result);
    });
  });

  // =========================================================================
  // Scenario 3: French Memo
  // =========================================================================
  describe('Scenario 3: French Memo (Prepositions, Street Names, Spacing Typo Amounts, French Phone)', () => {
    const frenchMemoText =
      'Rendez-vous avec M. Pierre Dupont à Paris sur le boulevard Saint-Germain 15 pour régler 50 0000 euro (environ 50k €). Contact: +33 1 42 68 55 00 ou pierre.dupont@societe.fr.';

    it('detects all French entity types including spacing typo amount and French phone', () => {
      const result = PrivacyGuard.mask(frenchMemoText);

      // Verify PERSON: M. Pierre Dupont
      const personTokens = result.tokens.filter((t) => t.type === 'PERSON');
      expect(personTokens.length).toBeGreaterThanOrEqual(1);
      expect(personTokens.some((t) => t.originalValue === 'M. Pierre Dupont')).toBe(true);

      // Verify ADDRESS: Paris and boulevard Saint-Germain 15
      const addressTokens = result.tokens.filter((t) => t.type === 'ADDRESS');
      expect(addressTokens.length).toBeGreaterThanOrEqual(2);
      expect(addressTokens.some((t) => t.originalValue === 'Paris')).toBe(true);
      expect(addressTokens.some((t) => t.originalValue === 'boulevard Saint-Germain 15')).toBe(true);

      // Verify AMOUNT_MONEY: 50 0000 euro and 50k €
      const amountTokens = result.tokens.filter((t) => t.type === 'AMOUNT_MONEY');
      expect(amountTokens.length).toBeGreaterThanOrEqual(2);
      expect(amountTokens.some((t) => t.originalValue === '50 0000 euro')).toBe(true);
      expect(amountTokens.some((t) => t.originalValue === '50k €')).toBe(true);

      // Verify PHONE: +33 1 42 68 55 00
      const phoneTokens = result.tokens.filter((t) => t.type === 'PHONE');
      expect(phoneTokens.length).toBeGreaterThanOrEqual(1);
      expect(phoneTokens.some((t) => t.originalValue === '+33 1 42 68 55 00')).toBe(true);

      // Verify EMAIL: pierre.dupont@societe.fr
      const emailTokens = result.tokens.filter((t) => t.type === 'EMAIL');
      expect(emailTokens.length).toBeGreaterThanOrEqual(1);
      expect(emailTokens.some((t) => t.originalValue === 'pierre.dupont@societe.fr')).toBe(true);
    });

    it('ensures zero raw PII leakage in sanitized text for French memo', () => {
      const result = PrivacyGuard.mask(frenchMemoText);
      assertZeroRawPiiLeakage(result);
    });

    it('guarantees exact deterministic roundtrip re-hydration for French memo', () => {
      const result = PrivacyGuard.mask(frenchMemoText);
      assertRoundtripInvariance(frenchMemoText, result);
    });

    it('validates schema compliance for French memo result', () => {
      const result = PrivacyGuard.mask(frenchMemoText);
      assertSchemaCompliance(result);
    });

    it('handles French female honorifics (Mme), street prefixes (rue), and currency symbols', () => {
      const additionalFrench =
        'Contactez Mme Sophie Martin à Paris au 10 rue de Rivoli pour la facture de 2.500,00 €. ' +
        'Email: sophie.martin@paris-store.fr, mobile: 01 42 68 55 00.';

      const result = PrivacyGuard.mask(additionalFrench);

      expect(result.tokens.some((t) => t.type === 'PERSON' && t.originalValue.includes('Sophie Martin'))).toBe(true);
      expect(result.tokens.some((t) => t.type === 'ADDRESS' && t.originalValue === 'Paris')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'ADDRESS' && t.originalValue.includes('rue de Rivoli'))).toBe(true);
      expect(result.tokens.some((t) => t.type === 'AMOUNT_MONEY' && t.originalValue === '2.500,00 €')).toBe(true);
      expect(result.tokens.some((t) => t.type === 'EMAIL' && t.originalValue === 'sophie.martin@paris-store.fr')).toBe(true);

      assertZeroRawPiiLeakage(result);
      assertRoundtripInvariance(additionalFrench, result);
    });
  });

  // =========================================================================
  // Scenario 4: English Chaotic Memo
  // =========================================================================
  describe('Scenario 4: English Chaotic Memo (Messy Syntax, Lowercase, Spacing Typos, Names Without Honorifics)', () => {
    const englishChaoticText =
      'call Alice Newman in New York on 555-123-4567 ASAP about the 15 0000 USD contract at Baker Street 221B, key: ghp_123456789012345678901234567890123456';

    it('detects all entities accurately despite chaotic syntax and spacing typos', () => {
      const result = PrivacyGuard.mask(englishChaoticText);

      // Verify PERSON: Alice Newman (detected via preposition / name pair)
      const personTokens = result.tokens.filter((t) => t.type === 'PERSON');
      expect(personTokens.length).toBeGreaterThanOrEqual(1);
      expect(personTokens.some((t) => t.originalValue === 'Alice Newman')).toBe(true);

      // Verify ADDRESS: New York and Baker Street 221B
      const addressTokens = result.tokens.filter((t) => t.type === 'ADDRESS');
      expect(addressTokens.length).toBeGreaterThanOrEqual(2);
      expect(addressTokens.some((t) => t.originalValue === 'New York')).toBe(true);
      expect(addressTokens.some((t) => t.originalValue === 'Baker Street 221B')).toBe(true);

      // Verify PHONE: 555-123-4567
      const phoneTokens = result.tokens.filter((t) => t.type === 'PHONE');
      expect(phoneTokens.length).toBeGreaterThanOrEqual(1);
      expect(phoneTokens.some((t) => t.originalValue === '555-123-4567')).toBe(true);

      // Verify AMOUNT_MONEY: 15 0000 USD (spacing typo amount)
      const amountTokens = result.tokens.filter((t) => t.type === 'AMOUNT_MONEY');
      expect(amountTokens.length).toBeGreaterThanOrEqual(1);
      expect(amountTokens.some((t) => t.originalValue === '15 0000 USD')).toBe(true);

      // Verify SECRET_KEY: ghp_123456789012345678901234567890123456
      const secretTokens = result.tokens.filter((t) => t.type === 'SECRET_KEY');
      expect(secretTokens.length).toBeGreaterThanOrEqual(1);
      expect(
        secretTokens.some(
          (t) => t.originalValue === 'ghp_123456789012345678901234567890123456',
        ),
      ).toBe(true);
    });

    it('detects all 7 categories together in a comprehensive chaotic text', () => {
      const allSevenChaoticText =
        'hey call Bob Miller in London at 10 Downing Street or on +1-800-555-0199 about the 25 0000 EUR payment ' +
        'to IBAN de89370400440532013000. Send confirmation to bob.miller@example.org with token bearer abcdef1234567890abcdef123456 ASAP!!';

      const result = PrivacyGuard.mask(allSevenChaoticText);

      const detectedTypes = new Set<PIIType>(result.tokens.map((t) => t.type));
      expect(detectedTypes.has('SECRET_KEY')).toBe(true);
      expect(detectedTypes.has('IBAN')).toBe(true);
      expect(detectedTypes.has('EMAIL')).toBe(true);
      expect(detectedTypes.has('PHONE')).toBe(true);
      expect(detectedTypes.has('AMOUNT_MONEY')).toBe(true);
      expect(detectedTypes.has('PERSON')).toBe(true);
      expect(detectedTypes.has('ADDRESS')).toBe(true);

      assertZeroRawPiiLeakage(result);
      assertRoundtripInvariance(allSevenChaoticText, result);
    });

    it('ensures zero raw PII leakage in sanitized text for English chaotic memo', () => {
      const result = PrivacyGuard.mask(englishChaoticText);
      assertZeroRawPiiLeakage(result);
    });

    it('guarantees exact deterministic roundtrip re-hydration for English chaotic memo', () => {
      const result = PrivacyGuard.mask(englishChaoticText);
      assertRoundtripInvariance(englishChaoticText, result);
    });

    it('validates schema compliance for English chaotic memo result', () => {
      const result = PrivacyGuard.mask(englishChaoticText);
      assertSchemaCompliance(result);
    });
  });

  // =========================================================================
  // Scenario 5: Adversarial Edge Cases & High Token Density
  // =========================================================================
  describe('Scenario 5: Adversarial Edge Cases & High Token Density', () => {
    const adversarialText =
      'Check accounts (de89 3704 0044 0532 0130 00) and (pl61109010140000071219812874). ' +
      'Credentials: (sk-abcdef0123456789abcdef0123456789) and (ghp_123456789012345678901234567890123456). ' +
      'Budgets: 15k€, 20 tys. zł, 100 USD. ' +
      'Offices in London, Berlin, Paris, and Baker Street 221B.';

    it('handles mixed lowercase IBANs, secret keys in parentheses, successive amounts, and consecutive cities', () => {
      const result = PrivacyGuard.mask(adversarialText);

      // Verify mixed lowercase IBANs detected
      const ibans = result.tokens.filter((t) => t.type === 'IBAN');
      expect(ibans.length).toBe(2);
      expect(ibans.some((t) => t.originalValue === 'de89 3704 0044 0532 0130 00')).toBe(true);
      expect(ibans.some((t) => t.originalValue === 'pl61109010140000071219812874')).toBe(true);

      // Verify secret keys inside parentheses detected
      const secrets = result.tokens.filter((t) => t.type === 'SECRET_KEY');
      expect(secrets.length).toBe(2);
      expect(secrets.some((t) => t.originalValue === 'sk-abcdef0123456789abcdef0123456789')).toBe(true);
      expect(secrets.some((t) => t.originalValue === 'ghp_123456789012345678901234567890123456')).toBe(true);

      // Verify successive amounts detected
      const amounts = result.tokens.filter((t) => t.type === 'AMOUNT_MONEY');
      expect(amounts.length).toBe(3);
      expect(amounts.some((t) => t.originalValue === '15k€')).toBe(true);
      expect(amounts.some((t) => t.originalValue === '20 tys. zł')).toBe(true);
      expect(amounts.some((t) => t.originalValue === '100 USD')).toBe(true);

      // Verify consecutive cities and street addresses detected
      const addresses = result.tokens.filter((t) => t.type === 'ADDRESS');
      expect(addresses.length).toBe(4);
      expect(addresses.some((t) => t.originalValue === 'London')).toBe(true);
      expect(addresses.some((t) => t.originalValue === 'Berlin')).toBe(true);
      expect(addresses.some((t) => t.originalValue === 'Paris')).toBe(true);
      expect(addresses.some((t) => t.originalValue === 'Baker Street 221B')).toBe(true);
    });

    it('asserts zero raw PII strings present in sanitized text', () => {
      const result = PrivacyGuard.mask(adversarialText);
      assertZeroRawPiiLeakage(result);

      // Explicit individual checks on sensitive original fragments
      expect(result.sanitizedText).not.toContain('de89 3704 0044 0532 0130 00');
      expect(result.sanitizedText).not.toContain('pl61109010140000071219812874');
      expect(result.sanitizedText).not.toContain('sk-abcdef0123456789abcdef0123456789');
      expect(result.sanitizedText).not.toContain('ghp_123456789012345678901234567890123456');
      expect(result.sanitizedText).not.toContain('15k€');
      expect(result.sanitizedText).not.toContain('20 tys. zł');
      expect(result.sanitizedText).not.toContain('100 USD');
      expect(result.sanitizedText).not.toContain('London');
      expect(result.sanitizedText).not.toContain('Berlin');
      expect(result.sanitizedText).not.toContain('Paris');
      expect(result.sanitizedText).not.toContain('Baker Street 221B');
    });

    it('asserts exact deterministic roundtrip re-hydration invariance for adversarial scenario', () => {
      const result = PrivacyGuard.mask(adversarialText);
      assertRoundtripInvariance(adversarialText, result);
    });

    it('handles high token density stress memo with multiple adjacent tokens', () => {
      const highDensityText =
        'Contact Alice Newman <alice@example.com> (+1-800-555-0199) in New York (Baker Street 221B) ' +
        'regarding fee $5,000.00 / 40k PLN / 300 CHF. ' +
        'Bank: de89370400440532013000, key: sk-abcdef0123456789abcdef0123456789.';

      const result = PrivacyGuard.mask(highDensityText);
      expect(result.tokens.length).toBeGreaterThanOrEqual(8);

      assertZeroRawPiiLeakage(result);
      assertRoundtripInvariance(highDensityText, result);
      assertSchemaCompliance(result);
    });

    it('correctly calculates HIGH risk level for adversarial high token density texts', () => {
      const result = PrivacyGuard.mask(adversarialText);
      expect(result.riskLevel).toBe('HIGH');
    });

    it('matches authoritative TOKEN_PATTERN syntax for all generated tokens', () => {
      const result = PrivacyGuard.mask(adversarialText);
      for (const token of result.tokens) {
        expect(token.token).toMatch(TOKEN_PATTERN);
      }
    });
  });
});
