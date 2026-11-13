import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request } from 'express';
import {
  getEncryptionKeyFromRequest,
  parseMasterKey,
  HEADER_ENCRYPTION_KEY,
} from '../../src/security/requestKey.js';
import { EncryptionService, InvalidKeyError } from '../../src/security/EncryptionService.js';
import { logger } from '../../src/utils/logger.js';

describe('requestKey security helper', () => {
  const originalMasterKey = process.env.OSCAR_MASTER_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.OSCAR_MASTER_KEY;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    if (originalMasterKey !== undefined) {
      process.env.OSCAR_MASTER_KEY = originalMasterKey;
    } else {
      delete process.env.OSCAR_MASTER_KEY;
    }

    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    vi.restoreAllMocks();
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

  it('throws InvalidKeyError when header key base64 length is invalid (never silently falls back)', () => {
    process.env.NODE_ENV = 'development';
    process.env.OSCAR_MASTER_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const req = {
      headers: {
        [HEADER_ENCRYPTION_KEY]: 'invalid_short_base64',
      },
    } as unknown as Request;

    expect(() => getEncryptionKeyFromRequest(req)).toThrow(InvalidKeyError);
  });

  it('throws InvalidKeyError when header key is empty or contains non-base64 characters', () => {
    const emptyReq = {
      headers: {
        [HEADER_ENCRYPTION_KEY]: '   ',
      },
    } as unknown as Request;
    expect(() => getEncryptionKeyFromRequest(emptyReq)).toThrow(InvalidKeyError);

    const badCharsReq = {
      headers: {
        [HEADER_ENCRYPTION_KEY]: '!@#$%^&*()!@#$%^&*()!@#$%^&*()!@#$%^&*()!@#=',
      },
    } as unknown as Request;
    expect(() => getEncryptionKeyFromRequest(badCharsReq)).toThrow(InvalidKeyError);
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

  it('throws InvalidKeyError when OSCAR_MASTER_KEY has invalid length or format', () => {
    process.env.OSCAR_MASTER_KEY = 'short_invalid_key';

    const req = { headers: {} } as unknown as Request;
    expect(() => getEncryptionKeyFromRequest(req)).toThrow(InvalidKeyError);
  });

  it('throws InvalidKeyError when neither header nor OSCAR_MASTER_KEY is present in test or production', () => {
    const req = { headers: {} } as unknown as Request;

    process.env.NODE_ENV = 'test';
    expect(() => getEncryptionKeyFromRequest(req)).toThrow(InvalidKeyError);

    process.env.NODE_ENV = 'production';
    expect(() => getEncryptionKeyFromRequest(req)).toThrow(InvalidKeyError);
  });

  it('allows static dev fallback key with loud logger.warn ONLY when NODE_ENV is development', () => {
    process.env.NODE_ENV = 'development';
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const req = { headers: {} } as unknown as Request;
    const resolved = getEncryptionKeyFromRequest(req);

    expect(resolved.byteLength).toBe(32);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Security',
      expect.stringContaining('static development fallback key'),
    );
  });

  it('parseMasterKey rejects undefined and malformed keys', () => {
    expect(() => parseMasterKey(undefined)).toThrow(InvalidKeyError);
    expect(() => parseMasterKey('')).toThrow(InvalidKeyError);
    expect(() => parseMasterKey('not-valid-key')).toThrow(InvalidKeyError);
  });
});
