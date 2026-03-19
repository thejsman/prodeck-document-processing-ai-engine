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


def main() -> None:
    try:
        input_data = json.load(sys.stdin)
        raw_prompt = input_data.get("prompt", "").strip()

        if not raw_prompt:
            raise ValueError("prompt is required")

        prompt, image_data = extract_image_from_prompt(raw_prompt)
        provider = create_provider()

        if image_data and hasattr(provider, "generate_with_image"):
            result = provider.generate_with_image(prompt, image_data)
        else:
            result = provider.generate(prompt)

        json.dump({"result": result.strip()}, sys.stdout)
        sys.stdout.flush()

    except Exception as exc:
        json.dump({"error": str(exc), "type": type(exc).__name__}, sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
