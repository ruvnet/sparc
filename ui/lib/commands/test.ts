import { CommandHandler } from './types'
import { ExecutionResult } from '../types'
import { commandErrorMessage } from './error'

export const test: CommandHandler = async (args: string, submit, context) => {
  // Ensure skipAI is false
  const newContext = {
    ...context,
    config: {
      ...context.config,
      skipAI: false,
    },
  }

  // Add user message
  submit({
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: `/test ${args}` }]
    }],
    userID: context.userID,
    model: context.model,
    template: context.template,
    config: newContext.config,
    clearInput: true
  })

  // Show loading state
  submit({
    messages: [{
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'Generating hello world example...',
        icon: 'Code'
      }],
      loading: true
    }],
    userID: context.userID,
    model: context.model,
    template: context.template,
    config: newContext.config
  })

  try {
    // Simulate AI response with hello world example
    const helloWorld = {
      commentary: "Creating a simple Hello World web application using Next.js",
      template: "nextjs-developer",
      title: "Hello World",
      description: "Basic Next.js hello world page",
      additional_dependencies: [],
      has_additional_dependencies: false,
      install_dependencies_command: "",
      port: 3000,
      code: [{
        file_name: "page.tsx",
        file_path: "app/page.tsx",
        file_content: `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Hello World!</h1>
    </main>
  )
}`,
        file_finished: true
      }]
    }

    // Create sandbox
    const response = await fetch('/api/sandbox', {
      method: 'POST',
      body: JSON.stringify({
        fragment: helloWorld,
        userID: context.userID,
        apiKey: context.config.apiKey,
      }),
    })

    if (!response.ok) {
      throw new Error(`Sandbox API error: ${response.statusText}`)
    }

    const result = await response.json() as ExecutionResult
    console.log('Sandbox result:', result)

    // Submit the response with both fragment and sandbox result
    submit({
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: helloWorld.commentary },
          { type: 'code', text: helloWorld.code[0].file_content },
          { type: 'fragment', text: JSON.stringify({
            ...helloWorld,
            title: "Hello World Example"
          })},
          { type: 'result', text: JSON.stringify(result) }
        ]
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: {
        ...newContext.config,
        forceTabSwitch: 'fragment',
        setPreview: {
          fragment: helloWorld,
          result: result
        }
      },
      updateLast: true
    })

    return true
  } catch (error: unknown) {
    console.error('Test command error:', error)
    submit({
      messages: [{
        role: 'assistant',
        content: [{ 
          type: 'text',
          text: `Failed to create test example: ${commandErrorMessage(error)}`
        }]
      }],
      userID: context.userID,
      model: context.model,
      template: context.template,
      config: newContext.config
    })
    return true
  }
}
