#!/usr/bin/env python3
"""Generic LLM bridge — sends a prompt to the configured LLM provider.

Reads a JSON command from stdin, delegates to the shared LLM provider,
and writes the result to stdout.

Input (stdin JSON):
  { "prompt": string }

Output (stdout JSON):
  { "result": "<LLM response text>" }

Error (stderr JSON + exit 1):
  { "error": "...", "type": "..." }
"""

import sys
import json
import os

_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_here, "..", "..", "plugins", "shared"))

from providers import create_provider  # noqa: E402


def extract_image_from_prompt(prompt: str):
    """Returns (clean_prompt, image_data_or_none)."""
    if prompt.startswith("DESIGN_IMAGE:"):
        newline_pos = prompt.find("\n\n")
        if newline_pos != -1:
            image_data = prompt[len("DESIGN_IMAGE:"):newline_pos].strip()
            clean_prompt = prompt[newline_pos + 2:].strip()
            return clean_prompt, image_data
    return prompt, None


def strip_surrogates(text: str) -> str:
    """Remove lone Unicode surrogates (U+D800–U+DFFF) that cannot be UTF-8 encoded.

    Lone surrogates appear when the source document contains invalid UTF-8 bytes
    decoded by Node.js as surrogate pairs.  Python's UTF-8 encoder (used by the
    OpenAI SDK's httpx HTTP client) rejects them, causing every LLM call to fail.
    """
    return ''.join(c for c in text if not ('\ud800' <= c <= '\udfff'))


def main() -> None:
    try:
        # Read stdin as binary and decode explicitly as UTF-8 (replacing bad bytes)
        # so Windows cp1252 default encoding never causes a read-time failure.
        raw_bytes = sys.stdin.buffer.read()
        input_data = json.loads(raw_bytes.decode('utf-8', errors='replace'))
        raw_prompt = strip_surrogates(input_data.get("prompt", "").strip())

        if not raw_prompt:
            raise ValueError("prompt is required")

        temperature = input_data.get("temperature")
        if temperature is not None:
            temperature = float(temperature)

        prompt, image_data = extract_image_from_prompt(raw_prompt)
        provider = create_provider()

        if image_data and hasattr(provider, "generate_with_image"):
            result = provider.generate_with_image(prompt, image_data)
        elif hasattr(provider, "generate_stream"):
            # Streaming avoids the non-streaming SDK read-timeout on large
            # completions, so callers can safely raise MAX_OUTPUT_TOKENS.
            result = "".join(provider.generate_stream(prompt, temperature=temperature))
        else:
            result = provider.generate(prompt, temperature=temperature)

        json.dump({"result": result.strip()}, sys.stdout)
        sys.stdout.flush()

    except Exception as exc:
        json.dump({"error": str(exc), "type": type(exc).__name__}, sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
