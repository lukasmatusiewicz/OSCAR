import React from 'react';
import { TaskCategory } from '../../types/contracts';
import { Badge } from '../atoms/Badge';

export interface CategoryBadgeProps {
  category: TaskCategory;
  className?: string;
}

const CATEGORY_MAP: Record<
  TaskCategory,
  { label: string; variant: 'info' | 'success' | 'warning' | 'danger' | 'default' | 'outline' }
> = {
  WORK: { label: '💼 Work', variant: 'info' },
  INTERVIEW_PREP: { label: '🎯 Interview Prep', variant: 'warning' },
  FINANCE: { label: '💳 Finance', variant: 'success' },
  PERSONAL: { label: '🏠 Personal', variant: 'default' },
  HEALTH: { label: '🩺 Health', variant: 'danger' },
  OTHER: { label: '📌 Other', variant: 'outline' },
};

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({ category, className = '' }) => {
  const config = CATEGORY_MAP[category] || { label: category, variant: 'default' };

  return (
    <Badge
      variant={config.variant}
      size="sm"
      className={`oscar-category-badge oscar-category-${category.toLowerCase()} ${className}`.trim()}
      aria-label={`Category: ${category}`}
    >
      {config.label}
    </Badge>
  );
};
