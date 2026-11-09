import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoEditor, detectClientTokens, isGermanSteuerId } from '../../../src/components/organisms/MemoEditor';

describe('MemoEditor & detectClientTokens', () => {
  it('detectClientTokens identifies multiple PII types and assigns correct risk levels', () => {
    const text = 'Transfer $5000 to user@company.com with key sk-abcdef12345678901234567890 for Dr. John Smith';
    const result = detectClientTokens(text);
    expect(result.tokens.length).toBeGreaterThanOrEqual(4);
    expect(result.riskLevel).toBe('HIGH'); // contains SECRET_KEY

    const lowRiskText = 'Call +1 555-123-4567 later';
    const lowResult = detectClientTokens(lowRiskText);
    expect(lowResult.tokens.length).toBe(1);
    expect(lowResult.riskLevel).toBe('LOW');

    const zeroRiskText = 'Review quarterly release roadmap';
    const zeroResult = detectClientTokens(zeroRiskText);
    expect(zeroResult.tokens.length).toBe(0);
    expect(zeroResult.riskLevel).toBe('NONE');
  });

  it('detectClientTokens assigns MEDIUM risk level for financial tokens or 2+ tokens', () => {
    const medResult = detectClientTokens('Transfer $50 to colleague');
    expect(medResult.tokens.length).toBe(1);
    expect(medResult.riskLevel).toBe('MEDIUM');

    const twoTokensResult = detectClientTokens('Email alex@example.com or sam@example.com');
    expect(twoTokensResult.tokens.length).toBe(2);
    expect(twoTokensResult.riskLevel).toBe('MEDIUM');
  });

  it('renders editor, detects tokens in real time, and triggers onSubmit', async () => {
    const handleSubmit = vi.fn();
    render(<MemoEditor onSubmit={handleSubmit} />);

    const textarea = screen.getByLabelText(/confidential memo input/i);
    fireEvent.change(textarea, { target: { value: 'Send funds to test@example.com' } });

    // Token preview list should appear
    expect(await screen.findByTestId('memo-token-preview-list')).toBeInTheDocument();
    expect(screen.getByTestId('token-badge-EMAIL_1')).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /encrypt & process/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
      expect(handleSubmit).toHaveBeenCalledWith(
        'Send funds to test@example.com',
        expect.arrayContaining([expect.objectContaining({ type: 'EMAIL' })])
      );
    });
  });

  it('detectClientTokens accurately detects Polish honorifics and full capitalized names', () => {
    const textWithoutHonorific = 'Meeting with Jan Kowalski and Alice Wonderland';
    const resultNoHon = detectClientTokens(textWithoutHonorific);
    const personTokensNoHon = resultNoHon.tokens.filter((t) => t.type === 'PERSON');
    expect(personTokensNoHon.length).toBe(2);
    expect(personTokensNoHon[0].originalValue).toBe('Jan Kowalski');
    expect(personTokensNoHon[1].originalValue).toBe('Alice Wonderland');

    const textWithPolishHon = 'Kontakt do Pan Tomasz Nowak oraz dr Piotr Wiśniewski i mec. Anna Zielińska';
    const resultHon = detectClientTokens(textWithPolishHon);
    const personTokensHon = resultHon.tokens.filter((t) => t.type === 'PERSON');
    expect(personTokensHon.length).toBe(3);
    expect(personTokensHon.some((t) => t.originalValue.includes('Tomasz Nowak'))).toBe(true);
    expect(personTokensHon.some((t) => t.originalValue.includes('Piotr Wiśniewski'))).toBe(true);
    expect(personTokensHon.some((t) => t.originalValue.includes('Anna Zielińska'))).toBe(true);
  });

  it('detectClientTokens detects lowercase names after prepositions across Polish, German, French, and English', () => {
    // Polish
    const plRes = detectClientTokens('spotkanie z janem kowalskim');
    const plPerson = plRes.tokens.find((t) => t.type === 'PERSON');
    expect(plPerson).toBeDefined();
    expect(plPerson?.originalValue).toBe('janem kowalskim');
    expect(plPerson?.startIndex).toBe(12);
    expect(plPerson?.endIndex).toBe(27);

    // German
    const deRes = detectClientTokens('treffen mit hans müller');
    const dePerson = deRes.tokens.find((t) => t.type === 'PERSON');
    expect(dePerson).toBeDefined();
    expect(dePerson?.originalValue).toBe('hans müller');
    expect(dePerson?.startIndex).toBe(12);
    expect(dePerson?.endIndex).toBe(23);

    // French
    const frRes = detectClientTokens('rendez-vous avec jean dupont');
    const frPerson = frRes.tokens.find((t) => t.type === 'PERSON');
    expect(frPerson).toBeDefined();
    expect(frPerson?.originalValue).toBe('jean dupont');
    expect(frPerson?.startIndex).toBe(17);
    expect(frPerson?.endIndex).toBe(28);

    // English
    const enRes = detectClientTokens('meeting with john doe');
    const enPerson = enRes.tokens.find((t) => t.type === 'PERSON');
    expect(enPerson).toBeDefined();
    expect(enPerson?.originalValue).toBe('john doe');
    expect(enPerson?.startIndex).toBe(13);
    expect(enPerson?.endIndex).toBe(21);
  });

  it('detectClientTokens excludes Slavic, German, French, and English pronouns and reflexive stop-words from lowercase preposition NER', () => {
    const input = 'kawa z albertem szyszka. jego nr 123412412. note: wziąć ze sobą pasztet.';
    const res = detectClientTokens(input);

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
  });

  it('detectClientTokens detects compound German street names with str. and lowercase names', () => {
    const berlinerRes = detectClientTokens('berlinerstr. 123');
    const berlinerToken = berlinerRes.tokens.find((t) => t.type === 'ADDRESS');
    expect(berlinerToken).toBeDefined();
    expect(berlinerToken?.originalValue).toBe('berlinerstr. 123');
    expect(berlinerToken?.startIndex).toBe(0);
    expect(berlinerToken?.endIndex).toBe(16);

    const hauptRes = detectClientTokens('Termin in hauptstr. 5');
    const hauptToken = hauptRes.tokens.find((t) => t.type === 'ADDRESS');
    expect(hauptToken).toBeDefined();
    expect(hauptToken?.originalValue).toBe('hauptstr. 5');

    // Combined detection
    const comboRes = detectClientTokens('spotkanie z janem kowalskim, berlinerstr. 123');
    const comboPerson = comboRes.tokens.find((t) => t.type === 'PERSON');
    const comboAddress = comboRes.tokens.find((t) => t.type === 'ADDRESS');
    expect(comboPerson?.originalValue).toBe('janem kowalskim');
    expect(comboAddress?.originalValue).toBe('berlinerstr. 123');
  });

  it('detectClientTokens accurately detects 9-digit, formatted, and international phone numbers', () => {
    const phoneText = 'Direct line: +48 123 456 789 or mobile 500-600-700 or US (555) 123-4567';
    const result = detectClientTokens(phoneText);
    const phoneTokens = result.tokens.filter((t) => t.type === 'PHONE');
    expect(phoneTokens.length).toBeGreaterThanOrEqual(3);
  });

  it('detectClientTokens accurately detects flexible multi-currency formats', () => {
    const moneyText = 'Invoices: 1500 PLN, 2500 zł, 5000 złotych, $450, € 120.50, 300 CHF, and 100 euro';
    const result = detectClientTokens(moneyText);
    const moneyTokens = result.tokens.filter((t) => t.type === 'AMOUNT_MONEY');
    expect(moneyTokens.length).toBeGreaterThanOrEqual(7);
  });

  it('detectClientTokens accurately detects street addresses and international cities', () => {
    const addressText = 'Visit our office at ul. Marszałkowska 10 or Friedrichstraße 42 or Baker Street 221B in Berlin and Paris.';
    const result = detectClientTokens(addressText);
    const addressTokens = result.tokens.filter((t) => t.type === 'ADDRESS');
    expect(addressTokens.length).toBeGreaterThanOrEqual(5);
    expect(result.riskLevel).toBe('HIGH');
  });

  it('detectClientTokens accurately detects NATIONAL_ID (PESEL, German Steuer-ID, SSN)', () => {
    // Polish PESEL with valid checksum
    const peselText = 'PESEL pacjenta: 44051401359 do dokumentacji';
    const peselResult = detectClientTokens(peselText);
    const peselTokens = peselResult.tokens.filter((t) => t.type === 'NATIONAL_ID');
    expect(peselTokens.length).toBe(1);
    expect(peselTokens[0].originalValue).toBe('44051401359');
    expect(peselResult.riskLevel).toBe('HIGH');

    // German Steuer-ID formatted & SSN
    const govIdText = 'German Steuer-ID 03 245 678 912 and US SSN 123-45-6789';
    const govResult = detectClientTokens(govIdText);
    const govTokens = govResult.tokens.filter((t) => t.type === 'NATIONAL_ID');
    expect(govTokens.length).toBe(2);
    expect(govTokens.some((t) => t.originalValue === '03 245 678 912')).toBe(true);
    expect(govTokens.some((t) => t.originalValue === '123-45-6789')).toBe(true);
    expect(govResult.riskLevel).toBe('HIGH');
  });

  it('detectClientTokens accurately detects HEALTH_DATA (KVNR, diagnoses, Tier 3 context matcher)', () => {
    // German KVNR and diagnoses
    const healthText = 'Patient KVNR A123456789, diagnoza: cukrzyca, oraz Diagnose: Hypertonie';
    const healthResult = detectClientTokens(healthText);
    const healthTokens = healthResult.tokens.filter((t) => t.type === 'HEALTH_DATA');
    expect(healthTokens.length).toBeGreaterThanOrEqual(3);
    expect(healthTokens.some((t) => t.originalValue === 'A123456789')).toBe(true);
    expect(healthResult.riskLevel).toBe('HIGH');

    // Tier 3 context matcher with insurance keywords
    const policyText = 'Numer polisy ubezpieczenia POL-987654321 dla pacjenta';
    const policyResult = detectClientTokens(policyText);
    const policyTokens = policyResult.tokens.filter((t) => t.type === 'HEALTH_DATA');
    expect(policyTokens.length).toBe(1);
    expect(policyTokens[0].originalValue).toBe('POL-987654321');
  });

  it('detectClientTokens accurately detects Tier 3 context matcher for NATIONAL_ID and validates ID functions', () => {
    // Tier 3 national ID context keywords
    const idText = 'Numer dokumentu tożsamości dowód ID-987654321 dla urzędu';
    const idResult = detectClientTokens(idText);
    const idTokens = idResult.tokens.filter((t) => t.type === 'NATIONAL_ID');
    expect(idTokens.length).toBe(1);
    expect(idTokens[0].originalValue).toBe('ID-987654321');

    // Edge cases for validation functions
    const invalidPeselResult = detectClientTokens('Błędny PESEL: 12345678901 oraz 123');
    expect(invalidPeselResult.tokens.filter((t) => t.type === 'NATIONAL_ID').length).toBe(0);

    const invalidSsnResult = detectClientTokens('Invalid SSNs: 000-12-3456, 666-12-3456, 950-12-3456, 123-00-1234, 123-45-0000');
    expect(invalidSsnResult.tokens.filter((t) => t.type === 'NATIONAL_ID').length).toBe(0);
  });

  it('displays error message when onSubmit throws an error', async () => {
    const handleSubmit = vi.fn().mockRejectedValue(new Error('Network encryption failed'));
    render(<MemoEditor onSubmit={handleSubmit} />);

    const textarea = screen.getByLabelText(/confidential memo input/i);
    fireEvent.change(textarea, { target: { value: 'Valid memo content to submit' } });

    const submitBtn = screen.getByRole('button', { name: /encrypt & process/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network encryption failed');
    });
  });

  it('displays error message when submitted with empty content', async () => {
    const handleSubmit = vi.fn();
    render(<MemoEditor onSubmit={handleSubmit} />);

    const submitBtn = screen.getByRole('button', { name: /encrypt & process/i });
    // Clear input and submit
    fireEvent.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(/please enter a memo/i);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('handles non-Error rejection in handleSubmit with default fallback message', async () => {
    const handleSubmit = vi.fn().mockRejectedValue('String rejection error');
    render(<MemoEditor onSubmit={handleSubmit} />);

    const textarea = screen.getByLabelText(/confidential memo input/i);
    fireEvent.change(textarea, { target: { value: 'Valid memo' } });

    const submitBtn = screen.getByRole('button', { name: /encrypt & process/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to submit memo');
    });
  });

  it('detectClientTokens handles German Steuer-ID variations, phone exclusion, and unformatted tax context', () => {
    // Leading + phone exclusion in isGermanSteuerId
    expect(isGermanSteuerId('03 245 678 912', '+03 245 678 912', 1)).toBe(false);
    expect(isGermanSteuerId('03 245 678 912', ' 03 245 678 912', 1)).toBe(true);

    // Unformatted 11-digit number near tax keyword (matching peselRegex but valid German Steuer-ID)
    const unformattedSteuer = 'Steuer-ID 11234567890 für das Finanzamt';
    const steuerRes = detectClientTokens(unformattedSteuer);
    expect(steuerRes.tokens.some((t) => t.type === 'NATIONAL_ID')).toBe(true);

    // Number starting with 0 in clean[0] === '0' and no tax context
    expect(isGermanSteuerId('01234567890', 'Ref: 01234567890', 5)).toBe(false);

    // Clean number with multiple repeated digits (invalid Steuer-ID)
    expect(isGermanSteuerId('11224567890', 'Ref: 11224567890', 5)).toBe(false);

    // Clean number with no repeated digits (invalid Steuer-ID)
    expect(isGermanSteuerId('12345678901', 'Ref: 12345678901', 5)).toBe(false);
  });

  it('detectClientTokens handles German, French, and English stop words in lowercase preposition patterns', () => {
    // German stop words / pronouns
    const deRes = detectClientTokens('treffen mit mir dir und bei uns euch');
    expect(deRes.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

    // French stop words / pronouns
    const frRes = detectClientTokens('rendez-vous avec moi toi et pour lui elle');
    expect(frRes.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

    // English stop words / pronouns
    const enRes = detectClientTokens('meeting with him her and for us them');
    expect(enRes.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

    // International cities after prepositions
    const cityRes = detectClientTokens('treffen mit Berlin und rendez-vous avec Paris und meeting with London');
    expect(cityRes.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);
  });

  it('detectClientTokens handles Tier 3 context matcher for candidate IDs with and without digits', () => {
    // Candidate ID without digits is skipped
    const textNoDigits = 'ubezpieczenie POLISABEZCYFR dla klienta';
    const resNoDigits = detectClientTokens(textNoDigits);
    expect(resNoDigits.tokens.filter((t) => t.type === 'HEALTH_DATA')).toHaveLength(0);

    // Candidate ID near German insurance keyword krankenkasse
    const deHealthText = 'versichert bei krankenkasse TK-987654321';
    const deHealthRes = detectClientTokens(deHealthText);
    expect(deHealthRes.tokens.some((t) => t.type === 'HEALTH_DATA')).toBe(true);

    // Candidate ID near German national ID keyword personalausweis
    const deNatText = 'personalausweis PA-123456789';
    const deNatRes = detectClientTokens(deNatText);
    expect(deNatRes.tokens.some((t) => t.type === 'NATIONAL_ID')).toBe(true);
  });

  it('detectClientTokens comprehensively assigns all risk levels', () => {
    // Single ADDRESS token -> MEDIUM
    const addrRes = detectClientTokens('Visit Berlin tomorrow');
    expect(addrRes.riskLevel).toBe('MEDIUM');

    // Single AMOUNT_MONEY token -> MEDIUM
    const moneyRes = detectClientTokens('Price is 500 EUR');
    expect(moneyRes.riskLevel).toBe('MEDIUM');

    // 3 or more non-high risk tokens -> HIGH
    const threeTokens = detectClientTokens('Contact a@b.com or c@d.com or e@f.com');
    expect(threeTokens.tokens.length).toBe(3);
    expect(threeTokens.riskLevel).toBe('HIGH');
  });

  it('detects single-word names after prepositions (markiem, beatą) and rejects non-names (mlekiem, sobą)', () => {
    // Single name detection
    const marekRes = detectClientTokens('kawa z markiem o 12:00');
    const marekToken = marekRes.tokens.find((t) => t.type === 'PERSON');
    expect(marekToken).toBeDefined();
    expect(marekToken?.originalValue).toBe('markiem');

    const beataRes = detectClientTokens('spotkanie z beatą');
    const beataToken = beataRes.tokens.find((t) => t.type === 'PERSON');
    expect(beataToken).toBeDefined();
    expect(beataToken?.originalValue).toBe('beatą');

    // Single non-name / pronoun rejection
    const sobaRes = detectClientTokens('kawa ze sobą');
    expect(sobaRes.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);

    const mlekoRes = detectClientTokens('kawa z mlekiem');
    expect(mlekoRes.tokens.filter((t) => t.type === 'PERSON')).toHaveLength(0);
  });
});
