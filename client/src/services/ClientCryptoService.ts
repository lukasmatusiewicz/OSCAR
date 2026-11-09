import { EncryptedPayload, EncryptedPayloadSchema } from '../types/contracts';
import { logger } from '../utils/logger';

export class InvalidKeyError extends Error {
  constructor(message = 'Invalid AES-256 key: key must be exactly 32 bytes (256 bits)') {
    super(message);
    this.name = 'InvalidKeyError';
  }
}

export class DecryptionError extends Error {
  constructor(
    message = 'Failed to decrypt payload: authentication tag mismatch or corrupted ciphertext',
  ) {
    super(message);
    this.name = 'DecryptionError';
  }
}

export class NoActiveKeyError extends Error {
  constructor(
    message = 'No active encryption key found in session KEY_STORE. Please login or initialize a key.',
  ) {
    super(message);
    this.name = 'NoActiveKeyError';
  }
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function fromHex(hex: string): Uint8Array {
  const cleaned = hex.trim();
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(cleaned, 'hex'));
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Client-side WebCrypto AES-256-GCM envelope encryption and session key manager.
 * Guarantees zero cleartext PII is persisted, generates 96-bit IVs,
 * validates 128-bit authentication tags, and zeroes ephemeral key memory on logout.
 */
export class ClientCryptoService {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH_BYTES = 32; // 256 bits
  private static readonly IV_LENGTH_BYTES = 12; // 96 bits
  private static readonly TAG_LENGTH_BITS = 128; // 16 bytes

  /**
   * Ephemeral session key store in memory.
   */
  private static KEY_STORE: Uint8Array | null = null;

  /**
   * Generates a cryptographically secure random 256-bit (32-byte) key.
   */
  public static generateKey(): Uint8Array {
    const cryptoObj =
      globalThis.crypto || (typeof window !== 'undefined' ? window.crypto : undefined);
    if (!cryptoObj) {
      throw new Error('WebCrypto API is not supported in this runtime environment');
    }
    const key = cryptoObj.getRandomValues(new Uint8Array(this.KEY_LENGTH_BYTES));
    logger.debug('ClientCrypto', 'Generated fresh 256-bit WebCrypto AES-GCM session key');
    return key;
  }

  /**
   * Securely zeroes out a key buffer in memory to eliminate residue.
   */
  public static zeroKey(buffer: Uint8Array): void {
    buffer.fill(0);
  }

  /**
   * Normalizes a Uint8Array, Base64, or Hex key into a validated 32-byte Uint8Array.
   */
  public static normalizeKey(key: Uint8Array | string): Uint8Array {
    let raw: Uint8Array;

    if (typeof key === 'string') {
      const trimmed = key.trim();
      // Check if 64-character hex string
      if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        raw = fromHex(trimmed);
      } else {
        // Assume Base64
        try {
          raw = fromBase64(trimmed);
        } catch {
          throw new InvalidKeyError();
        }
      }
    } else if (key instanceof Uint8Array) {
      raw = key;
    } else {
      throw new InvalidKeyError();
    }

    if (raw.byteLength !== this.KEY_LENGTH_BYTES) {
      throw new InvalidKeyError(
        `Invalid key length: expected ${this.KEY_LENGTH_BYTES} bytes, got ${raw.byteLength} bytes`,
      );
    }

    return raw;
  }

  /**
   * Imports a raw 32-byte key into a WebCrypto CryptoKey.
   */
  private static async importCryptoKey(
    keyBytes: Uint8Array,
    usages: KeyUsage[],
  ): Promise<CryptoKey> {
    const cryptoObj =
      globalThis.crypto || (typeof window !== 'undefined' ? window.crypto : undefined);
    if (!cryptoObj?.subtle) {
      throw new Error('WebCrypto subtle API is not available');
    }
    return await cryptoObj.subtle.importKey(
      'raw',
      keyBytes as unknown as BufferSource,
      { name: this.ALGORITHM },
      false,
      usages,
    );
  }

  /**
   * Initializes or loads the active session key into KEY_STORE.
   * If no key is provided, generates a fresh random 256-bit key.
   */
  public static initializeSessionKey(existingKey?: Uint8Array | string): Uint8Array {
    if (this.KEY_STORE) {
      this.zeroKey(this.KEY_STORE);
    }
    if (existingKey) {
      const normalized = this.normalizeKey(existingKey);
      // Copy to prevent external tampering
      this.KEY_STORE = new Uint8Array(normalized);
    } else {
      this.KEY_STORE = this.generateKey();
    }
    return new Uint8Array(this.KEY_STORE);
  }

  /**
   * Checks whether an active session key exists in KEY_STORE.
   */
  public static hasSessionKey(): boolean {
    return this.KEY_STORE !== null && this.KEY_STORE.some((byte) => byte !== 0);
  }

  /**
   * Retrieves a copy of the active session key.
   */
  public static getSessionKey(): Uint8Array | null {
    if (!this.KEY_STORE) return null;
    return new Uint8Array(this.KEY_STORE);
  }

  /**
   * Exports the session key in Base64 format for the X-Oscar-Encryption-Key header.
   */
  public static exportKeyForHeader(): string {
    if (!this.KEY_STORE || !this.hasSessionKey()) {
      throw new NoActiveKeyError();
    }
    return toBase64(this.KEY_STORE);
  }

  /**
   * Session logout: zeroes out the key memory buffer and clears KEY_STORE.
   */
  public static logout(): void {
    if (this.KEY_STORE) {
      this.zeroKey(this.KEY_STORE);
      this.KEY_STORE = null;
    }
  }

