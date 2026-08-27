import { createHash, timingSafeEqual } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'

import { Duration, ms } from '../duration'
import ratelimit from '../ratelimit'

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024
const MAX_BODY_LIMIT_BYTES = 256 * 1024
const DEFAULT_RATE_LIMIT = 10
const DEFAULT_RATE_WINDOW: Duration = '1d'
const MAX_RATE_LIMIT_PRINCIPALS = 10_000

type QuotaRecord = {
  count: number
  reset: number
}

const localQuotas = new Map<string, QuotaRecord>()

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly headers?: HeadersInit

  constructor(
    status: number,
    code: string,
    message: string,
    headers?: HeadersInit,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.headers = headers
  }
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  setting: string,
) {
  if (value === undefined) return fallback

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiError(503, 'security_misconfigured', `${setting} is invalid.`)
  }
  return parsed
}

function configuredBodyLimit() {
  return parseBoundedInteger(
    process.env.SPARC_API_MAX_BODY_BYTES,
    DEFAULT_BODY_LIMIT_BYTES,
    1024,
    MAX_BODY_LIMIT_BYTES,
    'SPARC_API_MAX_BODY_BYTES',
  )
}

export async function readJsonBody<T>(request: Request, routeLimit?: number) {
  const maximum = Math.min(
    routeLimit ?? configuredBodyLimit(),
    configuredBodyLimit(),
    MAX_BODY_LIMIT_BYTES,
  )
  const contentLength = request.headers.get('content-length')

  if (contentLength !== null) {
    const length = Number(contentLength)
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ApiError(400, 'invalid_content_length', 'Invalid content length.')
    }
    if (length > maximum) {
      throw new ApiError(413, 'body_too_large', 'Request body is too large.')
    }
  }

  const contentType = request.headers.get('content-type')
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Expected JSON request body.')
  }

  if (!request.body) {
    throw new ApiError(400, 'invalid_json', 'A JSON request body is required.')
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      received += value.byteLength
      if (received > maximum) {
        await reader.cancel()
        throw new ApiError(413, 'body_too_large', 'Request body is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must contain valid JSON.')
  }
}

export function requireObject(value: unknown, name = 'request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid_request', `${name} must be an object.`)
  }
  return value as Record<string, unknown>
}

export function optionalClientApiKey(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 2048) {
    throw new ApiError(400, 'invalid_api_key', 'Client API key is invalid.')
  }

  const key = value.trim()
  if (!key) return undefined
  return key
}

export function requireServerCredential(value: string | undefined) {
  if (!value) {
    throw new ApiError(
      503,
      'provider_not_configured',
      'The requested server-funded provider is not configured.',
    )
  }
  return value
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!authorization) return undefined

  const match = /^Bearer ([^\s]+)$/i.exec(authorization)
  if (!match || match[1].length > 8192) {
    throw new ApiError(401, 'invalid_authorization', 'Authentication failed.')
  }
  return match[1]
}

function secretMatches(actual: string, expected: string) {
  const actualDigest = Buffer.from(digest(actual), 'hex')
  const expectedDigest = Buffer.from(digest(expected), 'hex')
  return timingSafeEqual(actualDigest, expectedDigest)
}

function configuredSharedToken() {
  const token = process.env.SPARC_API_AUTH_TOKEN
  if (!token) return undefined

  const strongHex = /^[a-f0-9]{64,}$/i.test(token)
  const strongBase64Url = /^[A-Za-z0-9_-]{43,}$/.test(token)
  if ((!strongHex && !strongBase64Url) || token.length > 4096) {
    throw new ApiError(
      503,
      'authentication_misconfigured',
      'SPARC_API_AUTH_TOKEN must contain at least 32 random bytes.',
    )
  }
  return token
}

function supabaseAuthConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

async function authenticateBearer(token: string) {
  const sharedToken = configuredSharedToken()
  if (sharedToken && secretMatches(token, sharedToken)) {
    return `shared:${digest(token).slice(0, 32)}`
  }

  if (supabaseAuthConfigured()) {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )
    const { data, error } = await client.auth.getUser(token)
    if (!error && data.user?.id) return `user:${data.user.id}`
  }

  throw new ApiError(401, 'authentication_failed', 'Authentication failed.', {
    'WWW-Authenticate': 'Bearer',
  })
}

