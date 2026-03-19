"""Provider abstraction layer for LLM operations.

Exposes a single factory function that returns the correct LLMProvider
based on the LLM_PROVIDER environment variable (default: "ollama").
"""

from .base_provider import LLMProvider
from .factory import create_provider

__all__ = ["LLMProvider", "create_provider"]
