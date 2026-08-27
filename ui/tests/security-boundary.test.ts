import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  enforceApiQuota,
  readJsonBody,
  requestPrincipal,
  selectSecondCallResource,
  trustedPrincipal,
} from '../lib/security/api'
import {
  assertAllowedModel,
  sanitizeModelConfig,
  type LLMModel,
} from '../lib/models'

const openAIModel: LLMModel = {
  id: 'gpt-4o-mini',
  name: 'GPT-4o Mini',
  provider: 'OpenAI',
  providerId: 'openai',
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('API trust boundary', () => {
  it('fails closed when server-funded authentication is not configured', async () => {
    vi.stubEnv('SPARC_API_AUTH_TOKEN', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    await expect(
      trustedPrincipal(new Request('https://sparc.invalid/api/chat')),
    ).rejects.toMatchObject({
      status: 503,
      code: 'authentication_not_configured',
    })
  })

  it('accepts only the configured bearer token for server-funded work', async () => {
    const sharedToken = 'a'.repeat(64)
    vi.stubEnv('SPARC_API_AUTH_TOKEN', sharedToken)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    const valid = new Request('https://sparc.invalid/api/chat', {
      headers: { Authorization: `Bearer ${sharedToken}` },
    })
    await expect(trustedPrincipal(valid)).resolves.toMatch(/^shared:/)

    const invalid = new Request('https://sparc.invalid/api/chat', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    await expect(trustedPrincipal(invalid)).rejects.toMatchObject({
      status: 401,
      code: 'authentication_failed',
    })
  })

  it('fails closed when the shared bearer token is too weak', async () => {
    vi.stubEnv('SPARC_API_AUTH_TOKEN', 'guessable-token')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    await expect(
      trustedPrincipal(new Request('https://sparc.invalid/api/chat')),
    ).rejects.toMatchObject({
      status: 503,
      code: 'authentication_misconfigured',
    })
  })

  it('rejects oversized JSON before parsing it', async () => {
    vi.stubEnv('SPARC_API_MAX_BODY_BYTES', '1024')
    const request = new Request('https://sparc.invalid/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'x'.repeat(2048) }),
    })

    await expect(readJsonBody(request)).rejects.toMatchObject({
      status: 413,
      code: 'body_too_large',
    })
  })

  it('rate limits client-funded requests instead of bypassing quota', async () => {
    vi.stubEnv('RATE_LIMIT_MAX_REQUESTS', '1')
    vi.stubEnv('RATE_LIMIT_WINDOW', '1h')
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')

    const principal = await requestPrincipal(
      new Request('https://sparc.invalid/api/chat'),
      `client-test-key-${Date.now()}`,
    )
    await enforceApiQuota(principal)
    await expect(enforceApiQuota(principal)).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit_exceeded',
    })
  })

  it('does not allocate a server-funded second call for client-funded work', () => {
    const clientModel = { funding: 'client' }
    const serverFactory = vi.fn(() => ({ funding: 'server' }))

    expect(selectSecondCallResource(true, clientModel, serverFactory)).toBe(
      clientModel,
    )
    expect(serverFactory).not.toHaveBeenCalled()
  })
})

describe('model trust boundary', () => {
  it('accepts only catalogued provider and model pairs', () => {
    expect(() => assertAllowedModel(openAIModel)).not.toThrow()
    expect(() =>
      assertAllowedModel({ ...openAIModel, id: 'attacker-controlled-model' }),
    ).toThrow(ApiError)
    expect(() =>
      assertAllowedModel({ ...openAIModel, providerId: 'attacker-provider' }),
    ).toThrow(ApiError)
  })

  it('never routes server credentials to a request-controlled base URL', () => {
    expect(() =>
      sanitizeModelConfig(openAIModel, {
        baseURL: 'https://attacker.invalid/v1',
      }),
    ).toThrowError(expect.objectContaining({ code: 'server_credential_origin_locked' }))
  })

  it('requires an explicit origin allowlist even with a client credential', () => {
    vi.stubEnv('MODEL_BASE_URL_ALLOWLIST', '')
    expect(() =>
      sanitizeModelConfig(openAIModel, {
        apiKey: 'client-owned-key',
        baseURL: 'https://attacker.invalid/v1',
      }),
    ).toThrowError(expect.objectContaining({ code: 'model_origin_not_allowed' }))

    vi.stubEnv('MODEL_BASE_URL_ALLOWLIST', 'https://gateway.example.com')
    expect(
      sanitizeModelConfig(openAIModel, {
        apiKey: 'client-owned-key',
        baseURL: 'https://gateway.example.com/v1',
      }).baseURL,
    ).toBe('https://gateway.example.com/v1')
  })
})
