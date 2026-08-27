// SPDX-License-Identifier: MIT

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SparcStore } from '../store.js';
import {
  JwtVerifier,
  authenticate,
  authConfigFromEnvironment,
  authenticationChallenge,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  validateAuthConfig,
  type SparcAuthConfig,
} from './auth.js';
import { createSparcMcpServer } from './server.js';

export const MAX_MCP_REQUEST_BYTES = 256 * 1024;
export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 15_000;

class HttpProblem extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function normalizedHost(value: string | undefined): string | undefined {
  if (!value || value.length > 512 || /[\r\n]/.test(value)) return undefined;
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function isLoopbackHost(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost'
    || host === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(host)
    || /^::ffff:127(?:\.\d{1,3}){3}$/.test(host);
}

function requestHostAllowed(request: IncomingMessage, allowedHosts: readonly string[]): boolean {
  const host = normalizedHost(request.headers.host);
  return host !== undefined && allowedHosts.some((entry) => normalizedHost(entry) === host);
}

function requestIsLoopback(request: IncomingMessage): boolean {
  const remoteAddress = request.socket.remoteAddress;
  const host = normalizedHost(request.headers.host);
  return remoteAddress !== undefined
    && isLoopbackHost(remoteAddress)
    && host !== undefined
    && isLoopbackHost(host);
}

function jsonRpcError(response: ServerResponse, status: number, message: string): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32_000, message },
    id: null,
  }));
}

function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
  timeoutMs: number,
): Promise<unknown> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    request.resume();
    return Promise.reject(new HttpProblem(413, 'request body too large'));
  }
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    request.resume();
    return Promise.reject(new HttpProblem(415, 'application/json is required'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const complete = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      callback();
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        complete(() => reject(new HttpProblem(413, 'request body too large')));
        request.resume();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => complete(() => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpProblem(400, 'invalid JSON request'));
      }
    });
    const onError = (): void => complete(() => reject(new HttpProblem(400, 'request body failed')));
    const timer = setTimeout(() => {
      complete(() => reject(new HttpProblem(408, 'request body deadline exceeded')));
      request.destroy();
    }, timeoutMs);
    timer.unref?.();
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
}

export interface SparcMcpHttpRuntimeOptions {
  readonly store: SparcStore;
  readonly auth?: SparcAuthConfig;
  readonly allowedHosts?: readonly string[];
  readonly maxRequestBytes?: number;
  readonly requestTimeoutMs?: number;
}

export interface SparcMcpHttpRuntime {
  readonly server: Server;
  readonly store: SparcStore;
  readonly auth: SparcAuthConfig;
  readonly allowedHosts: readonly string[];
  close(): Promise<void>;
}

