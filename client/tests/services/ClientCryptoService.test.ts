import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ClientCryptoService,
  clientCryptoService,
  InvalidKeyError,
  DecryptionError,
  NoActiveKeyError
} from '../../src/services/ClientCryptoService';

describe('ClientCryptoService', () => {
  beforeEach(() => {
    ClientCryptoService.logout();
  });

  afterEach(() => {
    ClientCryptoService.logout();
  });

  describe('Key Management & Ephemeral Memory Zeroing', () => {
    it('generates a 32-byte (256-bit) cryptographically random key', () => {
      const key = ClientCryptoService.generateKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.byteLength).toBe(32);
      expect(key.some(b => b !== 0)).toBe(true);
    });

    it('zeroKey sets all bytes in the buffer to 0', () => {
      const key = ClientCryptoService.generateKey();
      expect(key.some(b => b !== 0)).toBe(true);
      ClientCryptoService.zeroKey(key);
      expect(key.every(b => b === 0)).toBe(true);
    });

    it('normalizes 32-byte Uint8Array correctly', () => {
      const key = ClientCryptoService.generateKey();
      const normalized = ClientCryptoService.normalizeKey(key);
      expect(normalized.byteLength).toBe(32);
    });

    it('normalizes 64-character hex string into 32-byte Uint8Array', () => {
      const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const normalized = ClientCryptoService.normalizeKey(hexKey);
      expect(normalized.byteLength).toBe(32);
      expect(normalized[0]).toBe(0x01);
      expect(normalized[1]).toBe(0x23);
    });

    it('normalizes valid Base64 string into 32-byte Uint8Array', () => {
      const raw = ClientCryptoService.generateKey();
      const b64 = Buffer.from(raw).toString('base64');
      const normalized = ClientCryptoService.normalizeKey(b64);
      expect(normalized.byteLength).toBe(32);
      expect(Array.from(normalized)).toEqual(Array.from(raw));
    });

    it('throws InvalidKeyError when key length is invalid', () => {
      expect(() => ClientCryptoService.normalizeKey(new Uint8Array(16))).toThrow(InvalidKeyError);
      expect(() => ClientCryptoService.normalizeKey('shortKey')).toThrow(InvalidKeyError);
      expect(() => ClientCryptoService.normalizeKey(123 as unknown as string)).toThrow(InvalidKeyError);
      expect(() => ClientCryptoService.normalizeKey('invalid base64!!!')).toThrow(InvalidKeyError);
    });

    it('initializes and manages KEY_STORE in session memory', () => {
      expect(ClientCryptoService.hasSessionKey()).toBe(false);
      expect(ClientCryptoService.getSessionKey()).toBeNull();

      ClientCryptoService.initializeSessionKey();
      expect(ClientCryptoService.hasSessionKey()).toBe(true);
      expect(ClientCryptoService.getSessionKey()?.byteLength).toBe(32);

      // Re-initialize with explicit key
      const explicit = ClientCryptoService.generateKey();
      ClientCryptoService.initializeSessionKey(explicit);
      expect(Array.from(ClientCryptoService.getSessionKey()!)).toEqual(Array.from(explicit));
    });

    it('logout zeroes memory buffer and clears KEY_STORE', () => {
      ClientCryptoService.initializeSessionKey();
      expect(ClientCryptoService.hasSessionKey()).toBe(true);

      const beforeLogout = ClientCryptoService.getSessionKey()!;
      expect(beforeLogout.some(b => b !== 0)).toBe(true);

      ClientCryptoService.logout();
      expect(ClientCryptoService.hasSessionKey()).toBe(false);
      expect(ClientCryptoService.getSessionKey()).toBeNull();
    });

    it('exportKeyForHeader returns Base64 key string or throws NoActiveKeyError', () => {
      expect(() => ClientCryptoService.exportKeyForHeader()).toThrow(NoActiveKeyError);

      const key = ClientCryptoService.initializeSessionKey();
      const headerVal = ClientCryptoService.exportKeyForHeader();
      expect(typeof headerVal).toBe('string');
      expect(Buffer.from(headerVal, 'base64').byteLength).toBe(32);
      expect(Array.from(Buffer.from(headerVal, 'base64'))).toEqual(Array.from(key));
    });
  });

  describe('AES-256-GCM Encryption & Decryption', () => {
    it('encrypts and decrypts arbitrary payload using active session key', async () => {
      ClientCryptoService.initializeSessionKey();
      const testData = { memo: 'Confidential strategic decision', count: 42, active: true };

      const encrypted = await ClientCryptoService.encrypt(testData);
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.authTag).toBeTruthy();
      expect(encrypted.keyId).toBe('v1');

      const decrypted = await ClientCryptoService.decrypt<typeof testData>(encrypted);
      expect(decrypted).toEqual(testData);
    });

    it('encrypts and decrypts with an explicitly supplied key', async () => {
      const customKey = ClientCryptoService.generateKey();
      const testData = { secret: 'top-secret-cleartext' };

      const encrypted = await ClientCryptoService.encrypt(testData, customKey, 'v2');
      expect(encrypted.keyId).toBe('v2');

      const decrypted = await ClientCryptoService.decrypt<typeof testData>(encrypted, customKey);
      expect(decrypted).toEqual(testData);
    });

    it('throws NoActiveKeyError when encrypting without session key or explicit key', async () => {
      expect(ClientCryptoService.hasSessionKey()).toBe(false);
      await expect(ClientCryptoService.encrypt({ test: 1 })).rejects.toThrow(NoActiveKeyError);
    });

    it('throws NoActiveKeyError when decrypting without session key or explicit key', async () => {
      ClientCryptoService.initializeSessionKey();
      const encrypted = await ClientCryptoService.encrypt({ a: 1 });
      ClientCryptoService.logout();

      await expect(ClientCryptoService.decrypt(encrypted)).rejects.toThrow(NoActiveKeyError);
    });

    it('throws DecryptionError when ciphertext has been tampered', async () => {
      ClientCryptoService.initializeSessionKey();
      const encrypted = await ClientCryptoService.encrypt({ message: 'Untampered' });

      // Tamper ciphertext
      const rawCt = Buffer.from(encrypted.ciphertext, 'base64');
      rawCt[0] ^= 0xff;
      const tampered = { ...encrypted, ciphertext: rawCt.toString('base64') };

      await expect(ClientCryptoService.decrypt(tampered)).rejects.toThrow(DecryptionError);
    });

    it('throws DecryptionError when authTag does not match', async () => {
      ClientCryptoService.initializeSessionKey();
      const encrypted = await ClientCryptoService.encrypt({ message: 'Authentic' });

      // Tamper authTag
      const rawTag = Buffer.from(encrypted.authTag, 'base64');
      rawTag[0] ^= 0xff;
      const tampered = { ...encrypted, authTag: rawTag.toString('base64') };

      await expect(ClientCryptoService.decrypt(tampered)).rejects.toThrow(DecryptionError);
    });

    it('throws DecryptionError on invalid IV length', async () => {
      ClientCryptoService.initializeSessionKey();
      const encrypted = await ClientCryptoService.encrypt({ message: 'Test' });
      const invalidIvPayload = {
        ...encrypted,
        iv: Buffer.from(new Uint8Array(8)).toString('base64') // 8 bytes instead of 12
      };

      await expect(ClientCryptoService.decrypt(invalidIvPayload)).rejects.toThrow(DecryptionError);
    });

    it('throws DecryptionError on invalid authTag length', async () => {
      ClientCryptoService.initializeSessionKey();
      const encrypted = await ClientCryptoService.encrypt({ message: 'Test' });
      const invalidTagPayload = {
        ...encrypted,
        authTag: Buffer.from(new Uint8Array(8)).toString('base64') // 8 bytes instead of 16
      };

      await expect(ClientCryptoService.decrypt(invalidTagPayload)).rejects.toThrow(DecryptionError);
    });
  });

  describe('Instance Bridge Methods', () => {
    it('delegates instance calls to static methods seamlessly', async () => {
      clientCryptoService.initializeSessionKey();
      expect(clientCryptoService.hasSessionKey()).toBe(true);
      expect(clientCryptoService.getSessionKey()?.byteLength).toBe(32);
      expect(clientCryptoService.exportKeyForHeader()).toBeTruthy();

      const enc = await clientCryptoService.encrypt({ msg: 'hello' });
      const dec = await clientCryptoService.decrypt<{ msg: string }>(enc);
      expect(dec.msg).toBe('hello');

      clientCryptoService.logout();
      expect(clientCryptoService.hasSessionKey()).toBe(false);
    });
  });
});
