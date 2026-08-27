import { Command, CommandContext, SubmitFunction } from './types'

export const codingCommand: Command = {
  name: 'Coding',
  description: 'Start a coding session',
  handler: async (args: string, submit: SubmitFunction, context: CommandContext) => {
    if (!args) return false;

    // Ensure skipAI is set to false
    const newContext = {
      ...context,
      config: {
        ...context.config,
        skipAI: false,
      },
    };

    // Use the default handler with updated context
    return newContext.defaultHandler(args, submit, newContext);
  }
}
