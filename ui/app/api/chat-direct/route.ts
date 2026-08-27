import { StreamingTextResponse } from 'ai'
import { ChatAnthropic } from '@langchain/anthropic'
import {
  AIMessage,
  HumanMessage,
  MessageContentText,
  SystemMessage,
} from '@langchain/core/messages'

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

function messageText(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) {
    throw new ApiError(400, 'invalid_messages', 'Message content is invalid.')
  }

  return content
    .map((part) => {
      const entry = requireObject(part, 'message content')
      return entry.type === 'text' && typeof entry.text === 'string'
        ? entry.text
        : ''
    })
    .join('')
}

function parseMessages(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    throw new ApiError(400, 'invalid_messages', 'Messages are invalid.')
  }

  return value.map((item) => {
    const message = requireObject(item, 'message')
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

    const apiKey =
      clientApiKey ?? requireServerCredential(process.env.ANTHROPIC_API_KEY)
    const model = new ChatAnthropic({
      apiKey,
      modelName: allowedAnthropicModel(body.modelName),
      streaming: true,
    })

    const stream = await model.stream(parseMessages(body.messages))
    
    // Transform the stream to emit text chunks
    const textEncoder = new TextEncoder()
    const textStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            let content = ''

            if (chunk instanceof AIMessage) {
              if (typeof chunk.content === 'string') {
                content = chunk.content
              } else if (Array.isArray(chunk.content)) {
                content = chunk.content
                  .filter((c): c is MessageContentText => c.type === 'text')
                  .map(c => c.text)
                  .join('')
              }
            } else if (typeof chunk.content === 'string') {
              content = chunk.content
            }

            if (content) {
              controller.enqueue(textEncoder.encode(content))
            }
          }
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      }
    })

    return new StreamingTextResponse(textStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    })
    
  } catch (error) {
    return apiErrorResponse(error)
  }
}