function boundedInteger(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} is outside the accepted range`);
  }
  return value;
}

export function createSparcMcpHttpRuntime(
  options: SparcMcpHttpRuntimeOptions,
): SparcMcpHttpRuntime {
  const auth = validateAuthConfig(options.auth ?? authConfigFromEnvironment());
  const maxRequestBytes = boundedInteger(
    options.maxRequestBytes ?? MAX_MCP_REQUEST_BYTES,
    MAX_MCP_REQUEST_BYTES,
    'maxRequestBytes',
  );
  const requestTimeoutMs = boundedInteger(
    options.requestTimeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
    60_000,
    'requestTimeoutMs',
  );
  const allowedHosts = options.allowedHosts?.length
    ? [...new Set(options.allowedHosts)]
    : ['127.0.0.1', 'localhost', '[::1]'];
  for (const entry of allowedHosts) {
    if (!normalizedHost(entry)) throw new Error('allowedHosts contains an invalid host');
  }
  const publiclyExposed = allowedHosts.some((entry) => !isLoopbackHost(normalizedHost(entry)!));
  const hasAuthentication = Boolean(auth.jwt || auth.bearerPrincipals?.length);
  if (publiclyExposed && !hasAuthentication) {
    throw new Error('public proxy hosts require JWT or static bearer authentication');
  }
  const jwtVerifier = auth.jwt ? new JwtVerifier(auth.jwt) : undefined;

  const server = createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('access-control-expose-headers', 'Mcp-Session-Id');
    if (!requestHostAllowed(request, allowedHosts)) {
      jsonRpcError(response, 421, 'host is not allowed');
      return;
    }

    const path = new URL(request.url ?? '/', 'http://sparc.invalid').pathname;
    const metadataPath = auth.jwt
      ? protectedResourceMetadataUrl(auth.jwt.resource).pathname
      : undefined;
    const isMetadataPath = path === metadataPath || path === '/.well-known/oauth-protected-resource';
    if (isMetadataPath && request.method === 'GET') {
      if (!auth.jwt) {
        jsonRpcError(response, 404, 'route not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(protectedResourceMetadata(auth.jwt)));
      return;
    }
    if (path !== '/mcp') {
      jsonRpcError(response, 404, 'route not found');
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        allow: 'POST, OPTIONS',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'Authorization, Content-Type, Mcp-Session-Id',
      });
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      jsonRpcError(response, 405, 'stateless endpoint accepts POST only');
      return;
    }

    const authentication = await authenticate(request.headers, auth, {
      loopbackRequest: requestIsLoopback(request),
      ...(jwtVerifier ? { jwtVerifier } : {}),
    });
    if (!authentication.ok) {
      response.setHeader('www-authenticate', authenticationChallenge(auth));
      jsonRpcError(response, authentication.status, authentication.reason);
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(request, maxRequestBytes, requestTimeoutMs);
    } catch (error) {
      const problem = error instanceof HttpProblem ? error : new HttpProblem(400, 'invalid request');
      jsonRpcError(response, problem.status, problem.message);
      return;
    }

    const protocol = createSparcMcpServer({
      store: options.store,
      principal: authentication.principal,
      oauth: authentication.principal.authentication === 'jwt',
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    } as unknown as StreamableHTTPServerTransportOptions);
    const cleanup = (): void => {
      void transport.close();
      void protocol.close();
    };
    response.once('close', cleanup);
    try {
      // SDK 1.30's Transport declaration is not exactOptionalPropertyTypes-safe.
      await protocol.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, body);
    } catch {
      jsonRpcError(response, 500, 'MCP request failed at the protected boundary');
      cleanup();
    }
  });
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.max(5_000, Math.min(60_000, requestTimeoutMs));
  server.keepAliveTimeout = 5_000;

  let closing: Promise<void> | undefined;
  return {
    server,
    store: options.store,
    auth,
    allowedHosts,
    close(): Promise<void> {
      if (closing) return closing;
      closing = new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        const force = setTimeout(() => server.closeAllConnections?.(), 2_000);
        server.close((error) => {
          clearTimeout(force);
          if (error) reject(error);
          else resolve();
        });
        server.closeIdleConnections?.();
      });
      return closing;
    },
  };
}

export interface StartSparcMcpHttpOptions extends SparcMcpHttpRuntimeOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface StartedSparcMcpHttpServer extends SparcMcpHttpRuntime {
  readonly host: string;
  readonly port: number;
  readonly url: URL;
}

export async function startSparcMcpHttpServer(
  options: StartSparcMcpHttpOptions,
): Promise<StartedSparcMcpHttpServer> {
  const host = options.host ?? '127.0.0.1';
  if (!isLoopbackHost(host)) {
    throw new Error('SPARC MCP must bind loopback; expose it only through an authenticated HTTPS proxy');
  }
  const port = options.port ?? 8787;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('port must be an integer between 0 and 65535');
  }
  const runtime = createSparcMcpHttpRuntime(options);
  try {
    await new Promise<void>((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(port, host, () => {
        runtime.server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
  const address = runtime.server.address();
  if (!address || typeof address === 'string') {
    await runtime.close();
    throw new Error('SPARC MCP did not expose a TCP address');
  }
  const urlHost = host.includes(':') ? `[${host}]` : host;
  return {
    ...runtime,
    host,
    port: address.port,
    url: new URL('/mcp', `http://${urlHost}:${address.port}`),
  };
}
