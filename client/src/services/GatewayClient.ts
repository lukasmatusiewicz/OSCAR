import {
  CreateMemoResponse,
  CreateMemoResponseSchema,
  CreateTaskInput,
  CreateTaskInputSchema,
  HealthResponse,
  HealthResponseSchema,
  MemoInput,
  MemoInputSchema,
  TaskEntity,
  TaskEntitySchema,
  UpdateTaskInput,
  UpdateTaskInputSchema,
} from '../types/contracts';
import { ClientCryptoService } from './ClientCryptoService';
import { logger } from '../utils/logger';
import { z } from 'zod';

export const DEFAULT_GATEWAY_URL = 'http://localhost:3000';
export const HEADER_ENCRYPTION_KEY = 'x-oscar-encryption-key';

export interface GatewayClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface GatewayIssue {
  path: string;
  message: string;
  code?: string;
}

/**
 * Structured gateway communication error containing HTTP status and Zod issues.
 */
export class GatewayError extends Error {
  public readonly status: number;
  public readonly issues?: GatewayIssue[];

  constructor(message: string, status = 500, issues?: GatewayIssue[]) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.issues = issues;
  }
}

/**
 * Typed HTTP Client for communicating with the OSCAR Backend Gateway.
 * Enforces contract schemas, attaches ephemeral session encryption keys,
 * and handles network failures gracefully.
 */
