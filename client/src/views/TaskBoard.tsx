import React from 'react';
import { DecryptedTaskPayload, TaskEntity, TaskPriority, TaskStatus } from '../types/contracts';
import { TaskCard } from '../components/organisms/TaskCard';

export interface TaskBoardProps {
  tasks: TaskEntity[];
  decryptedPayloads?: Record<string, DecryptedTaskPayload>;
  isDecrypted?: boolean;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onPriorityChange?: (taskId: string, newPriority: TaskPriority) => void;
  onSubtaskToggle?: (taskId: string, subtaskIndex: number, completed: boolean) => void;
  onTaskUpdate?: (taskId: string, updatedPayload: DecryptedTaskPayload) => void;
  onDelete?: (taskId: string) => void;
  className?: string;
}

export const TaskBoard: React.FC<TaskBoardProps> = ({
  tasks,
  decryptedPayloads = {},
  isDecrypted = true,
  onStatusChange,
  onPriorityChange,
  onSubtaskToggle,
  onTaskUpdate,
  onDelete,
  className = '',
}) => {
  const columns: { status: TaskStatus; title: string; color: string; badgeBg: string }[] = [
    { status: 'DRAFT', title: '⚖️ Review (Drafts)', color: '#b45309', badgeBg: '#fef3c7' },
    { status: 'PENDING', title: '📋 Active Backlog', color: '#1d4ed8', badgeBg: '#eff6ff' },
    { status: 'IN_PROGRESS', title: '⚡ In Progress', color: '#7e22ce', badgeBg: '#f3e8ff' },
    { status: 'COMPLETED', title: '✅ Done', color: '#15803d', badgeBg: '#dcfce7' },
  ];

  return (
    <div
      className={`oscar-task-board ${className}`.trim()}
      style={{
        maxWidth: '1440px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {columns.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.status);
        return (
          <div
            key={col.status}
            data-testid={`taskboard-column-${col.status.toLowerCase()}`}
            style={{
              backgroundColor: '#f8fafc',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              minHeight: '400px',
            }}
          >
            {/* Column Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '0.5rem',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: '#1e293b' }}>
                {col.title}
              </h3>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '9999px',
                  backgroundColor: col.badgeBg,
                  color: col.color,
                }}
              >
                {colTasks.length}
              </span>
            </div>

            {/* Task list in column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {colTasks.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '2rem 0.5rem',
                    color: '#94a3b8',
                    fontSize: '0.8125rem',
                  }}
                >
                  No tasks
                </div>
              ) : (
                colTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    decryptedPayload={decryptedPayloads[t.id]}
                    isDecrypted={isDecrypted}
                    onStatusChange={onStatusChange}
                    onPriorityChange={onPriorityChange}
                    onSubtaskToggle={onSubtaskToggle}
                    onTaskUpdate={onTaskUpdate}
                    onDelete={onDelete}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
