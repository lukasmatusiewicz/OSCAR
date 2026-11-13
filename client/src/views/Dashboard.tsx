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
  onTaskUpdate?: (taskId: string, updatedPayload: DecryptedTaskPayload) => void;
  onDelete?: (taskId: string) => void;
  hasActiveKey?: boolean;
  totalTokensMasked?: number;
  tokensByType?: Partial<Record<PIIType, number>>;
  sessionRiskLevel?: RiskLevel;
  recordMaskedTokens?: (tokens: { type: PIIType }[]) => void;
  onLogoutAndZeroKey?: () => void;
  onInitializeKey?: (key?: Uint8Array | string) => void;
  draftsCount?: number;
  undecryptableIds?: Record<string, boolean>;
  unsyncedIds?: Record<string, boolean>;
  isLoadingTasks?: boolean;
  fetchError?: string | null;
  syncError?: string | null;
  onRetryFetch?: () => void;
  simulateOffline?: boolean;
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
  onTaskUpdate,
  onDelete,
  hasActiveKey: propHasActiveKey,
  totalTokensMasked: propTotalTokensMasked,
  tokensByType: propTokensByType,
  sessionRiskLevel: propSessionRiskLevel,
  recordMaskedTokens: propRecordMaskedTokens,
  onLogoutAndZeroKey,
  onInitializeKey,
  draftsCount: propDraftsCount,
  undecryptableIds: propUndecryptableIds,
  unsyncedIds: propUnsyncedIds,
  isLoadingTasks: propIsLoadingTasks,
  fetchError: propFetchError,
  syncError: propSyncError,
  onRetryFetch,
  simulateOffline = false,
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
  const handleTaskUpdate = onTaskUpdate || fallbackTasks.updateTaskPayload;
  const handleDelete = onDelete || fallbackTasks.deleteTask;
  const draftsCount =
    propDraftsCount !== undefined ? propDraftsCount : fallbackTasks.draftsCount;
  const undecryptableIds =
    propUndecryptableIds !== undefined ? propUndecryptableIds : fallbackTasks.undecryptableIds;
  const unsyncedIds =
    propUnsyncedIds !== undefined ? propUnsyncedIds : fallbackTasks.unsyncedIds;
  const isLoadingTasks =
    propIsLoadingTasks !== undefined ? propIsLoadingTasks : fallbackTasks.isLoading;
  const fetchError =
    propFetchError !== undefined ? propFetchError : fallbackTasks.fetchError;
  const syncError =
    propSyncError !== undefined ? propSyncError : fallbackTasks.syncError;
  const handleRetryFetch = onRetryFetch || fallbackTasks.fetchTasks;
  const hasUndecryptableTasks = Object.values(undecryptableIds).some(Boolean);

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

  const {
    isSubmitting,
    warning: memoWarning,
    submitMemo,
  } = useMemos({
    simulateOffline,
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
        maxWidth: '1280px',
        margin: '0 auto',
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      {/* Main Content Area: MemoEditor + TaskList */}
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          minWidth: 0,
          width: '100%',
        }}
      >
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

        {/* EU AI Act Article 13 AI Error & Offline Fallback Transparency */}
        {memoWarning && (
          <div
            role="status"
            data-testid="memo-offline-warning"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.8125rem',
              color: '#92400e',
            }}
          >
            <span style={{ fontSize: '1rem' }}>⚡</span>
            <span>
              <strong>Offline Fallback Mode (EU AI Act Art. 13):</strong> {memoWarning}
            </span>
          </div>
        )}

        <MemoEditor onSubmit={submitMemo} isLoading={isSubmitting} />

        {isLoadingTasks && (
          <div
            role="status"
            data-testid="tasks-loading-indicator"
            style={{
              padding: '0.65rem 1rem',
              borderRadius: '8px',
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              fontSize: '0.8125rem',
              color: '#1d4ed8',
              fontWeight: 500,
            }}
          >
            Loading encrypted tasks from gateway...
          </div>
        )}

        {fetchError && (
          <div
            role="alert"
            data-testid="fetch-error-banner"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              fontSize: '0.8125rem',
              color: '#991b1b',
            }}
          >
            <span>
              <strong>Failed to load tasks:</strong> {fetchError}
            </span>
            <button
              type="button"
              onClick={() => void handleRetryFetch()}
              style={{
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.35rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {syncError && (
          <div
            role="alert"
            data-testid="sync-error-banner"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              fontSize: '0.8125rem',
              color: '#92400e',
            }}
          >
            <strong>Sync warning:</strong> {syncError} Changes are kept locally but not synced with the gateway.
          </div>
        )}

        {hasUndecryptableTasks && (
          <div
            role="status"
            data-testid="undecryptable-tasks-banner"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              fontSize: '0.8125rem',
              color: '#92400e',
            }}
          >
            Some tasks were encrypted with a previous session key (lost on page reload) and cannot be decrypted. You can delete stale tasks.
          </div>
        )}

        <TaskList
          tasks={tasks}
          decryptedPayloads={decryptedPayloads}
          isDecrypted={hasActiveKey}
          undecryptableIds={undecryptableIds}
          unsyncedIds={unsyncedIds}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          onSubtaskToggle={handleSubtaskToggle}
          onTaskUpdate={handleTaskUpdate}
          onDelete={handleDelete}
        />
      </main>

      {/* Sidebar: Privacy Audit Panel */}
      <aside className="oscar-dashboard-aside" style={{ minWidth: 0, width: '100%' }}>
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
