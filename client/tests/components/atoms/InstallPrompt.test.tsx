import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InstallPrompt, BeforeInstallPromptEvent } from '../../../src/components/atoms/InstallPrompt';

describe('InstallPrompt Component', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    // Mock matchMedia returning false for standalone
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  const createMockBeforeInstallPromptEvent = (outcome: 'accepted' | 'dismissed' = 'accepted') => {
    const event = new Event('beforeinstallprompt', {
      bubbles: true,
      cancelable: true,
    }) as unknown as BeforeInstallPromptEvent;

    (event as { platforms: string[] }).platforms = ['web'];
    (event as { prompt: () => Promise<void> }).prompt = vi.fn().mockResolvedValue(undefined);
    (event as { userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }).userChoice =
      Promise.resolve({ outcome, platform: 'web' });

    return event;
  };

  it('renders nothing initially when beforeinstallprompt has not fired', () => {
    render(<InstallPrompt />);
    expect(screen.queryByRole('button', { name: /install oscar app/i })).not.toBeInTheDocument();
  });

  it('renders the install button when beforeinstallprompt fires', () => {
    render(<InstallPrompt />);

    const mockEvent = createMockBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(mockEvent);
    });

    const installBtn = screen.getByRole('button', { name: /install oscar app/i });
    expect(installBtn).toBeInTheDocument();
    expect(installBtn).toHaveTextContent('📲 Install App');
  });

  it('triggers prompt() and hides button after installation is accepted', async () => {
    const onInstalled = vi.fn();
    render(<InstallPrompt onInstalled={onInstalled} />);

    const mockEvent = createMockBeforeInstallPromptEvent('accepted');
    act(() => {
      window.dispatchEvent(mockEvent);
    });

    const installBtn = screen.getByRole('button', { name: /install oscar app/i });
    expect(installBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(installBtn);
    });

    expect(mockEvent.prompt).toHaveBeenCalledTimes(1);
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /install oscar app/i })).not.toBeInTheDocument();
  });

  it('triggers prompt() and hides button when user dismisses installation choice', async () => {
    const onInstalled = vi.fn();
    render(<InstallPrompt onInstalled={onInstalled} />);

    const mockEvent = createMockBeforeInstallPromptEvent('dismissed');
    act(() => {
      window.dispatchEvent(mockEvent);
    });

    const installBtn = screen.getByRole('button', { name: /install oscar app/i });
    expect(installBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(installBtn);
    });

    expect(mockEvent.prompt).toHaveBeenCalledTimes(1);
    expect(onInstalled).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /install oscar app/i })).not.toBeInTheDocument();
  });

  it('hides button when appinstalled event fires', () => {
    const onInstalled = vi.fn();
    render(<InstallPrompt onInstalled={onInstalled} />);

    const mockEvent = createMockBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(mockEvent);
    });

    expect(screen.getByRole('button', { name: /install oscar app/i })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(screen.queryByRole('button', { name: /install oscar app/i })).not.toBeInTheDocument();
    expect(onInstalled).toHaveBeenCalledTimes(1);
  });

  it('handles prompt error gracefully and hides button', async () => {
    render(<InstallPrompt />);

    const mockEvent = createMockBeforeInstallPromptEvent();
    mockEvent.prompt = vi.fn().mockRejectedValue(new Error('User cancelled or prompt already called'));

    act(() => {
      window.dispatchEvent(mockEvent);
    });

    const installBtn = screen.getByRole('button', { name: /install oscar app/i });
    await act(async () => {
      fireEvent.click(installBtn);
    });

    expect(screen.queryByRole('button', { name: /install oscar app/i })).not.toBeInTheDocument();
  });

  it('does not render if display-mode is already standalone upon initialization', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<InstallPrompt />);
    const mockEvent = createMockBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(mockEvent);
    });

    expect(screen.queryByRole('button', { name: /install oscar app/i })).not.toBeInTheDocument();
  });

  it('removes event listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<InstallPrompt />);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('appinstalled', expect.any(Function));
  });
});