export async function trustedPrincipal(request: Request) {
  const sharedToken = configuredSharedToken()
  if (!sharedToken && !supabaseAuthConfigured()) {
    throw new ApiError(
      503,
      'authentication_not_configured',
      'Server-funded API access is disabled until authentication is configured.',
    )
  }

  const token = bearerToken(request)
  if (!token) {
    throw new ApiError(401, 'authentication_required', 'Authentication is required.', {
      'WWW-Authenticate': 'Bearer',
    })
  }
  return authenticateBearer(token)
}

/**
 * Server-funded work requires verified identity. Client-funded work can be
 * anonymous, but is still quota-bound to a one-way credential fingerprint.
 */
export async function requestPrincipal(
  request: Request,
  clientApiKey?: string,
) {
  if (!clientApiKey) return trustedPrincipal(request)

  const token = bearerToken(request)
  if (token) return authenticateBearer(token)
  return `client-key:${digest(clientApiKey).slice(0, 32)}`
}

export function selectSecondCallResource<T>(
  clientFunded: boolean,
  clientResource: T,
  createServerResource: () => T,
) {
  return clientFunded ? clientResource : createServerResource()
}

function quotaSettings() {
  const maximum = parseBoundedInteger(
    process.env.RATE_LIMIT_MAX_REQUESTS,
    DEFAULT_RATE_LIMIT,
    1,
    1000,
    'RATE_LIMIT_MAX_REQUESTS',
  )
  const window = (process.env.RATE_LIMIT_WINDOW ?? DEFAULT_RATE_WINDOW) as Duration

  let windowMs: number
  try {
    windowMs = ms(window)
  } catch {
    throw new ApiError(503, 'security_misconfigured', 'RATE_LIMIT_WINDOW is invalid.')
  }
  if (windowMs < 1000 || windowMs > 31 * 24 * 60 * 60 * 1000) {
    throw new ApiError(503, 'security_misconfigured', 'RATE_LIMIT_WINDOW is invalid.')
  }

  return { maximum, window, windowMs }
}

function quotaHeaders(maximum: number, remaining: number, reset: number) {
  return {
    'X-RateLimit-Limit': String(maximum),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(reset),
  }
}

function enforceLocalQuota(principal: string, maximum: number, windowMs: number) {
  const now = Date.now()
  const current = localQuotas.get(principal)
  if (current && current.reset > now) {
    current.count += 1
    if (current.count > maximum) {
      throw new ApiError(
        429,
        'rate_limit_exceeded',
        'You have reached your request limit.',
        quotaHeaders(maximum, 0, current.reset),
      )
    }
    return
  }

  if (localQuotas.size >= MAX_RATE_LIMIT_PRINCIPALS) {
    localQuotas.forEach((record, key) => {
      if (record.reset <= now) localQuotas.delete(key)
    })
  }
  if (localQuotas.size >= MAX_RATE_LIMIT_PRINCIPALS) {
    throw new ApiError(503, 'quota_unavailable', 'Request quota is temporarily unavailable.')
  }

  localQuotas.set(principal, { count: 1, reset: now + windowMs })
}

export async function enforceApiQuota(principal: string) {
  const { maximum, window, windowMs } = quotaSettings()
  const hasKvUrl = Boolean(process.env.KV_REST_API_URL)
  const hasKvToken = Boolean(process.env.KV_REST_API_TOKEN)

  if (hasKvUrl !== hasKvToken) {
    throw new ApiError(
      503,
      'quota_misconfigured',
      'Request quota is not configured correctly.',
    )
  }

  if (hasKvUrl && hasKvToken) {
    const limit = await ratelimit(`api:${principal}`, maximum, window)
    if (limit) {
      throw new ApiError(
        429,
        'rate_limit_exceeded',
        'You have reached your request limit.',
        quotaHeaders(limit.amount, limit.remaining, limit.reset),
      )
    }
    return
  }

  enforceLocalQuota(principal, maximum, windowMs)
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: error.headers },
    )
  }

  console.error('API request failed', error instanceof Error ? error.name : 'UnknownError')
  return Response.json(
    { error: 'The request could not be completed.', code: 'internal_error' },
    { status: 500 },
  )
}
