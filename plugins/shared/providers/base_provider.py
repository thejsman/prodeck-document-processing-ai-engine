"""Abstract base class for LLM providers."""

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Interface that every LLM provider must implement.

    Provides two capabilities:
        generate  – produce text from a prompt
        embed     – produce an embedding vector from text
    """

    @abstractmethod
    def generate(self, prompt: str) -> str:
        """Generate text given a prompt.

        Args:
            prompt: The input prompt string.

        Returns:
            The generated text response.

        Raises:
            ConnectionError: If the provider endpoint is unreachable.
            RuntimeError: If the provider returns an error response.
        """

    def generate_with_image(self, prompt: str, image_data: str) -> str:
        """Generate text given a prompt and an image (base64 data URL or http URL).

        Default implementation ignores the image and falls back to text-only generation.
        Override in providers that support vision (e.g. gpt-4o).

        Args:
            prompt: The input prompt string.
            image_data: Base64 data URL (data:image/...;base64,...) or HTTP image URL.

        Returns:
            The generated text response.
        """
        return self.generate(prompt)

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        """Produce an embedding vector for the given text.

        Args:
            text: The input text to embed.

        Returns:
            A list of floats representing the embedding vector.

        Raises:
            ConnectionError: If the provider endpoint is unreachable.
            RuntimeError: If the provider returns an error response.
        """
