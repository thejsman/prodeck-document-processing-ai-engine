#!/usr/bin/env python3
"""Persistent RAG processor using a pluggable LLM provider for embeddings and generation.

All vector storage is delegated to a VectorStore implementation.
The processor handles chunking, embedding, prompt construction,
and generation. It has no direct dependency on FAISS, numpy, or any
specific LLM backend.
"""

import sys
import json
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))

from providers import create_provider
from vector_store import FaissVectorStore

CHUNK_SIZE = 500
TOP_K = 5
QUERY = "Summarize the key points of this document"


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


def build_rag_prompt(retrieved_chunks):
    """Build the generation prompt from retrieved context chunks."""
    context_block = "\n\n".join(retrieved_chunks)
    return (
        "Using the retrieved context below, summarize in 5 bullet points:\n\n"
        + context_block
    )


def process_document(document, store, provider):
    """Core RAG pipeline: chunk, embed, store, retrieve, generate.

    Args:
        document: The document dict (type, source, content, metadata, createdAt).
        store: A VectorStore instance for storage and retrieval.
        provider: An LLMProvider instance for embeddings and generation.
    """
    content = document["content"]

    new_chunks = split_chunks(content, CHUNK_SIZE)
    if not new_chunks:
        raise ValueError("Document content produced no chunks after splitting")

    # Load existing index (no-op if nothing on disk yet)
    store.load()

    # Embed new chunks and add to store
    new_embeddings = embed_texts(new_chunks, provider)
    store.add(new_chunks, new_embeddings)

    # Persist updated index
    store.persist()

    # Retrieve top-k chunks for the query
    query_embedding = provider.embed(QUERY)
    retrieved = store.search(query_embedding, TOP_K)

    if not retrieved:
        raise ValueError("Vector store retrieval returned no valid chunks")

    # Generate summary
    prompt = build_rag_prompt(retrieved)
    summary = provider.generate(prompt)

    document["content"] = summary
    document["metadata"] = dict(document.get("metadata") or {})
    document["metadata"]["index_size"] = store.size
    document["metadata"]["chunks_retrieved"] = len(retrieved)
    document["metadata"]["processor"] = "local-faiss-rag"

    return document


def main():
    try:
        input_data = json.load(sys.stdin)

        if "document" not in input_data:
            raise ValueError('Missing "document" field in input')

        document = input_data["document"]

        if not isinstance(document.get("content"), str):
            raise ValueError("document.content must be a string")

        context = input_data.get("context", {})
        working_dir = context.get("workingDirectory", ".")

        provider = create_provider()
        store = FaissVectorStore(working_dir)
        processed = process_document(document, store, provider)

        json.dump({"document": processed}, sys.stdout)
        sys.stdout.flush()

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
