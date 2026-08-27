import { CommandContext, CommandRegistry, SubmitFunction } from './commands/types'
import { research } from './commands/research'
import { chat } from './commands/chat'
import { plan } from './commands/plan'
import { help } from './commands/help'
import { spec as sparc } from './commands/spec'
import { test } from './commands/test'

export const commands: CommandRegistry = {
  research: {
    name: 'Research',
    description: 'Get SPARC-style analysis on a topic',
    handler: research
  },
  chat: {
    name: 'Chat',
    description: 'Start a chat discussion',
    handler: chat
  },
  plan: {
    name: 'Plan',
    description: 'Create a plan for a task',
    handler: plan
  },
  help: {
    name: 'Help',
    description: 'Show available commands',
    handler: help
  },
  sparc: {
    name: 'SPARC',
    description: 'Enter specification mode',
    handler: sparc
  },
  test: {
    name: 'Test',
    description: 'Generate a hello world example',
    handler: test
  }
}

export async function handleCommand(input: string, submit: SubmitFunction, context: CommandContext): Promise<boolean> {
  let command = 'chat'
  let args = input

  // Check if input starts with /
  if (input.startsWith('/')) {
    // Extract command and args
    const parts = input.slice(1).split(' ')
    command = parts[0].toLowerCase()
    args = parts.slice(1).join(' ')
  }

  // Get command handler
  const commandConfig = commands[command]
  if (!commandConfig) {
    submit({
      messages: [{
        role: 'assistant',
        content: [{
          type: 'text',
          text: `Unknown command /${command}. Available commands: ${Object.keys(commands).map(c => '/' + c).join(', ')}`
        }]
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: context.config
    })
    return true
  }

  // Execute handler and prevent further processing
  const result = await commandConfig.handler(args, submit, context)
  return result
}

// Export command info for the picker
export const commandList = Object.entries(commands).map(([id, cmd]) => ({
  name: cmd.name,
  description: cmd.description,
  command: '/' + id
}));
