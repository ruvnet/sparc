import { ChatAnthropic } from '@langchain/anthropic'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'

import { allowedAnthropicModel } from '@/lib/models'
import {
  ApiError,
  apiErrorResponse,
  enforceApiQuota,
  optionalClientApiKey,
  readJsonBody,
  requestPrincipal,
  requireObject,
  requireServerCredential,
} from '@/lib/security/api'

interface AnthropicMessage {
  role: 'system' | 'user' | 'assistant'
  content: unknown
}

function messageText(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) {
    throw new ApiError(400, 'invalid_messages', 'Message content is invalid.')
  }

  return content
    .map((part) => {
      const entry = requireObject(part, 'message content')
      if (entry.type !== 'text') return ''
      if (typeof entry.text === 'string') return entry.text
      if (entry.text && typeof entry.text === 'object') {
        const nested = entry.text as Record<string, unknown>
        return typeof nested.text === 'string' ? nested.text : ''
      }
      return ''
    })
    .join('')
}

function parseMessages(value: unknown) {
  if (!Array.isArray(value) || value.length > 128) {
    throw new ApiError(400, 'invalid_messages', 'Messages are invalid.')
  }

  return value.map((item) => {
    const message = requireObject(item, 'message') as unknown as AnthropicMessage
    const content = messageText(message.content)

    if (message.role === 'system') return new SystemMessage(content)
    if (message.role === 'assistant') return new AIMessage(content)
    if (message.role === 'user') return new HumanMessage(content)
    throw new ApiError(400, 'invalid_messages', 'Message role is invalid.')
  })
}

export async function POST(req: Request) {
  try {
    const body = requireObject(await readJsonBody<unknown>(req))
    const clientApiKey = optionalClientApiKey(body.apiKey)
    const principal = await requestPrincipal(req, clientApiKey)
    await enforceApiQuota(principal)

    const modelName = allowedAnthropicModel(body.modelName)
    const apiKey =
      clientApiKey ?? requireServerCredential(process.env.ANTHROPIC_API_KEY)
    const model = new ChatAnthropic({
      apiKey,
      modelName,
    })

    let messages
    if (body.messages !== undefined) {
      messages = parseMessages(body.messages)
    } else {
      if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
        throw new ApiError(400, 'invalid_prompt', 'Prompt is required.')
      }
      messages = [
        new SystemMessage(
          'You are a research assistant. Analyze the provided topic and generate a comprehensive research report.',
        ),
        new HumanMessage(body.prompt),
      ]
    }

    const response = await model.invoke(messages)
    return Response.json({ content: response.content.toString() })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
