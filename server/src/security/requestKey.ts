import { Request } from 'express';

export const HEADER_ENCRYPTION_KEY = 'x-oscar-encryption-key';

/**
 * Fallback static 256-bit (32-byte) server key used in single-tenant or mock mode
 * when neither the client header nor OSCAR_MASTER_KEY environment variable is configured.
 */
const DEFAULT_SERVER_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/**
 * Resolves the AES-256-GCM encryption key for the active request lifecycle.
 * Prioritizes the client-supplied ephemeral header `X-Oscar-Encryption-Key`,
 * followed by the server environment variable `OSCAR_MASTER_KEY`, and falls back
 * to a deterministic server development key.
 *
 * @param req Express Request object.
 * @returns 32-byte Uint8Array encryption key buffer.
 */
export function getEncryptionKeyFromRequest(req: Request): Uint8Array {
  const headerKey = req.headers[HEADER_ENCRYPTION_KEY];
  if (typeof headerKey === 'string') {
    const trimmed = headerKey.trim();
    if (trimmed.length > 0) {
      const buffer = Buffer.from(trimmed, 'base64');
      if (buffer.length === 32) {
        return new Uint8Array(buffer);
      }
    }
  }

  const envKey = process.env.OSCAR_MASTER_KEY;
  if (envKey) {
    const trimmed = envKey.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const buffer = Buffer.from(trimmed, 'hex');
      if (buffer.length === 32) {
        return new Uint8Array(buffer);
      }
    }
    const buffer = Buffer.from(trimmed, 'base64');
    if (buffer.length === 32) {
      return new Uint8Array(buffer);
    }
  }

  return new Uint8Array(Buffer.from(DEFAULT_SERVER_KEY_HEX, 'hex'));
}
