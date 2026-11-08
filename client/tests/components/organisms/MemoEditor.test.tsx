import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoEditor, detectClientTokens } from '../../../src/components/organisms/MemoEditor';

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

  it('displays error message when submitted with empty content', async () => {
    const handleSubmit = vi.fn();
    render(<MemoEditor onSubmit={handleSubmit} />);

    const submitBtn = screen.getByRole('button', { name: /encrypt & process/i });
    // Clear input and submit
    fireEvent.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(/please enter a memo/i);
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