  /**
   * Encrypts an arbitrary JSON-serializable object using AES-256-GCM.
   * Uses KEY_STORE if key is not passed.
   */
  public static async encrypt<T = unknown>(
    data: T,
    key?: Uint8Array | string,
    keyId = 'v1',
  ): Promise<EncryptedPayload> {
    const startTime = Date.now();
    const rawKey = key ? this.normalizeKey(key) : this.KEY_STORE;
    if (!rawKey) {
      throw new NoActiveKeyError();
    }

    const cryptoKey = await this.importCryptoKey(rawKey, ['encrypt']);
    const cryptoObj =
      globalThis.crypto || (typeof window !== 'undefined' ? window.crypto : undefined)!;

    // Generate random 96-bit (12-byte) IV
    const iv = cryptoObj.getRandomValues(new Uint8Array(this.IV_LENGTH_BYTES));

    // Serialize payload to UTF-8
    const plaintext = JSON.stringify(data);
    const encodedData = new TextEncoder().encode(plaintext);

    // Encrypt with WebCrypto AES-GCM (appends 128-bit auth tag to the end)
    const encryptedBuffer = await cryptoObj.subtle.encrypt(
      {
        name: this.ALGORITHM,
        iv: iv as unknown as BufferSource,
        tagLength: this.TAG_LENGTH_BITS,
      },
      cryptoKey,
      encodedData as unknown as BufferSource,
    );

    const encryptedBytes = new Uint8Array(encryptedBuffer);
    const tagLengthBytes = this.TAG_LENGTH_BITS / 8; // 16 bytes
    const ciphertextBytes = encryptedBytes.slice(0, encryptedBytes.length - tagLengthBytes);
    const authTagBytes = encryptedBytes.slice(encryptedBytes.length - tagLengthBytes);

    const payload: EncryptedPayload = {
      ciphertext: toBase64(ciphertextBytes),
      iv: toBase64(iv),
      authTag: toBase64(authTagBytes),
      keyId,
    };

    const validatedPayload = EncryptedPayloadSchema.parse(payload);
    const durationMs = Date.now() - startTime;
    logger.debug('ClientCrypto', `Encrypted payload in ${durationMs}ms`, { durationMs, keyId });
    return validatedPayload;
  }

  /**
   * Decrypts an EncryptedPayload restoring the original JSON object.
   * Uses KEY_STORE if key is not passed.
   */
  public static async decrypt<T = unknown>(
    payload: EncryptedPayload,
    key?: Uint8Array | string,
  ): Promise<T> {
    const startTime = Date.now();
    const validated = EncryptedPayloadSchema.parse(payload);
    const rawKey = key ? this.normalizeKey(key) : this.KEY_STORE;
    if (!rawKey) {
      throw new NoActiveKeyError();
    }

    const cryptoKey = await this.importCryptoKey(rawKey, ['decrypt']);
    const cryptoObj =
      globalThis.crypto || (typeof window !== 'undefined' ? window.crypto : undefined)!;

    const iv = fromBase64(validated.iv);
    const ciphertext = fromBase64(validated.ciphertext);
    const authTag = fromBase64(validated.authTag);

    if (iv.byteLength !== this.IV_LENGTH_BYTES) {
      throw new DecryptionError(`Invalid IV length: expected ${this.IV_LENGTH_BYTES} bytes`);
    }

    if (authTag.byteLength !== this.TAG_LENGTH_BITS / 8) {
      throw new DecryptionError(
        `Invalid authTag length: expected ${this.TAG_LENGTH_BITS / 8} bytes`,
      );
    }

    // Reconstruct combined WebCrypto buffer: [ciphertext, authTag]
    const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
    combined.set(ciphertext, 0);
    combined.set(authTag, ciphertext.byteLength);

    try {
      const decryptedBuffer = await cryptoObj.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv: iv as unknown as BufferSource,
          tagLength: this.TAG_LENGTH_BITS,
        },
        cryptoKey,
        combined as unknown as BufferSource,
      );

      const jsonString = new TextDecoder().decode(decryptedBuffer);
      const parsed = JSON.parse(jsonString) as T;
      const durationMs = Date.now() - startTime;
      logger.debug('ClientCrypto', `Decrypted payload in ${durationMs}ms`, {
        durationMs,
        keyId: validated.keyId,
      });
      return parsed;
    } catch (err: unknown) {
      throw new DecryptionError(
        err instanceof Error ? err.message : 'Decryption authentication tag verification failed',
      );
    }
  }

  // Instance bridge methods for ergonomic dependency injection
  public initializeSessionKey(existingKey?: Uint8Array | string): Uint8Array {
    return ClientCryptoService.initializeSessionKey(existingKey);
  }

  public hasSessionKey(): boolean {
    return ClientCryptoService.hasSessionKey();
  }

  public getSessionKey(): Uint8Array | null {
    return ClientCryptoService.getSessionKey();
  }

  public exportKeyForHeader(): string {
    return ClientCryptoService.exportKeyForHeader();
  }

  public logout(): void {
    ClientCryptoService.logout();
  }

  public async encrypt<T = unknown>(
    data: T,
    key?: Uint8Array | string,
    keyId = 'v1',
  ): Promise<EncryptedPayload> {
    return ClientCryptoService.encrypt<T>(data, key, keyId);
  }

  public async decrypt<T = unknown>(
    payload: EncryptedPayload,
    key?: Uint8Array | string,
  ): Promise<T> {
    return ClientCryptoService.decrypt<T>(payload, key);
  }
}

export const clientCryptoService = new ClientCryptoService();
