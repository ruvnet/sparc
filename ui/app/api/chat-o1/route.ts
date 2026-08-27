import {
  assertAllowedModel,
  assertServerProviderConfigured,
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
  selectSecondCallResource,
} from '@/lib/security/api'
import { Templates, templatesToPrompt } from '@/lib/templates'
import { openai } from '@ai-sdk/openai'
import { streamObject, LanguageModel, CoreMessage, generateText } from 'ai'

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const body = requireObject(await readJsonBody<unknown>(req))
    assertAllowedModel(body.model)

    if (
      body.model.providerId !== 'openai' ||
      !['o1-preview', 'o1-mini'].includes(body.model.id)
    ) {
      throw new ApiError(400, 'model_not_allowed', 'The requested model is not allowed.')
    }
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
    const messages: CoreMessage[] = [
      { role: 'user', content: toPrompt(body.template as Templates) },
      ...(body.messages as CoreMessage[]),
    ]

    const { text } = await generateText({
      model: modelClient as LanguageModel,
      messages,
      ...modelParams,
    })

    // A client-funded request must remain client-funded for both model calls.
    const extractionModel = selectSecondCallResource(
      isClientFunded,
      modelClient as LanguageModel,
      () => openai('gpt-4o-mini') as LanguageModel,
    )
    const stream = await streamObject({
      model: extractionModel,
      schema,
      system: `Please extract as required by the schema from the response. You can use one of the following templates:\n${templatesToPrompt(body.template as Templates)}`,
      prompt: text,
      ...modelParams,
    })

    return stream.toTextStreamResponse()
  } catch (error) {
    return apiErrorResponse(error)
  }
}
