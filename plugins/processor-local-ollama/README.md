# Local Ollama Processor Plugin

A Processor plugin that calls a locally running Ollama server to summarize document content into 5 bullet points.

## Prerequisites

Ollama must be running locally on the default port:

```bash
ollama serve
ollama pull mistral
```

## Build

```bash
pnpm --filter @ai-engine/plugin-local-ollama build
```

## Usage

```bash
ai run pipeline.yaml input.pdf --plugins plugins/processor-local-ollama
```

## Configuration

- Endpoint: `http://localhost:11434/api/generate`
- Model: `mistral`
- Streaming: disabled
- No API key required
