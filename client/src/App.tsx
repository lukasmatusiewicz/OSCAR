import React, { useState, useEffect } from 'react';
import { Dashboard } from './views/Dashboard';
import { TaskBoard } from './views/TaskBoard';
import { useTasks } from './hooks/useTasks';
import { usePrivacyShield } from './hooks/usePrivacyShield';
import { InstallPrompt } from './components/atoms/InstallPrompt';
import { ClientCryptoService } from './services/ClientCryptoService';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'board'>('dashboard');
  const [simulateOffline, setSimulateOffline] = useState(false);

  const {
    hasActiveKey,
    totalTokensMasked,
    tokensByType,
    sessionRiskLevel,
    recordMaskedTokens,
    logoutAndZeroKey,
    initializeKey,
  } = usePrivacyShield();

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
  } = useTasks([], hasActiveKey);

  useEffect(() => {
    let cancelled = false;
    // Ensure ephemeral session key is initialized BEFORE fetching tasks on mount (F5 reload)
    const initializeAndHydrate = async () => {
      if (!ClientCryptoService.hasSessionKey()) {
        await initializeKey();
      }
      if (!cancelled) {
        await fetchTasks();
      }
    };
    void initializeAndHydrate();
    return () => {
      cancelled = true;
    };
  }, [initializeKey, fetchTasks]);

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
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#475569' }}>
              Confidential AI Voice & Task Agent • Client-Side WebCrypto AES-256-GCM
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <InstallPrompt />
        </div>
      </header>

      {/* Primary View Switcher Bar */}
      <div className="oscar-view-switcher-bar" data-testid="view-switcher-bar">
        <div className="oscar-view-switcher-inner" data-testid="view-switcher-inner">
          <nav aria-label="Primary navigation" className="oscar-nav-switcher">
            <button
              type="button"
              aria-current={activeTab === 'dashboard' ? 'page' : undefined}
              onClick={() => setActiveTab('dashboard')}
              className={`oscar-nav-pill${activeTab === 'dashboard' ? ' oscar-nav-pill--active' : ''}`}
            >
              Dashboard
            </button>
            <button
              type="button"
              aria-current={activeTab === 'board' ? 'page' : undefined}
              onClick={() => setActiveTab('board')}
              className={`oscar-nav-pill${activeTab === 'board' ? ' oscar-nav-pill--active' : ''}`}
            >
              Task Board
            </button>
          </nav>
        </div>
      </div>

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
            onInitializeKey={handleInitKey}
            draftsCount={draftsCount}
            undecryptableIds={undecryptableIds}
            unsyncedIds={unsyncedIds}
            isLoadingTasks={isLoading}
            fetchError={fetchError}
            syncError={syncError}
            onRetryFetch={fetchTasks}
            simulateOffline={simulateOffline}
            onToggleSimulateOffline={() => setSimulateOffline((prev) => !prev)}
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
          color: '#475569',
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
