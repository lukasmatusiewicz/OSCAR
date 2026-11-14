import React, { useState, useEffect } from 'react';
import {
  DecryptedTaskPayload,
  TaskCategory,
  TaskEntity,
  TaskPriority,
  TaskStatus,
} from '../../types/contracts';
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
  isUndecryptable?: boolean;
  isUnsynced?: boolean;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onPriorityChange?: (taskId: string, newPriority: TaskPriority) => void;
  onSubtaskToggle?: (taskId: string, subtaskIndex: number, completed: boolean) => void;
  onTaskUpdate?: (
    taskId: string,
    updatedPayload: DecryptedTaskPayload,
    updates?: { category?: TaskCategory },
  ) => void;
  onDelete?: (taskId: string) => void;
  className?: string;
}

const TASK_CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
  { value: 'WORK', label: '💼 Work' },
  { value: 'FINANCE', label: '💳 Finance' },
  { value: 'HEALTH', label: '🩺 Health' },
  { value: 'PERSONAL', label: '🏠 Personal' },
  { value: 'INTERVIEW_PREP', label: '🎯 Interview Prep' },
  { value: 'OTHER', label: '📌 Other' },
];

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  decryptedPayload,
  isDecrypted = true,
  isUndecryptable = false,
  isUnsynced = false,
  onStatusChange,
  onPriorityChange,
  onSubtaskToggle,
  onTaskUpdate,
  onDelete,
  className = '',
}) => {
  const isDraft = task.status === 'DRAFT';
  const isCompleted = task.status === 'COMPLETED';

  // Interactive Edit Mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(decryptedPayload?.title || '');
  const [editSummary, setEditSummary] = useState(decryptedPayload?.summary || '');
  const [editCategory, setEditCategory] = useState<TaskCategory>(task.category);
  const [editLocation, setEditLocation] = useState(decryptedPayload?.location || '');
  const [editContactPerson, setEditContactPerson] = useState(decryptedPayload?.contactPerson || '');
  const [editAmount, setEditAmount] = useState(decryptedPayload?.amount || '');
  const [editScheduledTime, setEditScheduledTime] = useState(
    decryptedPayload?.scheduledTime || task.scheduledTime || '',
  );
  const [editScheduledDate, setEditScheduledDate] = useState(
    decryptedPayload?.scheduledDate || task.scheduledDate || '',
  );
  const [editSubtasks, setEditSubtasks] = useState<{ title: string; completed: boolean }[]>(
    decryptedPayload?.subtasks ? [...decryptedPayload.subtasks] : [],
  );

  // Synchronize edit fields when incoming props change
  useEffect(() => {
    setEditTitle(decryptedPayload?.title || '');
    setEditSummary(decryptedPayload?.summary || '');
    setEditCategory(task.category);
    setEditLocation(decryptedPayload?.location || '');
    setEditContactPerson(decryptedPayload?.contactPerson || '');
    setEditAmount(decryptedPayload?.amount || '');
    setEditScheduledTime(decryptedPayload?.scheduledTime || task.scheduledTime || '');
    setEditScheduledDate(decryptedPayload?.scheduledDate || task.scheduledDate || '');
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
      scheduledDate: editScheduledDate.trim() || null,
    };

    if (editCategory !== task.category) {
      onTaskUpdate?.(task.id, updatedPayload, { category: editCategory });
    } else {
      onTaskUpdate?.(task.id, updatedPayload);
    }
    if (isDraft) {
      onStatusChange?.(task.id, 'PENDING');
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(decryptedPayload?.title || '');
    setEditSummary(decryptedPayload?.summary || '');
    setEditCategory(task.category);
    setEditLocation(decryptedPayload?.location || '');
    setEditContactPerson(decryptedPayload?.contactPerson || '');
    setEditAmount(decryptedPayload?.amount || '');
    setEditScheduledTime(decryptedPayload?.scheduledTime || task.scheduledTime || '');
    setEditScheduledDate(decryptedPayload?.scheduledDate || task.scheduledDate || '');
    setEditSubtasks(decryptedPayload?.subtasks ? [...decryptedPayload.subtasks] : []);
    setIsEditing(false);
  };

  const scheduledDate = task.scheduledDate || decryptedPayload?.scheduledDate;
  const scheduledTime = decryptedPayload?.scheduledTime || task.scheduledTime;
  const location = decryptedPayload?.location;
  const contactPerson = decryptedPayload?.contactPerson;
  const amount = decryptedPayload?.amount;
  const hasMetadata = Boolean(
    scheduledDate || scheduledTime || location || contactPerson || amount,
  );

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
      className={`oscar-task-card${isDraft ? ' oscar-task-card--draft' : ''} ${className}`.trim()}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        opacity: isCompleted ? 0.75 : 1,
        minWidth: 0,
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100%',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <CategoryBadge category={task.category} />
          <PrioritySelector
            value={task.priority}
            onChange={(p) => onPriorityChange?.(task.id, p)}
            readOnly={false}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
          {isUnsynced && (
            <span
              data-testid={`task-unsynced-badge-${task.id}`}
              style={{
                padding: '0.2rem 0.5rem',
                borderRadius: '9999px',
                fontSize: '0.7rem',
                fontWeight: 700,
                backgroundColor: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
              }}
            >
              ⚠ Not synced
            </span>
          )}
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
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="secondary"
              className="oscar-btn"
              onClick={() => setIsEditing(true)}
              aria-label="Edit Draft"
            >
              ✏️ Edit Draft
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="oscar-btn"
              onClick={() => onStatusChange?.(task.id, 'PENDING')}
              aria-label="Confirm Task"
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="oscar-btn"
              onClick={() => onStatusChange?.(task.id, 'CANCELLED')}
              aria-label="Dismiss Task"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Interactive Edit Mode (EU AI Act Art. 14) */}
      {isEditing ? (
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
            minWidth: 0,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <strong style={{ fontSize: '0.875rem', color: '#1e293b' }}>
              {isDraft
                ? '✏️ Interactive Draft Editor (Human Oversight)'
                : '✏️ Edit Task'}
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label
              htmlFor={`edit-category-${task.id}`}
              style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155' }}
            >
              Category
            </label>
            <select
              id={`edit-category-${task.id}`}
              aria-label="Category"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value as TaskCategory)}
              style={{
                padding: '0.45rem 0.6rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '0.8125rem',
                color: '#0f172a',
              }}
            >
              {TASK_CATEGORY_OPTIONS.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div
            data-testid="edit-mode-metadata-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '0.5rem',
              minWidth: 0,
              width: '100%',
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
              placeholder="e.g. 14:00"
            />
            <Input
              label="Scheduled Date"
              value={editScheduledDate}
              onChange={(e) => setEditScheduledDate(e.target.value)}
              placeholder="e.g. 2026-11-20"
            />
          </div>

          {/* Subtasks checklist editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0 }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155' }}>
              Subtasks Checklist Editor:
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0 }}>
              {editSubtasks.map((st, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    minWidth: 0,
                    width: '100%',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={st.completed}
                    onChange={(e) => {
                      const updated = [...editSubtasks];
                      updated[idx] = { ...updated[idx], completed: e.target.checked };
                      setEditSubtasks(updated);
                    }}
                    aria-label={`Subtask ${idx + 1} completed`}
                    style={{ cursor: 'pointer', width: '1rem', height: '1rem', flexShrink: 0 }}
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
                      minWidth: 0,
                      padding: '0.35rem 0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8125rem',
                      boxSizing: 'border-box',
                      wordBreak: 'break-word',
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    className="oscar-btn"
                    onClick={() => {
                      setEditSubtasks(editSubtasks.filter((_, i) => i !== idx));
                    }}
                    aria-label={`Remove subtask ${idx + 1}`}
                    style={{ flexShrink: 0 }}
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
              className="oscar-btn"
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
              flexWrap: 'wrap',
              marginTop: '0.5rem',
              borderTop: '1px solid #e2e8f0',
              paddingTop: '0.75rem',
              width: '100%',
            }}
          >
            <Button
              size="sm"
              variant="ghost"
              className="oscar-btn"
              onClick={handleCancelEdit}
              aria-label="Cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="oscar-btn"
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
              {scheduledDate && (
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
                    maxWidth: '100%',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  📅 Date: {scheduledDate}
                </span>
              )}
              {scheduledTime && (
                <span
                  data-testid="metadata-chip-time"
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
                    maxWidth: '100%',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  ⏰ Time: {scheduledTime}
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
                    maxWidth: '100%',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
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
                    maxWidth: '100%',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
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
                    maxWidth: '100%',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  💰 Amount: {amount}
                </span>
              )}
            </div>
          )}

          {/* Content Area: Title & Summary */}
          <div style={{ minWidth: 0, width: '100%' }}>
            <h4
              style={{
                margin: '0 0 0.35rem 0',
                fontSize: '1.125rem',
                fontWeight: 700,
                color: '#0f172a',
                textDecoration: isCompleted ? 'line-through' : 'none',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
            >
              {!isUndecryptable && isDecrypted && decryptedPayload
                ? decryptedPayload.title
                : '🔒 Encrypted Task Content'}
            </h4>
            <p
              style={{
                margin: 0,
                fontSize: '0.875rem',
                color: isUndecryptable ? '#b45309' : '#475569',
                lineHeight: 1.5,
                whiteSpace: 'pre-line',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
            >
              {!isUndecryptable && isDecrypted && decryptedPayload
                ? decryptedPayload.summary
                : isUndecryptable
                  ? 'Cannot decrypt: encrypted with a previous session key (lost on page reload).'
                  : 'Encrypted with AES-256-GCM. Active session key required to view cleartext.'}
            </p>
          </div>

          {/* Subtasks Checklist */}
          {!isUndecryptable &&
            isDecrypted &&
            decryptedPayload &&
            decryptedPayload.subtasks &&
            decryptedPayload.subtasks.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                  marginTop: '0.25rem',
                  minWidth: 0,
                  width: '100%',
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
                    minWidth: 0,
                    width: '100%',
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
                        color: subtask.completed ? '#475569' : '#1e293b',
                        textDecoration: subtask.completed ? 'line-through' : 'none',
                        minWidth: 0,
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
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
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                        {subtask.title}
                      </span>
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

        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            size="sm"
            variant="secondary"
            className="oscar-btn"
            onClick={() => downloadICalendarFile(task, decryptedPayload || undefined)}
            aria-label="Add to Calendar (.ics)"
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            📅 Add to Calendar (.ics)
          </Button>

          {!isDraft && (
            <>
              {(task.status === 'PENDING' || task.status === 'IN_PROGRESS') && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="oscar-btn"
                  onClick={() => setIsEditing(true)}
                  aria-label="Edit Task"
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                >
                  ✏️ Edit
                </Button>
              )}
              {task.status !== 'COMPLETED' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="oscar-btn"
                  onClick={() => onStatusChange?.(task.id, 'COMPLETED')}
                  style={{
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
                  className="oscar-btn"
                  onClick={() => onStatusChange?.(task.id, 'PENDING')}
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                >
                  ↺ Reopen
                </Button>
              )}
            </>
          )}

          <Button
            size="sm"
            variant="danger"
            className="oscar-btn"
            onClick={() => onDelete?.(task.id)}
            aria-label="Delete Task"
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            🗑️ Delete
          </Button>
        </div>
      </div>
    </article>
  );
};