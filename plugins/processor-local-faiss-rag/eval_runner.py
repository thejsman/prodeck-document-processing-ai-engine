#!/usr/bin/env python3
"""Evaluation runner — batch query with retrieval and timing details.

Reuses the same vector store and provider infrastructure as the main
knowledge store, but returns per-question metrics needed by the CLI
eval harness: retrieved chunks, answer text, latency, and provider.

Input (JSON on stdin):
    {
        "storageDir": "/path/to/namespaces/ns",
        "namespace": "ns",
        "questions": ["q1", "q2"]
    }

Output (JSON on stdout):
    {
        "results": [
            {
                "question": "q1",
                "answer": "...",
                "retrieved_chunks": ["chunk1", ...],
                "latency_ms": 1234.5,
                "provider": "ollama"
            }
        ]
    }
"""

import sys
import json
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))

from providers import create_provider
from vector_store import FaissVectorStore

TOP_K = 5


def evaluate_question(question, store, provider):
    """Run retrieval + generation for a single question, returning details."""
    start = time.monotonic()

    query_embedding = provider.embed(question)
    retrieved = store.search(query_embedding, TOP_K)

    if not retrieved:
        elapsed_ms = (time.monotonic() - start) * 1000
        return {
            "question": question,
            "answer": "",
            "retrieved_chunks": [],
            "latency_ms": round(elapsed_ms, 2),
        }

    context_block = "\n\n".join(retrieved)
    prompt = (
        "Using the context below, answer the question:\n\n"
        f"Question: {question}\n\n"
        f"Context:\n{context_block}"
    )

    answer = provider.generate(prompt)
    elapsed_ms = (time.monotonic() - start) * 1000

    return {
        "question": question,
        "answer": answer,
        "retrieved_chunks": retrieved,
        "latency_ms": round(elapsed_ms, 2),
    }


def main():
    try:
        input_data = json.load(sys.stdin)
        storage_dir = input_data["storageDir"]
        namespace = input_data.get("namespace", "default")
        questions = input_data.get("questions", [])

        if not questions:
            raise ValueError("No questions provided for evaluation")

        index_path = os.path.join(storage_dir, "index.faiss")
        chunks_path = os.path.join(storage_dir, "chunks.json")

        if not os.path.isfile(index_path) or not os.path.isfile(chunks_path):
            raise FileNotFoundError(
                f"No FAISS index found for namespace '{namespace}'. "
                f"Run 'ai-engine ingest <path> --namespace {namespace}' first."
            )

        provider = create_provider()
        provider_name = os.environ.get("LLM_PROVIDER", "ollama").lower().strip()

        store = FaissVectorStore(storage_dir)
        store.load()

        results = []
        for question in questions:
            result = evaluate_question(question, store, provider)
            result["provider"] = provider_name
            results.append(result)

        json.dump({"results": results}, sys.stdout)
        sys.stdout.flush()

    except Exception as exc:
        json.dump(
            {"error": str(exc), "type": type(exc).__name__},
            sys.stderr,
        )
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
