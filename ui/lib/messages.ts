export type MessageText = {
  type: 'text'
  text: string
  icon?: string
}

export type MessageImage = {
  type: 'image'
  image: string
}

export type MessageCode = {
  type: 'code'
  text: string
  code?: string
  language?: string
}

export type MessageContent = MessageText | MessageImage | MessageCode

export type Message = {
  role: 'user' | 'assistant'
  content: MessageContent[]
  loading?: boolean
  streaming?: boolean
  object?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
}

export function toAISDKMessages(messages: Message[]) {
  return messages.map(message => ({
    role: message.role,
    content: message.content.map(content => {
      if (content.type === 'text') {
        return { type: 'text', text: content.text }
      }
      if (content.type === 'image') {
        return { type: 'image', image: content.image, text: '' }
      }
      if (content.type === 'code') {
        return { type: 'text', text: content.text || content.code || '' }
      }
      return { type: 'text', text: '' }
    })
  }))
}

export function toMessageImage(image: string | File | File[]): MessageImage[] {
  if (Array.isArray(image)) {
    return image.map(file => ({
      type: 'image',
      image: URL.createObjectURL(file)
    }))
  }
  if (typeof image === 'string') {
    return [{
      type: 'image',
      image
    }]
  }
  return [{
    type: 'image',
    image: URL.createObjectURL(image)
  }]
}
import type { DeepPartial } from 'ai'

import type { FragmentSchema } from './schema'
import type { ExecutionResult } from './types'
