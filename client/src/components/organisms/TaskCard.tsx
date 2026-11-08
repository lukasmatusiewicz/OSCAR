import React, { useState, useEffect } from 'react';
import { DecryptedTaskPayload, TaskEntity, TaskPriority, TaskStatus } from '../../types/contracts';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { CategoryBadge } from '../molecules/CategoryBadge';
import { PrioritySelector } from '../molecules/PrioritySelector';
import { downloadICalendarFile } from '../../utils/calendarExport';

export interface TaskCardProps {
  task: TaskEntity;
  decryptedPayload?: DecryptedTaskPayload | null;
  isDecrypted?: boolean;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onPriorityChange?: (taskId: string, newPriority: TaskPriority) => void;
  onSubtaskToggle?: (taskId: string, subtaskIndex: number, completed: boolean) => void;
  onTaskUpdate?: (taskId: string, updatedPayload: DecryptedTaskPayload) => void;
  className?: string;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  decryptedPayload,
  isDecrypted = true,
  onStatusChange,
  onPriorityChange,
  onSubtaskToggle,
  onTaskUpdate,
  className = '',
}) => {
  const isDraft = task.status === 'DRAFT';
  const isCompleted = task.status === 'COMPLETED';

  // Draft Interactive Edit Mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(decryptedPayload?.title || '');
  const [editSummary, setEditSummary] = useState(decryptedPayload?.summary || '');
  const [editLocation, setEditLocation] = useState(
    decryptedPayload?.location || task.location || '',
  );
  const [editContactPerson, setEditContactPerson] = useState(
    decryptedPayload?.contactPerson || task.contactPerson || '',
  );
  const [editAmount, setEditAmount] = useState(decryptedPayload?.amount || task.amount || '');
  const [editScheduledTime, setEditScheduledTime] = useState(
    decryptedPayload?.scheduledTime || task.scheduledTime || task.scheduledDate || '',
  );
  const [editSubtasks, setEditSubtasks] = useState<{ title: string; completed: boolean }[]>(
    decryptedPayload?.subtasks ? [...decryptedPayload.subtasks] : [],
  );

  // Synchronize edit fields when incoming props change
  useEffect(() => {
    setEditTitle(decryptedPayload?.title || '');
    setEditSummary(decryptedPayload?.summary || '');
    setEditLocation(decryptedPayload?.location || task.location || '');
    setEditContactPerson(decryptedPayload?.contactPerson || task.contactPerson || '');
    setEditAmount(decryptedPayload?.amount || task.amount || '');
    setEditScheduledTime(
      decryptedPayload?.scheduledTime || task.scheduledTime || task.scheduledDate || '',
    );
    setEditSubtasks(decryptedPayload?.subtasks ? [...decryptedPayload.subtasks] : []);
  }, [decryptedPayload, task]);

  const handleSaveEdit = () => {
    const finalSubtasks = editSubtasks
      .map((s) => ({ title: s.title.trim(), completed: s.completed }))
      .filter((s) => s.title.length > 0);

    const updatedPayload: DecryptedTaskPayload = {
      title: editTitle.trim() || decryptedPayload?.title || 'Untitled Task',
      summary: editSummary.trim() || decryptedPayload?.summary || '',
      subtasks:
        finalSubtasks.length > 0 ? finalSubtasks : [{ title: 'Action Item', completed: false }],
      location: editLocation.trim() || null,
      contactPerson: editContactPerson.trim() || null,
      amount: editAmount.trim() || null,
      scheduledTime: editScheduledTime.trim() || null,
    };

    onTaskUpdate?.(task.id, updatedPayload);
    onStatusChange?.(task.id, 'PENDING');
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(decryptedPayload?.title || '');
    setEditSummary(decryptedPayload?.summary || '');
    setEditLocation(decryptedPayload?.location || task.location || '');
    setEditContactPerson(decryptedPayload?.contactPerson || task.contactPerson || '');
    setEditAmount(decryptedPayload?.amount || task.amount || '');
    setEditScheduledTime(
      decryptedPayload?.scheduledTime || task.scheduledTime || task.scheduledDate || '',
    );
    setEditSubtasks(decryptedPayload?.subtasks ? [...decryptedPayload.subtasks] : []);
    setIsEditing(false);
  };

  const scheduled =
    task.scheduledDate || decryptedPayload?.scheduledTime || task.scheduledTime;
  const location = decryptedPayload?.location || task.location;
  const contactPerson = decryptedPayload?.contactPerson || task.contactPerson;
  const amount = decryptedPayload?.amount || task.amount;
  const hasMetadata = Boolean(scheduled || location || contactPerson || amount);

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
            data-testid={`task-provenance-${task.id}`}
            style={{
              fontSize: '0.6875rem',
              padding: '0.15rem 0.4rem',
              borderRadius: '4px',
              backgroundColor:
                task.provenance === 'DETERMINISTIC_FALLBACK' ? '#fef3c7' : '#f1f5f9',
              color: task.provenance === 'DETERMINISTIC_FALLBACK' ? '#92400e' : '#475569',
              fontWeight: 600,
            }}
          >
            {task.provenance === 'DETERMINISTIC_FALLBACK'
              ? '⚡ OFFLINE FALLBACK'
              : task.provenance === 'GEMINI_FLASH'
                ? '🤖 Gemini 2.5'
                : '🤖 Fallback Engine'}
          </span>
        </div>
      </div>

      {/* Human Oversight Banner for Drafts (EU AI Act Articles 13 & 14) */}
      {isDraft && !isEditing && (
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
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <span>
            ⚖️ <strong>Human Oversight Required:</strong> Review AI-extracted task before
            confirming.
          </span>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsEditing(true)}
              aria-label="Edit Draft"
            >
              ✏️ Edit Draft
            </Button>
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

      {/* Interactive Draft Edit Mode (EU AI Act Art. 14) */}
      {isDraft && isEditing ? (
        <div
          data-testid="draft-edit-mode"
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.875rem', color: '#1e293b' }}>
              ✏️ Interactive Draft Editor (Human Oversight)
            </strong>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Refine metadata and checklist items before confirming
            </span>
          </div>

          <Input
            label="Title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Action-oriented task title"
          />

          <Input
            label="Summary"
            isTextArea
            rows={2}
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            placeholder="Detailed objective and context"
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.5rem',
            }}
          >
            <Input
              label="Location"
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              placeholder="e.g. Kassel, Room 4B"
            />
            <Input
              label="Contact Person"
              value={editContactPerson}
              onChange={(e) => setEditContactPerson(e.target.value)}
              placeholder="e.g. Dr. Schmidt"
            />
            <Input
              label="Amount"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              placeholder="e.g. 1500 EUR"
            />
            <Input
              label="Scheduled Time"
              value={editScheduledTime}
              onChange={(e) => setEditScheduledTime(e.target.value)}
              placeholder="e.g. 2026-11-15T10:00:00Z"
            />
          </div>

          {/* Subtasks checklist editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155' }}>
              Subtasks Checklist Editor:
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {editSubtasks.map((st, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={st.completed}
                    onChange={(e) => {
                      const updated = [...editSubtasks];
                      updated[idx] = { ...updated[idx], completed: e.target.checked };
                      setEditSubtasks(updated);
                    }}
                    aria-label={`Subtask ${idx + 1} completed`}
                    style={{ cursor: 'pointer', width: '1rem', height: '1rem' }}
                  />
                  <input
                    type="text"
                    value={st.title}
                    onChange={(e) => {
                      const updated = [...editSubtasks];
                      updated[idx] = { ...updated[idx], title: e.target.value };
                      setEditSubtasks(updated);
                    }}
                    placeholder={`Subtask #${idx + 1}`}
                    aria-label={`Subtask ${idx + 1} title`}
                    style={{
                      flex: 1,
                      padding: '0.35rem 0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8125rem',
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setEditSubtasks(editSubtasks.filter((_, i) => i !== idx));
                    }}
                    aria-label={`Remove subtask ${idx + 1}`}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>

            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => setEditSubtasks([...editSubtasks, { title: '', completed: false }])}
              aria-label="+ Add Item"
              style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
            >
              + Add Item
            </Button>
          </div>

          {/* Action buttons */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'flex-end',
              marginTop: '0.5rem',
              borderTop: '1px solid #e2e8f0',
              paddingTop: '0.75rem',
            }}
          >
            <Button size="sm" variant="ghost" onClick={handleCancelEdit} aria-label="Cancel">
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleSaveEdit}
              aria-label="Confirm & Save Task"
            >
              💾 Confirm & Save Task
            </Button>
          </div>
        </div>
      ) : (
        /* Non-Edit Clean View */
        <>
          {/* Smart Metadata Chips */}
          {hasMetadata && (
            <div
              data-testid="smart-metadata-chips"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.375rem',
                padding: '0.15rem 0',
              }}
            >
              {scheduled && (
                <span
                  data-testid="metadata-chip-scheduled"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '9999px',
                    backgroundColor: '#eff6ff',
                    color: '#1d4ed8',
                    border: '1px solid #bfdbfe',
                    fontWeight: 500,
                  }}
                >
                  📅 Scheduled: {scheduled}
                </span>
              )}
              {location && (
                <span
                  data-testid="metadata-chip-location"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '9999px',
                    backgroundColor: '#ecfeff',
                    color: '#0e7490',
                    border: '1px solid #a5f3fc',
                    fontWeight: 500,
                  }}
                >
                  📍 Location: {location}
                </span>
              )}
              {contactPerson && (
                <span
                  data-testid="metadata-chip-contact"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '9999px',
                    backgroundColor: '#fef3c7',
                    color: '#92400e',
                    border: '1px solid #fde68a',
                    fontWeight: 500,
                  }}
                >
                  👤 Contact: {contactPerson}
                </span>
              )}
              {amount && (
                <span
                  data-testid="metadata-chip-amount"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '9999px',
                    backgroundColor: '#f5f3ff',
                    color: '#6d28d9',
                    border: '1px solid #ddd6fe',
                    fontWeight: 500,
                  }}
                >
                  💰 Amount: {amount}
                </span>
              )}
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
              {isDecrypted && decryptedPayload
                ? decryptedPayload.title
                : '🔒 Encrypted Task Content'}
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
        </>
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

        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => downloadICalendarFile(task, decryptedPayload || undefined)}
            aria-label="Add to Calendar (.ics)"
            style={{
              transition: 'all 0.2s ease',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            📅 Add to Calendar (.ics)
          </Button>

          {!isDraft && (
            <>
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
            </>
          )}
        </div>
      </div>
    </article>
  );
};