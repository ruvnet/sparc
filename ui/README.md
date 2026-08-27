# SPARC UI Framework

A comprehensive React component library for the SPARC (Specification, Pseudocode, Architecture, Refinement, and Completion) Framework. This library provides a robust set of UI components designed to streamline the development of AI-powered applications.

## Overview

The SPARC UI Framework is built on modern web technologies and best practices, offering:

- **AI-First Architecture**: Deep integration with multiple LLM providers
- **Component-Driven Design**: Modular, reusable components following atomic design principles
- **Type Safety**: Full TypeScript support with comprehensive type definitions
- **Modern Styling**: Built with Tailwind CSS for responsive and customizable designs
- **Accessibility**: ARIA-compliant components following WCAG guidelines
- **Framework Agnostic**: Core components work with any React-based framework

## Quick Start

### Installation

```bash
npm install @ruv/sparc-ui
# or
yarn add @ruv/sparc-ui
# or
pnpm add @ruv/sparc-ui
```


## Environment Setup

### Core Requirements

```bash
# E2B API Key (Required) - Get your key at https://e2b.dev/
E2B_API_KEY="your-e2b-api-key"

# At least one AI provider API key is required
OPENAI_API_KEY="your-openai-key"
ANTHROPIC_API_KEY="your-anthropic-key"

# Required for any server-funded API route unless Supabase auth is configured.
# Generate at least 32 random bytes, for example: openssl rand -hex 32
SPARC_API_AUTH_TOKEN="64-lowercase-hex-characters"

# Additional Provider Options
GROQ_API_KEY="your-groq-key"
FIREWORKS_API_KEY="your-fireworks-key"
TOGETHER_API_KEY="your-together-key"
GOOGLE_AI_API_KEY="your-google-ai-key"
GOOGLE_VERTEX_CREDENTIALS="your-vertex-credentials"
MISTRAL_API_KEY="your-mistral-key"
XAI_API_KEY="your-xai-key"
```

### Optional Features

```bash
# Site Configuration
NEXT_PUBLIC_SITE_URL="your-site-url"

# UI Configuration
NEXT_PUBLIC_NO_API_KEY_INPUT="true"
NEXT_PUBLIC_NO_BASE_URL_INPUT="true"

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS="100"
RATE_LIMIT_WINDOW="1h"

# Request bodies are bounded to 256 KiB; the default is 64 KiB.
SPARC_API_MAX_BODY_BYTES="65536"

# Vercel/Upstash KV (for short URLs and rate limiting)
KV_REST_API_URL="your-kv-api-url"
KV_REST_API_TOKEN="your-kv-api-token"

# Supabase Authentication (alternative to SPARC_API_AUTH_TOKEN)
NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"

# Optional comma-separated origins for client-funded custom model endpoints.
# Never add an origin that should receive server-owned provider credentials.
MODEL_BASE_URL_ALLOWLIST="https://gateway.example.com"

# PostHog Analytics
NEXT_PUBLIC_POSTHOG_KEY="your-posthog-key"
NEXT_PUBLIC_POSTHOG_HOST="your-posthog-host"
```


## Core Features

### AI Integration

The framework provides seamless integration with multiple AI providers:

```tsx
// OpenAI Integration
<ChatInput
  provider="openai"
  model="gpt-4-turbo-preview"
  temperature={0.7}
  maxTokens={2000}
  systemPrompt="You are a helpful assistant..."
/>

// Anthropic Integration
<ChatInput
  provider="anthropic"
  model="claude-3-opus-20240229"
  temperature={0.5}
  maxTokens={4000}
/>

// Custom Provider Integration
<ChatInput
  provider="custom"
  endpoint="https://your-api.com/v1/chat"
  headers={{
    'Authorization': 'Bearer your-token'
  }}
/>
```

### Code Execution Environment

Secure, sandboxed code execution powered by E2B with support for multiple development environments:

#### Available Templates

- **Gradio Developer**: Build ML/AI interfaces with Gradio (Port: 7860)
- **Next.js Developer**: Create React applications with Next.js (Port: 3000)
- **Streamlit Developer**: Develop data apps with Streamlit (Port: 8501)
- **Vue Developer**: Build Vue/Nuxt applications (Port: 3000)

```tsx
// Example: Using a sandbox template
<Preview
  mode="code"
  template="gradio-developer"  // Specify the template
  code={[{
    file_path: "app.py",
    file_content: `
