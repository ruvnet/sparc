import {
  assertAllowedModel,
  assertServerProviderConfigured,
  getDefaultMode,
  getModelClient,
  modelUsesClientCredential,
  sanitizeModelConfig,
} from '@/lib/models'
import { toPrompt } from '@/lib/prompt'
import { fragmentSchema as schema } from '@/lib/schema'
import {
  ApiError,
  apiErrorResponse,
  enforceApiQuota,
  readJsonBody,
  requestPrincipal,
  requireObject,
} from '@/lib/security/api'
import { Templates } from '@/lib/templates'
import { streamObject, LanguageModel, CoreMessage } from 'ai'

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const body = requireObject(await readJsonBody<unknown>(req))
    assertAllowedModel(body.model)

    if (!Array.isArray(body.messages) || body.messages.length > 128) {
      throw new ApiError(400, 'invalid_messages', 'Messages are invalid.')
    }
    if (!body.template || typeof body.template !== 'object') {
      throw new ApiError(400, 'invalid_template', 'Template is invalid.')
    }

    const model = body.model
    const config = sanitizeModelConfig(model, body.config)
    const isClientFunded = modelUsesClientCredential(model, config)
    const principal = await requestPrincipal(
      req,
      isClientFunded ? config.apiKey : undefined,
    )
    await enforceApiQuota(principal)
    if (!isClientFunded) assertServerProviderConfigured(model)

    const modelParams = {
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      maxTokens: config.maxTokens,
    }
    const modelClient = getModelClient(model, config)
    const stream = await streamObject({
      model: modelClient as LanguageModel,
      schema,
      system: toPrompt(body.template as Templates),
      messages: body.messages as CoreMessage[],
      mode: getDefaultMode(model),
      ...modelParams,
    })

    return stream.toTextStreamResponse()
  } catch (error) {
    return apiErrorResponse(error)
  }
}
