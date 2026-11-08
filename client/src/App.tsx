import React, { useState, useEffect } from 'react';
import { Dashboard } from './views/Dashboard';
import { TaskBoard } from './views/TaskBoard';
import { useTasks } from './hooks/useTasks';
import { usePrivacyShield } from './hooks/usePrivacyShield';
import { PrivacyShieldBadge } from './components/atoms/PrivacyShieldBadge';
import { Button } from './components/atoms/Button';
import { ClientCryptoService } from './services/ClientCryptoService';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'board'>('dashboard');

  const {
    tasks,
    decryptedPayloads,
    updateTaskStatus,
    updateTaskPriority,
    toggleSubtask
  } = useTasks();

  const {
    hasActiveKey,
    sessionRiskLevel,
    totalTokensMasked,
    logoutAndZeroKey,
    initializeKey
  } = usePrivacyShield();

  useEffect(() => {
    // Automatically initialize ephemeral session key on app launch
    if (!ClientCryptoService.hasSessionKey()) {
      initializeKey();
    }
  }, [initializeKey]);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a', display: 'flex', flexDirection: 'column' }}>
      {/* Top Application Header */}
      <header
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              🎙️ OSCAR
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#2563eb', backgroundColor: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid #bfdbfe' }}>
                CLIENT ENCLAVE
              </span>
            </h1>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
              Confidential AI Voice & Task Agent • Client-Side WebCrypto AES-256-GCM
            </p>
          </div>

          {/* Navigation Tabs */}
          <nav role="tablist" style={{ display: 'flex', gap: '0.25rem', backgroundColor: '#f1f5f9', padding: '0.2rem', borderRadius: '8px' }}>
            <button
              role="tab"
              aria-selected={activeTab === 'dashboard'}
              onClick={() => setActiveTab('dashboard')}
              style={{
                border: 'none',
                backgroundColor: activeTab === 'dashboard' ? '#ffffff' : 'transparent',
                color: activeTab === 'dashboard' ? '#0f172a' : '#64748b',
                fontWeight: activeTab === 'dashboard' ? 700 : 500,
                padding: '0.35rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                boxShadow: activeTab === 'dashboard' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              Dashboard
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'board'}
              onClick={() => setActiveTab('board')}
              style={{
                border: 'none',
                backgroundColor: activeTab === 'board' ? '#ffffff' : 'transparent',
                color: activeTab === 'board' ? '#0f172a' : '#64748b',
                fontWeight: activeTab === 'board' ? 700 : 500,
                padding: '0.35rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                boxShadow: activeTab === 'board' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              Task Board
            </button>
          </nav>
        </div>

        {/* Security Status Header Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <PrivacyShieldBadge
            riskLevel={sessionRiskLevel}
            isSecured={hasActiveKey}
            tokenCount={totalTokensMasked}
          />

          {hasActiveKey ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={logoutAndZeroKey}
              aria-label="Logout and Zero Key"
              style={{ fontSize: '0.75rem', color: '#dc2626' }}
            >
              🔒 Lock & Zero Key
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => initializeKey()}
              style={{ fontSize: '0.75rem' }}
            >
              🔑 Init Session Key
            </Button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div style={{ flex: 1, padding: '1rem 0' }}>
        {activeTab === 'dashboard' ? (
          <Dashboard />
        ) : (
          <TaskBoard
            tasks={tasks}
            decryptedPayloads={decryptedPayloads}
            isDecrypted={hasActiveKey}
            onStatusChange={updateTaskStatus}
            onPriorityChange={updateTaskPriority}
            onSubtaskToggle={toggleSubtask}
          />
        )}
      </div>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid #e2e8f0',
          backgroundColor: '#ffffff',
          padding: '0.75rem 1.5rem',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: '#94a3b8'
        }}
      >
        OSCAR Confidential Computing • Zero Cleartext PII to Cloud • EU AI Act Articles 13 & 14 Human Oversight Compliant
      </footer>
    </div>
  );
};

export default App;
