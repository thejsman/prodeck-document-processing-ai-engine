# LangChain Summarizer Plugin

A Processor plugin that uses LangChain + OpenAI to summarize document content into 5 bullet points.

## Prerequisites

```bash
pip install -r requirements.txt
```

Set the `OPENAI_API_KEY` environment variable:

```bash
export OPENAI_API_KEY=sk-...
```

## Build

```bash
pnpm --filter @ai-engine/plugin-langchain-summarize build
```

## Usage

```bash
ai run pipeline.yaml input.pdf --plugins plugins/processor-langchain-summarize
```

## How It Works

1. The TypeScript wrapper registers as a standard Processor plugin
2. On execution, it delegates to `processor.py` via the Python stdin/stdout bridge
3. The Python script reads the document, calls OpenAI via LangChain, and returns the summary

## Configuration

- Model: `gpt-4o-mini`
- Temperature: `0` (deterministic)
- Prompt: "Summarize the following text in 5 bullet points"
