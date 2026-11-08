import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'info' | 'success' | 'warning' | 'danger' | 'outline';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  style,
  className = '',
  ...props
}) => {
  const variantStyles: Record<string, React.CSSProperties> = {
    default: { backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0' },
    info: { backgroundColor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' },
    success: { backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
    warning: { backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' },
    danger: { backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' },
    outline: { backgroundColor: 'transparent', color: '#475569', border: '1px solid #cbd5e1' }
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: '0.125rem 0.375rem', fontSize: '0.6875rem' },
    md: { padding: '0.2rem 0.55rem', fontSize: '0.75rem' }
  };

  const combinedStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    borderRadius: '9999px',
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    ...variantStyles[variant],
    ...sizeStyles[size],
    ...style
  };

  return (
    <span
      className={`oscar-badge oscar-badge-${variant} ${className}`.trim()}
      style={combinedStyle}
      {...props}
    >
      {children}
    </span>
  );
};
