import React, { useEffect, useId, useRef, useState } from 'react';
import { PIIType, RiskLevel } from '../../types/contracts';
import { Button } from '../atoms/Button';
import { PrivacyShieldBadge } from '../atoms/PrivacyShieldBadge';

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
  onInitializeKey?: () => void;
  simulateOffline?: boolean;
  onToggleSimulateOffline?: () => void;
  className?: string;
}

export const PrivacyAuditPanel: React.FC<PrivacyAuditPanelProps> = ({
  metrics,
  onLogoutAndZeroKey,
  onInitializeKey,
  simulateOffline = false,
  onToggleSimulateOffline,
  className = '',
}) => {
  const piiTypes: PIIType[] = ['SECRET_KEY', 'IBAN', 'EMAIL', 'PHONE', 'AMOUNT_MONEY', 'PERSON'];
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const warningId = useId();
  const controlsRef = useRef<HTMLDivElement>(null);
  const wasConfirmingRef = useRef(false);

  useEffect(() => {
    if (!metrics.hasActiveKey && isConfirmingLogout) {
      setIsConfirmingLogout(false);
    }
  }, [metrics.hasActiveKey, isConfirmingLogout]);

  useEffect(() => {
    if (isConfirmingLogout && metrics.hasActiveKey) {
      wasConfirmingRef.current = true;
      controlsRef.current
        ?.querySelector<HTMLButtonElement>('[data-testid="cancel-lock-key-btn"]')
        ?.focus();
    } else if (wasConfirmingRef.current && !isConfirmingLogout) {
      wasConfirmingRef.current = false;
      if (metrics.hasActiveKey) {
        controlsRef.current
          ?.querySelector<HTMLButtonElement>('[data-testid="logout-zero-key-btn"]')
          ?.focus();
      }
    }
  }, [isConfirmingLogout, metrics.hasActiveKey]);

  const handleConfirmLockAndZero = () => {
    setIsConfirmingLogout(false);
    onLogoutAndZeroKey();
  };

  const handleCancelLockAndZero = () => {
    setIsConfirmingLogout(false);
  };

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
        <PrivacyShieldBadge
          riskLevel={metrics.sessionRiskLevel}
          isSecured={metrics.hasActiveKey}
          tokenCount={metrics.totalTokensMasked}
        />
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
          <span style={{ fontSize: '0.7rem', color: '#475569' }}>Ephemeral Session</span>
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

      {/* Session & Demo Controls */}
      <div
        ref={controlsRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
          marginTop: 'auto',
          paddingTop: '0.65rem',
          borderTop: '1px solid #e2e8f0',
          minWidth: 0,
          width: '100%',
        }}
      >
        {onToggleSimulateOffline && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
              padding: '0.45rem 0.6rem',
              backgroundColor: '#f8fafc',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155' }}>
              Network Mode
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={simulateOffline}
              aria-label="Simulate Offline"
              data-testid="simulate-offline-toggle"
              onClick={onToggleSimulateOffline}
              style={{
                padding: '0.3rem 0.65rem',
                borderRadius: '9999px',
                border: `1px solid ${simulateOffline ? '#d97706' : '#cbd5e1'}`,
                backgroundColor: simulateOffline ? '#fef3c7' : '#ffffff',
                color: simulateOffline ? '#92400e' : '#334155',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <span aria-hidden="true">{simulateOffline ? '⚡' : '🌐'}</span>
              <span>{simulateOffline ? 'Simulated Offline' : 'Simulate Offline'}</span>
            </button>
          </div>
        )}

        {metrics.hasActiveKey ? (
          isConfirmingLogout ? (
            <div
              role="alertdialog"
              aria-label="Confirm session key lock"
              aria-describedby={warningId}
              data-testid="lock-confirm-dialog"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  handleCancelLockAndZero();
                }
              }}
              style={{
                padding: '0.75rem',
                borderRadius: '8px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
                minWidth: 0,
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              <p
                id={warningId}
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  lineHeight: 1.45,
                  fontWeight: 500,
                  color: '#991b1b',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                }}
              >
                Warning: Clearing the session key is irreversible. Current tasks encrypted with
                this key will become undecryptable.
              </p>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  justifyContent: 'flex-end',
                  width: '100%',
                }}
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="cancel-lock-key-btn"
                  onClick={handleCancelLockAndZero}
                  style={{ flex: '1 1 auto' }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  data-testid="confirm-lock-key-btn"
                  onClick={handleConfirmLockAndZero}
                  style={{ flex: '1 1 auto' }}
                >
                  Confirm Lock &amp; Zero
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="danger"
              size="sm"
              data-testid="logout-zero-key-btn"
              onClick={() => setIsConfirmingLogout(true)}
              aria-label="Zero Session Key & Logout"
            >
              🧹 Zero Session Key & Logout
            </Button>
          )
        ) : (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onInitializeKey}
            disabled={!onInitializeKey}
            aria-label="Init Session Key"
          >
            🔑 Init Session Key
          </Button>
        )}
        <span style={{ fontSize: '0.6875rem', color: '#475569', textAlign: 'center' }}>
          Guaranteed client memory zeroing (keyBuffer.fill(0))
        </span>
      </div>
    </aside>
  );
};
