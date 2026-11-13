import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError, z } from 'zod';
import { errorHandler, NotFoundError } from '../../src/middleware/errorHandler.js';
import { DecryptionError, InvalidKeyError } from '../../src/security/EncryptionService.js';
import { logger } from '../../src/utils/logger.js';

function createMockReq(method = 'POST', path = '/api/memos'): Request {
  return {
    method,
    path,
    body: { content: 'Sensitive PII John Doe 1234567890' },
  } as unknown as Request;
}

function createMockRes(): {
  res: Response;
  statusCode: number | undefined;
  body: unknown;
} {
  const state: {
    res: Response;
    statusCode: number | undefined;
    body: unknown;
  } = {
    statusCode: undefined,
    body: undefined,
    res: {} as Response,
  };

  state.res = {
    headersSent: false,
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return state.res;
    }),
    json: vi.fn((payload: unknown) => {
      state.body = payload;
      return state.res;
    }),
  } as unknown as Response;

  return state;
}

describe('errorHandler Middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps InvalidKeyError to HTTP 400 and logs safely', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createMockReq('POST', '/api/memos');
    const mock = createMockRes();
    const next = vi.fn() as NextFunction;

    errorHandler(new InvalidKeyError('Invalid key length'), req, mock.res, next);

    expect(mock.statusCode).toBe(400);
    expect(mock.body).toEqual({
      error: 'Invalid encryption key',
      code: 'INVALID_ENCRYPTION_KEY',
      message: 'Invalid key length',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'ErrorHandler',
      'POST /api/memos failed with status 400',
      expect.objectContaining({
        name: 'InvalidKeyError',
        status: 400,
        code: 'INVALID_ENCRYPTION_KEY',
        method: 'POST',
        path: '/api/memos',
      }),
    );
  });

  it('maps DecryptionError to HTTP 422 with DECRYPTION_FAILED code', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createMockReq('PATCH', '/api/tasks/task_123');
    const mock = createMockRes();
    const next = vi.fn() as NextFunction;

    errorHandler(new DecryptionError('Tag mismatch'), req, mock.res, next);

    expect(mock.statusCode).toBe(422);
    expect(mock.body).toEqual({
      error: 'Decryption failed',
      code: 'DECRYPTION_FAILED',
      message: 'Failed to decrypt payload with the provided encryption key',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'ErrorHandler',
      'PATCH /api/tasks/task_123 failed with status 422',
      expect.objectContaining({
        name: 'DecryptionError',
        status: 422,
        code: 'DECRYPTION_FAILED',
        method: 'PATCH',
        path: '/api/tasks/task_123',
      }),
    );
  });

  it('maps NotFoundError to HTTP 404', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createMockReq('GET', '/api/tasks/missing');
    const mock = createMockRes();
    const next = vi.fn() as NextFunction;

    errorHandler(new NotFoundError('Task not found'), req, mock.res, next);

    expect(mock.statusCode).toBe(404);
    expect(mock.body).toEqual({
      error: 'Not found',
      message: 'Task not found',
    });
  });

  it('maps PayloadTooLargeError (413) to HTTP 413', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createMockReq('POST', '/api/memos');
    const mock = createMockRes();
    const next = vi.fn() as NextFunction;

    const err = Object.assign(new Error('request entity too large'), {
      name: 'PayloadTooLargeError',
      status: 413,
      type: 'entity.too.large',
    });

    errorHandler(err, req, mock.res, next);

    expect(mock.statusCode).toBe(413);
    expect(mock.body).toEqual({
      error: 'Payload too large',
      message: 'The request payload exceeds the maximum allowed size',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'ErrorHandler',
      'POST /api/memos failed with status 413',
      expect.objectContaining({
        name: 'PayloadTooLargeError',
        status: 413,
        method: 'POST',
        path: '/api/memos',
      }),
    );
  });

  it('maps UnsupportedMediaTypeError (415) to HTTP 415', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createMockReq('POST', '/api/memos');
    const mock = createMockRes();
    const next = vi.fn() as NextFunction;

    const err = Object.assign(new Error('unsupported charset'), {
      name: 'UnsupportedMediaTypeError',
      status: 415,
      type: 'encoding.unsupported',
    });

    errorHandler(err, req, mock.res, next);

    expect(mock.statusCode).toBe(415);
    expect(mock.body).toEqual({
      error: 'Unsupported media type',
      message: 'The request Content-Type or encoding is not supported',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'ErrorHandler',
      'POST /api/memos failed with status 415',
      expect.objectContaining({
        name: 'UnsupportedMediaTypeError',
        status: 415,
        method: 'POST',
        path: '/api/memos',
      }),
    );
  });

  it('maps ZodError to HTTP 400 and SyntaxError (400) to HTTP 400', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createMockReq('POST', '/api/memos');
    const next = vi.fn() as NextFunction;

    const parsed = z.object({ content: z.string().min(5) }).safeParse({ content: 'a' });
    const zodErr = parsed.success ? new ZodError([]) : parsed.error;
    const mockZod = createMockRes();
    errorHandler(zodErr, req, mockZod.res, next);
    expect(mockZod.statusCode).toBe(400);
    expect((mockZod.body as { error: string }).error).toBe('Validation failed');

    const syntaxErr = Object.assign(new SyntaxError('Unexpected token'), { status: 400 });
    const mockSyntax = createMockRes();
    errorHandler(syntaxErr, req, mockSyntax.res, next);
    expect(mockSyntax.statusCode).toBe(400);
    expect((mockSyntax.body as { error: string }).error).toBe('Invalid JSON payload');
  });

  it('maps unexpected errors to HTTP 500 without leaking PII or stack traces in logs or response', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createMockReq('POST', '/api/memos');
    const mock = createMockRes();
    const next = vi.fn() as NextFunction;

    const sensitiveErr = new Error('DB crash with PII user@secret.com');
    errorHandler(sensitiveErr, req, mock.res, next);

    expect(mock.statusCode).toBe(500);
    expect(JSON.stringify(mock.body)).not.toContain('user@secret.com');
    expect(JSON.stringify(mock.body)).not.toContain('stack');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('user@secret.com');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('Sensitive PII');
  });
});
