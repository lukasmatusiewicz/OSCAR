import React, { useState, useEffect } from 'react';
import { Dashboard } from './views/Dashboard';
import { TaskBoard } from './views/TaskBoard';
import { useTasks } from './hooks/useTasks';
import { usePrivacyShield } from './hooks/usePrivacyShield';
import { PrivacyShieldBadge } from './components/atoms/PrivacyShieldBadge';
import { InstallPrompt } from './components/atoms/InstallPrompt';
import { Button } from './components/atoms/Button';
import { ClientCryptoService } from './services/ClientCryptoService';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'board'>('dashboard');
  const [simulateOffline, setSimulateOffline] = useState(false);

  const {
    tasks,
    decryptedPayloads,
    undecryptableIds,
    isLoading,
    fetchError,
    unsyncedIds,
    syncError,
    addTask,
    updateTaskStatus,
    updateTaskPriority,
    updateTaskPayload,
    deleteTask,
    fetchTasks,
    toggleSubtask,
    decryptAllTasks,
    clearDecryptedPayloads,
    draftsCount,
  } = useTasks();

  const {
    hasActiveKey,
    totalTokensMasked,
    tokensByType,
    sessionRiskLevel,
    recordMaskedTokens,
    logoutAndZeroKey,
    initializeKey,
  } = usePrivacyShield();

  useEffect(() => {
    // Automatically initialize ephemeral session key on app launch
    if (!ClientCryptoService.hasSessionKey()) {
      initializeKey();
    }
  }, [initializeKey]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const handleLockAndZero = () => {
    logoutAndZeroKey();
    clearDecryptedPayloads();
  };

  const handleInitKey = () => {
    initializeKey();
    void decryptAllTasks(tasks);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Application Header */}
      <header
        className="oscar-app-header"
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.02em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              🎙️ OSCAR
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: '#2563eb',
                  backgroundColor: '#eff6ff',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '4px',
                  border: '1px solid #bfdbfe',
                }}
              >
                CLIENT ENCLAVE
              </span>
            </h1>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
              Confidential AI Voice & Task Agent • Client-Side WebCrypto AES-256-GCM
            </p>
          </div>

          {/* Navigation Tabs */}
          <nav
            role="tablist"
            style={{
              display: 'flex',
              gap: '0.25rem',
              backgroundColor: '#f1f5f9',
              padding: '0.2rem',
              borderRadius: '8px',
              flexWrap: 'wrap',
            }}
          >
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
                boxShadow: activeTab === 'dashboard' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
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
                boxShadow: activeTab === 'board' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Task Board
            </button>
          </nav>
        </div>

        {/* Security Status Header Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            role="switch"
            aria-checked={simulateOffline}
            aria-label="Simulate Offline"
            data-testid="simulate-offline-toggle"
            onClick={() => setSimulateOffline((prev) => !prev)}
            style={{
              padding: '0.3rem 0.65rem',
              borderRadius: '9999px',
              border: `1px solid ${simulateOffline ? '#f59e0b' : '#cbd5e1'}`,
              backgroundColor: simulateOffline ? '#fef3c7' : '#f8fafc',
              color: simulateOffline ? '#92400e' : '#475569',
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
          <InstallPrompt />
          <PrivacyShieldBadge
            riskLevel={sessionRiskLevel}
            isSecured={hasActiveKey}
            tokenCount={totalTokensMasked}
          />

          {hasActiveKey ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleLockAndZero}
              aria-label="Logout and Zero Key"
              style={{ fontSize: '0.75rem', color: '#dc2626' }}
            >
              🔒 Lock & Zero Key
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={handleInitKey}
              style={{ fontSize: '0.75rem' }}
            >
              🔑 Init Session Key
            </Button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          padding: '1rem 0',
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        {activeTab === 'dashboard' ? (
          <Dashboard
            tasks={tasks}
            decryptedPayloads={decryptedPayloads}
            onTaskCreated={addTask}
            onStatusChange={updateTaskStatus}
            onPriorityChange={updateTaskPriority}
            onSubtaskToggle={toggleSubtask}
            onTaskUpdate={updateTaskPayload}
            onDelete={deleteTask}
            hasActiveKey={hasActiveKey}
            totalTokensMasked={totalTokensMasked}
            tokensByType={tokensByType}
            sessionRiskLevel={sessionRiskLevel}
            recordMaskedTokens={recordMaskedTokens}
            onLogoutAndZeroKey={handleLockAndZero}
            draftsCount={draftsCount}
            undecryptableIds={undecryptableIds}
            unsyncedIds={unsyncedIds}
            isLoadingTasks={isLoading}
            fetchError={fetchError}
            syncError={syncError}
            onRetryFetch={fetchTasks}
            simulateOffline={simulateOffline}
          />
        ) : (
          <TaskBoard
            tasks={tasks}
            decryptedPayloads={decryptedPayloads}
            isDecrypted={hasActiveKey}
            undecryptableIds={undecryptableIds}
            unsyncedIds={unsyncedIds}
            onStatusChange={updateTaskStatus}
            onPriorityChange={updateTaskPriority}
            onSubtaskToggle={toggleSubtask}
            onTaskUpdate={updateTaskPayload}
            onDelete={deleteTask}
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
          color: '#94a3b8',
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        OSCAR Confidential Computing • Zero Cleartext PII to Cloud • EU AI Act Articles 13 & 14
        Human Oversight Compliant
      </footer>
    </div>
  );
};

export default App;
