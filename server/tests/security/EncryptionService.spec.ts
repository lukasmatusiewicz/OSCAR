import { describe, it, expect, vi } from 'vitest';
import {
  EncryptionService,
  DecryptionError,
  InvalidKeyError
} from '../../src/security/EncryptionService.js';
import { EncryptedPayloadSchema } from '../../src/types/contracts.js';

describe('EncryptionService', () => {
  it('should encrypt and decrypt a JSON payload preserving roundtrip invariance', async () => {
    const rawKey = EncryptionService.generateKey();
    const originalPayload = {
      title: 'Approve budget with [PERSON_1]',
      summary: 'Critical financial review',
      subtasks: [{ title: 'Check invoice', completed: false }]
    };

    const encrypted = await EncryptionService.encrypt(originalPayload, rawKey);

    expect(EncryptedPayloadSchema.safeParse(encrypted).success).toBe(true);
    expect(encrypted.keyId).toBe('v1');
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();

    const decrypted = await EncryptionService.decrypt(encrypted, rawKey);
    expect(decrypted).toEqual(originalPayload);
  });

  it('should support Base64 string keys', async () => {
    const rawKey = EncryptionService.generateKey();
    const base64Key = Buffer.from(rawKey).toString('base64');
    const payload = { test: 'base64-key' };

    const encrypted = await EncryptionService.encrypt(payload, base64Key);
    const decrypted = await EncryptionService.decrypt(encrypted, base64Key);

    expect(decrypted).toEqual(payload);
  });

  it('should support hex string keys (64 hex characters = 32 bytes)', async () => {
    const rawKey = EncryptionService.generateKey();
    const hexKey = Buffer.from(rawKey).toString('hex');
    const payload = { test: 'hex-key' };

    const encrypted = await EncryptionService.encrypt(payload, hexKey);
    const decrypted = await EncryptionService.decrypt(encrypted, hexKey);

    expect(decrypted).toEqual(payload);
  });

  it('should generate a unique 96-bit (12-byte) IV for each encryption call', async () => {
    const key = EncryptionService.generateKey();
    const payload = { msg: 'identical content' };

    const enc1 = await EncryptionService.encrypt(payload, key);
    const enc2 = await EncryptionService.encrypt(payload, key);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

    // Verify IV length in bytes is 12 (96 bits)
    const iv1Bytes = Buffer.from(enc1.iv, 'base64');
    const iv2Bytes = Buffer.from(enc2.iv, 'base64');
    expect(iv1Bytes.length).toBe(12);
    expect(iv2Bytes.length).toBe(12);
  });

  it('should verify authTag is 128-bit (16-byte)', async () => {
    const key = EncryptionService.generateKey();
    const payload = { hello: 'world' };

    const enc = await EncryptionService.encrypt(payload, key);
    const tagBytes = Buffer.from(enc.authTag, 'base64');
    expect(tagBytes.length).toBe(16);
  });

  it('should reject invalid key lengths (< 32 bytes or > 32 bytes)', async () => {
    const shortKey = new Uint8Array(16); // 128-bit key not allowed for AES-256
    const payload = { secret: 'data' };

    await expect(EncryptionService.encrypt(payload, shortKey)).rejects.toThrow(InvalidKeyError);
    await expect(
      EncryptionService.decrypt(
        { ciphertext: 'abc', iv: 'abc', authTag: 'abc', keyId: 'v1' },
        shortKey
      )
    ).rejects.toThrow(InvalidKeyError);
  });

  it('should fail decryption when ciphertext is tampered with', async () => {
    const key = EncryptionService.generateKey();
    const payload = { secret: 'unaltered' };

    const encrypted = await EncryptionService.encrypt(payload, key);

    // Tamper with ciphertext by corrupting bytes
    const cipherBuf = Buffer.from(encrypted.ciphertext, 'base64');
    cipherBuf[0] ^= 0xff;
    const tampered = {
      ...encrypted,
      ciphertext: cipherBuf.toString('base64')
    };

    await expect(EncryptionService.decrypt(tampered, key)).rejects.toThrow(DecryptionError);
  });

  it('should fail decryption when authTag is tampered with', async () => {
    const key = EncryptionService.generateKey();
    const payload = { secret: 'unaltered' };

    const encrypted = await EncryptionService.encrypt(payload, key);

    // Tamper with auth tag
    const tagBuf = Buffer.from(encrypted.authTag, 'base64');
    tagBuf[0] ^= 0xff;
    const tampered = {
      ...encrypted,
      authTag: tagBuf.toString('base64')
    };

    await expect(EncryptionService.decrypt(tampered, key)).rejects.toThrow(DecryptionError);
  });

  it('should fail decryption when wrong key is supplied', async () => {
    const key1 = EncryptionService.generateKey();
    const key2 = EncryptionService.generateKey();
    const payload = { secret: 'confidential' };

    const encrypted = await EncryptionService.encrypt(payload, key1);
    await expect(EncryptionService.decrypt(encrypted, key2)).rejects.toThrow(DecryptionError);
  });

  it('should zero out ephemeral session key buffer with zeroKey', () => {
    const key = EncryptionService.generateKey();
    expect(key.some(byte => byte !== 0)).toBe(true);

    EncryptionService.zeroKey(key);
    expect(key.every(byte => byte === 0)).toBe(true);
  });

  it('should zero session key buffer reliably via withSessionKey even when errors occur', async () => {
    const sessionKey = EncryptionService.generateKey();
    const keyCopy = new Uint8Array(sessionKey);

    let observedDuringExecution = false;

    await EncryptionService.withSessionKey(sessionKey, async key => {
      observedDuringExecution = key.some(b => b !== 0);
      const encrypted = await EncryptionService.encrypt({ test: true }, key);
      const decrypted = await EncryptionService.decrypt<{ test: boolean }>(encrypted, key);
      expect(decrypted.test).toBe(true);
    });

    expect(observedDuringExecution).toBe(true);
    // Buffer must be all zeroes after withSessionKey
    expect(sessionKey.every(b => b === 0)).toBe(true);

    // Test with exception thrown
    const errorKey = EncryptionService.generateKey();
    await expect(
      EncryptionService.withSessionKey(errorKey, async () => {
        throw new Error('Failure during processing');
      })
    ).rejects.toThrow('Failure during processing');

    // Buffer must still be zeroed out
    expect(errorKey.every(b => b === 0)).toBe(true);
  });

  it('should reject malformed EncryptedPayload objects', async () => {
    const key = EncryptionService.generateKey();
    const malformed = {
      ciphertext: '',
      iv: '',
      authTag: '',
      keyId: 'v1'
    };

    await expect(EncryptionService.decrypt(malformed as any, key)).rejects.toThrow();
  });

  it('should reject non-string and non-Uint8Array key types', async () => {
    const payload = { test: true };
    await expect(EncryptionService.encrypt(payload, 12345 as any)).rejects.toThrow(InvalidKeyError);
  });

  it('should reject payload with invalid IV byte length during decryption', async () => {
    const key = EncryptionService.generateKey();
    const invalidIvPayload = {
      ciphertext: Buffer.from('some-data').toString('base64'),
      iv: Buffer.from(new Uint8Array(8)).toString('base64'), // 8 bytes instead of 12
      authTag: Buffer.from(new Uint8Array(16)).toString('base64'),
      keyId: 'v1'
    };

    await expect(EncryptionService.decrypt(invalidIvPayload, key)).rejects.toThrow(DecryptionError);
  });

  it('should reject payload with invalid authTag byte length during decryption', async () => {
    const key = EncryptionService.generateKey();
    const invalidTagPayload = {
      ciphertext: Buffer.from('some-data').toString('base64'),
      iv: Buffer.from(new Uint8Array(12)).toString('base64'),
      authTag: Buffer.from(new Uint8Array(10)).toString('base64'), // 10 bytes instead of 16
      keyId: 'v1'
    };

    await expect(EncryptionService.decrypt(invalidTagPayload, key)).rejects.toThrow(DecryptionError);
  });

  it('should format DecryptionError gracefully when subtle.decrypt throws a non-Error string', async () => {
    const key = EncryptionService.generateKey();
    const payload = await EncryptionService.encrypt({ test: 'non-error' }, key);

    const spy = vi.spyOn(globalThis.crypto.subtle, 'decrypt').mockRejectedValueOnce('raw string rejection');

    await expect(EncryptionService.decrypt(payload, key)).rejects.toThrow(
      'Decryption authentication tag verification failed'
    );

    spy.mockRestore();
  });
});
