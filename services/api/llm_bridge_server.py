#!/usr/bin/env python3
"""Persistent LLM bridge server.

Reads newline-delimited JSON requests from stdin, generates LLM responses,
and writes newline-delimited JSON responses to stdout.  Stays alive between
requests so Python startup and provider import cost is paid once per worker
rather than once per LLM call.

Activated by setting LLM_BRIDGE_PERSISTENT=true in the environment.
Pool size is controlled by LLM_BRIDGE_POOL_SIZE (default 2).

Input  (one JSON object per line on stdin):
  { "id": "uuid", "prompt": "..." }

Output (one JSON object per line on stdout):
  { "id": "uuid", "result": "..." }
  { "id": "uuid", "error": "...", "type": "..." }
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
    """Remove lone Unicode surrogates that Python's UTF-8 encoder rejects."""
    return ''.join(c for c in text if not ('\ud800' <= c <= '\udfff'))


def main() -> None:
    # Create the provider once — env vars are fixed at spawn time.
    provider = create_provider()

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        request_id = ""
        try:
            request = json.loads(raw_line.encode('utf-8', errors='replace').decode('utf-8'))
            request_id = request.get("id", "")
            raw_prompt = strip_surrogates(request.get("prompt", "").strip())

            if not raw_prompt:
                raise ValueError("prompt is required")

            prompt, image_data = extract_image_from_prompt(raw_prompt)

            if image_data and hasattr(provider, "generate_with_image"):
                result = provider.generate_with_image(prompt, image_data)
            else:
                result = provider.generate(prompt)

            response = {"id": request_id, "result": result.strip()}

        except Exception as exc:
            response = {"id": request_id, "error": str(exc), "type": type(exc).__name__}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
