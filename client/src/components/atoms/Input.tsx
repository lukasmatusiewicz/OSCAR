import React, { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<
  HTMLInputElement | HTMLTextAreaElement
> {
  label?: string;
  error?: string;
  helperText?: string;
  isTextArea?: boolean;
  rows?: number;
  onClear?: () => void;
}

export const Input = forwardRef<HTMLInputElement | HTMLTextAreaElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      isTextArea = false,
      rows = 3,
      value,
      onClear,
      id,
      className = '',
      disabled,
      style,
      ...props
    },
    ref,
  ) => {
    const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

    const containerStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      width: '100%',
    };

    const fieldStyle: React.CSSProperties = {
      padding: '0.5rem 0.75rem',
      borderRadius: '6px',
      border: `1px solid ${error ? '#ef4444' : '#cbd5e1'}`,
      outline: 'none',
      fontSize: '0.875rem',
      backgroundColor: disabled ? '#f8fafc' : '#ffffff',
      color: '#0f172a',
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      width: '100%',
      boxSizing: 'border-box',
    };

    return (
      <div className={`oscar-input-group ${className}`.trim()} style={containerStyle}>
        {label && (
          <label
            htmlFor={inputId}
            style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155' }}
          >
            {label}
          </label>
        )}

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
          {isTextArea ? (
            <textarea
              ref={ref as React.Ref<HTMLTextAreaElement>}
              id={inputId}
              rows={rows}
              value={value}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              aria-describedby={
                error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
              }
              style={{ ...fieldStyle, resize: 'vertical', ...style }}
              {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          ) : (
            <input
              ref={ref as React.Ref<HTMLInputElement>}
              id={inputId}
              value={value}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              aria-describedby={
                error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
              }
              style={{ ...fieldStyle, ...style }}
              {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
            />
          )}

          {onClear && value && !disabled && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear input"
              style={{
                position: 'absolute',
                right: '0.5rem',
                top: isTextArea ? '0.5rem' : '50%',
                transform: isTextArea ? 'none' : 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: '#94a3b8',
                fontSize: '1rem',
                padding: '0.2rem',
              }}
            >
              ✕
            </button>
          )}
        </div>

        {error ? (
          <span
            id={`${inputId}-error`}
            role="alert"
            style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 500 }}
          >
            {error}
          </span>
        ) : helperText ? (
          <span id={`${inputId}-helper`} style={{ fontSize: '0.75rem', color: '#64748b' }}>
            {helperText}
          </span>
        ) : null}
      </div>
    );
  },
);

Input.displayName = 'Input';
