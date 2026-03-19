"""OpenAI LLM provider — uses the official OpenAI Python SDK."""

import os
from typing import Optional

from .base_provider import LLMProvider


class OpenAIProvider(LLMProvider):
    """LLMProvider backed by the OpenAI API.

    Requires the ``openai`` package and a valid ``OPENAI_API_KEY``
    environment variable.

    Args:
        api_key: OpenAI API key.  Falls back to ``OPENAI_API_KEY`` env var.
        generation_model: Model for chat completions (default ``gpt-4o-mini``).
        embedding_model: Model for embeddings (default ``text-embedding-3-small``).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        generation_model: str = "gpt-4o-mini",
        embedding_model: str = "text-embedding-3-small",
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

    def generate(self, prompt: str) -> str:
        try:
            response = self._client.chat.completions.create(
                model=self._generation_model,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as exc:
            raise RuntimeError(f"OpenAI chat completion failed: {exc}") from exc

        choice = response.choices[0]
        if choice.message.content is None:
            raise RuntimeError("OpenAI returned an empty response")
        return choice.message.content

    def generate_stream(self, prompt: str):
        """Yield tokens from OpenAI chat completion using the streaming API."""
        try:
            stream = self._client.chat.completions.create(
                model=self._generation_model,
                messages=[{"role": "user", "content": prompt}],
                stream=True,
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
        # gpt-4o has vision built-in; fall back to it if current model lacks vision
        vision_model = self._generation_model if self._generation_model.startswith("gpt-4") else "gpt-4o"
        try:
            response = self._client.chat.completions.create(
                model=vision_model,
                messages=messages,
                max_tokens=4096,
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
