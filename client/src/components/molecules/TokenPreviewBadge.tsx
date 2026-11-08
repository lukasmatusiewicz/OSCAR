import React from 'react';
import { PIIType } from '../../types/contracts';

export interface TokenPreviewBadgeProps {
  token: string;
  type: PIIType;
  className?: string;
}

const TYPE_CONFIG: Record<PIIType, { icon: string; label: string; color: string; bg: string }> = {
  SECRET_KEY: { icon: '🔑', label: 'Secret Key', color: '#dc2626', bg: '#fef2f2' },
  IBAN: { icon: '🏦', label: 'IBAN', color: '#b45309', bg: '#fffbeb' },
  EMAIL: { icon: '📧', label: 'Email', color: '#2563eb', bg: '#eff6ff' },
  PHONE: { icon: '📱', label: 'Phone', color: '#059669', bg: '#ecfdf5' },
  AMOUNT_MONEY: { icon: '💰', label: 'Amount', color: '#7c3aed', bg: '#f5f3ff' },
  PERSON: { icon: '👤', label: 'Person', color: '#d97706', bg: '#fffbeb' },
};

export const TokenPreviewBadge: React.FC<TokenPreviewBadgeProps> = ({
  token,
  type,
  className = '',
}) => {
  const cfg = TYPE_CONFIG[type] || { icon: '🔒', label: type, color: '#475569', bg: '#f1f5f9' };

  return (
    <span
      role="note"
      aria-label={`Sanitized Token: ${token} (${cfg.label})`}
      data-testid={`token-badge-${token.replace(/[[\]]/g, '')}`}
      className={`oscar-token-badge ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.15rem 0.45rem',
        borderRadius: '4px',
        backgroundColor: cfg.bg,
        border: `1px dashed ${cfg.color}`,
        color: cfg.color,
        fontSize: '0.75rem',
        fontFamily: 'monospace',
        fontWeight: 600,
        userSelect: 'none',
      }}
    >
      <span aria-hidden="true">{cfg.icon}</span>
      <span>{token}</span>
      <span style={{ fontSize: '0.65rem', opacity: 0.8, textTransform: 'uppercase' }}>
        [{cfg.label}]
      </span>
    </span>
  );
};
