import { CommandHandler } from './types'
import { commandErrorDetails, commandErrorMessage } from './error'

export const chat: CommandHandler = async (args: string, submit, context) => {
  if (!args) return false

  console.log('=== Chat Command Start ===')
  console.log('Args:', args)

  // Submit user message immediately
  submit({
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: args }]
    }],
    userID: context.userID,
    model: context.model,
    template: context.template,
    config: context.config,
    clearInput: true
  })

  // Show loading indicator
  await new Promise(resolve => setTimeout(resolve, 500))
  submit({
    messages: [{
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'Processing your message...',
        icon: 'MessageCircle'
      }],
      loading: true
    }],
    userID: context.userID,
    model: context.model,
    template: context.template,
    config: context.config
  })

  try {
    // Get all previous messages including system messages
    const previousMessages = context.messages || [];
    
    // Add the current user message
    const messagePayload = [...previousMessages, {
      role: 'user',
      content: [{ type: 'text', text: args }]
    }];

    const requestBody = {
      prompt: args,
      messages: messagePayload.map(msg => ({
        role: msg.role,
        content: msg.content.map(c => ({
          type: c.type,
          text: c.type === 'text' ? c.text : ''
        }))
      })),
      modelName: context.config?.modelName || 'claude-3-sonnet-20240229'
    };

    console.log('Chat API Request:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('/api/chat-direct', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: args,
        messages: messagePayload.map(msg => ({
          role: msg.role,
          content: msg.content.map(c => ({
            type: c.type,
            text: c.type === 'text' ? c.text : ''
          }))
        })),
        modelName: context.config?.modelName || 'claude-3-sonnet-20240229'
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `API request failed with status ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body received');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedContent = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        accumulatedContent += chunk;

        // Update the message with accumulated content
        submit({
          messages: [{
            role: 'assistant',
            content: [{ type: 'text', text: accumulatedContent }],
            streaming: true
          }],
          userID: context.userID,
          model: context.model,
          template: context.template,
          config: context.config,
          updateLast: true
        });
      }

      // Send final message with streaming false
      submit({
        messages: [{
          role: 'assistant',
          content: [{ type: 'text', text: accumulatedContent }],
          streaming: false
        }],
        userID: context.userID,
        model: context.model,
        template: context.template,
        config: context.config,
        updateLast: true
      });
    } catch (error) {
      console.error('Streaming error:', error);
      throw error;
    }

    console.log('=== Chat Command Complete ===')
    return true
  } catch (error: unknown) {
    console.error('=== Chat Command Error ===')
    console.error('Error Details:', commandErrorDetails(error))
    
    submit({
      messages: [{
        role: 'assistant',
        content: [{ 
          type: 'text', 
          text: `Unable to complete chat. Error: ${commandErrorMessage(error)}`
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
