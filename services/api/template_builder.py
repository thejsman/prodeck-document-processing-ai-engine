#!/usr/bin/env python3
"""Template AI builder — generates and modifies YAML proposal templates.

Reads a JSON command from stdin, delegates to the shared LLM provider,
and writes the result JSON to stdout.

Input:
  {
    "operation": "generate" | "modify",
    "prompt": string,           # used for "generate"
    "templateYaml": string,     # used for "modify"
    "instruction": string       # used for "modify"
  }

Output (stdout):
  { "result": "<yaml string>" }

Error (stderr + exit 1):
  { "error": "...", "type": "..." }
"""

import sys
import json
import os

# Resolve path to the shared provider library relative to this file.
_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_here, "..", "..", "plugins", "shared"))

from providers import create_provider  # noqa: E402

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_GENERATE_SYSTEM = """You generate proposal templates in YAML format.

Output must follow this structure exactly:

name: string
version: string
sections:
  - title: string
    query: string
    instruction: string

Rules:
- Generate 5-10 sections
- Sections must represent a typical enterprise proposal
- Output valid YAML only
- Do not include explanations or markdown fences
"""

_MODIFY_SYSTEM = """You modify an existing YAML proposal template.

You must return the full updated YAML.

Rules:
- Preserve existing structure
- Follow schema:

name: string
version: string
sections:
  - title: string
    query: string
    instruction: string

Return YAML only. Do not include markdown fences or explanations.
"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    try:
        input_data = json.load(sys.stdin)
        operation = input_data.get("operation")

        provider = create_provider()

        if operation == "generate":
            prompt = input_data.get("prompt", "").strip()
            if not prompt:
                raise ValueError("No prompt provided for generate")

            full_prompt = f"{_GENERATE_SYSTEM}\nUser request: {prompt}"
            result = provider.generate(full_prompt)
            json.dump({"result": result}, sys.stdout)
            sys.stdout.flush()

        elif operation == "modify":
            template_yaml = input_data.get("templateYaml", "").strip()
            instruction = input_data.get("instruction", "").strip()
            if not template_yaml:
                raise ValueError("templateYaml is required for modify")
            if not instruction:
                raise ValueError("instruction is required for modify")

            full_prompt = (
                f"{_MODIFY_SYSTEM}\n"
                f"Existing template:\n{template_yaml}\n\n"
                f"Instruction: {instruction}"
            )
            result = provider.generate(full_prompt)
            json.dump({"result": result}, sys.stdout)
            sys.stdout.flush()

        else:
            raise ValueError(f"Unknown operation: {operation!r}")

    except Exception as exc:
        json.dump({"error": str(exc), "type": type(exc).__name__}, sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
