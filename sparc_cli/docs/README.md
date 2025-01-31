# SPARC CLI Documentation

Version: 0.8.2

## Introduction

SPARC CLI is a powerful command-line interface that implements the SPARC Framework methodology for AI-assisted software development. It combines autonomous research capabilities with guided implementation to provide a comprehensive toolkit for analyzing codebases, planning changes, and executing development tasks.

## Key Benefits

- Framework Integration: Seamlessly implements SPARC Framework's methodology
- Autonomous Capabilities: Provides both research and guided implementation
- Safety Controls: Features human-in-the-loop controls and review mechanisms
- Provider Flexibility: Supports multiple LLM providers
- Development Workflow: Enhances productivity through AI assistance

## Core Features

- Research and implementation modes
- Multiple LLM provider support
- Interactive chat mode
- Human-in-the-loop interaction
- Expert knowledge queries
- Shell command execution
- Rich console output
- Web scraping and data extraction

## Web Scraping Features

The CLI includes powerful web scraping capabilities:
- Configurable rate limiting and request throttling
- Automatic retry mechanisms
- Response caching
- Error handling and recovery
- Support for multiple data formats (HTML, JSON, XML)

Example usage:
```bash
sparc scrape --url "https://example.com" --selector "article.content" --format json
```

## Documentation Sections

- [Usage Guide](usage.md) - Installation and basic usage
- [Advanced Features](advanced.md) - Detailed features and configurations
- [Architecture](architecture.md) - System design and components

For installation and getting started, please refer to the [Usage Guide](usage.md).

### Environment Setup

Environment variables are automatically managed in `$HOME/.sparc_exports` and sourced in your shell's RC file.

Required API Keys:
- ANTHROPIC_API_KEY - Get it from: https://console.anthropic.com/account/keys

Optional API Keys:
- OPENAI_API_KEY - Get it from: https://platform.openai.com/api-keys
- OPENROUTER_KEY - Get it from: https://openrouter.ai/keys
- GEMINI_API_KEY - Get it from: https://makersuite.google.com/app/apikey
- VERTEXAI_PROJECT and VERTEXAI_LOCATION - Configure in Google Cloud Console

The installation script supports both local Python and Docker-based installations. Choose the installation method that best suits your needs:

```bash
./install.sh

./install.sh --docker
```
