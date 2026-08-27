import type { DeepPartial } from 'ai'

import type { LLMModel, LLMModelConfig } from '../models'
import type { FragmentSchema } from '../schema'
import type { Templates } from '../templates'
import type { ExecutionResult } from '../types'

export type CommandConfig = LLMModelConfig & {
  anthropicApiKey?: string
  modelName?: string
  skipAI?: boolean
  forceTabSwitch?: 'code' | 'fragment'
  setPreview?: {
    fragment: DeepPartial<FragmentSchema>
    result: ExecutionResult
  }
}

export type CommandTemplate = Partial<Templates>

export type SubmitParams = {
  messages: Array<{
    role: 'user' | 'assistant'
    content: Array<{
      type: string
      text: string
      icon?: string
    }>
    loading?: boolean
    streaming?: boolean
  }>
  userID: string | undefined
  template: CommandTemplate
  model: LLMModel | undefined
  config: CommandConfig
  clearInput?: boolean
  updateLast?: boolean
}

export type SubmitFunction = (params: SubmitParams) => void

export type CommandContext = {
  userID: string | undefined
  template: CommandTemplate
  model: LLMModel | undefined
  config: CommandConfig
  messages: Array<{
    role: 'user' | 'assistant'
    content: Array<{
      type: string
      text: string
      icon?: string
    }>
    loading?: boolean
    streaming?: boolean
  }>
  defaultHandler: CommandHandler
}

export type CommandHandler = (args: string, submit: SubmitFunction, context: CommandContext) => Promise<boolean>

export interface Command {
  name: string
  description: string
  handler: CommandHandler
  preview?: (
    fragment: DeepPartial<FragmentSchema>,
    result: ExecutionResult,
  ) => {
    title: string
    description: string
    files: Array<{
      name: string
      content: string
    }>
  }
}

export type CommandRegistry = Record<string, Command>
