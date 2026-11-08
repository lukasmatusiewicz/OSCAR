import React from 'react';
import { TaskPriority } from '../../types/contracts';

export interface PrioritySelectorProps {
  value: TaskPriority;
  onChange?: (priority: TaskPriority) => void;
  readOnly?: boolean;
  className?: string;
}

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; bg: string; text: string; border: string }> = {
  LOW: { label: 'Low', bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  MEDIUM: { label: 'Medium', bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
  HIGH: { label: 'High', bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' },
  URGENT: { label: 'Urgent', bg: '#fef2f2', text: '#dc2626', border: '#fecaca' }
};

export const PrioritySelector: React.FC<PrioritySelectorProps> = ({
  value,
  onChange,
  readOnly = false,
  className = ''
}) => {
  const priorities: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

  if (readOnly) {
    const cfg = PRIORITY_CONFIG[value] || PRIORITY_CONFIG.MEDIUM;
    return (
      <span
        className={`oscar-priority-badge oscar-priority-${value.toLowerCase()} ${className}`.trim()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0.15rem 0.5rem',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: 600,
          backgroundColor: cfg.bg,
          color: cfg.text,
          border: `1px solid ${cfg.border}`
        }}
      >
        ● {cfg.label}
      </span>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Task Priority"
      className={`oscar-priority-selector ${className}`.trim()}
      style={{ display: 'inline-flex', gap: '0.25rem', padding: '0.15rem', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}
    >
      {priorities.map((p) => {
        const isSelected = value === p;
        const cfg = PRIORITY_CONFIG[p];
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange?.(p)}
            style={{
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: isSelected ? 700 : 500,
              backgroundColor: isSelected ? cfg.bg : 'transparent',
              color: isSelected ? cfg.text : '#64748b',
              border: isSelected ? `1px solid ${cfg.border}` : '1px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
};
