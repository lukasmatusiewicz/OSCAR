import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  disabled,
  className = '',
  ...props
}) => {
  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: '#2563eb',
      color: '#ffffff',
      border: '1px solid #1d4ed8',
      cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
      opacity: disabled || isLoading ? 0.6 : 1,
    },
    secondary: {
      backgroundColor: '#f1f5f9',
      color: '#1e293b',
      border: '1px solid #cbd5e1',
      cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
      opacity: disabled || isLoading ? 0.6 : 1,
    },
    danger: {
      backgroundColor: '#dc2626',
      color: '#ffffff',
      border: '1px solid #b91c1c',
      cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
      opacity: disabled || isLoading ? 0.6 : 1,
    },
    ghost: {
      backgroundColor: 'transparent',
      color: '#475569',
      border: '1px solid transparent',
      cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
      opacity: disabled || isLoading ? 0.6 : 1,
    },
    icon: {
      backgroundColor: 'transparent',
      color: '#475569',
      border: 'none',
      padding: '0.35rem',
      borderRadius: '50%',
      cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
      opacity: disabled || isLoading ? 0.6 : 1,
    },
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: '0.25rem 0.5rem', fontSize: '0.8125rem', gap: '0.25rem' },
    md: { padding: '0.45rem 0.9rem', fontSize: '0.875rem', gap: '0.375rem' },
    lg: { padding: '0.65rem 1.25rem', fontSize: '1rem', gap: '0.5rem' },
  };

  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px',
    fontWeight: 500,
    transition: 'all 0.15s ease',
    ...variantStyles[variant],
    ...(variant !== 'icon' ? sizeStyles[size] : {}),
    ...props.style,
  };

  return (
    <button
      {...props}
      style={style}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      aria-disabled={disabled || isLoading}
      className={`oscar-button oscar-button-${variant} oscar-button-${size} ${className}`.trim()}
    >
      {isLoading ? (
        <span
          data-testid="button-spinner"
          style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}
        >
          ⏳
        </span>
      ) : (
        leftIcon && <span className="oscar-button-icon-left">{leftIcon}</span>
      )}
      <span>{children}</span>
      {!isLoading && rightIcon && <span className="oscar-button-icon-right">{rightIcon}</span>}
    </button>
  );
};
