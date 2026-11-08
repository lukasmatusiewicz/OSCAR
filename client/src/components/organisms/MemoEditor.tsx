import React, { useState, useMemo } from 'react';
import { PIITokenMap, PIIType, RiskLevel } from '../../types/contracts';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { PrivacyShieldBadge } from '../atoms/PrivacyShieldBadge';
import { TokenPreviewBadge } from '../molecules/TokenPreviewBadge';

export interface MemoEditorProps {
  onSubmit: (content: string, tokens: PIITokenMap[]) => Promise<unknown> | unknown;
  isLoading?: boolean;
  className?: string;
  placeholder?: string;
}

export function detectClientTokens(text: string): { tokens: PIITokenMap[]; riskLevel: RiskLevel } {
  const tokens: PIITokenMap[] = [];
  let tokenIndex = 1;

  const patterns: { type: PIIType; regex: RegExp }[] = [
    {
      type: 'SECRET_KEY',
      regex:
        /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35}|[0-9a-fA-F]{32,64})/g,
    },
    { type: 'IBAN', regex: /[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}(?:[A-Z0-9]{0,16})/g },
    { type: 'EMAIL', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
    { type: 'PHONE', regex: /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
    {
      type: 'AMOUNT_MONEY',
      regex:
        /(?:[$€£¥]\s*\d+(?:,\d{3})*(?:\.\d{2})?|\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|GBP|PLN))/g,
    },
    { type: 'PERSON', regex: /(?:Mr\.|Mrs\.|Ms\.|Dr\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g },
  ];

  for (const { type, regex } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      tokens.push({
        token: `[${type}_${tokenIndex++}]`,
        type,
        originalValue: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  // Calculate risk level based on token presence
  let riskLevel: RiskLevel = 'NONE';
  if (tokens.length > 0) {
    const hasSecret = tokens.some((t) => t.type === 'SECRET_KEY');
    const hasFinancial = tokens.some((t) => t.type === 'IBAN' || t.type === 'AMOUNT_MONEY');
    if (hasSecret || tokens.length >= 5) {
      riskLevel = 'HIGH';
    } else if (hasFinancial || tokens.length >= 2) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }
  }

  return { tokens, riskLevel };
}

export const MemoEditor: React.FC<MemoEditorProps> = ({
  onSubmit,
  isLoading = false,
  className = '',
  placeholder = 'Speak or type your memo... Confidential details (emails, phone numbers, keys, financial data) are client-side shielded before transmission.',
}) => {
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { tokens, riskLevel } = useMemo(() => detectClientTokens(content), [content]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      setError('Please enter a memo before submitting.');
      return;
    }
    setError(null);
    try {
      await onSubmit(content, tokens);
      setContent('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit memo');
    }
  };

  return (
    <div
      className={`oscar-memo-editor ${className}`.trim()}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '1.25rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
          📝 New Confidential Voice/Text Memo
        </h3>
        <PrivacyShieldBadge riskLevel={riskLevel} isSecured={true} tokenCount={tokens.length} />
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
      >
        <Input
          isTextArea
          rows={4}
          placeholder={placeholder}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            if (error) setError(null);
          }}
          disabled={isLoading}
          error={error || undefined}
          aria-label="Confidential Memo Input"
        />

        {tokens.length > 0 && (
          <div
            data-testid="memo-token-preview-list"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
              padding: '0.5rem 0.75rem',
              backgroundColor: '#f8fafc',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
              Client Privacy Guard Shield Active ({tokens.length} tokens protected):
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {tokens.map((tok, i) => (
                <TokenPreviewBadge key={`${tok.token}-${i}`} token={tok.token} type={tok.type} />
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '0.25rem',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {content.length} characters • AES-256-GCM envelope
          </span>
          <Button type="submit" variant="primary" isLoading={isLoading} disabled={isLoading}>
            Encrypt & Process
          </Button>
        </div>
      </form>
    </div>
  );
};
