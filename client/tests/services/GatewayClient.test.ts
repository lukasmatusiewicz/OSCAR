import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GatewayClient,
  GatewayError,
  DEFAULT_GATEWAY_URL,
  HEADER_ENCRYPTION_KEY,
} from '../../src/services/GatewayClient';
import { ClientCryptoService } from '../../src/services/ClientCryptoService';
import { CreateMemoResponse, TaskEntity } from '../../src/types/contracts';

describe('GatewayClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: GatewayClient;

  beforeEach(() => {
    ClientCryptoService.initializeSessionKey();
    mockFetch = vi.fn();
    client = new GatewayClient({ baseUrl: DEFAULT_GATEWAY_URL, fetchFn: mockFetch });
  });

  afterEach(() => {
    ClientCryptoService.logout();
    vi.restoreAllMocks();
  });

  const sampleTask: TaskEntity = {
    id: 'task_001_mock_id_1234567',
    memoId: 'memo_001_mock_id_1234567',
    userId: 'usr_mock_session_active',
    encryptedPayload: {
      ciphertext: 'AAAA',
      iv: 'AAAAAAAAAAAAAAAA',
      authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
      keyId: 'v1',
    },
    category: 'WORK',
    priority: 'MEDIUM',
    status: 'DRAFT',
    scheduledDate: null,
    tags: ['work'],
    provenance: 'GEMINI_FLASH',
    modelVersion: 'gemini-2.5-flash-001',
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
  };

  const sampleMemoResponse: CreateMemoResponse = {
    task: sampleTask,
    tasks: [sampleTask],
    memo: {
      id: 'memo_001_mock_id_1234567',
      userId: 'usr_mock_session_active',
      encryptedPayload: {
        ciphertext: 'BBBB',
        iv: 'BBBBBBBBBBBBBBBB',
        authTag: 'BBBBBBBBBBBBBBBBBBBBBB==',
        keyId: 'v1',
      },
      sanitizedContentPreview: 'preview',
      hasPII: false,
      maskedFieldsCount: 0,
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z',
    },
    piiStats: {
      detectedEntityCount: 0,
      maskedTokens: [],
      riskLevel: 'NONE',
    },
  };

  describe('submitMemo', () => {
    it('sends POST request to /api/memos with headers and returns typed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleMemoResponse,
      });

      const response = await client.submitMemo('Review budget with team');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${DEFAULT_GATEWAY_URL}/api/memos`);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers[HEADER_ENCRYPTION_KEY]).toBeDefined();

      const parsedBody = JSON.parse(init.body);
      expect(parsedBody.content).toBe('Review budget with team');
      expect(response.task.id).toBe(sampleTask.id);
    });

    it('throws GatewayError with status and issues when server returns 400', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Validation failed',
          issues: [{ path: 'content', message: 'Content must not be empty' }],
        }),
      });

      await expect(client.submitMemo('test')).rejects.toThrow(GatewayError);
    });

    it('wraps network errors into GatewayError with status 0', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(client.submitMemo('test')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('fetchTasks', () => {
    it('sends GET request to /api/tasks and returns array of tasks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [sampleTask],
      });

      const tasks = await client.fetchTasks();

      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe(sampleTask.id);
    });

    it('throws GatewayError when server responds with 500 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      await expect(client.fetchTasks()).rejects.toThrow(GatewayError);
    });
  });

  describe('createTask', () => {
    it('sends POST request to /api/tasks and returns created task', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => sampleTask,
      });

      const task = await client.createTask({
        title: 'New Manual Task',
        summary: 'Summary description for task',
        category: 'WORK',
        priority: 'HIGH',
      });

      expect(task.id).toBe(sampleTask.id);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${DEFAULT_GATEWAY_URL}/api/tasks`);
      expect(init.method).toBe('POST');
    });
  });

  describe('updateTask', () => {
    it('sends PATCH request to /api/tasks/:id and returns updated task', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...sampleTask, status: 'COMPLETED' }),
      });

      const updated = await client.updateTask(sampleTask.id, { status: 'COMPLETED' });

      expect(updated.status).toBe('COMPLETED');
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${DEFAULT_GATEWAY_URL}/api/tasks/${sampleTask.id}`);
      expect(init.method).toBe('PATCH');
    });
  });

  describe('deleteTask', () => {
    it('sends DELETE request to /api/tasks/:id and returns true on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, id: sampleTask.id }),
      });

      const result = await client.deleteTask(sampleTask.id);

      expect(result).toBe(true);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${DEFAULT_GATEWAY_URL}/api/tasks/${sampleTask.id}`);
      expect(init.method).toBe('DELETE');
    });
  });

  describe('healthCheck', () => {
    it('sends GET request to /api/health and returns health status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', timestamp: '2026-11-08T00:00:00.000Z' }),
      });

      const health = await client.healthCheck();

      expect(health.status).toBe('ok');
      expect(health.timestamp).toBe('2026-11-08T00:00:00.000Z');
    });
  });
});
