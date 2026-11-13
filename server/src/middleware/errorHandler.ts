import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { DecryptionError, InvalidKeyError } from '../security/EncryptionService.js';
import { logger } from '../utils/logger.js';

export class NotFoundError extends Error {
  constructor(message = 'The requested resource was not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface StructuredIssue {
  path: string;
  message: string;
  code: string;
}

export interface StructuredValidationErrorResponse {
  error: string;
  issues: StructuredIssue[];
}

export interface StructuredGenericErrorResponse {
  error: string;
  message: string;
  code?: string;
}

interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: string;
}

function getHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const httpErr = err as HttpLikeError;
  if (typeof httpErr.status === 'number') {
    return httpErr.status;
  }
  if (typeof httpErr.statusCode === 'number') {
    return httpErr.statusCode;
  }
  return undefined;
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const code = (err as HttpLikeError).code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function logSafeRequestError(
  err: unknown,
  status: number,
  method: string,
  path: string,
  overrideCode?: string,
): void {
  const name = err instanceof Error ? err.name : 'UnknownError';
  const code = overrideCode ?? getErrorCode(err);

  logger.error('ErrorHandler', `${method} ${path} failed with status ${status}`, {
    name,
    status,
    ...(code ? { code } : {}),
    method,
    path,
  });
}

/**
 * Global structured error handling middleware for Express.
 * Catches Zod validation errors, JSON syntax errors, key/decryption errors,
 * HTTP 413/415/404 errors, and unexpected internal errors.
 * Ensures zero PII and zero stack traces leak across the external API boundary.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const httpStatus = getHttpStatus(err);
  const errorType = err && typeof err === 'object' ? (err as HttpLikeError).type : undefined;

  // 1. Zod schema validation errors -> 400 Bad Request with field issues
  if (err instanceof ZodError) {
    logSafeRequestError(err, 400, req.method, req.path);
    const issues: StructuredIssue[] = err.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
      code: e.code,
    }));

    const response: StructuredValidationErrorResponse = {
      error: 'Validation failed',
      issues,
    };
    return res.status(400).json(response);
  }

  // 2. Body-parser JSON syntax error -> 400 Bad Request
  if (err instanceof SyntaxError && httpStatus === 400) {
    logSafeRequestError(err, 400, req.method, req.path);
    const response: StructuredGenericErrorResponse = {
      error: 'Invalid JSON payload',
      message: 'The request payload contains malformed JSON syntax',
    };
    return res.status(400).json(response);
  }

  // 3. Invalid or missing encryption key -> 400 Bad Request
  if (err instanceof InvalidKeyError) {
    logSafeRequestError(err, 400, req.method, req.path, 'INVALID_ENCRYPTION_KEY');
    const response: StructuredGenericErrorResponse = {
      error: 'Invalid encryption key',
      code: 'INVALID_ENCRYPTION_KEY',
      message: err.message,
    };
    return res.status(400).json(response);
  }

  // 4. Resource not found -> 404 Not Found
  if (err instanceof NotFoundError || (err instanceof Error && err.name === 'NotFoundError')) {
    logSafeRequestError(err, 404, req.method, req.path);
    const response: StructuredGenericErrorResponse = {
      error: 'Not found',
      message: err.message,
    };
    return res.status(404).json(response);
  }

  // 5. Payload too large -> 413 Payload Too Large
  if (
    httpStatus === 413 ||
    (err instanceof Error && err.name === 'PayloadTooLargeError') ||
    errorType === 'entity.too.large'
  ) {
    logSafeRequestError(err, 413, req.method, req.path);
    const response: StructuredGenericErrorResponse = {
      error: 'Payload too large',
      message: 'The request payload exceeds the maximum allowed size',
    };
    return res.status(413).json(response);
  }

  // 6. Unsupported media type -> 415 Unsupported Media Type
  if (
    httpStatus === 415 ||
    (err instanceof Error && err.name === 'UnsupportedMediaTypeError') ||
    errorType === 'encoding.unsupported'
  ) {
    logSafeRequestError(err, 415, req.method, req.path);
    const response: StructuredGenericErrorResponse = {
      error: 'Unsupported media type',
      message: 'The request Content-Type or encoding is not supported',
    };
    return res.status(415).json(response);
  }

  // 7. AES-GCM Decryption failure (e.g. wrong key on PATCH /api/tasks/:id) -> 422 Unprocessable Entity
  if (err instanceof DecryptionError) {
    logSafeRequestError(err, 422, req.method, req.path, 'DECRYPTION_FAILED');
    const response: StructuredGenericErrorResponse = {
      error: 'Decryption failed',
      code: 'DECRYPTION_FAILED',
      message: 'Failed to decrypt payload with the provided encryption key',
    };
    return res.status(422).json(response);
  }

  // 8. Fallback for unexpected internal errors -> 500 Internal Server Error
  logSafeRequestError(err, 500, req.method, req.path);
  const response: StructuredGenericErrorResponse = {
    error: 'Internal server error',
    message: 'An unexpected internal error occurred while processing the request',
  };
  return res.status(500).json(response);
};

