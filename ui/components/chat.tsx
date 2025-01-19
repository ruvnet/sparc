import { Message } from '@/lib/messages'
import { FragmentSchema } from '@/lib/schema'
import { ExecutionResult } from '@/lib/types'
import { DeepPartial } from 'ai'
import { Loader2Icon, LoaderIcon, Terminal, Search, BookOpen, Database, LineChart, Lightbulb } from 'lucide-react'
import { useEffect } from 'react'

export function Chat({
  messages,
  isLoading,
  setCurrentPreview,
}: {
  messages: Message[]
  isLoading: boolean
  setCurrentPreview: (preview: {
    fragment: DeepPartial<FragmentSchema> | undefined
    result: ExecutionResult | undefined
  }) => void
}) {
  useEffect(() => {
    const chatContainer = document.getElementById('chat-container')
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight
    }
  }, [JSON.stringify(messages)])

  return (
    <div
      id="chat-container"
      className="flex flex-col pb-4 gap-4 overflow-y-auto max-h-full px-2 md:px-4"
    >
      {messages.map((message: Message, index: number) => (
        <div
          className={`flex flex-col px-4 shadow-sm whitespace-pre-wrap transition-colors ${
            message.role !== 'user'
              ? 'bg-accent/50 dark:bg-white/5 border border-accent/20 dark:border-white/10 text-accent-foreground dark:text-muted-foreground py-4 rounded-2xl gap-4 w-full hover:bg-accent/60 dark:hover:bg-white/[0.07]'
              : 'bg-gradient-to-b from-black/5 to-black/10 dark:from-black/40 dark:to-black/60 py-3 px-5 rounded-xl gap-2 w-fit hover:from-black/10 hover:to-black/15 dark:hover:from-black/50 dark:hover:to-black/70'
          } font-serif`}
          key={index}
        >
          {message.content.map((content, id) => {
            if (content.type === 'text') {
              return (
                <div key={id} className="flex items-center gap-2">
                  {content.icon && (
                    <div className="w-5 h-5 flex items-center justify-center">
                      {content.icon === 'Search' && <Search className="w-4 h-4" />}
                      {content.icon === 'BookOpen' && <BookOpen className="w-4 h-4" />}
                      {content.icon === 'Database' && <Database className="w-4 h-4" />}
                      {content.icon === 'LineChart' && <LineChart className="w-4 h-4" />}
                      {content.icon === 'Lightbulb' && <Lightbulb className="w-4 h-4" />}
                    </div>
                  )}
                  <span>{content.text}</span>
                </div>
              )
            }
            if (content.type === 'image') {
              return (
                <img
                  key={id}
                  src={content.image}
                  alt="fragment"
                  className="mr-2 inline-block w-12 h-12 object-cover rounded-lg bg-white mb-2"
                />
              )
            }
          })}
          {message.object && (
            <div
              onClick={() =>
                setCurrentPreview({
                  fragment: message.object,
                  result: message.result,
                })
              }
              className="py-2 pl-2 w-full md:w-max flex items-center border border-accent/20 dark:border-white/10 rounded-xl select-none transition-colors hover:bg-white/50 dark:hover:bg-white/5 hover:cursor-pointer"
            >
              <div className="rounded-[0.5rem] w-10 h-10 bg-black/5 dark:bg-white/10 self-stretch flex items-center justify-center transition-colors">
                <Terminal strokeWidth={2} className="text-[#FF8800]" />
              </div>
              <div className="pl-2 pr-4 flex flex-col">
                <span className="font-bold font-sans text-sm text-primary">
                  {message.object.title}
                </span>
                <span className="font-sans text-sm text-muted-foreground">
                  Click to see fragment
                </span>
              </div>
            </div>
          )}
        </div>
      ))}
      {isLoading && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <LoaderIcon strokeWidth={2} className="animate-spin w-4 h-4" />
          <span>Generating...</span>
        </div>
      )}
    </div>
  )
}