import gradio as gr
def greet(name): return f"Hello {name}!"
demo = gr.Interface(fn=greet, inputs="text", outputs="text")
demo.launch()
    `
  }]}
  port={7860}  // Template-specific port
  onExecute={async (result) => {
    const { url, error } = result;
    if (error) {
      console.error('Execution failed:', error);
    } else {
      console.log('App running at:', url);
    }
  }}
/>
```

For detailed template documentation and implementation guides, see [sandbox-templates/README.md](sandbox-templates/README.md).

### Advanced Component Customization

#### Theme Customization

```tsx
import { ThemeProvider } from '@ruv/sparc-ui';

<ThemeProvider
  theme={{
    colors: {
      primary: '#007AFF',
      secondary: '#5856D6',
      background: '#ffffff',
      text: '#000000'
    },
    typography: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: {
        base: '16px',
        heading: '24px'
      }
    },
    spacing: {
      base: '4px',
      large: '8px'
    }
  }}
>
  <App />
</ThemeProvider>
```

#### Component Composition

```tsx
import { ChatInput, Preview, FragmentCode, useChat } from '@ruv/sparc-ui';

function CustomChatInterface() {
  const {
    messages,
    isLoading,
    sendMessage,
    clearMessages
  } = useChat({
    provider: 'anthropic',
    model: 'claude-3-opus-20240229'
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="messages-container">
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.type === 'code' ? (
              <FragmentCode
                code={msg.content}
                language={msg.language}
                showLineNumbers
                enableCopy
                theme="github-dark"
              />
            ) : (
              <Preview
                mode="markdown"
                content={msg.content}
                enableMath
                enableDiagrams
              />
            )}
          </div>
        ))}
      </div>
      
      <ChatInput
        onSubmit={sendMessage}
        suggestions={[
          'Explain this code',
          'Generate unit tests',
          'Optimize performance'
        ]}
        autoComplete={{
          enable: true,
          source: 'codebase'
        }}
      />
    </div>
  );
}
```

### Advanced Features

#### Code Analysis and Transformation

```tsx
import { FragmentCode, useCodeAnalysis } from '@ruv/sparc-ui';

function CodeAnalyzer() {
  const { analyze, refactor } = useCodeAnalysis();
  
  const handleAnalyze = async (code) => {
    const analysis = await analyze(code, {
      metrics: ['complexity', 'maintainability'],
      suggestions: true,
      security: true
    });
    
    const refactored = await refactor(code, {
      target: 'performance',
      preserveLogic: true
    });
    
    return { analysis, refactored };
  };
  
  return (
    <FragmentCode
      onAnalyze={handleAnalyze}
      showMetrics
      enableRefactoring
      diffView
    />
  );
}
```

#### Real-time Collaboration

```tsx
import { CollaborativeEditor } from '@ruv/sparc-ui';

<CollaborativeEditor
  mode="pair-programming"
  room="project-123"
  participants={{
    max: 5,
    roles: ['driver', 'navigator']
  }}
  features={{
    cursor: true,
    chat: true,
    voice: true
  }}
  persistence={{
    enable: true,
    provider: 'local-storage'
  }}
/>
```

## Performance Optimization

### Code Splitting

The package supports tree-shaking and code splitting:

```tsx
// Import only what you need
import { ChatInput } from '@ruv/sparc-ui/chat';
import { Preview } from '@ruv/sparc-ui/preview';
```

### Lazy Loading

```tsx
import { lazy, Suspense } from 'react';

const ChatInput = lazy(() => import('@ruv/sparc-ui/chat'));
const Preview = lazy(() => import('@ruv/sparc-ui/preview'));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ChatInput />
      <Preview />
    </Suspense>
  );
}
```

## Security Considerations

- All code execution is sandboxed using E2B's secure environment
- API keys are never exposed to the client
- Rate limiting prevents abuse
- Input validation and sanitization on all user inputs
- Regular security audits and dependency updates

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build package
npm run build

# Run tests
npm test

# Run linting
npm run lint
```

## Support

- Documentation: [https://sparc-ui.dev](https://sparc-ui.dev)
- Issues: [GitHub Issues](https://github.com/ruv/sparc-ui/issues)
- Discord: [Join our community](https://discord.gg/sparc-ui)

## License

This project is licensed under the Apache 2 License. See [LICENSE](LICENSE) file for details.
