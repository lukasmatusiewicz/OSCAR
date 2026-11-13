import React from 'react';
import { RiskLevel } from '../../types/contracts';

export interface PrivacyShieldBadgeProps {
  riskLevel?: RiskLevel;
  isSecured?: boolean;
  tokenCount?: number;
  className?: string;
  onClick?: () => void;
}

export const PrivacyShieldBadge: React.FC<PrivacyShieldBadgeProps> = ({
  riskLevel = 'NONE',
  isSecured = true,
  tokenCount = 0,
  className = '',
  onClick,
}) => {
  const getRiskColor = (level: RiskLevel) => {
    switch (level) {
      case 'NONE':
        return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', label: 'No PII Detected' };
      case 'LOW':
        return { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', label: 'Protected' };
      case 'MEDIUM':
        return { bg: '#fffbeb', text: '#b45309', border: '#fde68a', label: 'Sanitized' };
      case 'HIGH':
        return {
          bg: '#fef2f2',
          text: '#b91c1c',
          border: '#fecaca',
          label: 'High Privacy Sensitivity',
        };
      default:
        return { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1', label: 'Shield Active' };
    }
  };

  const config = getRiskColor(riskLevel);

  return (
    <div
      role="status"
      aria-label={`Privacy Shield: ${isSecured ? 'Active' : 'Disabled'}, Risk: ${config.label}, Masked Tokens: ${tokenCount}`}
      onClick={onClick}
      className={`privacy-shield-badge ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.25rem 0.65rem',
        borderRadius: '9999px',
        backgroundColor: isSecured ? config.bg : '#f1f5f9',
        border: `1px solid ${isSecured ? config.border : '#cbd5e1'}`,
        color: isSecured ? config.text : '#64748b',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        userSelect: 'none',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '0.875rem' }}>
        {isSecured ? '🛡️' : '⚠️'}
      </span>
      <span>{isSecured ? config.label : 'Shield Offline'}</span>
      {tokenCount > 0 && (
        <span
          data-testid="privacy-shield-token-count"
          style={{
            backgroundColor: isSecured ? config.text : '#94a3b8',
            color: '#ffffff',
            borderRadius: '9999px',
            padding: '0.05rem 0.35rem',
            fontSize: '0.6875rem',
            fontWeight: 700,
          }}
        >
          {tokenCount}
        </span>
      )}
    </div>
  );
};
