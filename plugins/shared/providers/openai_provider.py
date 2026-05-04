"""OpenAI LLM provider — uses the official OpenAI Python SDK."""

import os
from typing import Optional

from .base_provider import LLMProvider

# Models that accept max_completion_tokens instead of max_tokens
_COMPLETION_TOKENS_MODELS = {"o1", "o1-mini", "o3", "o3-mini"}

# Models with native vision support
VISION_MODELS = {"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-5", "gpt-5.2"}


class OpenAIProvider(LLMProvider):
    """LLMProvider backed by the OpenAI API.

    Requires the ``openai`` package and a valid ``OPENAI_API_KEY``
    environment variable.

    Args:
        api_key: OpenAI API key.  Falls back to ``OPENAI_API_KEY`` env var.
        generation_model: Model for chat completions (default ``gpt-5.2``).
        embedding_model: Model for embeddings (default ``text-embedding-3-large``).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        generation_model: str = "gpt-5.2",
        embedding_model: str = "text-embedding-3-large",
        temperature: float = 0,
    ):
        resolved_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not resolved_key:
            raise RuntimeError(
                "OpenAI provider requires an API key. "
                "Set the OPENAI_API_KEY environment variable or pass api_key explicitly."
            )

        try:
            import openai  # noqa: F811
        except ImportError as exc:
            raise RuntimeError(
                "The 'openai' package is required for the OpenAI provider. "
                "Install it with: pip install openai"
            ) from exc

        self._client = openai.OpenAI(api_key=resolved_key)
        self._generation_model = generation_model
        self._embedding_model = embedding_model
        self._default_temperature = temperature

    def _token_param(self) -> dict:
        """Return the correct token-limit param for the active generation model."""
        if (
            self._generation_model.startswith("gpt-5")
            or self._generation_model in _COMPLETION_TOKENS_MODELS
        ):
            return {"max_completion_tokens": 8000}
        return {"max_tokens": 8000}

    def _temperature_param(self, override: Optional[float] = None) -> dict:
        """o1/o3 reasoning models do not accept temperature — omit it for those."""
        if self._generation_model in _COMPLETION_TOKENS_MODELS:
            return {}
        value = override if override is not None else self._default_temperature
        return {"temperature": value}

    def generate(self, prompt: str, temperature: Optional[float] = None) -> str:
        try:
            response = self._client.chat.completions.create(
                model=self._generation_model,
                messages=[{"role": "user", "content": prompt}],
                timeout=60,
                **self._token_param(),
                **self._temperature_param(temperature),
            )
        except Exception as exc:
            raise RuntimeError(f"OpenAI chat completion failed: {exc}") from exc

        choice = response.choices[0]
        if choice.message.content is None:
            raise RuntimeError("OpenAI returned an empty response")
        return choice.message.content

    def generate_stream(self, prompt: str, temperature: Optional[float] = None):
        """Yield tokens from OpenAI chat completion using the streaming API."""
        try:
            stream = self._client.chat.completions.create(
                model=self._generation_model,
                messages=[{"role": "user", "content": prompt}],
                stream=True,
                **self._temperature_param(temperature),
            )
        except Exception as exc:
            raise RuntimeError(f"OpenAI streaming completion failed: {exc}") from exc

        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    def generate_with_image(self, prompt: str, image_data: str) -> str:
        """Send a prompt with an image to a vision-capable model (gpt-4o)."""
        image_content = {"type": "image_url", "image_url": {"url": image_data}}
        messages = [{
            "role": "user",
            "content": [
                image_content,
                {"type": "text", "text": prompt},
            ],
        }]
        vision_model = self._generation_model if self._generation_model in VISION_MODELS else "gpt-4o"
        try:
            response = self._client.chat.completions.create(
                model=vision_model,
                messages=messages,
                **self._token_param(),
                **self._temperature_param(),  # vision calls always use instance default
            )
        except Exception:
            return self.generate(prompt)
        choice = response.choices[0]
        if choice.message.content is None:
            return self.generate(prompt)
        return choice.message.content

    def embed(self, text: str) -> list[float]:
        try:
            response = self._client.embeddings.create(
                model=self._embedding_model,
                input=text,
            )
        except Exception as exc:
            raise RuntimeError(f"OpenAI embedding request failed: {exc}") from exc

        return response.data[0].embedding
