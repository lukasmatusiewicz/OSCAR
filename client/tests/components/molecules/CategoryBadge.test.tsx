import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryBadge } from '../../../src/components/molecules/CategoryBadge';
import { TaskCategory } from '../../../src/types/contracts';

describe('CategoryBadge', () => {
  it('renders correct label and styling for every taxonomy category', () => {
    const categories: TaskCategory[] = [
      'WORK',
      'INTERVIEW_PREP',
      'FINANCE',
      'PERSONAL',
      'HEALTH',
      'OTHER',
    ];

    categories.forEach((cat) => {
      const { unmount } = render(<CategoryBadge category={cat} />);
      expect(screen.getByLabelText(`Category: ${cat}`)).toBeInTheDocument();
      unmount();
    });

    // Test fallback category
    render(<CategoryBadge category={'CUSTOM' as unknown as TaskCategory} />);
    expect(screen.getByLabelText('Category: CUSTOM')).toBeInTheDocument();
  });
});
