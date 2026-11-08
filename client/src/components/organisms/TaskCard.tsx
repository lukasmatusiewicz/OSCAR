import React from 'react';
import { DecryptedTaskPayload, TaskEntity, TaskPriority, TaskStatus } from '../../types/contracts';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { CategoryBadge } from '../molecules/CategoryBadge';
import { PrioritySelector } from '../molecules/PrioritySelector';

export interface TaskCardProps {
  task: TaskEntity;
  decryptedPayload?: DecryptedTaskPayload | null;
  isDecrypted?: boolean;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onPriorityChange?: (taskId: string, newPriority: TaskPriority) => void;
  onSubtaskToggle?: (taskId: string, subtaskIndex: number, completed: boolean) => void;
  className?: string;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  decryptedPayload,
  isDecrypted = true,
  onStatusChange,
  onPriorityChange,
  onSubtaskToggle,
  className = '',
}) => {
  const isDraft = task.status === 'DRAFT';
  const isCompleted = task.status === 'COMPLETED';

  const statusColors: Record<TaskStatus, { bg: string; text: string; border: string }> = {
    DRAFT: { bg: '#fef3c7', text: '#b45309', border: '#fde68a' },
    PENDING: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
    IN_PROGRESS: { bg: '#f3e8ff', text: '#7e22ce', border: '#e9d5ff' },
    COMPLETED: { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' },
    CANCELLED: { bg: '#f1f5f9', text: '#64748b', border: '#cbd5e1' },
  };

  const currentStatusStyle = statusColors[task.status] || statusColors.PENDING;

  return (
    <article
      data-testid={`task-card-${task.id}`}
      className={`oscar-task-card ${className}`.trim()}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: `1px solid ${isDraft ? '#f59e0b' : '#e2e8f0'}`,
        padding: '1.25rem',
        boxShadow: isDraft
          ? '0 0 0 1px #f59e0b, 0 2px 4px rgba(245, 158, 11, 0.1)'
          : '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        transition: 'all 0.2s ease',
        opacity: isCompleted ? 0.75 : 1,
      }}
    >
      {/* Header bar: Category, Priority, Status, Provenance */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CategoryBadge category={task.category} />
          <PrioritySelector
            value={task.priority}
            onChange={(p) => onPriorityChange?.(task.id, p)}
            readOnly={false}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span
            data-testid={`task-status-badge-${task.id}`}
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: currentStatusStyle.bg,
              color: currentStatusStyle.text,
              border: `1px solid ${currentStatusStyle.border}`,
            }}
          >
            {task.status}
          </span>
          <span
            title={`Inference Provenance: ${task.provenance}`}
            style={{
              fontSize: '0.6875rem',
              padding: '0.15rem 0.4rem',
              borderRadius: '4px',
              backgroundColor: '#f1f5f9',
              color: '#475569',
              fontWeight: 500,
            }}
          >
            🤖 {task.provenance === 'GEMINI_FLASH' ? 'Gemini 2.5' : 'Fallback Engine'}
          </span>
        </div>
      </div>

      {/* Human Oversight Banner for Drafts (EU AI Act Articles 13 & 14) */}
      {isDraft && (
        <div
          role="alert"
          style={{
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '6px',
            padding: '0.5rem 0.75rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.8125rem',
            color: '#92400e',
          }}
        >
          <span>
            ⚖️ <strong>Human Oversight Required:</strong> Review AI-extracted task before
            confirming.
          </span>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onStatusChange?.(task.id, 'PENDING')}
              aria-label="Confirm Task"
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onStatusChange?.(task.id, 'CANCELLED')}
              aria-label="Dismiss Task"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Content Area: Title & Summary */}
      <div>
        <h4
          style={{
            margin: '0 0 0.35rem 0',
            fontSize: '1.125rem',
            fontWeight: 700,
            color: '#0f172a',
            textDecoration: isCompleted ? 'line-through' : 'none',
          }}
        >
          {isDecrypted && decryptedPayload ? decryptedPayload.title : '🔒 Encrypted Task Content'}
        </h4>
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            color: '#475569',
            lineHeight: 1.5,
          }}
        >
          {isDecrypted && decryptedPayload
            ? decryptedPayload.summary
            : 'Encrypted with AES-256-GCM. Active session key required to view cleartext.'}
        </p>
      </div>

      {/* Subtasks Checklist */}
      {isDecrypted &&
        decryptedPayload &&
        decryptedPayload.subtasks &&
        decryptedPayload.subtasks.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
              marginTop: '0.25rem',
            }}
          >
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155' }}>
              Action Checklist ({decryptedPayload.subtasks.filter((s) => s.completed).length}/
              {decryptedPayload.subtasks.length}):
            </span>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
              }}
            >
              {decryptedPayload.subtasks.map((subtask, index) => (
                <li
                  key={`${task.id}-subtask-${index}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.8125rem',
                    color: subtask.completed ? '#94a3b8' : '#1e293b',
                    textDecoration: subtask.completed ? 'line-through' : 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={subtask.completed}
                    onChange={(e) => onSubtaskToggle?.(task.id, index, e.target.checked)}
                    aria-label={subtask.title}
                    style={{
                      cursor: 'pointer',
                      accentColor: '#2563eb',
                      width: '1rem',
                      height: '1rem',
                      borderRadius: '4px',
                      transition: 'all 0.15s ease',
                    }}
                  />
                  <span>{subtask.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

      {/* Footer: Tags, Scheduled Date, Actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          borderTop: '1px solid #f1f5f9',
          paddingTop: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
          {task.tags &&
            task.tags.map((tag) => (
              <Badge key={tag} variant="outline" size="sm">
                #{tag}
              </Badge>
            ))}
          {task.scheduledDate && (
            <span
              style={{
                fontSize: '0.75rem',
                color: '#64748b',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              📅 {new Date(task.scheduledDate).toLocaleDateString()}
            </span>
          )}
        </div>

        {!isDraft && (
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {task.status !== 'COMPLETED' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onStatusChange?.(task.id, 'COMPLETED')}
                style={{
                  transition: 'all 0.2s ease',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                ✓ Mark Done
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onStatusChange?.(task.id, 'PENDING')}
                style={{
                  transition: 'all 0.2s ease',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                ↺ Reopen
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
};
