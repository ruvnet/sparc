'use client';

import { AuthDialog } from '../components/auth-dialog'
import { Chat } from '../components/chat'
import { ChatInput } from '../components/chat-input'
import { ChatPicker } from '../components/chat-picker'
import { ChatSettings } from '../components/chat-settings'
import { CommandPicker } from '../components/command-picker'
import { NavBar } from '../components/navbar'
import { Preview } from '../components/preview'
import { AuthViewType, useAuth } from '../lib/auth'
import { Message, MessageText, MessageCode, MessageImage, toAISDKMessages, toMessageImage } from '../lib/messages'
import { LLMModelConfig } from '../lib/models'
import modelsList from '../lib/models.json'
import { FragmentSchema, fragmentSchema as schema } from '../lib/schema'
import { supabase } from '../lib/supabase'
import templates, { TemplateId } from '../lib/templates'
import { ExecutionResult } from '../lib/types'
import { handleCommand } from '../lib/commands'
import { SubmitFunction, CommandContext } from '../lib/commands/types'
import { DeepPartial } from 'ai'
import { experimental_useObject as useObject } from 'ai/react'
import { usePostHog } from 'posthog-js/react'
import { SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalStorage } from 'usehooks-ts'

export default function Home() {
  // Helper functions defined at the top
  const setCurrentPreview = (preview: {
    fragment: DeepPartial<FragmentSchema> | undefined
    result: ExecutionResult | undefined
  }) => {
    setFragment(preview.fragment)
    setResult(preview.result)
    setCurrentPreviewState(preview)
  }

  const addMessage = (message: Message) => {
    const newMessages = [...messages, message]
    setMessages(newMessages)
    return newMessages
  }

  const setMessage = (message: Partial<Message>, index?: number) => {
    setMessages((previousMessages) => {
      const updatedMessages = [...previousMessages]
      updatedMessages[index ?? previousMessages.length - 1] = {
        ...previousMessages[index ?? previousMessages.length - 1],
        ...message,
      }
      return updatedMessages
    })
  }

  // State declarations
  const [chatInput, setChatInput] = useLocalStorage('chat', '')
  const [files, setFiles] = useState<File[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<'auto' | TemplateId>('auto')
  const [languageModel, setLanguageModel] = useLocalStorage<LLMModelConfig>('languageModel', {
    model: 'claude-3-5-sonnet-latest',
  })

  const posthog = usePostHog()

  const [result, setResult] = useState<ExecutionResult>()
  const [messages, setMessages] = useState<Message[]>([])
  const [fragment, setFragment] = useState<DeepPartial<FragmentSchema>>()
  const [currentTab, setCurrentTab] = useState<'code' | 'fragment'>('code')
  const [showFragment, setShowFragment] = useState<boolean>(true)
  const [currentPreviewState, setCurrentPreviewState] = useState<{
    fragment: DeepPartial<FragmentSchema> | undefined;
    result: ExecutionResult | undefined;
  }>({ fragment: undefined, result: undefined });
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isAuthDialogOpen, setAuthDialog] = useState(false)
  const [authView, setAuthView] = useState<AuthViewType>('sign_in')
  const [isRateLimited, setIsRateLimited] = useState(false)
  const { session, apiKey } = useAuth(setAuthDialog, setAuthView)
  const autoChatStarted = useRef(false)
  const currentModel = useMemo(
    () => modelsList.models.find((model) => model.id === languageModel.model),
    [languageModel.model],
  )
  const currentTemplate = useMemo(
    () =>
      selectedTemplate === 'auto'
        ? templates
        : { [selectedTemplate]: templates[selectedTemplate] },
    [selectedTemplate],
  )

  // Auto-chat initialization
  useEffect(() => {
    if (session && messages.length === 0 && !autoChatStarted.current) {
      autoChatStarted.current = true
      void handleCommand(
        '/chat Tell me about yourself', 
        (params) => {
          // Handle all messages, including streaming ones
          if (params.messages) {
            const newMessages = params.messages.map(msg => {
              const content = msg.content.map(c => {
                if ('type' in c) {
                  switch (c.type) {
                    case 'text':
                      return { type: 'text', text: c.text } as MessageText;
                    case 'code':
                      return { type: 'code', text: c.text } as MessageCode;
                    case 'image':
                      if ('image' in c) {
                        return { type: 'image', image: c.image } as MessageImage;
                      }
                      break;
                  }
                }
                return null;
              }).filter((c): c is MessageText | MessageCode | MessageImage => c !== null);
            
              return {
                role: msg.role as Message['role'],
                content,
                loading: msg.loading,
                streaming: msg.streaming
              } as Message;
            });
            
            if (params.updateLast) {
              setMessages(prev => [...prev.slice(0, -1), ...newMessages]);
            } else {
              setMessages(prev => [...prev, ...newMessages]);
            }
          }
        },
        {
          userID: session?.user?.id,
          template: currentTemplate,
          model: currentModel,
          config: languageModel,
          messages: [],
          defaultHandler: async (args: string, submit: SubmitFunction, context: CommandContext) => {
            const content: Message['content'] = [{ type: 'text', text: args }]
            const newMessages: Message[] = [{
              role: 'user' as const,
              content,
            }]
            setMessages(newMessages)
            submit({
              userID: session?.user?.id,
              messages: toAISDKMessages(newMessages),
              template: currentTemplate,
              model: currentModel,
              config: context.config,
            })
            return true
          }
        }
      ).catch((commandError) => {
        autoChatStarted.current = false
        console.error(
          'Automatic chat initialization failed:',
          commandError instanceof Error ? commandError.message : 'UnknownError',
        )
      })
    }
  }, [currentModel, currentTemplate, languageModel, messages.length, session])

  const { object, submit, isLoading, stop, error } = useObject({
    api: currentModel?.id === 'o1-preview' || currentModel?.id === 'o1-mini'
      ? '/api/chat-o1'
      : '/api/chat',
    schema,
    onError: (error) => {
      if (error.message.includes('request limit')) {
        setIsRateLimited(true)
      }
    },
    onFinish: async ({ object: fragment, error }) => {
      if (!error) {
        console.log('fragment', fragment)
        setIsPreviewLoading(true)
        posthog.capture('fragment_generated', {
          template: fragment?.template,
        })

        try {
          if (!fragment) return;

          setFragment(fragment)
          setCurrentPreview({ fragment, result: undefined })
          
          const codeContent = Array.isArray(fragment.code)
            ? fragment.code
                .filter((f): f is NonNullable<typeof f> => f !== null && f !== undefined)
                .map(f => `// ${f.file_path}\n${f.file_content}`)
                .join('\n\n')
            : typeof fragment.code === 'string' ? fragment.code : '';

          setMessage({ 
            content: [
              { type: 'text', text: fragment.commentary || '' },
              { type: 'code', text: codeContent }
            ],
            object: fragment 
          })

          const response = await fetch('/api/sandbox', {
            method: 'POST',
            body: JSON.stringify({
              fragment,
              userID: session?.user?.id,
              apiKey,
            }),
          })

          if (!response.ok) {
            throw new Error(`Sandbox API error: ${response.statusText}`)
          }

          const result = await response.json()
          console.log('result', result)
          posthog.capture('sandbox_created', { url: result.url })

          setResult(result)
          setCurrentPreview({ fragment, result })
          setMessage({ result })
        } catch (err) {
          console.error('Sandbox error:', err)
        } finally {
          setIsPreviewLoading(false)
        }
      }
    },
  })

  useEffect(() => {
    if (object) {
      setFragment(object)
      const codeContent = Array.isArray(object.code)
        ? object.code
            .filter((f): f is NonNullable<typeof f> => f !== null && f !== undefined)
            .map(f => `// ${f.file_path}\n${f.file_content}`)
            .join('\n\n')
        : typeof object.code === 'string' ? object.code : '';

      const content: Message['content'] = [
        { type: 'text', text: object.commentary || '' },
        { type: 'code', text: codeContent },
      ]

      setMessages((previousMessages) => {
        const previousMessage = previousMessages.at(-1)
        if (previousMessage?.role === 'assistant') {
          return [
            ...previousMessages.slice(0, -1),
            { ...previousMessage, content, object },
          ]
        }
        return [...previousMessages, { role: 'assistant', content, object }]
      })
    }
  }, [object])

  useEffect(() => {
    if (error) stop()
  }, [error, stop])

  const handleSubmitAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!session) {
      return setAuthDialog(true)
    }

    if (isLoading) {
      stop()
    }

    let commandInput = chatInput
    // If no command prefix and chat is selected in dropdown, add /chat prefix
    if (!chatInput.startsWith('/') && selectedTemplate === 'chat') {
      commandInput = `/chat ${chatInput}`
    }

    // Handle commands
    if (commandInput.startsWith('/')) {
      // Clear input immediately for all commands
      setChatInput('');
      setFiles([]);
      
      const defaultHandler = async (args: string, submit: SubmitFunction, context: CommandContext) => {
        // Handle regular chat messages
        const content: Message['content'] = [{ type: 'text', text: args }]
        const images = await toMessageImage(files)

        if (images.length > 0) {
          images.forEach((image) => {
            content.push({ type: 'image', image: image.image })
          })
        }

        // Add user message to chat
        const newMessages = [...messages, {
          role: 'user' as const,
          content,
        }]
        setMessages(newMessages as Message[])

        // Submit for AI processing
        submit({
          userID: session?.user?.id,
          messages: toAISDKMessages(newMessages),
          template: currentTemplate,
          model: currentModel,
          config: context.config, // Use context config to respect command overrides
        })

        return true
      }

      const isCommand = await handleCommand(
        commandInput,
        (params) => {
          if (params.messages) {
            const newMessages = params.messages.map(msg => {
              const content = msg.content.map(c => {
                if ('type' in c) {
                  switch (c.type) {
                    case 'text':
                      return { type: 'text', text: c.text } as MessageText;
                    case 'code':
                      return { type: 'code', text: c.text } as MessageCode;
                    case 'image':
                      if ('image' in c) {
                        return { type: 'image', image: c.image } as MessageImage;
                      }
                      break;
                  }
                }
                return null;
              }).filter((c): c is MessageText | MessageCode | MessageImage => c !== null);
              
              return {
                role: msg.role as Message['role'],
                content,
                loading: msg.loading,
                streaming: msg.streaming
              } as Message;
            });
            
            if (params.updateLast) {
              setMessages(prev => [...prev.slice(0, -1), ...newMessages]);
            } else {
              setMessages(prev => [...prev, ...newMessages]);
            }
          }
        },
        {
          userID: session?.user?.id,
          template: currentTemplate,
          model: currentModel,
          config: languageModel,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content.filter(c => 'text' in c).map(c => ({
              type: c.type,
              text: 'text' in c ? c.text || '' : '',
              icon: 'icon' in c ? c.icon : undefined
            })),
            loading: false,
            streaming: false
          })),
          defaultHandler
        }
      );
      if (isCommand) {
        setChatInput('');
        setFiles([]);
        return;
      }

      // Reset command input if we didn't handle it
      commandInput = chatInput;
    }

    // Handle regular chat messages
    const content: Message['content'] = [{ type: 'text', text: chatInput }]
    const images = await toMessageImage(files)

    if (images.length > 0) {
      images.forEach((image) => {
        content.push({ type: 'image', image: image.image })
      })
    }

    const updatedMessages = addMessage({
      role: 'user' as const,
      content,
    })

    submit({
      userID: session?.user?.id,
      messages: toAISDKMessages(updatedMessages),
      template: currentTemplate,
      model: currentModel,
      config: languageModel,
    })

    setChatInput('')
    setFiles([])
    setCurrentTab('code')

    posthog.capture('chat_submit', {
      template: selectedTemplate,
      model: languageModel.model,
    })
  }

  const retry = () => {
    submit({
      userID: session?.user?.id,
      messages: toAISDKMessages(messages),
      template: currentTemplate,
      model: currentModel,
      config: languageModel,
    })
  }

  const handleSaveInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setChatInput(e.target.value)
  }

  const handleFileChange = (change: SetStateAction<File[]>) => {
    setFiles(change)
  }

  const logout = () => {
    if (supabase) {
      void supabase.auth.signOut()
      return
    }
    console.warn('Supabase is not initialized')
  }

  const handleLanguageModelChange = (e: LLMModelConfig) => {
    setLanguageModel({ ...languageModel, ...e })
  }

  const handleSocialClick = (target: 'github' | 'x' | 'discord') => {
    if (target === 'github') {
      window.open('https://github.com/e2b-dev/fragments', '_blank')
    } else if (target === 'x') {
      window.open('https://x.com/e2b_dev', '_blank')
    } else if (target === 'discord') {
      window.open('https://discord.gg/U7KEcGErtQ', '_blank')
    }

    posthog.capture(`${target}_click`)
  }

  const handleClearChat = () => {
    stop()
    setChatInput('')
    setFiles([])
    setMessages([])
    setFragment(undefined)
    setResult(undefined)
    setCurrentTab('code')
    setIsPreviewLoading(false)
  }

  const handleUndo = () => {
    setMessages((previousMessages) => [...previousMessages.slice(0, -2)])
    setCurrentPreview({ fragment: undefined, result: undefined })
  }

  return (
    <main className="flex min-h-screen max-h-screen">
      {supabase && (
        <AuthDialog
          open={isAuthDialogOpen}
          setOpen={setAuthDialog}
          view={authView}
          supabase={supabase}
        />
      )}
      <div className={`grid w-full ${showFragment ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
        <div
          className={`flex flex-col w-full max-h-full max-w-[800px] mx-auto px-4 overflow-auto ${showFragment && fragment ? 'col-span-1' : 'col-span-2'}`}
        >
          <NavBar
            session={session}
            showLogin={() => setAuthDialog(true)}
            signOut={logout}
            onSocialClick={handleSocialClick}
            onClear={handleClearChat}
            canClear={messages.length > 0}
            canUndo={messages.length > 1 && !isLoading}
            onUndo={handleUndo}
            showFragment={showFragment}
            onToggleFragment={() => setShowFragment(!showFragment)}
          />
          <Chat
            messages={messages}
            isLoading={isLoading}
            setCurrentPreview={setCurrentPreview}
          />
          <ChatInput
            retry={retry}
            isErrored={error !== undefined}
            isLoading={isLoading}
            isRateLimited={isRateLimited}
            stop={stop}
            input={chatInput}
            handleInputChange={handleSaveInputChange}
            handleSubmit={handleSubmitAuth}
            isMultiModal={currentModel?.multiModal || false}
            files={files}
            handleFileChange={handleFileChange}
          >
            <CommandPicker 
              onCommandSelect={(command) => setChatInput(command + ' ')} 
            />
            <ChatPicker
              templates={templates}
              selectedTemplate={selectedTemplate}
              onSelectedTemplateChange={setSelectedTemplate}
              models={modelsList.models}
              languageModel={languageModel}
              onLanguageModelChange={handleLanguageModelChange}
            />
            <ChatSettings
              languageModel={languageModel}
              onLanguageModelChange={handleLanguageModelChange}
              apiKeyConfigurable={!process.env.NEXT_PUBLIC_NO_API_KEY_INPUT}
              baseURLConfigurable={!process.env.NEXT_PUBLIC_NO_BASE_URL_INPUT}
            />
          </ChatInput>
        </div>
        {showFragment && (currentPreviewState.fragment || fragment) && (
          <Preview
            apiKey={apiKey}
            selectedTab={currentTab}
            onSelectedTabChange={setCurrentTab}
            isChatLoading={isLoading}
            isPreviewLoading={isPreviewLoading}
            fragment={currentPreviewState.fragment || fragment}
            result={(currentPreviewState.result || result) as ExecutionResult}
            onClose={() => {
              setFragment(undefined)
              setCurrentPreviewState({ fragment: undefined, result: undefined })
            }}
          />
        )}
      </div>
    </main>
  )
}
