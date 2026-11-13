import React from 'react';
import { Input } from '../atoms/Input';

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const SearchBox: React.FC<SearchBoxProps> = ({
  value,
  onChange,
  placeholder = 'Search tasks or tags...',
  className = '',
}) => {
  return (
    <div
      className={`oscar-search-box ${className}`.trim()}
      style={{ position: 'relative', width: '100%' }}
    >
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClear={() => onChange('')}
        aria-label="Search"
        style={{
          paddingLeft: '2rem',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '0.65rem',
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#475569',
          fontSize: '0.875rem',
          pointerEvents: 'none',
        }}
      >
        🔍
      </span>
    </div>
  );
};
