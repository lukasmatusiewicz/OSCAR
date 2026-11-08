import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchBox } from '../../../src/components/molecules/SearchBox';

describe('SearchBox', () => {
  it('renders input with search placeholder and handles typing', () => {
    const handleChange = vi.fn();
    render(<SearchBox value="audit" onChange={handleChange} placeholder="Search tasks..." />);
    const input = screen.getByPlaceholderText(/search tasks/i);
    expect(input).toHaveValue('audit');
    fireEvent.change(input, { target: { value: 'budget' } });
    expect(handleChange).toHaveBeenCalledWith('budget');
  });

  it('clears query when clear button is clicked', () => {
    const handleChange = vi.fn();
    render(<SearchBox value="sensitive query" onChange={handleChange} />);
    const clearBtn = screen.getByRole('button', { name: /clear input/i });
    fireEvent.click(clearBtn);
    expect(handleChange).toHaveBeenCalledWith('');
  });
});
