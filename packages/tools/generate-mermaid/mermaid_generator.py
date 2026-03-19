#!/usr/bin/env python3
"""Mermaid diagram generator — calls the LLM to produce Mermaid markup.

Reads a JSON command from stdin, delegates to the shared LLM provider,
and writes the result to stdout.

Input (stdin JSON):
  { "description": string }

Output (stdout JSON):
  { "result": "<mermaid diagram string>" }

Error (stderr JSON + exit 1):
  { "error": "...", "type": "..." }
"""

import sys
import json
import os

_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_here, "..", "..", "..", "plugins", "shared"))

from providers import create_provider  # noqa: E402

_SYSTEM = """\
You are a diagram generator. Given a description, produce a valid Mermaid diagram.

Rules:
- Return ONLY the Mermaid diagram code
- Do not include markdown code fences
- Do not include explanations or commentary
- Use graph TD (top-down) unless the description specifies otherwise
- Keep diagrams clear and readable
"""


def main() -> None:
    try:
        input_data = json.load(sys.stdin)
        description = input_data.get("description", "").strip()

        if not description:
            raise ValueError("description is required")

        provider = create_provider()

        full_prompt = (
            f"{_SYSTEM}\n\n"
            f"DESCRIPTION:\n{description}\n\n"
            f"Generate the Mermaid diagram:"
        )

        result = provider.generate(full_prompt)

        # Strip markdown fences if the LLM adds them
        cleaned = result.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            # Remove first line (```mermaid) and last line (```)
            if lines[-1].strip() == "```":
                lines = lines[1:-1]
            else:
                lines = lines[1:]
            cleaned = "\n".join(lines).strip()

        json.dump({"result": cleaned}, sys.stdout)
        sys.stdout.flush()

    except Exception as exc:
        json.dump({"error": str(exc), "type": type(exc).__name__}, sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
