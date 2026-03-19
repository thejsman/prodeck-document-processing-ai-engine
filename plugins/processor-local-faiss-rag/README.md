# Local FAISS RAG Processor Plugin

Persistent Retrieval-Augmented Generation using FAISS for vector storage and a
pluggable LLM provider for embeddings and generation. Unlike the in-memory RAG
plugin, this plugin saves the FAISS index and chunk metadata to disk so that
knowledge accumulates across pipeline runs.

## LLM Provider

The plugin uses the **LLM Provider Abstraction Layer** (`plugins/shared/providers/`).
By default it calls a local Ollama instance, but you can switch to OpenAI (or any
future provider) via environment variables — no code changes required.

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | `ollama` or `openai` | `ollama` |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |
| `OLLAMA_GENERATION_MODEL` | Ollama generation model | `mistral` |
| `OLLAMA_EMBEDDING_MODEL` | Ollama embedding model | `nomic-embed-text` |
| `OPENAI_API_KEY` | OpenAI API key (required for OpenAI) | — |
| `OPENAI_GENERATION_MODEL` | OpenAI chat model | `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | OpenAI embedding model | `text-embedding-3-small` |

## Namespace Isolation

The `ingest` and `query` CLI commands support `--namespace <name>` to maintain
independent knowledge bases within a single working directory:

```
<workdir>/namespaces/<namespace>/index.faiss
<workdir>/namespaces/<namespace>/chunks.json
```

Default namespace is `"default"` when no flag is provided.

## Prerequisites

For Ollama (default):

```bash
ollama serve
ollama pull mistral
ollama pull nomic-embed-text
```

Install Python dependencies:

```bash
pip install requests numpy faiss-cpu

# For OpenAI provider (optional)
pip install openai
```

## Build

```bash
pnpm --filter @ai-engine/plugin-local-faiss-rag build
```

## Usage

### Pipeline mode

```bash
ai-engine run pipeline.yaml input.pdf --plugins plugins/processor-local-faiss-rag
```

### Ingest + Query mode

```bash
# Ingest into a namespace
ai-engine ingest ./docs/ --workdir ./kb --namespace research

# Query that namespace
ai-engine query "What are the key findings?" --workdir ./kb --namespace research

# Use OpenAI instead
LLM_PROVIDER=openai OPENAI_API_KEY=sk-... \
  ai-engine query "Summarize" --workdir ./kb --namespace research
```

## How It Works

1. Document content is split into ~500-character chunks
2. Each chunk is embedded using `provider.embed()` (Ollama or OpenAI)
3. Vectors are L2-normalized and added to a FAISS `IndexFlatIP` index (cosine similarity)
4. The index is saved to `index.faiss` and chunk texts to `chunks.json` in the namespace directory
5. On subsequent runs, the existing index is loaded and new chunks are appended
6. A query is embedded and the top 5 most similar chunks are retrieved via FAISS search
7. Retrieved chunks are sent as context to `provider.generate()` for a summary

## Persistence

Two files are written to the namespace directory:

| File | Contents |
|------|----------|
| `index.faiss` | FAISS vector index (binary) |
| `chunks.json` | Chunk text array (JSON) |

On first run, these are created. On subsequent runs, they are loaded and extended with new
document chunks, giving the pipeline memory across invocations.

## Error Handling

- Fails immediately if the LLM provider is unreachable or misconfigured
- Fails immediately if FAISS index is corrupted or mismatched with chunks
- Clear error message if querying a non-existent namespace
- No silent data corruption — index/chunks consistency is validated on load
- No stdout logging — stderr JSON errors only
