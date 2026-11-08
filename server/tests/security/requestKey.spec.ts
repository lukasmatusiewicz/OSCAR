import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Request } from 'express';
import {
  getEncryptionKeyFromRequest,
  HEADER_ENCRYPTION_KEY,
} from '../../src/security/requestKey.js';
import { EncryptionService } from '../../src/security/EncryptionService.js';

describe('requestKey security helper', () => {
  const originalEnv = process.env.OSCAR_MASTER_KEY;

  beforeEach(() => {
    delete process.env.OSCAR_MASTER_KEY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OSCAR_MASTER_KEY = originalEnv;
    } else {
      delete process.env.OSCAR_MASTER_KEY;
    }
  });

  it('extracts key from valid X-Oscar-Encryption-Key base64 header', () => {
    const rawKey = EncryptionService.generateKey();
    const base64 = Buffer.from(rawKey).toString('base64');

    const req = {
      headers: {
        [HEADER_ENCRYPTION_KEY]: base64,
      },
    } as unknown as Request;

    const resolved = getEncryptionKeyFromRequest(req);
    expect(resolved.byteLength).toBe(32);
    expect(Buffer.from(resolved).toString('base64')).toBe(base64);
  });

  it('falls back when header key base64 length is invalid', () => {
    const req = {
      headers: {
        [HEADER_ENCRYPTION_KEY]: 'invalid_short_base64',
      },
    } as unknown as Request;

    const resolved = getEncryptionKeyFromRequest(req);
    expect(resolved.byteLength).toBe(32);
  });

  it('extracts key from OSCAR_MASTER_KEY when configured as 64-character hex string', () => {
    const hex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.OSCAR_MASTER_KEY = hex;

    const req = { headers: {} } as unknown as Request;
    const resolved = getEncryptionKeyFromRequest(req);

    expect(resolved.byteLength).toBe(32);
    expect(Buffer.from(resolved).toString('hex')).toBe(hex);
  });

  it('extracts key from OSCAR_MASTER_KEY when configured as 32-byte base64 string', () => {
    const rawKey = EncryptionService.generateKey();
    const base64 = Buffer.from(rawKey).toString('base64');
    process.env.OSCAR_MASTER_KEY = base64;

    const req = { headers: {} } as unknown as Request;
    const resolved = getEncryptionKeyFromRequest(req);

    expect(resolved.byteLength).toBe(32);
    expect(Buffer.from(resolved).toString('base64')).toBe(base64);
  });

  it('falls back to default static key when OSCAR_MASTER_KEY has invalid length', () => {
    process.env.OSCAR_MASTER_KEY = 'short_invalid_key';

    const req = { headers: {} } as unknown as Request;
    const resolved = getEncryptionKeyFromRequest(req);

    expect(resolved.byteLength).toBe(32);
  });

  it('returns default static key when neither header nor env var is present', () => {
    const req = { headers: {} } as unknown as Request;
    const resolved = getEncryptionKeyFromRequest(req);

    expect(resolved.byteLength).toBe(32);
  });
});
