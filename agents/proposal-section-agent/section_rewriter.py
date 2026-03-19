#!/usr/bin/env python3
"""Section rewriter — regenerates a single section of a proposal document.

Reads a JSON command from stdin, calls the shared LLM provider,
and writes the result to stdout.

Input (stdin JSON):
  {
    "proposalMarkdown": string,   # full proposal for context
    "sectionName":      string,   # ## heading of the section to rewrite
    "instruction":      string,   # rewriting instruction
    "existingSection":  string    # pre-extracted section text (optional, from extract-section tool)
  }

Output (stdout JSON):
  { "result": "<markdown string>" }

Error (stderr JSON + exit 1):
  { "error": "...", "type": "..." }
"""

import sys
import json
import os

# Resolve path to the shared provider library.
_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_here, "..", "..", "plugins", "shared"))

from providers import create_provider  # noqa: E402

_SYSTEM = """\
You are rewriting a section of a business proposal.

Rules:
- Rewrite ONLY the requested section
- Start your response with the section heading: ## {section_name}
- Follow the rewriting instruction precisely
- Preserve the professional tone of the original proposal
- Do not include any other sections, preamble, or commentary
- Return markdown only
"""


def main() -> None:
    try:
        input_data = json.load(sys.stdin)

        section_name = input_data.get("sectionName", "").strip()
        instruction = input_data.get("instruction", "").strip()
        proposal_markdown = input_data.get("proposalMarkdown", "").strip()
        existing_section = input_data.get("existingSection", "").strip()

        if not section_name:
            raise ValueError("sectionName is required")

        if not instruction:
            instruction = "Rewrite this section to be clear, concise, and professional."

        provider = create_provider()

        system_prompt = _SYSTEM.format(section_name=section_name)

        # If the extract-section tool already isolated the section, include it
        # directly so the LLM has clear context of what to rewrite.
        section_context = ""
        if existing_section:
            section_context = f"CURRENT SECTION CONTENT:\n{existing_section}\n\n"

        full_prompt = (
            f"{system_prompt}\n\n"
            f"SECTION TO REWRITE: {section_name}\n\n"
            f"INSTRUCTION: {instruction}\n\n"
            f"{section_context}"
            f"FULL PROPOSAL (for context):\n{proposal_markdown}\n\n"
            f"Rewrite the '{section_name}' section only. "
            f"Start with '## {section_name}' and return markdown."
        )

        result = provider.generate(full_prompt)
        json.dump({"result": result}, sys.stdout)
        sys.stdout.flush()

    except Exception as exc:
        json.dump({"error": str(exc), "type": type(exc).__name__}, sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
