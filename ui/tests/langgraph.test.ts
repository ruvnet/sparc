import { ChatPromptTemplate } from '@langchain/core/prompts'
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables'
import { describe, expect, it } from 'vitest'

describe('LangChain composition', () => {
  it('renders the prompt and carries typed state through a sequence', async () => {
    const haikuPrompt = ChatPromptTemplate.fromTemplate(
      'Write a haiku about {topic}.',
    )
    const renderedPrompt = await haikuPrompt.invoke({ topic: 'programming' })

    expect(renderedPrompt.toString()).toContain('programming')

    const chain = RunnableSequence.from([
      RunnableLambda.from(async ({ topic }: { topic: string }) => ({
        topic,
        haiku: 'Quiet keys awaken\nLogic blooms between the lines\nTests guard every change',
      })),
      RunnableLambda.from(
        async (state: { topic: string; haiku: string }) => ({
          ...state,
          analysis: `${state.topic}: ${state.haiku.split('\n').length} lines`,
        }),
      ),
    ])

    await expect(chain.invoke({ topic: 'programming' })).resolves.toEqual({
      topic: 'programming',
      haiku:
        'Quiet keys awaken\nLogic blooms between the lines\nTests guard every change',
      analysis: 'programming: 3 lines',
    })
  })
})
