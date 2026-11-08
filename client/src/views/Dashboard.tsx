import React from 'react';
import { MemoEditor } from '../components/organisms/MemoEditor';
import { TaskList } from '../components/organisms/TaskList';
import { PrivacyAuditPanel } from '../components/organisms/PrivacyAuditPanel';
import { useTasks } from '../hooks/useTasks';
import { usePrivacyShield } from '../hooks/usePrivacyShield';
import { useMemos } from '../hooks/useMemos';
import {
  TaskEntity,
  DecryptedTaskPayload,
  TaskPriority,
  TaskStatus,
  PIIType,
  RiskLevel,
} from '../types/contracts';

export interface DashboardProps {
  initialTasks?: TaskEntity[];
  initialDecrypted?: Record<string, DecryptedTaskPayload>;
  className?: string;
  tasks?: TaskEntity[];
  decryptedPayloads?: Record<string, DecryptedTaskPayload>;
  onTaskCreated?: (task: TaskEntity, decrypted?: DecryptedTaskPayload) => void;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onPriorityChange?: (taskId: string, newPriority: TaskPriority) => void;
  onSubtaskToggle?: (taskId: string, subtaskIndex: number, completed: boolean) => void;
  hasActiveKey?: boolean;
  totalTokensMasked?: number;
  tokensByType?: Partial<Record<PIIType, number>>;
  sessionRiskLevel?: RiskLevel;
  recordMaskedTokens?: (tokens: { type: PIIType }[]) => void;
  onLogoutAndZeroKey?: () => void;
  onInitializeKey?: (key?: Uint8Array | string) => void;
  draftsCount?: number;
}

export const Dashboard: React.FC<DashboardProps> = ({
  initialTasks = [],
  initialDecrypted = {},
  className = '',
  tasks: propTasks,
  decryptedPayloads: propDecryptedPayloads,
  onTaskCreated,
  onStatusChange,
  onPriorityChange,
  onSubtaskToggle,
  hasActiveKey: propHasActiveKey,
  totalTokensMasked: propTotalTokensMasked,
  tokensByType: propTokensByType,
  sessionRiskLevel: propSessionRiskLevel,
  recordMaskedTokens: propRecordMaskedTokens,
  onLogoutAndZeroKey,
  onInitializeKey,
  draftsCount: propDraftsCount,
}) => {
  // Always call fallback hooks unconditionally to satisfy React Rules of Hooks
  const fallbackTasks = useTasks(initialTasks);
  const fallbackShield = usePrivacyShield();

  // If props are passed, use them; otherwise gracefully fall back to internal hooks
  const tasks = propTasks !== undefined ? propTasks : fallbackTasks.tasks;
  const decryptedPayloads =
    propDecryptedPayloads !== undefined
      ? { ...initialDecrypted, ...propDecryptedPayloads }
      : { ...initialDecrypted, ...fallbackTasks.decryptedPayloads };
  const handleTaskCreated = onTaskCreated || fallbackTasks.addTask;
  const handleStatusChange = onStatusChange || fallbackTasks.updateTaskStatus;
  const handlePriorityChange = onPriorityChange || fallbackTasks.updateTaskPriority;
  const handleSubtaskToggle = onSubtaskToggle || fallbackTasks.toggleSubtask;
  const draftsCount =
    propDraftsCount !== undefined ? propDraftsCount : fallbackTasks.draftsCount;

  const hasActiveKey =
    propHasActiveKey !== undefined ? propHasActiveKey : fallbackShield.hasActiveKey;
  const totalTokensMasked =
    propTotalTokensMasked !== undefined ? propTotalTokensMasked : fallbackShield.totalTokensMasked;
  const tokensByType =
    propTokensByType !== undefined ? propTokensByType : fallbackShield.tokensByType;
  const sessionRiskLevel =
    propSessionRiskLevel !== undefined ? propSessionRiskLevel : fallbackShield.sessionRiskLevel;
  const recordMaskedTokens = propRecordMaskedTokens || fallbackShield.recordMaskedTokens;

  const handleLogout = () => {
    if (onLogoutAndZeroKey) {
      onLogoutAndZeroKey();
    } else {
      fallbackShield.logoutAndZeroKey();
      fallbackTasks.clearDecryptedPayloads();
    }
  };

  const handleInitKey = () => {
    if (onInitializeKey) {
      onInitializeKey();
    } else {
      fallbackShield.initializeKey();
    }
  };

  const { isSubmitting, submitMemo } = useMemos({
    onTaskCreated: (task, decrypted) => {
      handleTaskCreated(task, decrypted);
    },
    onTokensDetected: (tokens) => {
      recordMaskedTokens(tokens);
    },
  });

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
          decryptedPayloads={decryptedPayloads}
          isDecrypted={hasActiveKey}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          onSubtaskToggle={handleSubtaskToggle}
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
