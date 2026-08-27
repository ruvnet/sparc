import { CommandHandler } from './types'
import { commandErrorDetails, commandErrorMessage } from './error'

export const plan: CommandHandler = async (args: string, submit, context) => {
  if (!args) return false

  console.log('=== Plan Command Start ===')
  console.log('Args:', args)
  console.log('Context:', {
    config: context.config ? {
      ...context.config,
      anthropicApiKey: context.config.anthropicApiKey ? '***' : 'Not found'
    } : 'No config'
  })

  try {
    // Submit user message immediately
    submit({
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `/plan ${args}` }]
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
          text: 'Planning...',
          icon: 'Calendar'
        }],
        loading: true
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: context.config
    })

    // Generate plan using SPARC methodology - step by step
    const stages = [
      { 
        name: 'Specification',
        prompt: `Create the Specification stage for: ${args}\n` +
          `- Define clear objectives and requirements\n` +
          `- Identify key stakeholders\n` +
          `- Outline success criteria`
      },
      {
        name: 'Pseudocode',
        prompt: `Create the Pseudocode stage for: ${args}\n` +
          `- Outline high-level logic and flow\n` +
          `- Define main processes and algorithms\n` +
          `- Identify key decision points`
      },
      {
        name: 'Architecture',
        prompt: `Create the Architecture stage for: ${args}\n` +
          `- Design system components and interfaces\n` +
          `- Define data structures and relationships\n` +
          `- Outline deployment architecture`
      },
      {
        name: 'Refinement',
        prompt: `Create the Refinement stage for: ${args}\n` +
          `- Identify iterative improvements\n` +
          `- Define testing strategies\n` +
          `- Outline optimization opportunities`
      },
      {
        name: 'Completion',
        prompt: `Create the Completion stage for: ${args}\n` +
          `- Define testing and deployment strategy\n` +
          `- Outline documentation requirements\n` +
          `- Identify maintenance considerations`
      }
    ];

    const stageResults: string[] = [];
    
    for (const stage of stages) {
      // Show current stage progress
      submit({
        messages: [{
          role: 'assistant',
          content: [{
            type: 'text',
            text: `Working on ${stage.name} stage...`,
            icon: 'Calendar'
          }],
          loading: true
        }],
        userID: context.userID,
        model: context.model,
        template: context.template,
        config: context.config
      });

      const response = await fetch('/api/anthropic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: stage.prompt,
          modelName: context.config?.modelName || 'claude-3-sonnet-20240229'
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const { content } = await response.json();
      stageResults.push(`=== ${stage.name} ===\n${content}`);

      // Show stage completion
      submit({
        messages: [{
          role: 'assistant',
          content: [{
            type: 'text',
            text: `Completed ${stage.name} stage`,
            icon: 'Check'
          }]
        }],
        userID: context.userID,
        model: context.model,
        template: context.template,
        config: context.config
      });

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Combine all stages into final plan
    const finalPlan = stageResults.join('\n\n');

    // Submit final response
    submit({
      messages: [{
        role: 'assistant',
        content: [{ type: 'text', text: finalPlan }]
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: context.config
    });

    console.log('=== Plan Command Complete ===')
    return true
  } catch (error: unknown) {
    console.error('=== Plan Command Error ===')
    console.error('Error Details:', commandErrorDetails(error))
    
    submit({
      messages: [{
        role: 'assistant',
        content: [{ 
          type: 'text', 
          text: `Unable to complete planning. Error: ${commandErrorMessage(error)}`
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
