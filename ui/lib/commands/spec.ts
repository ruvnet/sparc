import { CommandHandler } from './types'
import { commandErrorDetails, commandErrorMessage } from './error'

export const spec: CommandHandler = async (args: string, submit, context) => {
  if (!args) return false

  console.log('=== Spec Command Start ===')
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
        prompt: `Specification mode activated. Task: ${args}`,
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
        content: [{ type: 'text', text: `/spec ${args}` }]
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

    console.log('=== Spec Command Complete ===')
    return true
  } catch (error: unknown) {
    console.error('=== Spec Command Error ===')
    console.error('Error Details:', commandErrorDetails(error))
    
    submit({
      messages: [{
        role: 'assistant',
        content: [{ 
          type: 'text', 
          text: `Unable to complete specification analysis. Error: ${commandErrorMessage(error)}`
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
