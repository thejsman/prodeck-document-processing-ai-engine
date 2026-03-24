#!/usr/bin/env python3
"""Reusable knowledge store operations for ingest and query.

Exposes chunking, embedding, indexing, and retrieval as standalone
operations that the CLI can invoke without running a full pipeline.
Delegates all vector storage to the FaissVectorStore abstraction
and all LLM calls to a pluggable LLMProvider.
"""

import sys
import json
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))

from providers import create_provider
from vector_store import FaissVectorStore

CHUNK_SIZE = 500
TOP_K = 5


def split_chunks(text, chunk_size):
    """Split text into chunks of approximately chunk_size characters."""
    chunks = []
    for start in range(0, len(text), chunk_size):
        chunk = text[start : start + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def embed_texts(texts, provider):
    """Embed a list of texts, returning a list of float lists."""
    return [provider.embed(text) for text in texts]


def ingest_documents(documents, storage_dir, provider):
    """Ingest multiple documents into the FAISS index.

    Args:
        documents: List of dicts with 'fileName' and 'content' keys.
        storage_dir: Directory for index.faiss and chunks.json.
        provider: An LLMProvider instance for computing embeddings.

    Returns:
        Dict with 'documents' count and 'chunks' count.
    """
    os.makedirs(storage_dir, exist_ok=True)
    store = FaissVectorStore(storage_dir)
    store.load()

    total_chunks = 0
    for doc in documents:
        content = doc["content"]
        chunks = split_chunks(content, CHUNK_SIZE)
        if not chunks:
            continue
        embeddings = embed_texts(chunks, provider)
        store.add(chunks, embeddings)
        total_chunks += len(chunks)

    store.persist()

    return {
        "documents": len(documents),
        "chunks": total_chunks,
    }


def search_chunks(question, storage_dir, provider, namespace="default", top_k=5):
    """Search the FAISS index and return raw chunks with similarity scores.

    Unlike query_index, this function does NOT invoke an LLM to generate an
    answer.  It returns the top-k most similar chunks so that the Node.js
    VectorStoreProvider abstraction layer can return structured results.

    Returns an empty list when the namespace has not been indexed yet.
    """
    index_path = os.path.join(storage_dir, "index.faiss")
    chunks_path = os.path.join(storage_dir, "chunks.json")

    if not os.path.isfile(index_path) or not os.path.isfile(chunks_path):
        return []

    store = FaissVectorStore(storage_dir)
    store.load()

    query_embedding = provider.embed(question)
    return store.search_with_scores(query_embedding, top_k)


STREAM_SENTINEL = "\n<<<RESULT_JSON>>>\n"


def query_index(question, storage_dir, provider, namespace="default", stream=False):
    """Query the FAISS index and generate an answer.

    When stream=True and the provider supports generate_stream(), tokens are
    written to stdout immediately as they arrive.  The caller must write the
    STREAM_SENTINEL followed by the result JSON after this function returns.

    Args:
        question: The question string.
        storage_dir: Directory containing index.faiss and chunks.json.
        provider: An LLMProvider instance for embeddings and generation.
        namespace: Namespace name (used in error messages).
        stream: If True, stream tokens to stdout via provider.generate_stream().

    Returns:
        The complete answer string.
    """
    index_path = os.path.join(storage_dir, "index.faiss")
    chunks_path = os.path.join(storage_dir, "chunks.json")

    if not os.path.isfile(index_path) or not os.path.isfile(chunks_path):
        raise FileNotFoundError(
            f"No FAISS index found for namespace '{namespace}'. "
            f"Run 'ai-engine ingest <path> --namespace {namespace}' first."
        )

    store = FaissVectorStore(storage_dir)
    store.load()

    query_embedding = provider.embed(question)
    retrieved = store.search(query_embedding, TOP_K)

    if not retrieved:
        raise ValueError("Vector store retrieval returned no valid chunks")

    context_block = "\n\n".join(retrieved)
    prompt = (
        "Using the context below, answer the question:\n\n"
        f"Question: {question}\n\n"
        f"Context:\n{context_block}"
    )

    if stream and hasattr(provider, "generate_stream"):
        tokens = []
        for token in provider.generate_stream(prompt):
            sys.stdout.write(token)
            sys.stdout.flush()
            tokens.append(token)
        return "".join(tokens)

    return provider.generate(prompt)


def main():
    """Entry point: reads JSON command from stdin, dispatches to operation."""
    try:
        input_data = json.load(sys.stdin)
        operation = input_data.get("operation")
        storage_dir = input_data.get("storageDir", ".")
        namespace = input_data.get("namespace", "default")

        provider = create_provider()

        if operation == "ingest":
            documents = input_data.get("documents", [])
            if not documents:
                raise ValueError("No documents provided for ingestion")
            result = ingest_documents(documents, storage_dir, provider)
            # Annotate which provider/model embedded the documents.
            provider_name = os.environ.get("LLM_PROVIDER", "ollama").lower()
            if provider_name == "openai":
                embed_model = os.environ.get(
                    "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"
                )
            else:
                embed_model = os.environ.get(
                    "OLLAMA_EMBEDDING_MODEL", "nomic-embed-text"
                )
            result["provider"] = f"{provider_name} ({embed_model})"
            json.dump({"result": result}, sys.stdout)
            sys.stdout.flush()

        elif operation == "query":
            question = input_data.get("question", "")
            if not question:
                raise ValueError("No question provided for query")
            stream = input_data.get("stream", False)
            answer = query_index(
                question, storage_dir, provider, namespace=namespace, stream=stream
            )
            if answer is not None:
                if stream:
                    # Separate streamed tokens from the result JSON so the
                    # caller can split on the sentinel and parse only the JSON.
                    sys.stdout.write(STREAM_SENTINEL)
                    sys.stdout.flush()
                json.dump({"result": {"answer": answer}}, sys.stdout)
                sys.stdout.flush()

        elif operation == "search":
            question = input_data.get("question", "")
            if not question:
                raise ValueError("No question provided for search")
            top_k = int(input_data.get("topK", 5))
            chunks = search_chunks(question, storage_dir, provider, namespace, top_k)
            json.dump({"result": {"chunks": chunks}}, sys.stdout)
            sys.stdout.flush()

        else:
            raise ValueError(f"Unknown operation: {operation}")

    except Exception as exc:
        error_output = {
            "error": str(exc),
            "type": type(exc).__name__,
        }
        json.dump(error_output, sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
