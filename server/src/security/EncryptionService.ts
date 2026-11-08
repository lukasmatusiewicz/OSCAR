import { EncryptedPayload, EncryptedPayloadSchema } from '../types/contracts.js';

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

/**
 * Envelope encryption service using WebCrypto AES-256-GCM at rest.
 * Guarantees zero cleartext PII is persisted, generates unique 96-bit IVs,
 * validates 128-bit authentication tags, and ensures ephemeral key zeroing.
 */
export class EncryptionService {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH_BYTES = 32; // 256 bits
  private static readonly IV_LENGTH_BYTES = 12; // 96 bits
  private static readonly TAG_LENGTH_BITS = 128; // 16 bytes

  /**
   * Generates a cryptographically secure random 256-bit (32-byte) key.
   */
  public static generateKey(): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(this.KEY_LENGTH_BYTES));
  }

  /**
   * Securely zeroes out a key buffer in memory to eliminate residue.
   */
  public static zeroKey(buffer: Uint8Array): void {
    buffer.fill(0);
  }

  /**
   * Executes an operation with an ephemeral session key and guarantees memory zeroing upon completion.
   */
  public static async withSessionKey<R>(
    keyBuffer: Uint8Array,
    fn: (key: Uint8Array) => Promise<R>,
  ): Promise<R> {
    try {
      return await fn(keyBuffer);
    } finally {
      this.zeroKey(keyBuffer);
    }
  }

  /**
   * Normalizes a Uint8Array, Base64, or Hex key into a validated 32-byte Uint8Array.
   */
  private static normalizeKey(key: Uint8Array | string): Uint8Array {
    let raw: Uint8Array;

    if (typeof key === 'string') {
      const trimmed = key.trim();
      // Check if 64-char hex string
      if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        raw = new Uint8Array(Buffer.from(trimmed, 'hex'));
      } else {
        // Assume Base64
        raw = new Uint8Array(Buffer.from(trimmed, 'base64'));
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
    return await globalThis.crypto.subtle.importKey(
      'raw',
      keyBytes as unknown as BufferSource,
      { name: this.ALGORITHM },
      false,
      usages,
    );
  }

  /**
   * Encrypts an arbitrary JSON-serializable object using AES-256-GCM.
   */
  public static async encrypt<T = unknown>(
    data: T,
    key: Uint8Array | string,
    keyId = 'v1',
  ): Promise<EncryptedPayload> {
    const rawKey = this.normalizeKey(key);
    const cryptoKey = await this.importCryptoKey(rawKey, ['encrypt']);

    // Generate random 96-bit (12-byte) IV
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(this.IV_LENGTH_BYTES));

    // Serialize payload to UTF-8
    const plaintext = JSON.stringify(data);
    const encodedData = new TextEncoder().encode(plaintext);

    // Encrypt with WebCrypto AES-GCM (appends 128-bit auth tag to the end)
    const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
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
      ciphertext: Buffer.from(ciphertextBytes).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      authTag: Buffer.from(authTagBytes).toString('base64'),
      keyId,
    };

    return EncryptedPayloadSchema.parse(payload);
  }

  /**
   * Decrypts an EncryptedPayload restoring the original JSON object.
   */
  public static async decrypt<T = unknown>(
    payload: EncryptedPayload,
    key: Uint8Array | string,
  ): Promise<T> {
    // Validate payload schema structure
    const validated = EncryptedPayloadSchema.parse(payload);
    const rawKey = this.normalizeKey(key);
    const cryptoKey = await this.importCryptoKey(rawKey, ['decrypt']);

    const iv = new Uint8Array(Buffer.from(validated.iv, 'base64'));
    const ciphertext = new Uint8Array(Buffer.from(validated.ciphertext, 'base64'));
    const authTag = new Uint8Array(Buffer.from(validated.authTag, 'base64'));

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
      const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv: iv as unknown as BufferSource,
          tagLength: this.TAG_LENGTH_BITS,
        },
        cryptoKey,
        combined as unknown as BufferSource,
      );

      const jsonString = new TextDecoder().decode(decryptedBuffer);
      return JSON.parse(jsonString) as T;
    } catch (err: unknown) {
      throw new DecryptionError(
        err instanceof Error ? err.message : 'Decryption authentication tag verification failed',
      );
    }
  }
}
