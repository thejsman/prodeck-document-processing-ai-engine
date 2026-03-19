"""Provider factory — instantiates the correct LLMProvider from configuration."""

import os
from typing import Optional

from .base_provider import LLMProvider

_PROVIDERS = {
    "ollama": "plugins.shared.providers.ollama_provider.OllamaProvider",
    "openai": "plugins.shared.providers.openai_provider.OpenAIProvider",
}


def create_provider(provider_name: Optional[str] = None) -> LLMProvider:
    """Create an LLMProvider instance.

    Resolution order for the provider name:
        1. Explicit ``provider_name`` argument
        2. ``LLM_PROVIDER`` environment variable
        3. ``"ollama"`` (default)

    Args:
        provider_name: One of ``"ollama"`` or ``"openai"``.

    Returns:
        A configured LLMProvider ready to use.

    Raises:
        ValueError: If the requested provider name is unknown.
    """
    name = (provider_name or os.environ.get("LLM_PROVIDER", "ollama")).lower().strip()

    if name == "ollama":
        from .ollama_provider import OllamaProvider

        base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        generation_model = os.environ.get("OLLAMA_GENERATION_MODEL", "mistral")
        embedding_model = os.environ.get("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")
        return OllamaProvider(
            base_url=base_url,
            generation_model=generation_model,
            embedding_model=embedding_model,
        )

    if name == "openai":
        from .openai_provider import OpenAIProvider

        generation_model = os.environ.get("OPENAI_GENERATION_MODEL", "gpt-4o-mini")
        embedding_model = os.environ.get(
            "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"
        )
        return OpenAIProvider(
            generation_model=generation_model,
            embedding_model=embedding_model,
        )

    supported = ", ".join(sorted(_PROVIDERS))
    raise ValueError(
        f"Unknown LLM provider '{name}'. Supported providers: {supported}"
    )
