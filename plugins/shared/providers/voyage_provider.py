"""Voyage AI embedding provider — embeddings only, no generation."""

import os
from typing import Optional

from .base_provider import LLMProvider


class VoyageProvider(LLMProvider):
    """LLMProvider backed by the Voyage AI embeddings API.

    Only implements embed() — generate() raises RuntimeError.
    Pair with LLM_PROVIDER=anthropic (or openai) for generation.

    Env vars: VOYAGE_API_KEY, VOYAGE_EMBEDDING_MODEL (default: voyage-4)
    """

    def __init__(self, api_key: Optional[str] = None, embedding_model: str = "voyage-4"):
        resolved_key = api_key or os.environ.get("VOYAGE_API_KEY")
        if not resolved_key:
            raise RuntimeError(
                "Voyage provider requires an API key. "
                "Set the VOYAGE_API_KEY environment variable."
            )
        try:
            import voyageai
        except ImportError as exc:
            raise RuntimeError(
                "The 'voyageai' package is required. Install it with: pip install voyageai"
            ) from exc

        self._client = voyageai.Client(api_key=resolved_key)
        self._embedding_model = embedding_model

    def embed(self, text: str) -> list[float]:
        try:
            result = self._client.embed([text], model=self._embedding_model)
        except Exception as exc:
            raise RuntimeError(f"Voyage embedding request failed: {exc}") from exc
        return result.embeddings[0]

    def generate(self, prompt: str, temperature=None) -> str:
        raise RuntimeError(
            "Voyage AI does not provide a generation API. "
            "Use LLM_PROVIDER=anthropic or openai for generation."
        )

    def generate_stream(self, prompt: str, temperature=None):
        raise RuntimeError(
            "Voyage AI does not provide a generation API. "
            "Use LLM_PROVIDER=anthropic or openai for generation."
        )
