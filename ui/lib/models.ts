import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenAI } from '@ai-sdk/openai'
import { createOllama } from 'ollama-ai-provider'

import models from './models.json'
import { ApiError, optionalClientApiKey } from './security/api'

export type LLMModel = {
  id: string
  name: string
  provider: string
  providerId: string
}

export type LLMModelConfig = {
  model?: string
  apiKey?: string
  baseURL?: string
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  maxTokens?: number
}

const ALLOWED_MODEL_PAIRS = new Set(
  models.models.map(({ id, providerId }) => `${providerId}:${id}`),
)

const ALLOWED_ANTHROPIC_MODELS = new Set([
  ...models.models
    .filter(({ providerId }) => providerId === 'anthropic')
    .map(({ id }) => id),
  // Retained for compatibility with the existing command routes.
  'claude-3-sonnet-20240229',
])

const CLIENT_KEY_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'google',
  'mistral',
  'groq',
  'togetherai',
  'fireworks',
  'xai',
])

const PROVIDER_ORIGINS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  google: 'https://generativelanguage.googleapis.com',
  mistral: 'https://api.mistral.ai',
  groq: 'https://api.groq.com',
  togetherai: 'https://api.together.xyz',
  fireworks: 'https://api.fireworks.ai',
  xai: 'https://api.x.ai',
}

export function assertAllowedModel(model: unknown): asserts model is LLMModel {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new ApiError(400, 'invalid_model', 'Model is invalid.')
  }

  const candidate = model as Partial<LLMModel>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.providerId !== 'string' ||
    !ALLOWED_MODEL_PAIRS.has(`${candidate.providerId}:${candidate.id}`)
  ) {
    throw new ApiError(400, 'model_not_allowed', 'The requested model is not allowed.')
  }
}

export function allowedAnthropicModel(value: unknown) {
  const model = value === undefined ? 'claude-3-sonnet-20240229' : value
  if (typeof model !== 'string' || !ALLOWED_ANTHROPIC_MODELS.has(model)) {
    throw new ApiError(400, 'model_not_allowed', 'The requested model is not allowed.')
  }
  return model
}

function allowedCustomOrigins() {
  const configured = process.env.MODEL_BASE_URL_ALLOWLIST ?? ''
  const origins = new Set<string>()

  for (const entry of configured.split(',')) {
    const value = entry.trim()
    if (!value) continue
    try {
      const url = new URL(value)
      if (url.username || url.password || url.hash) continue
      origins.add(url.origin)
    } catch {
      throw new ApiError(
        503,
        'model_allowlist_misconfigured',
        'MODEL_BASE_URL_ALLOWLIST is invalid.',
      )
    }
  }
  return origins
}

function safeBaseURL(
  providerId: string,
  baseURL: unknown,
  clientApiKey?: string,
) {
  if (baseURL === undefined || baseURL === null || baseURL === '') return undefined
  if (typeof baseURL !== 'string' || baseURL.length > 2048) {
    throw new ApiError(400, 'invalid_base_url', 'Model base URL is invalid.')
  }
  if (!clientApiKey && providerId !== 'ollama') {
    throw new ApiError(
      400,
      'server_credential_origin_locked',
      'Custom model origins require a client-supplied credential.',
    )
  }

  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    throw new ApiError(400, 'invalid_base_url', 'Model base URL is invalid.')
  }
  if (url.username || url.password || url.hash) {
    throw new ApiError(400, 'invalid_base_url', 'Model base URL is invalid.')
  }

  const canonicalOrigin = PROVIDER_ORIGINS[providerId]
  const explicitlyAllowed = allowedCustomOrigins().has(url.origin)
  if (url.origin !== canonicalOrigin && !explicitlyAllowed) {
    throw new ApiError(400, 'model_origin_not_allowed', 'Model origin is not allowed.')
  }
  if (url.protocol !== 'https:' && !explicitlyAllowed) {
    throw new ApiError(400, 'model_origin_not_allowed', 'Model origin is not allowed.')
  }
  return url.toString().replace(/\/$/, '')
}

function optionalFiniteNumber(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ApiError(400, 'invalid_model_config', `${name} is invalid.`)
  }
  return value
}