export class GatewayClient {
  public readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GatewayClientOptions = {}) {
    const isBrowser = typeof window !== 'undefined';
    const defaultUrl = isBrowser ? '' : DEFAULT_GATEWAY_URL;
    const configuredUrl =
      typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
        ? import.meta.env.VITE_API_URL
        : defaultUrl;
    const rawUrl = options.baseUrl !== undefined ? options.baseUrl : configuredUrl;
    this.baseUrl = rawUrl ? rawUrl.replace(/\/+$/, '') : '';

    this.fetchImpl =
      options.fetchFn ??
      (isBrowser && window.fetch
        ? window.fetch.bind(window)
        : globalThis.fetch);
  }

  /**
   * Returns current active baseUrl.
   */
  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Formats API endpoint cleanly with baseUrl, preventing double slashes and supporting relative proxy routing.
   */
  public formatUrl(endpoint: string): string {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return this.baseUrl ? `${this.baseUrl}${cleanEndpoint}` : cleanEndpoint;
  }

  /**
   * Prepares standard HTTP request headers, injecting ephemeral encryption key
   * if active in the ClientCryptoService session store.
   */
  private buildHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    if (ClientCryptoService.hasSessionKey()) {
      try {
        headers[HEADER_ENCRYPTION_KEY] = ClientCryptoService.exportKeyForHeader();
      } catch {
        // Continue without header if key cannot be exported
      }
    }

    return headers;
  }

  /**
   * Safe JSON parser for HTTP response errors.
   */
  private async parseErrorResponse(
    response: Response,
  ): Promise<{ message: string; issues?: GatewayIssue[] }> {
    try {
      const data = await response.json();
      const message =
        data?.message || data?.error || `Request failed with status code ${response.status}`;
      const issues = Array.isArray(data?.issues) ? data.issues : undefined;
      return { message, issues };
    } catch {
      return { message: `Request failed with status code ${response.status}` };
    }
  }

  /**
   * Submits a confidential memo to the gateway for PII masking, AI task extraction,
   * re-hydration, and envelope encryption at rest.
   *
   * @param content Cleartext user memo string.
   * @param title Optional memo title.
   * @returns CreateMemoResponse conforming to schema contracts.
   */
  public async submitMemo(content: string, title?: string): Promise<CreateMemoResponse> {
    const payload: MemoInput = MemoInputSchema.parse({ content, title });
    const url = this.formatUrl('/api/memos');
    const start = Date.now();
    logger.info('GatewayClient', `Outbound POST ${url}`);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      throw new GatewayError(
        err instanceof Error ? err.message : 'Network failure while connecting to gateway',
        0,
      );
    }

    const duration = Date.now() - start;
    logger.info('GatewayClient', `Incoming POST ${url} -> ${response.status} (${duration}ms)`);

    if (!response.ok) {
      const { message, issues } = await this.parseErrorResponse(response);
      throw new GatewayError(message, response.status, issues);
    }

    const data = await response.json();
    return CreateMemoResponseSchema.parse(data);
  }

  /**
   * Fetches all encrypted task entities persisted on the gateway.
   *
   * @returns Array of TaskEntity records.
   */
  public async fetchTasks(): Promise<TaskEntity[]> {
    const url = this.formatUrl('/api/tasks');
    const start = Date.now();
    logger.info('GatewayClient', `Outbound GET ${url}`);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: this.buildHeaders(),
      });
    } catch (err: unknown) {
      throw new GatewayError(
        err instanceof Error ? err.message : 'Network failure while fetching tasks',
        0,
      );
    }

    const duration = Date.now() - start;
    logger.info('GatewayClient', `Incoming GET ${url} -> ${response.status} (${duration}ms)`);

    if (!response.ok) {
      const { message, issues } = await this.parseErrorResponse(response);
      throw new GatewayError(message, response.status, issues);
    }

    const data = await response.json();
    return z.array(TaskEntitySchema).parse(data);
  }

  /**
   * Manually creates a new task on the gateway.
   *
   * @param input Task properties to persist.
   * @returns Created TaskEntity.
   */
  public async createTask(input: CreateTaskInput): Promise<TaskEntity> {
    const payload = CreateTaskInputSchema.parse(input);
    const url = this.formatUrl('/api/tasks');
    const start = Date.now();
    logger.info('GatewayClient', `Outbound POST ${url}`);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      throw new GatewayError(
        err instanceof Error ? err.message : 'Network failure while creating task',
        0,
      );
    }

    const duration = Date.now() - start;
    logger.info('GatewayClient', `Incoming POST ${url} -> ${response.status} (${duration}ms)`);

    if (!response.ok) {
      const { message, issues } = await this.parseErrorResponse(response);
      throw new GatewayError(message, response.status, issues);
    }

    const data = await response.json();
    return TaskEntitySchema.parse(data);
  }

  /**
   * Updates task status, priority, or non-sensitive properties on the gateway.
   *
   * @param id Unique task identifier.
   * @param updates Partial properties to apply.
   * @returns Updated TaskEntity.
   */
  public async updateTask(id: string, updates: UpdateTaskInput): Promise<TaskEntity> {
    const payload = UpdateTaskInputSchema.parse(updates);
    const url = this.formatUrl(`/api/tasks/${encodeURIComponent(id)}`);
    const start = Date.now();
    logger.info('GatewayClient', `Outbound PATCH ${url}`);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'PATCH',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      throw new GatewayError(
        err instanceof Error ? err.message : 'Network failure while updating task',
        0,
      );
    }

    const duration = Date.now() - start;
    logger.info('GatewayClient', `Incoming PATCH ${url} -> ${response.status} (${duration}ms)`);

    if (!response.ok) {
      const { message, issues } = await this.parseErrorResponse(response);
      throw new GatewayError(message, response.status, issues);
    }

    const data = await response.json();
    return TaskEntitySchema.parse(data);
  }

  /**
   * Deletes a task by its unique identifier on the gateway.
   *
   * @param id Unique task identifier.
   * @returns True if deletion succeeded.
   */
  public async deleteTask(id: string): Promise<boolean> {
    const url = this.formatUrl(`/api/tasks/${encodeURIComponent(id)}`);
    const start = Date.now();
    logger.info('GatewayClient', `Outbound DELETE ${url}`);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'DELETE',
        headers: this.buildHeaders(),
      });
    } catch (err: unknown) {
      throw new GatewayError(
        err instanceof Error ? err.message : 'Network failure while deleting task',
        0,
      );
    }

    const duration = Date.now() - start;
    logger.info('GatewayClient', `Incoming DELETE ${url} -> ${response.status} (${duration}ms)`);

    if (!response.ok) {
      const { message, issues } = await this.parseErrorResponse(response);
      throw new GatewayError(message, response.status, issues);
    }

    return true;
  }

  /**
   * Checks gateway health and readiness.
   *
   * @returns HealthResponse.
   */
  public async healthCheck(): Promise<HealthResponse> {
    const url = this.formatUrl('/api/health');
    const start = Date.now();
    logger.info('GatewayClient', `Outbound GET ${url}`);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: this.buildHeaders(),
      });
    } catch (err: unknown) {
      throw new GatewayError(
        err instanceof Error ? err.message : 'Network failure while pinging healthcheck',
        0,
      );
    }

    const duration = Date.now() - start;
    logger.info('GatewayClient', `Incoming GET ${url} -> ${response.status} (${duration}ms)`);

    if (!response.ok) {
      const { message, issues } = await this.parseErrorResponse(response);
      throw new GatewayError(message, response.status, issues);
    }

    const data = await response.json();
    return HealthResponseSchema.parse(data);
  }
}

export const gatewayClient = new GatewayClient();

