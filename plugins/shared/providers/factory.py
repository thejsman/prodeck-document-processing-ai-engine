"""Provider factory — instantiates the correct LLMProvider from configuration."""

import os
from typing import Optional

from .base_provider import LLMProvider

_PROVIDERS = {
    "anthropic": "plugins.shared.providers.anthropic_provider.AnthropicProvider",
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
        provider_name: One of ``"anthropic"``, ``"ollama"``, or ``"openai"``.

    Returns:
        A configured LLMProvider ready to use.

    Raises:
        ValueError: If the requested provider name is unknown.
    """
    name = (provider_name or os.environ.get("LLM_PROVIDER", "ollama")).lower().strip()

    if name == "anthropic":
        from .anthropic_provider import AnthropicProvider

        generation_model = os.environ.get(
            "ANTHROPIC_GENERATION_MODEL", "claude-sonnet-4-6"
        )
        temperature = float(os.environ.get("ANTHROPIC_TEMPERATURE", "0"))
        return AnthropicProvider(
            generation_model=generation_model,
            temperature=temperature,
        )

    if name == "ollama":
        from .ollama_provider import OllamaProvider

        base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        generation_model = os.environ.get("OLLAMA_GENERATION_MODEL", "mistral")
        embedding_model = os.environ.get("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")
        timeout = int(os.environ.get("OLLAMA_TIMEOUT", "300"))
        return OllamaProvider(
            base_url=base_url,
            generation_model=generation_model,
            embedding_model=embedding_model,
            timeout=timeout,
        )

    if name == "openai":
        from .openai_provider import OpenAIProvider

        generation_model = os.environ.get("OPENAI_GENERATION_MODEL", "gpt-5.2")
        embedding_model = os.environ.get(
            "OPENAI_EMBEDDING_MODEL", "text-embedding-3-large"
        )
        temperature = float(os.environ.get("OPENAI_TEMPERATURE", "0"))
        return OpenAIProvider(
            generation_model=generation_model,
            embedding_model=embedding_model,
            temperature=temperature,
        )

    supported = ", ".join(sorted(_PROVIDERS))
    raise ValueError(
        f"Unknown LLM provider '{name}'. Supported providers: {supported}"
    )
