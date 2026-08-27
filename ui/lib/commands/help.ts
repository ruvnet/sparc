import { CommandHandler } from './types'
import { commandErrorMessage } from './error'

const HELP_CONTENT = `
SPARC Methodology Overview:

1. Specification:
   - Clearly define the problem, requirements, and desired outcomes
   - Distinguish between functional and non-functional requirements

2. Pseudocode:
   - Develop a high-level logical outline
   - Include how tests will be integrated

3. Architecture:
   - Design a robust and extensible architecture
   - Identify major components and interfaces

4. Refinement:
   - Iteratively improve the solution
   - Use test-driven development (TDD)

5. Completion:
   - Finalize with comprehensive testing
   - Ensure documentation and readiness for deployment

Available Commands:
/chat [message] - Engage in conversation with the assistant
/research [topic] - Get SPARC-style analysis on a topic
/plan [task] - Create a project plan using SPARC methodology
/sparc - Enter specification mode
/test - Generate a hello world example
/help - Show this help message

For more information visit: https://github.com/ruvnet/sparc
`

export const help: CommandHandler = async (args: string, submit, context) => {
  // Submit help command immediately
  submit({
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: `/help ${args}` }]
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
        text: 'Preparing help information...',
        icon: 'HelpCircle'
      }],
      loading: true
    }],
    userID: context.userID,
    model: context.model,
    template: context.template,
    config: context.config
  })

  try {
    // Submit final response after short delay
    await new Promise(resolve => setTimeout(resolve, 500))
    submit({
      messages: [{
        role: 'assistant',
        content: [{ type: 'text', text: HELP_CONTENT }]
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: context.config
    })

    return true
  } catch (error: unknown) {
    console.error('Help error:', error)
    
    submit({
      messages: [{
        role: 'assistant',
        content: [{ 
          type: 'text', 
          text: `Unable to display help. Error: ${commandErrorMessage(error)}`
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
