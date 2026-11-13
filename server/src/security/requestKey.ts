import { Request } from 'express';
import { InvalidKeyError } from './EncryptionService.js';
import { logger } from '../utils/logger.js';

export const HEADER_ENCRYPTION_KEY = 'x-oscar-encryption-key';
const EXPECTED_KEY_BYTES = 32;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const HEX_64_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Fallback static 256-bit (32-byte) server key used ONLY in local development mode
 * when neither the client header nor OSCAR_MASTER_KEY environment variable is configured.
 */
const DEFAULT_SERVER_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/**
 * Parses and validates a 32-byte base64-encoded encryption key.
 *
 * @param rawValue Raw base64 string from request header.
 * @returns Validated 32-byte Uint8Array key buffer.
 * @throws InvalidKeyError when the string is empty, malformed base64, or not 32 bytes.
 */
function parseBase64Key(rawValue: string): Uint8Array {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0 || trimmed.length % 4 !== 0 || !BASE64_PATTERN.test(trimmed)) {
    throw new InvalidKeyError('Invalid X-Oscar-Encryption-Key header: expected valid 32-byte base64 string');
  }

  const buffer = Buffer.from(trimmed, 'base64');
  if (buffer.length !== EXPECTED_KEY_BYTES) {
    throw new InvalidKeyError(
      `Invalid X-Oscar-Encryption-Key header: expected ${EXPECTED_KEY_BYTES} bytes, got ${buffer.length} bytes`,
    );
  }

  return new Uint8Array(buffer);
}

/**
 * Parses and validates the server OSCAR_MASTER_KEY (64-char hex or 32-byte base64).
 *
 * @param rawMasterKey Raw OSCAR_MASTER_KEY value.
 * @returns Validated 32-byte Uint8Array key buffer.
 * @throws InvalidKeyError when the key is missing, empty, or malformed.
 */
export function parseMasterKey(rawMasterKey: string | undefined): Uint8Array {
  if (!rawMasterKey || rawMasterKey.trim().length === 0) {
    throw new InvalidKeyError('OSCAR_MASTER_KEY is required and must be a 64-char hex or 32-byte base64 key');
  }

  const trimmed = rawMasterKey.trim();
  if (HEX_64_PATTERN.test(trimmed)) {
    const buffer = Buffer.from(trimmed, 'hex');
    if (buffer.length === EXPECTED_KEY_BYTES) {
      return new Uint8Array(buffer);
    }
  }

  if (trimmed.length % 4 === 0 && BASE64_PATTERN.test(trimmed)) {
    const buffer = Buffer.from(trimmed, 'base64');
    if (buffer.length === EXPECTED_KEY_BYTES) {
      return new Uint8Array(buffer);
    }
  }

  throw new InvalidKeyError(
    'Invalid OSCAR_MASTER_KEY: must be a 64-character hex string or valid 32-byte base64 string',
  );
}

/**
 * Resolves the AES-256-GCM encryption key for the active request lifecycle.
 * Prioritizes the client-supplied ephemeral header `X-Oscar-Encryption-Key`,
 * followed by the server environment variable `OSCAR_MASTER_KEY`.
 * Falls back to the static development key ONLY when `NODE_ENV === 'development'`.
 *
 * @param req Express Request object.
 * @returns 32-byte Uint8Array encryption key buffer.
 * @throws InvalidKeyError when the header is malformed or no valid key is available.
 */
export function getEncryptionKeyFromRequest(req: Request): Uint8Array {
  const headerKey = req.headers[HEADER_ENCRYPTION_KEY];
  if (headerKey !== undefined) {
    if (typeof headerKey !== 'string') {
      throw new InvalidKeyError('Invalid X-Oscar-Encryption-Key header: expected a single string value');
    }
    return parseBase64Key(headerKey);
  }

  const envKey = process.env.OSCAR_MASTER_KEY;
  if (envKey !== undefined && envKey.trim().length > 0) {
    return parseMasterKey(envKey);
  }

  if (process.env.NODE_ENV === 'development') {
    logger.warn(
      'Security',
      'OSCAR_MASTER_KEY is not configured and X-Oscar-Encryption-Key header is missing; using static development fallback key',
    );
    return new Uint8Array(Buffer.from(DEFAULT_SERVER_KEY_HEX, 'hex'));
  }

  throw new InvalidKeyError(
    'Encryption key required: provide X-Oscar-Encryption-Key header or configure OSCAR_MASTER_KEY',
  );
}