export function sanitizeModelConfig(
  model: LLMModel,
  value: unknown,
): LLMModelConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid_model_config', 'Model configuration is invalid.')
  }

  const config = value as Record<string, unknown>
  const apiKey = optionalClientApiKey(config.apiKey)
  if (apiKey && !CLIENT_KEY_PROVIDERS.has(model.providerId)) {
    throw new ApiError(
      400,
      'unsupported_client_credential',
      'This provider does not accept a client API key.',
    )
  }

  return {
    model: model.id,
    apiKey,
    baseURL: safeBaseURL(model.providerId, config.baseURL, apiKey),
    temperature: optionalFiniteNumber(config.temperature, 'temperature', 0, 2),
    topP: optionalFiniteNumber(config.topP, 'topP', 0, 1),
    topK: optionalFiniteNumber(config.topK, 'topK', 0, 1000),
    frequencyPenalty: optionalFiniteNumber(
      config.frequencyPenalty,
      'frequencyPenalty',
      -2,
      2,
    ),
    presencePenalty: optionalFiniteNumber(
      config.presencePenalty,
      'presencePenalty',
      -2,
      2,
    ),
    maxTokens: optionalFiniteNumber(config.maxTokens, 'maxTokens', 1, 32768),
  }
}

export function modelUsesClientCredential(
  model: LLMModel,
  config: LLMModelConfig,
) {
  return CLIENT_KEY_PROVIDERS.has(model.providerId) && Boolean(config.apiKey)
}

export function assertServerProviderConfigured(model: LLMModel) {
  const configuredCredentials: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    groq: process.env.GROQ_API_KEY,
    togetherai: process.env.TOGETHER_API_KEY,
    fireworks: process.env.FIREWORKS_API_KEY,
    vertex: process.env.GOOGLE_VERTEX_CREDENTIALS,
    xai: process.env.XAI_API_KEY,
  }

  // Ollama is a trusted, administrator-configured local service and has no key.
  if (model.providerId === 'ollama') return
  if (!configuredCredentials[model.providerId]) {
    throw new ApiError(
      503,
      'provider_not_configured',
      'The requested server-funded provider is not configured.',
    )
  }
}

export function getModelClient(
  model: LLMModel,
  config: LLMModelConfig,
): unknown {
  const { id: modelNameString, providerId } = model
  const { apiKey, baseURL } = config

  const providerConfigs = {
    anthropic: () => createAnthropic({ apiKey, baseURL })(modelNameString),
    openai: () => createOpenAI({ apiKey, baseURL })(modelNameString),
    google: () =>
      createGoogleGenerativeAI({ apiKey, baseURL })(modelNameString),
    mistral: () => createMistral({ apiKey, baseURL })(modelNameString),
    groq: () =>
      createOpenAI({
        apiKey: apiKey || process.env.GROQ_API_KEY,
        baseURL: baseURL || 'https://api.groq.com/openai/v1',
      })(modelNameString),
    togetherai: () =>
      createOpenAI({
        apiKey: apiKey || process.env.TOGETHER_API_KEY,
        baseURL: baseURL || 'https://api.together.xyz/v1',
      })(modelNameString),
    ollama: () => createOllama({ baseURL })(modelNameString),
    fireworks: () =>
      createOpenAI({
        apiKey: apiKey || process.env.FIREWORKS_API_KEY,
        baseURL: baseURL || 'https://api.fireworks.ai/inference/v1',
      })(modelNameString),
    vertex: () =>
      createVertex({
        googleAuthOptions: {
          credentials: JSON.parse(
            process.env.GOOGLE_VERTEX_CREDENTIALS || '{}',
          ),
        },
      })(modelNameString),
    xai: () =>
      createOpenAI({
        apiKey: apiKey || process.env.XAI_API_KEY,
        baseURL: baseURL || 'https://api.x.ai/v1',
      })(modelNameString),
  }

  const createClient =
    providerConfigs[providerId as keyof typeof providerConfigs]

  if (!createClient) {
    throw new Error(`Unsupported provider: ${providerId}`)
  }

  return createClient()
}

export function getDefaultMode(model: LLMModel) {
  const { providerId } = model

  // monkey patch fireworks
  if (providerId === 'fireworks') {
    return 'json'
  }

  return 'auto'
}
