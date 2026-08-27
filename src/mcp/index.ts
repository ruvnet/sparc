// SPDX-License-Identifier: MIT

export {
  SPARC_ARTIFACT_SCHEMA_URI,
  SPARC_METHODOLOGY_URI,
  registerSparcResourcesAndPrompts,
} from './content.js';
export {
  SPARC_READ_SCOPE,
  SPARC_WRITE_SCOPE,
  JwtVerifier,
  authenticate,
  authConfigFromEnvironment,
  authenticationChallenge,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  validateAuthConfig,
  type AuthenticatedPrincipal,
  type JwtAuthConfig,
  type SparcAuthConfig,
  type SparcScope,
  type StaticBearerPrincipal,
} from './auth.js';
export {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  MAX_MCP_REQUEST_BYTES,
  createSparcMcpHttpRuntime,
  isLoopbackHost,
  startSparcMcpHttpServer,
  type SparcMcpHttpRuntime,
  type SparcMcpHttpRuntimeOptions,
  type StartedSparcMcpHttpServer,
  type StartSparcMcpHttpOptions,
} from './http.js';
export {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MAX_PAGE_BYTES,
  SPARC_TOOL_INPUT_SCHEMAS,
  SPARC_TOOL_INPUT_ZOD_SCHEMAS,
  createSparcMcpServer,
  paginateSparcTrace,
  registerSparcTools,
  summarizeSparcRun,
  type CreateSparcMcpServerOptions,
  type SparcMcpToolName,
  type SparcToolContext,
} from './server.js';
export {
  startSparcStdioServer,
  type StartedSparcStdioServer,
  type StartSparcStdioOptions,
} from './stdio.js';
