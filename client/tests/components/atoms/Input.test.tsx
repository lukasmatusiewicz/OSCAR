import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '../../../src/components/atoms/Input';

describe('Input', () => {
  it('renders text input with label and helper text', () => {
    render(<Input label="Username" helperText="Enter your handle" placeholder="johndoe" />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your handle/i)).toBeInTheDocument();
  });

  it('renders error message and aria-invalid on error', () => {
    render(<Input label="Email" error="Invalid email address" />);
    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email address');
  });

  it('renders textarea when isTextArea is true', () => {
    render(<Input label="Memo" isTextArea rows={5} placeholder="Speak or type..." />);
    const textarea = screen.getByPlaceholderText(/speak or type/i);
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('rows', '5');
  });

  it('renders helperText for textarea without error', () => {
    render(<Input isTextArea label="Notes" helperText="Add additional notes here" />);
    expect(screen.getByText('Add additional notes here')).toBeInTheDocument();
  });

  it('renders input without helperText or error', () => {
    render(<Input placeholder="Simple input" />);
    expect(screen.getByPlaceholderText('Simple input')).toBeInTheDocument();
  });

  it('renders clear button and triggers onClear callback', () => {
    const handleClear = vi.fn();
    const { unmount } = render(<Input value="Test text" onChange={() => {}} onClear={handleClear} />);
    const clearBtn = screen.getByRole('button', { name: /clear input/i });
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(handleClear).toHaveBeenCalledTimes(1);
    unmount();

    // Test onClear on textarea
    render(<Input isTextArea value="Long text" onChange={() => {}} onClear={handleClear} />);
    const clearAreaBtn = screen.getByRole('button', { name: /clear input/i });
    expect(clearAreaBtn).toBeInTheDocument();
    fireEvent.click(clearAreaBtn);
    expect(handleClear).toHaveBeenCalledTimes(2);
  });
});
