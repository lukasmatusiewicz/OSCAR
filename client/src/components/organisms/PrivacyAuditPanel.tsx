import React from 'react';
import { PIIType, RiskLevel } from '../../types/contracts';
import { Button } from '../atoms/Button';

export interface PrivacyMetrics {
  totalTokensMasked: number;
  tokensByType: Partial<Record<PIIType, number>>;
  sessionRiskLevel: RiskLevel;
  hasActiveKey: boolean;
  draftsAwaitingReviewCount?: number;
}

export interface PrivacyAuditPanelProps {
  metrics: PrivacyMetrics;
  onLogoutAndZeroKey: () => void;
  className?: string;
}

export const PrivacyAuditPanel: React.FC<PrivacyAuditPanelProps> = ({
  metrics,
  onLogoutAndZeroKey,
  className = '',
}) => {
  const piiTypes: PIIType[] = ['SECRET_KEY', 'IBAN', 'EMAIL', 'PHONE', 'AMOUNT_MONEY', 'PERSON'];

  return (
    <aside
      aria-label="Privacy and Security Audit Panel"
      className={`oscar-privacy-audit-panel ${className}`.trim()}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '1.25rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        minWidth: 0,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.25rem' }}>🛡️</span>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
            Privacy Shield & Audit
          </h3>
        </div>
      </div>

      {/* Security Status Box */}
      <div
        data-testid="security-status-box"
        style={{
          padding: '0.75rem',
          backgroundColor: metrics.hasActiveKey ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${metrics.hasActiveKey ? '#bbf7d0' : '#fecaca'}`,
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.25rem',
          }}
        >
          <span
            style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: metrics.hasActiveKey ? '#166534' : '#991b1b',
            }}
          >
            {metrics.hasActiveKey ? '🟢 WebCrypto AES-256-GCM Active' : '🔴 No Active Session Key'}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Ephemeral Session</span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: '0.75rem',
            color: metrics.hasActiveKey ? '#15803d' : '#b91c1c',
          }}
        >
          {metrics.hasActiveKey
            ? 'Sensitive task content is envelope-encrypted on-device before sync. Zero cleartext PII reaches Firestore.'
            : 'Key is not initialized or memory has been cleared.'}
        </p>
      </div>

      {/* Masking Telemetry */}
      <div>
        <h4
          style={{
            margin: '0 0 0.5rem 0',
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: '#475569',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Masked PII Occurrences ({metrics.totalTokensMasked} Total)
        </h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '0.5rem',
          }}
        >
          {piiTypes.map((type) => {
            const count = metrics.tokensByType[type] || 0;
            return (
              <div
                key={type}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.35rem 0.5rem',
                  backgroundColor: '#f8fafc',
                  borderRadius: '6px',
                  border: '1px solid #f1f5f9',
                  fontSize: '0.75rem',
                }}
              >
                <span style={{ color: '#475569', fontWeight: 500 }}>{type}</span>
                <span
                  data-testid={`metric-${type.toLowerCase()}`}
                  style={{
                    fontWeight: 700,
                    color: count > 0 ? '#2563eb' : '#475569',
                  }}
                >
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Human Oversight Compliance Card */}
      {metrics.draftsAwaitingReviewCount !== undefined && metrics.draftsAwaitingReviewCount > 0 && (
        <div
          data-testid="drafts-review-alert"
          style={{
            padding: '0.6rem 0.75rem',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '6px',
            fontSize: '0.75rem',
            color: '#92400e',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.25rem',
          }}
        >
          <span>
            ⚖️ <strong>Drafts Pending Review:</strong>
          </span>
          <span
            style={{
              fontWeight: 700,
              backgroundColor: '#fef3c7',
              padding: '0.1rem 0.4rem',
              borderRadius: '4px',
            }}
          >
            {metrics.draftsAwaitingReviewCount}
          </span>
        </div>
      )}

      {/* Memory Zeroing Action */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          marginTop: 'auto',
          paddingTop: '0.5rem',
          borderTop: '1px solid #f1f5f9',
        }}
      >
        <Button
          variant="danger"
          size="sm"
          onClick={onLogoutAndZeroKey}
          disabled={!metrics.hasActiveKey}
          aria-label="Zero Session Key & Logout"
        >
          🧹 Zero Session Key & Logout
        </Button>
        <span style={{ fontSize: '0.6875rem', color: '#475569', textAlign: 'center' }}>
          Guaranteed client memory zeroing (keyBuffer.fill(0))
        </span>
      </div>
    </aside>
  );
};
