"""Ollama LLM provider — calls a local Ollama instance over HTTP."""

import requests

from .base_provider import LLMProvider


class OllamaProvider(LLMProvider):
    """LLMProvider backed by a local Ollama server.

    Args:
        base_url: Ollama HTTP endpoint (default ``http://localhost:11434``).
        generation_model: Model name for text generation (default ``mistral``).
        embedding_model: Model name for embeddings (default ``nomic-embed-text``).
    """

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        generation_model: str = "mistral",
        embedding_model: str = "nomic-embed-text",
    ):
        self._base_url = base_url.rstrip("/")
        self._generation_model = generation_model
        self._embedding_model = embedding_model

    def generate(self, prompt: str) -> str:
        url = f"{self._base_url}/api/generate"
        payload = {
            "model": self._generation_model,
            "prompt": prompt,
            "stream": False,
        }
        try:
            resp = requests.post(url, json=payload, timeout=120)
            resp.raise_for_status()
        except requests.ConnectionError as exc:
            raise ConnectionError(
                f"Cannot reach Ollama at {url}. Is it running?"
            ) from exc
        except requests.HTTPError as exc:
            raise RuntimeError(
                f"Ollama /api/generate returned HTTP {resp.status_code}: {resp.text}"
            ) from exc

        data = resp.json()
        if "response" not in data:
            raise RuntimeError("Ollama generate response missing 'response' field")
        return data["response"]

    def generate_stream(self, prompt: str):
        """Yield tokens from Ollama generation using HTTP streaming (NDJSON)."""
        import json as _json
        url = f"{self._base_url}/api/generate"
        payload = {"model": self._generation_model, "prompt": prompt, "stream": True}
        try:
            resp = requests.post(url, json=payload, stream=True, timeout=120)
            resp.raise_for_status()
        except requests.ConnectionError as exc:
            raise ConnectionError(
                f"Cannot reach Ollama at {url}. Is it running?"
            ) from exc
        except requests.HTTPError as exc:
            raise RuntimeError(
                f"Ollama /api/generate returned HTTP {resp.status_code}: {resp.text}"
            ) from exc

        for line in resp.iter_lines():
            if not line:
                continue
            try:
                chunk = _json.loads(line)
            except _json.JSONDecodeError:
                continue
            token = chunk.get("response", "")
            if token:
                yield token

    def embed(self, text: str) -> list[float]:
        url = f"{self._base_url}/api/embeddings"
        payload = {"model": self._embedding_model, "prompt": text}
        try:
            resp = requests.post(url, json=payload, timeout=30)
            resp.raise_for_status()
        except requests.ConnectionError as exc:
            raise ConnectionError(
                f"Cannot reach Ollama at {url}. Is it running?"
            ) from exc
        except requests.HTTPError as exc:
            raise RuntimeError(
                f"Ollama /api/embeddings returned HTTP {resp.status_code}: {resp.text}"
            ) from exc

        data = resp.json()
        if "embedding" not in data:
            raise RuntimeError("Ollama embeddings response missing 'embedding' field")
        return data["embedding"]
