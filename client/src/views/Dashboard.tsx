import React from 'react';
import { MemoEditor } from '../components/organisms/MemoEditor';
import { TaskList } from '../components/organisms/TaskList';
import { PrivacyAuditPanel } from '../components/organisms/PrivacyAuditPanel';
import { useTasks } from '../hooks/useTasks';
import { usePrivacyShield } from '../hooks/usePrivacyShield';
import { useMemos } from '../hooks/useMemos';
import { TaskEntity, DecryptedTaskPayload } from '../types/contracts';

export interface DashboardProps {
  initialTasks?: TaskEntity[];
  initialDecrypted?: Record<string, DecryptedTaskPayload>;
  className?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({
  initialTasks = [],
  initialDecrypted = {},
  className = '',
}) => {
  const {
    tasks,
    decryptedPayloads,
    addTask,
    updateTaskStatus,
    updateTaskPriority,
    toggleSubtask,
    clearDecryptedPayloads,
    draftsCount,
  } = useTasks(initialTasks);

  const {
    hasActiveKey,
    totalTokensMasked,
    tokensByType,
    sessionRiskLevel,
    recordMaskedTokens,
    logoutAndZeroKey,
    initializeKey,
  } = usePrivacyShield();

  const { isSubmitting, submitMemo } = useMemos({
    onTaskCreated: (task, decrypted) => {
      addTask(task, decrypted);
    },
    onTokensDetected: (tokens) => {
      recordMaskedTokens(tokens);
    },
  });

  const handleLogout = () => {
    logoutAndZeroKey();
    clearDecryptedPayloads();
  };

  const handleInitKey = () => {
    initializeKey();
  };

  return (
    <div
      className={`oscar-dashboard-view ${className}`.trim()}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 340px',
        gap: '1.5rem',
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '1rem',
        boxSizing: 'border-box',
      }}
    >
      {/* Main Content Area: MemoEditor + TaskList */}
      <main style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
        {/* Key Activation Alert if logged out */}
        {!hasActiveKey && (
          <div
            role="alert"
            style={{
              padding: '1rem',
              borderRadius: '8px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <strong style={{ color: '#991b1b', display: 'block' }}>
                Ephemeral Key Memory Cleared
              </strong>
              <span style={{ fontSize: '0.8125rem', color: '#b91c1c' }}>
                Key buffer zeroed. Initialize a fresh session key to encrypt memos and decrypt
                sensitive tasks.
              </span>
            </div>
            <button
              type="button"
              onClick={handleInitKey}
              style={{
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.4rem 0.8rem',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Generate Session Key
            </button>
          </div>
        )}

        <MemoEditor onSubmit={submitMemo} isLoading={isSubmitting} />

        <TaskList
          tasks={tasks}
          decryptedPayloads={{ ...initialDecrypted, ...decryptedPayloads }}
          isDecrypted={hasActiveKey}
          onStatusChange={updateTaskStatus}
          onPriorityChange={updateTaskPriority}
          onSubtaskToggle={toggleSubtask}
        />
      </main>

      {/* Sidebar: Privacy Audit Panel */}
      <aside style={{ minWidth: '300px' }}>
        <div style={{ position: 'sticky', top: '1rem' }}>
          <PrivacyAuditPanel
            metrics={{
              totalTokensMasked,
              tokensByType,
              sessionRiskLevel,
              hasActiveKey,
              draftsAwaitingReviewCount: draftsCount,
            }}
            onLogoutAndZeroKey={handleLogout}
          />
        </div>
      </aside>
    </div>
  );
};
