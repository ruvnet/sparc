import { CommandHandler } from './types'
import { commandErrorMessage } from './error'

interface ResearchState {
  steps: string[]
  currentStep: number
  results: string[]
}

export const research: CommandHandler = async (args: string, submit, context) => {
  if (!args) return false

  // Initialize research state
  const state: ResearchState = {
    steps: [
      'Understanding the research question',
      'Gathering relevant information',
      'Analyzing the data',
      'Formulating conclusions'
    ],
    currentStep: 0,
    results: []
  }

  // Submit initial user message
  submit({
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: `/research ${args}` }]
    }],
    userID: context.userID,
    model: context.model,
    template: context.template,
    config: context.config,
    clearInput: true
  })

  // Show initial loading indicator with longer delay
  await new Promise(resolve => setTimeout(resolve, 500))
  submit({
    messages: [{
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'Researching...',
        icon: 'Search'
      }],
      loading: true
    }],
    userID: context.userID,
    model: context.model,
    template: context.template,
    config: context.config
  })

  try {
    // Execute research steps
    for (const step of state.steps) {
      state.currentStep++
      
      // Add longer delay between steps
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Update progress with icon
      const icons = ['BookOpen', 'Database', 'LineChart', 'Lightbulb']
      submit({
        messages: [{
          role: 'assistant',
          content: [{
            type: 'text',
            text: `Step ${state.currentStep}/${state.steps.length}: ${step}`,
            icon: icons[state.currentStep - 1]
          }],
          loading: true
        }],
        userID: context.userID,
        model: context.model,
        template: context.template,
        config: context.config
      })

      // Perform research step
      const response = await fetch('/api/anthropic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: `${step}: ${args}`,
          modelName: context.config?.modelName || 'claude-3-sonnet-20240229'
        })
      })

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`)
      }

      const { content } = await response.json()
      state.results.push(content)
    }

    // Submit the complete response
    submit({
      messages: [{
        role: 'assistant',
        content: [{ type: 'text', text: state.results.join('\n\n') }]
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: context.config
    })

    return true
  } catch (error: unknown) {
    console.error('Research error:', error)
    
    submit({
      messages: [{
        role: 'assistant',
        content: [{ 
          type: 'text', 
          text: `Unable to complete research analysis. Error: ${commandErrorMessage(error)}`
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
