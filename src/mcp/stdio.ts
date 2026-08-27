// SPDX-License-Identifier: MIT

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SPARC_IDENTIFIER_PATTERN } from '../domain.js';
import { SparcStore } from '../store.js';
import { SPARC_READ_SCOPE, SPARC_WRITE_SCOPE } from './auth.js';
import { createSparcMcpServer } from './server.js';

export interface StartSparcStdioOptions {
  readonly store: SparcStore;
  readonly principalId?: string;
}

export interface StartedSparcStdioServer {
  close(): Promise<void>;
}

/**
 * Connects the SPARC protocol to stdin/stdout. This function never writes
 * diagnostics to stdout because stdout is reserved exclusively for MCP.
 */
export async function startSparcStdioServer(
  options: StartSparcStdioOptions,
): Promise<StartedSparcStdioServer> {
  const principalId = options.principalId ?? 'local-stdio';
  if (!SPARC_IDENTIFIER_PATTERN.test(principalId)) {
    throw new Error('invalid stdio principal');
  }
  const protocol = createSparcMcpServer({
    store: options.store,
    principal: {
      principalId,
      scopes: new Set([SPARC_READ_SCOPE, SPARC_WRITE_SCOPE]),
      authentication: 'anonymous-loopback',
    },
  });
  const transport = new StdioServerTransport();
  // SDK 1.30's Transport declaration is not exactOptionalPropertyTypes-safe.
  await protocol.connect(transport as unknown as Transport);
  let closed = false;
  return {
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await Promise.allSettled([transport.close(), protocol.close()]);
    },
  };
}
