import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter, RateLimitError, TimeoutError } from '../../src/gateway/RateLimiter.js';

describe('RateLimiter', () => {
  let mockTime = 100000;
  const mockNow = () => mockTime;
  const advanceTime = (ms: number) => {
    mockTime += ms;
  };
  const mockSleep = vi.fn(async (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    advanceTime(ms);
  });

  beforeEach(() => {
    mockTime = 100000;
    vi.clearAllMocks();
  });

  it('should initialize with 12 tokens by default (12 RPM capacity)', () => {
    const limiter = new RateLimiter({ nowFn: mockNow, sleepFn: mockSleep });
    expect(limiter.getAvailableTokens()).toBe(12);
    expect(limiter.getCapacity()).toBe(12);
  });

  it('should consume tokens successfully when available', () => {
    const limiter = new RateLimiter({ nowFn: mockNow, sleepFn: mockSleep });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.getAvailableTokens()).toBe(11);

    expect(limiter.tryConsume(5)).toBe(true);
    expect(limiter.getAvailableTokens()).toBe(6);
  });

  it('should reject token consumption when bucket is empty', () => {
    const limiter = new RateLimiter({
      rpm: 12,
      capacity: 2,
      nowFn: mockNow,
      sleepFn: mockSleep
    });

    expect(limiter.tryConsume(2)).toBe(true);
    expect(limiter.tryConsume(1)).toBe(false);
  });

  it('should replenish tokens over time at 12 RPM (1 token every 5000ms)', () => {
    const limiter = new RateLimiter({
      rpm: 12,
      capacity: 12,
      nowFn: mockNow,
      sleepFn: mockSleep
    });

    // Consume all 12 tokens
    expect(limiter.tryConsume(12)).toBe(true);
    expect(limiter.getAvailableTokens()).toBe(0);

    // Advance 5000ms -> should replenish 1 token
    advanceTime(5000);
    expect(limiter.getAvailableTokens()).toBeCloseTo(1, 1);

    // Advance 25000ms more (total 30000ms = half minute -> 6 tokens)
    advanceTime(25000);
    expect(limiter.getAvailableTokens()).toBeCloseTo(6, 1);

    // Advance 60000ms more -> should cap at capacity (12 tokens)
    advanceTime(60000);
    expect(limiter.getAvailableTokens()).toBe(12);
  });

  it('should calculate jittered exponential backoff correctly', () => {
    const limiter = new RateLimiter({
      baseDelayMs: 1000,
      backoffMultiplier: 2.0,
      maxRetries: 2,
      jitter: 0 // deterministic for testing formula
    });

    expect(limiter.calculateBackoff(0)).toBe(1000);
    expect(limiter.calculateBackoff(1)).toBe(2000);
    expect(limiter.calculateBackoff(2)).toBe(4000);
  });

  it('should include random jitter within bounds when jitter is enabled', () => {
    const limiter = new RateLimiter({
      baseDelayMs: 1000,
      backoffMultiplier: 2.0,
      jitter: 200
    });

    const backoff = limiter.calculateBackoff(0);
    expect(backoff).toBeGreaterThanOrEqual(1000);
    expect(backoff).toBeLessThanOrEqual(1200);
  });

  it('should execute operation successfully within rate limit', async () => {
    const limiter = new RateLimiter({ nowFn: mockNow, sleepFn: mockSleep });
    const op = vi.fn(async (signal: AbortSignal) => {
      expect(signal).toBeDefined();
      return 'success';
    });

    const result = await limiter.execute(op);
    expect(result).toBe('success');
    expect(op).toHaveBeenCalledTimes(1);
    expect(limiter.getAvailableTokens()).toBe(11);
  });

  it('should retry on transient 429/503 errors with exponential backoff up to maxRetries', async () => {
    const limiter = new RateLimiter({
      baseDelayMs: 1000,
      backoffMultiplier: 2.0,
      maxRetries: 2,
      jitter: 0,
      nowFn: mockNow,
      sleepFn: mockSleep
    });

    let attempts = 0;
    const op = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        const err: any = new Error('Rate limit exceeded: 429 Too Many Requests');
        err.status = 429;
        throw err;
      }
      return 'recovered';
    });

    const result = await limiter.execute(op);
    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenNthCalledWith(1, 1000, expect.anything());
    expect(mockSleep).toHaveBeenNthCalledWith(2, 2000, expect.anything());
  });

  it('should throw RateLimitError when retries are exhausted on 429', async () => {
    const limiter = new RateLimiter({
      baseDelayMs: 500,
      backoffMultiplier: 2.0,
      maxRetries: 2,
      jitter: 0,
      nowFn: mockNow,
      sleepFn: mockSleep
    });

    const op = vi.fn(async () => {
      const err: any = new Error('Google AI 429 RESOURCE_EXHAUSTED');
      err.status = 429;
      throw err;
    });

    await expect(limiter.execute(op)).rejects.toThrow(RateLimitError);
    expect(op).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should wait and retry when token bucket is exhausted', async () => {
    const limiter = new RateLimiter({
      rpm: 60, // 1 token per 1000ms
      capacity: 1,
      baseDelayMs: 1000,
      jitter: 0,
      nowFn: mockNow,
      sleepFn: async (ms: number) => {
        advanceTime(ms);
      }
    });

    // Consume the 1 available token
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.getAvailableTokens()).toBe(0);

    const op = vi.fn(async () => 'completed');

    // Executing should back off until token replenishes or retry succeeds
    const result = await limiter.execute(op);
    expect(result).toBe('completed');
  });

  it('should fail with RateLimitError if token bucket cannot be satisfied within max retries', async () => {
    const limiter = new RateLimiter({
      rpm: 12,
      capacity: 1,
      maxRetries: 2,
      baseDelayMs: 100,
      jitter: 0,
      nowFn: mockNow,
      // sleep without advancing mockTime so tokens never replenish
      sleepFn: vi.fn(async () => {})
    });

    limiter.tryConsume(1); // empty bucket

    const op = vi.fn(async () => 'should not run');
    await expect(limiter.execute(op)).rejects.toThrow(RateLimitError);
    expect(op).not.toHaveBeenCalled();
  });

  it('should throw TimeoutError when operation times out after SLA timeout (8000ms)', async () => {
    const limiter = new RateLimiter({
      timeoutMs: 50, // Short timeout for test
      maxRetries: 0
    });

    const slowOp = (signal: AbortSignal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('slow'), 200);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err: any = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          reject(err);
        });
      });
    };

    await expect(limiter.execute(slowOp)).rejects.toThrow();
  });

  it('should not retry on non-retryable errors (e.g. 400 Bad Request)', async () => {
    const limiter = new RateLimiter({
      maxRetries: 2,
      nowFn: mockNow,
      sleepFn: mockSleep
    });

    const fatalOp = vi.fn(async () => {
      const err: any = new Error('Invalid schema parameter');
      err.status = 400;
      throw err;
    });

    await expect(limiter.execute(fatalOp)).rejects.toThrow('Invalid schema parameter');
    expect(fatalOp).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('should create an SLA timeout signal via createTimeoutSignal', () => {
    const limiter = new RateLimiter({ timeoutMs: 8000 });
    const signal = limiter.createTimeoutSignal();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it('should use default sleep function with real timers when sleepFn is omitted', async () => {
    const limiter = new RateLimiter({
      baseDelayMs: 10,
      maxRetries: 1,
      jitter: 0
    });

    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw { status: 429 };
      }
      return 'finished';
    });

    const result = await limiter.execute(op);
    expect(result).toBe('finished');
    expect(calls).toBe(2);
  });

  it('should abort default sleep immediately if signal is already aborted', async () => {
    const limiter = new RateLimiter();
    const controller = new AbortController();
    controller.abort();

    await expect(limiter.execute(async () => 'never', controller.signal)).rejects.toThrow(
      TimeoutError
    );

    // Also test direct default sleep handler
    await expect((limiter as any).sleep(100, controller.signal)).rejects.toThrow('Aborted');
  });

  it('should abort default sleep mid-sleep when signal triggers abort', async () => {
    const limiter = new RateLimiter({
      rpm: 60,
      capacity: 1,
      baseDelayMs: 200,
      maxRetries: 1,
      jitter: 0
    });

    limiter.tryConsume(1); // empty bucket so it sleeps
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    await expect(limiter.execute(async () => 'never', controller.signal)).rejects.toThrow(
      TimeoutError
    );
  });

  it('should handle non-object errors and non-Error instances cleanly', async () => {
    const limiter = new RateLimiter({ maxRetries: 0 });

    const throwStringOp = vi.fn(async () => {
      throw 'string error message';
    });

    await expect(limiter.execute(throwStringOp)).rejects.toBe('string error message');
  });

  it('should recognize response status 503 and quota string errors as retryable', async () => {
    const limiter = new RateLimiter({
      baseDelayMs: 5,
      maxRetries: 1,
      jitter: false
    });

    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw { response: { status: 503 } };
      }
      return 'ok';
    });

    const res = await limiter.execute(op);
    expect(res).toBe('ok');
    expect(calls).toBe(2);
  });

  it('should support disabling jitter via jitter: false and custom jitter numbers', () => {
    const noJitter = new RateLimiter({ jitter: false, baseDelayMs: 100 });
    expect(noJitter.calculateBackoff(0)).toBe(100);

    const customJitter = new RateLimiter({ jitter: 50, baseDelayMs: 100 });
    const backoff = customJitter.calculateBackoff(0);
    expect(backoff).toBeGreaterThanOrEqual(100);
    expect(backoff).toBeLessThanOrEqual(150);
  });

  it('should abort retry sleep in Phase 2 when signal triggers abort', async () => {
    const limiter = new RateLimiter({
      baseDelayMs: 200,
      maxRetries: 2,
      jitter: 0
    });

    const controller = new AbortController();
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        setTimeout(() => controller.abort(), 20);
        throw { status: 429 };
      }
      return 'ok';
    });

    await expect(limiter.execute(op, controller.signal)).rejects.toThrow(TimeoutError);
  });

  it('should throw RateLimitError if sleepFn fails without abort during token acquisition', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      sleepFn: async () => {
        throw new Error('Timer failure');
      }
    });
    limiter.tryConsume(1);
    await expect(limiter.execute(async () => 'ok')).rejects.toThrow(RateLimitError);
  });

  it('should rethrow original error if sleepFn fails without abort during retry loop', async () => {
    const limiter = new RateLimiter({
      maxRetries: 1,
      sleepFn: async () => {
        throw new Error('Timer failure');
      }
    });
    const op = vi.fn(async () => {
      throw { status: 429, message: 'Original 429 error' };
    });
    await expect(limiter.execute(op)).rejects.toMatchObject({ status: 429 });
  });

  it('should throw TimeoutError if signal is aborted before Phase 2 retry', async () => {
    const controller = new AbortController();
    const limiter = new RateLimiter({
      maxRetries: 1,
      sleepFn: async () => {
        controller.abort();
      }
    });

    const op = vi.fn(async () => {
      throw { status: 429 };
    });

    await expect(limiter.execute(op, controller.signal)).rejects.toThrow(TimeoutError);
  });

  it('should throw RateLimitError if sleepFn fails without abort during token acquisition', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      sleepFn: async () => {
        throw new Error('Timer failure');
      }
    });
    limiter.tryConsume(1);
    await expect(limiter.execute(async () => 'ok')).rejects.toThrow(RateLimitError);
  });

  it('should rethrow original error if sleepFn fails without abort during retry loop', async () => {
    const limiter = new RateLimiter({
      maxRetries: 1,
      sleepFn: async () => {
        throw new Error('Timer failure');
      }
    });
    const op = vi.fn(async () => {
      throw { status: 429, message: 'Original 429 error' };
    });
    await expect(limiter.execute(op)).rejects.toMatchObject({ status: 429 });
  });
});
