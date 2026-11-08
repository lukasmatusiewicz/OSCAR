import http from 'node:http';
import { Socket } from 'node:net';
import type { Express } from 'express';

export interface InProcessResponse<T = any> {
  status: number;
  headers: Record<string, unknown>;
  body: T;
  text: string;
}

export interface InProcessRequestBuilder<T = any> extends PromiseLike<InProcessResponse<T>> {
  set(headerName: string, headerValue: string): InProcessRequestBuilder<T>;
  send(payload: unknown): InProcessRequestBuilder<T>;
}

/**
 * Socket-free in-process HTTP dispatcher for Express applications.
 * Executes the full Express pipeline and middleware lifecycle directly via Node's
 * http.IncomingMessage and http.ServerResponse, eliminating sandbox TCP port binding
 * restrictions (connect EACCES 127.0.0.1) in compliance with Section 7.6.
 */
export function inProcessApp(app: Express) {
  function createBuilder<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'OPTIONS',
    url: string,
  ): InProcessRequestBuilder<T> {
    const headers: Record<string, string> = {};
    let requestPayload: unknown = undefined;

    const builder: InProcessRequestBuilder<T> = {
      set(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return builder;
      },
      send(data: unknown) {
        requestPayload = data;
        return builder;
      },
      then<TResult1 = InProcessResponse<T>, TResult2 = never>(
        onfulfilled?: ((value: InProcessResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return new Promise<InProcessResponse<T>>((resolve, reject) => {
          try {
            const socket = new Socket();
            const req = new http.IncomingMessage(socket);
            req.method = method;
            req.url = url;
            req.headers = { ...headers };

            const bodyString =
              typeof requestPayload === 'string'
                ? requestPayload
                : requestPayload !== undefined
                  ? JSON.stringify(requestPayload)
                  : '';

            if (bodyString) {
              if (!req.headers['content-type']) {
                req.headers['content-type'] = 'application/json';
              }
              req.headers['content-length'] = String(Buffer.byteLength(bodyString));
            }

            const res = new http.ServerResponse(req);
            let responseData = '';

            res.write = function (chunk: unknown): boolean {
              if (chunk) {
                responseData += chunk.toString();
              }
              return true;
            };

            res.end = function (chunk?: unknown): http.ServerResponse {
              if (chunk) {
                responseData += chunk.toString();
              }
              let parsedBody: T;
              try {
                parsedBody = responseData ? (JSON.parse(responseData) as T) : ({} as T);
              } catch {
                parsedBody = responseData as unknown as T;
              }
              resolve({
                status: res.statusCode,
                headers: res.getHeaders(),
                body: parsedBody,
                text: responseData,
              });
              return this;
            };

            app(req, res);

            if (bodyString) {
              req.push(bodyString);
            }
            req.push(null);
          } catch (err: unknown) {
            reject(err);
          }
        }).then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  return {
    get: <T = any>(url: string) => createBuilder<T>('GET', url),
    post: <T = any>(url: string) => createBuilder<T>('POST', url),
    patch: <T = any>(url: string) => createBuilder<T>('PATCH', url),
    delete: <T = any>(url: string) => createBuilder<T>('DELETE', url),
    options: <T = any>(url: string) => createBuilder<T>('OPTIONS', url),
  };
}
