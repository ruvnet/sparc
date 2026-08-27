// SPDX-License-Identifier: MIT

import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { SPARC_IDENTIFIER_PATTERN } from '../domain.js';

export const SPARC_READ_SCOPE = 'sparc.read';
export const SPARC_WRITE_SCOPE = 'sparc.write';

export type SparcScope = typeof SPARC_READ_SCOPE | typeof SPARC_WRITE_SCOPE;

export interface StaticBearerPrincipal {
  readonly token: string;
  readonly principalId: string;
  readonly scopes: readonly SparcScope[];
}

export interface JwtAuthConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  readonly resource: string;
  readonly authorizationServers?: readonly string[];
  readonly readScope?: string;
  readonly writeScope?: string;
}

export interface SparcAuthConfig {
  readonly bearerPrincipals?: readonly StaticBearerPrincipal[];
  readonly jwt?: JwtAuthConfig;
  /** Anonymous access is accepted only on a loopback socket and loopback Host. */
  readonly anonymousLoopbackPrincipalId?: string;
}

export interface AuthenticatedPrincipal {
  readonly principalId: string;
  readonly scopes: ReadonlySet<SparcScope>;
  readonly authentication: 'anonymous-loopback' | 'static-bearer' | 'jwt';
}

export type AuthenticationResult =
  | { readonly ok: true; readonly principal: AuthenticatedPrincipal }
  | { readonly ok: false; readonly status: 401 | 403; readonly reason: string };

const SCOPE = /^[\x21-\x7e]{1,200}$/;

