import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

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
}

/**
 * Global structured error handling middleware for Express.
 * Catches Zod validation errors, JSON syntax errors, and unexpected internal errors.
 * Ensures zero PII and zero stack traces leak across the external API boundary.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // 1. Zod schema validation errors -> 400 Bad Request with field issues
  if (err instanceof ZodError) {
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
  if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400) {
    const response: StructuredGenericErrorResponse = {
      error: 'Invalid JSON payload',
      message: 'The request payload contains malformed JSON syntax',
    };
    return res.status(400).json(response);
  }

  // 3. Fallback for unexpected internal errors -> 500 Internal Server Error
  const response: StructuredGenericErrorResponse = {
    error: 'Internal server error',
    message: 'An unexpected internal error occurred while processing the request',
  };
  return res.status(500).json(response);
};

