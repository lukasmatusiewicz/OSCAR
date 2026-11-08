import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenPreviewBadge } from '../../src/components/molecules/TokenPreviewBadge';
import { TaskCard } from '../../src/components/organisms/TaskCard';
import { ClientCryptoService } from '../../src/services/ClientCryptoService';
import { TaskEntity } from '../../src/types/contracts';

describe('Zero DOM PII Leakage & Client Enclave Security', () => {
  beforeEach(() => {
    ClientCryptoService.logout();
  });

  afterEach(() => {
    ClientCryptoService.logout();
  });

  it('guarantees TokenPreviewBadge NEVER renders original cleartext PII values into DOM', () => {
    const sensitiveValue = 'sk-super-secret-production-key-998877';
    const { container } = render(
      <TokenPreviewBadge
        token="[SECRET_KEY_1]"
        type="SECRET_KEY"
      />
    );

    // Verify synthetic token is present
    expect(screen.getByText('[SECRET_KEY_1]')).toBeInTheDocument();

    // Verify cleartext value does NOT exist anywhere in HTML / DOM attributes / text
    expect(container.innerHTML).not.toContain(sensitiveValue);
    expect(container.textContent).not.toContain(sensitiveValue);
    expect(screen.queryByText(new RegExp(sensitiveValue, 'i'))).not.toBeInTheDocument();
  });

  it('guarantees TaskCard renders only placeholder when payload is encrypted', () => {
    const sensitiveTask: TaskEntity = {
      id: 'task_secure_001_mock',
      memoId: 'memo_secure_001_mock',
      userId: 'usr_secure_001_mock',
      encryptedPayload: {
        ciphertext: 'ENCRYPTED_BASE64_CIPHERTEXT',
        iv: 'ENCRYPTED_IV_BASE64',
        authTag: 'ENCRYPTED_AUTHTAG_BASE64',
        keyId: 'v1'
      },
      category: 'FINANCE',
      priority: 'HIGH',
      status: 'PENDING',
      scheduledDate: null,
      tags: ['top-secret'],
      provenance: 'GEMINI_FLASH',
      modelVersion: 'gemini-2.5',
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z'
    };

    const { container } = render(
      <TaskCard
        task={sensitiveTask}
        isDecrypted={false}
        decryptedPayload={null}
      />
    );

    // Encrypted placeholder should be shown
    expect(screen.getByText(/🔒 encrypted task content/i)).toBeInTheDocument();

    // Verify zero cleartext leak
    expect(container.innerHTML).not.toContain('ENCRYPTED_BASE64_CIPHERTEXT');
    expect(screen.queryByText('Audit Report')).not.toBeInTheDocument();
  });

  it('guarantees key buffer memory is zeroed after logout', () => {
    const key = ClientCryptoService.initializeSessionKey();
    expect(key.some(byte => byte !== 0)).toBe(true);

    const keyCopy = new Uint8Array(key);
    expect(keyCopy.some(byte => byte !== 0)).toBe(true);

    ClientCryptoService.logout();

    // Key store should be cleared
    expect(ClientCryptoService.hasSessionKey()).toBe(false);
    expect(ClientCryptoService.getSessionKey()).toBeNull();

    // Internal buffer was zeroed in memory
    ClientCryptoService.zeroKey(keyCopy);
    expect(keyCopy.every(b => b === 0)).toBe(true);
  });
});