function exactString(value: string, name: string): string {
  if (!SCOPE.test(value) || /["\\,]/.test(value)) {
    throw new Error(`${name} must be a bounded OAuth token`);
  }
  return value;
}

function principalId(value: string): string {
  if (!SPARC_IDENTIFIER_PATTERN.test(value)) throw new Error('invalid authentication principal');
  return value;
}

function strongToken(value: string): string {
  const strongHex = /^[a-f0-9]{64,}$/i.test(value);
  const strongBase64Url = /^[A-Za-z0-9_-]{43,}$/.test(value);
  if ((!strongHex && !strongBase64Url) || value.length > 4096) {
    throw new Error('static bearer tokens must contain at least 32 random bytes');
  }
  return value;
}

function absoluteUrl(value: string, name: string, httpsOnly: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment`);
  }
  if (httpsOnly && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  return parsed;
}

function scopes(values: readonly SparcScope[]): readonly SparcScope[] {
  const result = [...new Set(values)];
  if (result.length === 0 || result.some((scope) => (
    scope !== SPARC_READ_SCOPE && scope !== SPARC_WRITE_SCOPE
  ))) {
    throw new Error('static bearer scopes must contain sparc.read and/or sparc.write');
  }
  return result;
}

export function validateAuthConfig(input: SparcAuthConfig = {}): SparcAuthConfig {
  const seenTokens = new Set<string>();
  const bearerPrincipals = (input.bearerPrincipals ?? []).map((entry) => {
    const token = strongToken(entry.token);
    if (seenTokens.has(token)) throw new Error('duplicate static bearer token');
    seenTokens.add(token);
    return Object.freeze({
      token,
      principalId: principalId(entry.principalId),
      scopes: Object.freeze(scopes(entry.scopes)),
    });
  });

  let jwt: JwtAuthConfig | undefined;
  if (input.jwt) {
    const issuer = absoluteUrl(input.jwt.issuer, 'JWT issuer', true).toString().replace(/\/$/, '');
    const jwksUrl = absoluteUrl(input.jwt.jwksUrl, 'JWKS URL', true).toString();
    const resourceUrl = absoluteUrl(input.jwt.resource, 'OAuth protected resource', true);
    const resource = resourceUrl.pathname === '/' ? resourceUrl.origin : resourceUrl.href;
    if (!input.jwt.audience || input.jwt.audience.length > 500) {
      throw new Error('JWT audience must be a bounded nonempty string');
    }
    const authorizationServers = input.jwt.authorizationServers?.length
      ? input.jwt.authorizationServers.map((value) => (
        absoluteUrl(value, 'authorization server', true).toString().replace(/\/$/, '')
      ))
      : [issuer];
    jwt = Object.freeze({
      issuer,
      audience: input.jwt.audience,
      jwksUrl,
      resource,
      authorizationServers: Object.freeze([...new Set(authorizationServers)]),
      readScope: exactString(input.jwt.readScope ?? SPARC_READ_SCOPE, 'JWT read scope'),
      writeScope: exactString(input.jwt.writeScope ?? SPARC_WRITE_SCOPE, 'JWT write scope'),
    });
  }

  const anonymousLoopbackPrincipalId = input.anonymousLoopbackPrincipalId === undefined
    ? undefined
    : principalId(input.anonymousLoopbackPrincipalId);
  return Object.freeze({
    ...(bearerPrincipals.length > 0 ? { bearerPrincipals: Object.freeze(bearerPrincipals) } : {}),
    ...(jwt ? { jwt } : {}),
    ...(anonymousLoopbackPrincipalId ? { anonymousLoopbackPrincipalId } : {}),
  });
}

function bearerToken(headers: IncomingHttpHeaders): string | undefined {
  const value = headers.authorization;
  if (value === undefined) return undefined;
  if (Array.isArray(value) || !value.startsWith('Bearer ')) return '';
  const token = value.slice('Bearer '.length);
  return token.length <= 8192 ? token : '';
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

function jwtClaimScopes(payload: JWTPayload): readonly string[] {
  const raw = payload.scope ?? payload.scp;
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  if (Array.isArray(raw) && raw.every((entry) => typeof entry === 'string')) return raw;
  return [];
}

function mappedJwtScopes(payload: JWTPayload, config: JwtAuthConfig): ReadonlySet<SparcScope> {
  const claims = new Set(jwtClaimScopes(payload));
  const mapped = new Set<SparcScope>();
  if (claims.has(config.readScope ?? SPARC_READ_SCOPE)) mapped.add(SPARC_READ_SCOPE);
  if (claims.has(config.writeScope ?? SPARC_WRITE_SCOPE)) mapped.add(SPARC_WRITE_SCOPE);
  return mapped;
}

export class JwtVerifier {
  private readonly keySet;

  constructor(private readonly config: JwtAuthConfig) {
    this.keySet = createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
    });
  }

  async verify(token: string): Promise<AuthenticatedPrincipal> {
    const verified = await jwtVerify(token, this.keySet, {
      issuer: this.config.issuer,
      audience: this.config.audience,
      clockTolerance: 5,
      maxTokenAge: '1h',
    });
    if (!verified.payload.sub) throw new Error('JWT subject is required');
    const resolvedScopes = mappedJwtScopes(verified.payload, this.config);
    if (resolvedScopes.size === 0) throw new Error('JWT has no recognized SPARC scope');
    return {
      principalId: principalId(verified.payload.sub),
      scopes: resolvedScopes,
      authentication: 'jwt',
    };
  }
}

export interface AuthenticateOptions {
  readonly loopbackRequest: boolean;
  readonly jwtVerifier?: JwtVerifier;
}

export async function authenticate(
  headers: IncomingHttpHeaders,
  config: SparcAuthConfig,
  options: AuthenticateOptions,
): Promise<AuthenticationResult> {
  const token = bearerToken(headers);
  if (token) {
    for (const entry of config.bearerPrincipals ?? []) {
      if (constantTimeEqual(token, entry.token)) {
        return {
          ok: true,
          principal: {
            principalId: entry.principalId,
            scopes: new Set(entry.scopes),
            authentication: 'static-bearer',
          },
        };
      }
    }
    if (config.jwt && options.jwtVerifier) {
      try {
        return { ok: true, principal: await options.jwtVerifier.verify(token) };
      } catch {
        return { ok: false, status: 401, reason: 'bearer token verification failed' };
      }
    }
    return { ok: false, status: 401, reason: 'bearer token verification failed' };
  }
  if (token === '') return { ok: false, status: 401, reason: 'valid Bearer authorization is required' };
  if (options.loopbackRequest && config.anonymousLoopbackPrincipalId) {
    return {
      ok: true,
      principal: {
        principalId: config.anonymousLoopbackPrincipalId,
        scopes: new Set([SPARC_READ_SCOPE, SPARC_WRITE_SCOPE]),
        authentication: 'anonymous-loopback',
      },
    };
  }
  return { ok: false, status: 401, reason: 'Bearer authorization is required' };
}

export function protectedResourceMetadata(config: JwtAuthConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [...(config.authorizationServers ?? [config.issuer])],
    scopes_supported: [
      config.readScope ?? SPARC_READ_SCOPE,
      config.writeScope ?? SPARC_WRITE_SCOPE,
    ],
    bearer_methods_supported: ['header'],
  };
}

/** RFC 9728 section 3.1 well-known transformation for path-bearing resources. */
export function protectedResourceMetadataUrl(resource: string): URL {
  const parsed = new URL(resource);
  const resourcePath = parsed.pathname === '/' ? '' : parsed.pathname;
  return new URL(`/.well-known/oauth-protected-resource${resourcePath}`, parsed.origin);
}

export function authenticationChallenge(config: SparcAuthConfig): string {
  if (!config.jwt) return 'Bearer';
  return `Bearer resource_metadata="${protectedResourceMetadataUrl(config.jwt.resource).href}", scope="${config.jwt.readScope ?? SPARC_READ_SCOPE}"`;
}

export function authConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): SparcAuthConfig {
  const issuer = environment.SPARC_MCP_AUTH_ISSUER;
  const audience = environment.SPARC_MCP_AUTH_AUDIENCE;
  const jwksUrl = environment.SPARC_MCP_AUTH_JWKS_URL;
  const resource = environment.SPARC_MCP_RESOURCE;
  const devToken = environment.SPARC_MCP_DEV_TOKEN;
  const devPrincipal = environment.SPARC_MCP_DEV_PRINCIPAL ?? 'local-developer';
  const jwt = issuer || audience || jwksUrl || resource
    ? (() => {
      if (!issuer || !audience || !jwksUrl || !resource) {
        throw new Error('JWT auth requires issuer, audience, JWKS URL, and resource');
      }
      return { issuer, audience, jwksUrl, resource };
    })()
    : undefined;
  return validateAuthConfig({
    ...(jwt ? { jwt } : {}),
    ...(devToken ? {
      bearerPrincipals: [{
        token: devToken,
        principalId: devPrincipal,
        scopes: [SPARC_READ_SCOPE, SPARC_WRITE_SCOPE],
      }],
    } : {}),
    ...(!jwt && !devToken ? { anonymousLoopbackPrincipalId: devPrincipal } : {}),
  });
}
