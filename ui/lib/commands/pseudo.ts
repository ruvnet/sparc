import { CommandHandler } from './types'
import { commandErrorDetails, commandErrorMessage } from './error'

export const pseudo: CommandHandler = async (args: string, submit, context) => {
  if (!args) return false

  console.log('=== Pseudo Command Start ===')
  console.log('Args:', args)
  console.log('Context:', {
    config: context.config ? {
      ...context.config,
      anthropicApiKey: context.config.anthropicApiKey ? '***' : 'Not found'
    } : 'No config'
  })

  try {
    const response = await fetch('/api/anthropic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Pseudocode mode activated. Task: ${args}`,
        modelName: context.config?.modelName || 'claude-3-sonnet-20240229'
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const { content } = await response.json();

    // Add user message
    submit({
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `/pseudo ${args}` }]
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: context.config
    });

    // Add response after a short delay
    await new Promise(resolve => setTimeout(resolve, 500));

    submit({
      messages: [{
        role: 'assistant',
        content: [{ type: 'text', text: content }]
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: context.config
    });

    console.log('=== Pseudo Command Complete ===')
    return true
  } catch (error: unknown) {
    console.error('=== Pseudo Command Error ===')
    console.error('Error Details:', commandErrorDetails(error))
    
    submit({
      messages: [{
        role: 'assistant',
        content: [{ 
          type: 'text', 
          text: `Unable to complete pseudocode analysis. Error: ${commandErrorMessage(error)}`
        }]
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: context.config
    })
    return true
  }
}
