import { describe, it, expect, beforeAll } from 'vitest';

describe('Global Unhandled Rejection Guard (main.tsx)', () => {
  beforeAll(async () => {
    // Import main to register the unhandledrejection listener
    await import('../src/main');
  });

  const createRejectionEvent = (reason: unknown): Event => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'reason', {
      value: reason,
      writable: true,
      configurable: true,
    });
    return event;
  };

  it('prevents default for "message channel closed before a response was received" error', () => {
    const event = createRejectionEvent(new Error('message channel closed before a response was received'));
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('prevents default for "A listener indicated an asynchronous response by returning true" error', () => {
    const event = createRejectionEvent(new Error('A listener indicated an asynchronous response by returning true'));
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('prevents default when noise is a string reason instead of an Error object', () => {
    const event = createRejectionEvent('message channel closed before a response was received');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does NOT prevent default for standard application errors', () => {
    const event = createRejectionEvent(new Error('Network connection lost'));
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does NOT prevent default for undefined or null reasons', () => {
    const eventNull = createRejectionEvent(null);
    window.dispatchEvent(eventNull);
    expect(eventNull.defaultPrevented).toBe(false);

    const eventUndefined = createRejectionEvent(undefined);
    window.dispatchEvent(eventUndefined);
    expect(eventUndefined.defaultPrevented).toBe(false);
  });
});
