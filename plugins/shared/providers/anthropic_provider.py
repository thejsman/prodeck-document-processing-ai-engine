"""Anthropic LLM provider — uses the official Anthropic Python SDK."""

import os
from typing import Optional

from .base_provider import LLMProvider

# Max output tokens per completion. Raised from 8096 because rich HTML artifacts
# (e.g. multi-slide presentation decks, especially tall 9:16 portrait slides) were
# being truncated mid-tag at the old cap, which broke <slides> extraction and made
# the generated deck silently disappear. 16000 matches the other artifact-generation
# paths in the codebase and stays within the non-streaming timeout budget.
MAX_OUTPUT_TOKENS = 16000

# Claude models with native vision support
VISION_MODELS = {
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
}


class AnthropicProvider(LLMProvider):
    """LLMProvider backed by the Anthropic API.

    Requires the ``anthropic`` package and a valid ``ANTHROPIC_API_KEY``
    environment variable.

    Note: Anthropic does not provide a native embeddings API. Calling
    ``embed()`` will raise a ``RuntimeError``. Use the ``openai`` or
    ``ollama`` provider for namespaces that require ingestion/embedding.

    Args:
        api_key: Anthropic API key. Falls back to ``ANTHROPIC_API_KEY`` env var.
        generation_model: Model for completions (default ``claude-sonnet-4-6``).
        temperature: Sampling temperature (default ``0``).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        generation_model: str = "claude-sonnet-4-6",
        temperature: float = 0,
    ):
        resolved_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not resolved_key:
            raise RuntimeError(
                "Anthropic provider requires an API key. "
                "Set the ANTHROPIC_API_KEY environment variable or pass api_key explicitly."
            )

        try:
            import anthropic  # noqa: F811
        except ImportError as exc:
            raise RuntimeError(
                "The 'anthropic' package is required for the Anthropic provider. "
                "Install it with: pip install anthropic"
            ) from exc

        self._client = anthropic.Anthropic(api_key=resolved_key)
        self._generation_model = generation_model
        self._default_temperature = temperature

    def generate(self, prompt: str, temperature: Optional[float] = None) -> str:
        t = temperature if temperature is not None else self._default_temperature
        try:
            response = self._client.messages.create(
                model=self._generation_model,
                max_tokens=MAX_OUTPUT_TOKENS,
                temperature=t,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as exc:
            raise RuntimeError(f"Anthropic message creation failed: {exc}") from exc

        if not response.content:
            raise RuntimeError("Anthropic returned an empty response")
        return response.content[0].text

    def generate_stream(self, prompt: str, temperature: Optional[float] = None):
        """Yield tokens from Anthropic completion using the streaming API."""
        t = temperature if temperature is not None else self._default_temperature
        try:
            with self._client.messages.stream(
                model=self._generation_model,
                max_tokens=MAX_OUTPUT_TOKENS,
                temperature=t,
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    yield text
        except Exception as exc:
            raise RuntimeError(f"Anthropic streaming completion failed: {exc}") from exc

    def generate_with_image(self, prompt: str, image_data: str) -> str:
        """Send a prompt with an image to a vision-capable Claude model."""
        vision_model = (
            self._generation_model
            if self._generation_model in VISION_MODELS
            else "claude-sonnet-4-6"
        )
        try:
            response = self._client.messages.create(
                model=vision_model,
                max_tokens=MAX_OUTPUT_TOKENS,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": image_data,
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }],
            )
        except Exception:
            return self.generate(prompt)

        if not response.content:
            return self.generate(prompt)
        return response.content[0].text

    def embed(self, text: str) -> list[float]:
        raise RuntimeError(
            "Anthropic does not provide a native embeddings API. "
            "Use the 'openai' or 'ollama' provider for namespaces that require ingestion."
        )
