export interface RateLimiterOptions {
  /** Requests per minute (default 12 to safely stay below 15 RPM free tier ceiling) */
  rpm?: number;
  /** Maximum burst capacity in tokens (default 12) */
  capacity?: number;
  /** SLA timeout in milliseconds for operations (default 8,000ms) */
  timeoutMs?: number;
  /** Initial base delay for exponential backoff in milliseconds (default 1,000ms) */
  baseDelayMs?: number;
  /** Multiplier for exponential backoff (default 2.0x) */
  backoffMultiplier?: number;
  /** Maximum number of retry attempts (default 2) */
  maxRetries?: number;
  /** Jitter in milliseconds or boolean (default 200ms) */
  jitter?: number | boolean;
  /** Clock provider for deterministic testing */
  nowFn?: () => number;
  /** Sleep provider for deterministic testing */
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class RateLimitError extends Error {
  public readonly status = 429;
  constructor(message = 'Rate limit exceeded: 12 RPM quota ceiling or max retries exhausted') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends Error {
  public readonly status = 504;
  constructor(message = 'Operation exceeded 8000ms SLA timeout') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * In-memory Token-Bucket Rate Limiter & Resilience Controller.
 * Protects Google AI Studio Free Tier ceiling (15 RPM) with a strict 12 RPM capacity,
 * 8,000ms SLA timeouts, and jittered exponential backoff.
 */
export class RateLimiter {
  private readonly rpm: number;
  private readonly capacity: number;
  private readonly timeoutMs: number;
  private readonly baseDelayMs: number;
  private readonly backoffMultiplier: number;
  private readonly maxRetries: number;
  private readonly jitterMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  private tokens: number;
  private lastRefill: number;

  constructor(options: RateLimiterOptions = {}) {
    this.rpm = options.rpm ?? 12;
    this.capacity = options.capacity ?? 12;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.backoffMultiplier = options.backoffMultiplier ?? 2.0;
    this.maxRetries = options.maxRetries ?? 2;

    if (typeof options.jitter === 'number') {
      this.jitterMs = Math.max(0, options.jitter);
    } else if (options.jitter === false) {
      this.jitterMs = 0;
    } else {
      this.jitterMs = 200;
    }

    this.now = options.nowFn ?? (() => Date.now());
    this.sleep =
      options.sleepFn ??
      ((ms: number, signal?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            return reject(new Error('Aborted'));
          }
          const timer = setTimeout(() => resolve(), ms);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
          });
        }));

    this.tokens = this.capacity;
    this.lastRefill = this.now();
  }

  /**
   * Refills the token bucket based on elapsed time.
   */
  private refill(): void {
    const currentTime = this.now();
    const elapsedMs = Math.max(0, currentTime - this.lastRefill);
    const tokensToAdd = elapsedMs * (this.rpm / 60000);
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = currentTime;
  }

  /**
   * Attempts to consume tokens atomically.
   */
  public tryConsume(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /**
   * Current tokens remaining in the bucket.
   */
  public getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Maximum capacity of the token bucket.
   */
  public getCapacity(): number {
    return this.capacity;
  }

  /**
   * Calculates exponential backoff delay with random jitter.
   */
  public calculateBackoff(attempt: number): number {
    const base = this.baseDelayMs * Math.pow(this.backoffMultiplier, attempt);
    const jitter = this.jitterMs > 0 ? Math.random() * this.jitterMs : 0;
    return Math.round(base + jitter);
  }

  /**
   * Creates an AbortSignal that aborts after the configured SLA timeout (default 8,000ms).
   */
  public createTimeoutSignal(timeoutMs?: number): AbortSignal {
    return AbortSignal.timeout(timeoutMs ?? this.timeoutMs);
  }

  /**
   * Determines whether an error is transient and retryable (e.g. 429, 503, RESOURCE_EXHAUSTED).
   */
  private isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as Record<string, unknown>;
    const status = err.status ?? (err.response as Record<string, unknown> | undefined)?.status;
    if (status === 429 || status === 503) return true;

    const message = typeof err.message === 'string' ? err.message : '';
    return /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|rate limit|quota/i.test(message);
  }

  /**
   * Executes an asynchronous operation under token-bucket rate limiting,
   * retry with jittered exponential backoff, and 8,000ms SLA timeout.
   */
  public async execute<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    customSignal?: AbortSignal,
  ): Promise<T> {
    const timeoutSignal = this.createTimeoutSignal();
    const effectiveSignal = customSignal
      ? AbortSignal.any([timeoutSignal, customSignal])
      : timeoutSignal;

    // Phase 1: Acquire rate limit token with backoff if bucket empty
    let tokenAcquired = false;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (effectiveSignal.aborted) {
        throw new TimeoutError();
      }

      if (this.tryConsume(1)) {
        tokenAcquired = true;
        break;
      }

      if (attempt < this.maxRetries) {
        const delay = this.calculateBackoff(attempt);
        try {
          await this.sleep(delay, effectiveSignal);
        } catch {
          if (effectiveSignal.aborted) {
            throw new TimeoutError();
          }
          throw new RateLimitError();
        }
      }
    }

    if (!tokenAcquired) {
      throw new RateLimitError();
    }

    // Phase 2: Execute operation with retry on transient upstream errors
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (effectiveSignal.aborted) {
        throw new TimeoutError();
      }

      try {
        return await operation(effectiveSignal);
      } catch (err: unknown) {
        lastError = err;

        // If error is due to abort/timeout, fail immediately
        if (effectiveSignal.aborted || (err instanceof Error && err.name === 'TimeoutError')) {
          throw new TimeoutError();
        }

        // Check if error is transient / retryable
        if (this.isRetryableError(err) && attempt < this.maxRetries) {
          const delay = this.calculateBackoff(attempt);
          try {
            await this.sleep(delay, effectiveSignal);
          } catch {
            if (effectiveSignal.aborted) {
              throw new TimeoutError();
            }
            throw err;
          }
          continue;
        }

        if (this.isRetryableError(err)) {
          throw new RateLimitError(
            err instanceof Error ? err.message : 'Upstream rate limit exhausted after retries',
          );
        }

        // Non-retryable error (e.g. 400 Bad Request)
        throw err;
      }
    }

    /* v8 ignore next */
    throw lastError;
  }
}
