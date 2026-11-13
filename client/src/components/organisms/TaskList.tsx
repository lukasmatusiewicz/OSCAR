import React, { useState, useMemo } from 'react';
import {
  DecryptedTaskPayload,
  TaskCategory,
  TaskEntity,
  TaskPriority,
  TaskStatus,
} from '../../types/contracts';
import { Button } from '../atoms/Button';
import { SearchBox } from '../molecules/SearchBox';
import { TaskCard } from './TaskCard';

export interface TaskListProps {
  tasks: TaskEntity[];
  decryptedPayloads?: Record<string, DecryptedTaskPayload>;
  isDecrypted?: boolean;
  undecryptableIds?: Record<string, boolean>;
  unsyncedIds?: Record<string, boolean>;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onPriorityChange?: (taskId: string, newPriority: TaskPriority) => void;
  onSubtaskToggle?: (taskId: string, subtaskIndex: number, completed: boolean) => void;
  onTaskUpdate?: (taskId: string, updatedPayload: DecryptedTaskPayload) => void;
  onDelete?: (taskId: string) => void;
  className?: string;
}

export const TaskList: React.FC<TaskListProps> = ({
  tasks,
  decryptedPayloads = {},
  isDecrypted = true,
  undecryptableIds = {},
  unsyncedIds = {},
  onStatusChange,
  onPriorityChange,
  onSubtaskToggle,
  onTaskUpdate,
  onDelete,
  className = '',
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TaskCategory | 'ALL'>('ALL');
  const [selectedPriority, setSelectedPriority] = useState<TaskPriority | 'ALL'>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | 'ALL'>('ALL');

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Status filter
      if (selectedStatus !== 'ALL' && t.status !== selectedStatus) return false;
      // Category filter
      if (selectedCategory !== 'ALL' && t.category !== selectedCategory) return false;
      // Priority filter
      if (selectedPriority !== 'ALL' && t.priority !== selectedPriority) return false;
      // Search filter across decrypted title/summary and tags
      if (search.trim()) {
        const query = search.toLowerCase();
        const payload = decryptedPayloads[t.id];
        const titleMatch = payload?.title?.toLowerCase().includes(query) ?? false;
        const summaryMatch = payload?.summary?.toLowerCase().includes(query) ?? false;
        const tagMatch = t.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false;
        if (!titleMatch && !summaryMatch && !tagMatch) return false;
      }
      return true;
    });
  }, [tasks, decryptedPayloads, search, selectedCategory, selectedPriority, selectedStatus]);

  const categories: (TaskCategory | 'ALL')[] = [
    'ALL',
    'WORK',
    'INTERVIEW_PREP',
    'FINANCE',
    'PERSONAL',
    'HEALTH',
    'OTHER',
  ];

  const statuses: (TaskStatus | 'ALL')[] = [
    'ALL',
    'DRAFT',
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
  ];

  return (
    <section
      className={`oscar-task-list ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Search & Filter Header */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          padding: '1rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search decrypted tasks by keyword or #tag..."
        />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'center',
            fontSize: '0.8125rem',
          }}
        >
          {/* Status filter buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: '#64748b' }}>Status:</span>
            {statuses.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSelectedStatus(s)}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  border: '1px solid',
                  borderColor: selectedStatus === s ? '#2563eb' : '#e2e8f0',
                  backgroundColor: selectedStatus === s ? '#eff6ff' : '#ffffff',
                  color: selectedStatus === s ? '#1d4ed8' : '#475569',
                  fontWeight: selectedStatus === s ? 700 : 500,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Category filter select */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label htmlFor="category-filter-select" style={{ fontWeight: 600, color: '#64748b' }}>
              Category:
            </label>
            <select
              id="category-filter-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as TaskCategory | 'ALL')}
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '0.75rem',
                backgroundColor: '#ffffff',
              }}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Priority filter select */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label htmlFor="priority-filter-select" style={{ fontWeight: 600, color: '#64748b' }}>
              Priority:
            </label>
            <select
              id="priority-filter-select"
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value as TaskPriority | 'ALL')}
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '0.75rem',
                backgroundColor: '#ffffff',
              }}
            >
              <option value="ALL">ALL</option>
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="URGENT">URGENT</option>
            </select>
          </div>

          {(search ||
            selectedCategory !== 'ALL' ||
            selectedPriority !== 'ALL' ||
            selectedStatus !== 'ALL') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch('');
                setSelectedCategory('ALL');
                setSelectedPriority('ALL');
                setSelectedStatus('ALL');
              }}
            >
              Reset Filters
            </Button>
          )}
        </div>
      </div>

      {/* Results Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 0.25rem',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#334155' }}>
          Tasks ({filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'} found)
        </h3>
      </div>

      {/* Task Cards List or Empty State */}
      {filteredTasks.length === 0 ? (
        <div
          data-testid="task-list-empty"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '2px dashed #e2e8f0',
            padding: '2.5rem 1rem',
            textAlign: 'center',
            color: '#64748b',
          }}
        >
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 500 }}>
            No tasks found matching your criteria.
          </p>
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>
            Compose a confidential memo above to extract actionable structured tasks.
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {filteredTasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              decryptedPayload={decryptedPayloads[t.id]}
              isDecrypted={isDecrypted}
              isUndecryptable={Boolean(undecryptableIds[t.id])}
              isUnsynced={Boolean(unsyncedIds[t.id])}
              onStatusChange={onStatusChange}
              onPriorityChange={onPriorityChange}
              onSubtaskToggle={onSubtaskToggle}
              onTaskUpdate={onTaskUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
};
