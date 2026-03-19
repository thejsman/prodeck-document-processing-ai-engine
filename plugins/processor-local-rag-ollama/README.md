# Local RAG Ollama Processor Plugin

Retrieval-Augmented Generation (RAG) improves LLM output by first retrieving the most relevant
pieces of a document, then feeding only those pieces as context to the model. This produces
more focused and accurate summaries compared to sending the entire document. This plugin
implements in-memory RAG using local embeddings and local inference via Ollama.

## Prerequisites

Ollama must be running locally with both models pulled:

```bash
ollama serve
ollama pull mistral
ollama pull nomic-embed-text
```

## Build

```bash
pnpm --filter @ai-engine/plugin-local-rag-ollama build
```

## Usage

```bash
ai run pipeline.yaml input.pdf --plugins plugins/processor-local-rag-ollama
```

## How It Works

1. Document content is split into ~500-character chunks
2. Each chunk is embedded locally using `nomic-embed-text`
3. A fixed query is embedded and cosine similarity selects the top 3 chunks
4. The retrieved chunks are sent as context to `mistral` for summarization

All processing is local. No data leaves the machine. No state persists between runs.
