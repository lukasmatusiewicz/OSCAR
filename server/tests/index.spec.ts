import { describe, it, expect, vi } from 'vitest';
import { Server } from 'node:http';
import { server, PORT, handleShutdown } from '../src/index.js';

describe('Server Entrypoint & Lifecycle', () => {
  it('exports PORT as a valid number', () => {
    expect(typeof PORT).toBe('number');
    expect(PORT).toBeGreaterThan(0);
  });

  it('exports an active Server instance', () => {
    expect(server).toBeInstanceOf(Server);
  });

  it('handles graceful shutdown cleanly and idempotently', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Initial shutdown signal invocation
    expect(() => handleShutdown('SIGINT')).not.toThrow();

    // Subsequent idempotent invocation ignores repeated shutdown signals
    expect(() => handleShutdown('SIGTERM')).not.toThrow();

    stdoutSpy.mockRestore();
  });
});
