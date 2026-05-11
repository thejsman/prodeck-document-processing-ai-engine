"""NVIDIA NIM LLM provider — OpenAI-compatible API via integrate.api.nvidia.com."""

import os
from typing import Optional

from .base_provider import LLMProvider

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

# NIM models that support vision (image_url content) via OpenAI-compatible API
NVIDIA_VISION_MODELS = {
    "microsoft/phi-3.5-vision-instruct",
    "nvidia/neva-22b",
    "meta/llama-3.2-11b-vision-instruct",
    "meta/llama-3.2-90b-vision-instruct",
}


class NvidiaProvider(LLMProvider):
    """LLMProvider backed by NVIDIA NIM (OpenAI-compatible).

    Requires the ``openai`` package and a valid ``NVIDIA_API_KEY``
    environment variable.

    Args:
        api_key: NVIDIA NIM API key.  Falls back to ``NVIDIA_API_KEY`` env var.
        generation_model: Model for chat completions.
        embedding_model: Model for embeddings.
        temperature: Default temperature for generation calls.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        generation_model: str = "moonshotai/kimi-k2.6",
        embedding_model: str = "nvidia/nv-embedqa-e5-v5",
        temperature: float = 0,
    ):
        resolved_key = api_key or os.environ.get("NVIDIA_API_KEY")
        if not resolved_key:
            raise RuntimeError(
                "NVIDIA NIM provider requires an API key. "
                "Set the NVIDIA_API_KEY environment variable or pass api_key explicitly."
            )

        try:
            import openai  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(
                "The 'openai' package is required for the NVIDIA NIM provider. "
                "Install it with: pip install openai"
            ) from exc

        import openai as _openai

        self._client = _openai.OpenAI(
            api_key=resolved_key,
            base_url=NVIDIA_BASE_URL,
        )
        self._generation_model = generation_model
        self._embedding_model = embedding_model
        self._default_temperature = temperature

    def generate(self, prompt: str, temperature: Optional[float] = None) -> str:
        temp = temperature if temperature is not None else self._default_temperature
        try:
            response = self._client.chat.completions.create(
                model=self._generation_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=8000,
                temperature=temp,
                timeout=60,
            )
        except Exception as exc:
            raise RuntimeError(f"NVIDIA NIM chat completion failed: {exc}") from exc

        choice = response.choices[0]
        if choice.message.content is None:
            raise RuntimeError("NVIDIA NIM returned an empty response")
        return choice.message.content

    def generate_stream(self, prompt: str, temperature: Optional[float] = None):
        """Yield tokens from NVIDIA NIM using the streaming API."""
        temp = temperature if temperature is not None else self._default_temperature
        try:
            stream = self._client.chat.completions.create(
                model=self._generation_model,
                messages=[{"role": "user", "content": prompt}],
                stream=True,
                temperature=temp,
            )
        except Exception as exc:
            raise RuntimeError(f"NVIDIA NIM streaming completion failed: {exc}") from exc

        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    def generate_with_image(self, prompt: str, image_data: str) -> str:
        """Send a prompt + image to a vision-capable NVIDIA NIM model.

        Falls back to text-only generation when the configured model is not
        vision-capable.
        """
        vision_model = (
            self._generation_model
            if self._generation_model in NVIDIA_VISION_MODELS
            else "microsoft/phi-3.5-vision-instruct"
        )
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_data}},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        try:
            response = self._client.chat.completions.create(
                model=vision_model,
                messages=messages,
                max_tokens=8000,
                temperature=self._default_temperature,
                timeout=60,
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
                input=[text],
                encoding_format="float",
                extra_body={"input_type": "query", "truncate": "NONE"},
            )
        except Exception as exc:
            raise RuntimeError(f"NVIDIA NIM embedding request failed: {exc}") from exc

        return response.data[0].embedding
