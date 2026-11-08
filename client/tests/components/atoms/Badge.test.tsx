import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../../../src/components/atoms/Badge';

describe('Badge', () => {
  it('renders badge with children and supports various variants', () => {
    const variants = ['default', 'info', 'success', 'warning', 'danger', 'outline'] as const;
    variants.forEach((v) => {
      const { unmount } = render(<Badge variant={v}>{v}</Badge>);
      expect(screen.getByText(v)).toBeInTheDocument();
      unmount();
    });
  });
});
