import { describe, expect, it } from 'vitest';
import {
  SPARC_READ_SCOPE,
  SPARC_WRITE_SCOPE,
  authenticate,
  authConfigFromEnvironment,
  authenticationChallenge,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  validateAuthConfig,
} from '../src/mcp/auth.js';

const TOKEN = 'a'.repeat(64);

describe('SPARC MCP authentication', () => {
  it('authenticates a strong static token with only its configured scopes', async () => {
    const config = validateAuthConfig({
      bearerPrincipals: [{
        token: TOKEN,
        principalId: 'reader-one',
        scopes: [SPARC_READ_SCOPE],
      }],
    });
    const result = await authenticate(
      { authorization: `Bearer ${TOKEN}` },
      config,
      { loopbackRequest: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.principalId).toBe('reader-one');
    expect([...result.principal.scopes]).toEqual([SPARC_READ_SCOPE]);
    expect(result.principal.scopes.has(SPARC_WRITE_SCOPE)).toBe(false);
  });

  it('never grants anonymous access to a nonloopback request', async () => {
    const config = validateAuthConfig({ anonymousLoopbackPrincipalId: 'local-user' });
    await expect(authenticate({}, config, { loopbackRequest: true }))
      .resolves.toMatchObject({ ok: true });
    await expect(authenticate({}, config, { loopbackRequest: false }))
      .resolves.toEqual({ ok: false, status: 401, reason: 'Bearer authorization is required' });
  });

  it('rejects weak or duplicated development credentials', () => {
    expect(() => validateAuthConfig({
      bearerPrincipals: [{ token: 'password', principalId: 'dev', scopes: [SPARC_WRITE_SCOPE] }],
    })).toThrow(/32 random bytes/);
    expect(() => validateAuthConfig({
      bearerPrincipals: [
        { token: TOKEN, principalId: 'one', scopes: [SPARC_READ_SCOPE] },
        { token: TOKEN, principalId: 'two', scopes: [SPARC_WRITE_SCOPE] },
      ],
    })).toThrow(/duplicate/);
    expect(() => validateAuthConfig({
      bearerPrincipals: [{ token: TOKEN, principalId: 'invalid/principal', scopes: [SPARC_READ_SCOPE] }],
    })).toThrow(/invalid authentication principal/);
    expect(() => validateAuthConfig({
      bearerPrincipals: [{ token: TOKEN, principalId: `p${'x'.repeat(128)}`, scopes: [SPARC_READ_SCOPE] }],
    })).toThrow(/invalid authentication principal/);
  });

  it('uses the RFC 9728 well-known URI for a path-bearing protected resource', () => {
    const config = validateAuthConfig({
      jwt: {
        issuer: 'https://identity.example.test/tenant',
        audience: 'sparc-api',
        jwksUrl: 'https://identity.example.test/tenant/keys',
        resource: 'https://sparc.example.test/api/mcp',
      },
    });
    expect(protectedResourceMetadataUrl(config.jwt!.resource).href)
      .toBe('https://sparc.example.test/.well-known/oauth-protected-resource/api/mcp');
    expect(authenticationChallenge(config)).toContain(
      'resource_metadata="https://sparc.example.test/.well-known/oauth-protected-resource/api/mcp"',
    );
    expect(protectedResourceMetadataUrl('https://sparc.example.test/api/mcp/').href)
      .toBe('https://sparc.example.test/.well-known/oauth-protected-resource/api/mcp/');
  });

  it('validates JWT issuer, audience, JWKS and protected-resource metadata', () => {
    const config = validateAuthConfig({
      jwt: {
        issuer: 'https://identity.example.test',
        audience: 'sparc-api',
        jwksUrl: 'https://identity.example.test/.well-known/jwks.json',
        resource: 'https://sparc.example.test',
      },
    });
    expect(protectedResourceMetadata(config.jwt!)).toEqual({
      resource: 'https://sparc.example.test',
      authorization_servers: ['https://identity.example.test'],
      scopes_supported: [SPARC_READ_SCOPE, SPARC_WRITE_SCOPE],
      bearer_methods_supported: ['header'],
    });
    expect(() => validateAuthConfig({
      jwt: {
        issuer: 'http://identity.example.test',
        audience: 'sparc-api',
        jwksUrl: 'https://identity.example.test/keys',
        resource: 'https://sparc.example.test',
      },
    })).toThrow(/HTTPS/);
  });

  it('fails closed when the JWT environment is only partially configured', () => {
    expect(() => authConfigFromEnvironment({
      SPARC_MCP_AUTH_ISSUER: 'https://identity.example.test',
    })).toThrow(/requires issuer, audience, JWKS URL, and resource/);
  });
});
