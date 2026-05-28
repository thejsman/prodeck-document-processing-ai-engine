#!/usr/bin/env python3
"""Proposal generation processor v2.

Reads source documents from a working directory, loads a YAML template
to determine which sections to generate, optionally retrieves relevant
context from a FAISS namespace index, generates structured proposal
sections independently via the provider abstraction (with per-section
retry), supports deterministic pricing computation, and writes
versioned Markdown output atomically.

Input (JSON on stdin):
    {
        "workdir": "/path/to/docs",
        "outputDir": "/path/to/output",
        "client": "Acme Corp",
        "industry": "Financial Services",
        "namespace": "acme",            (optional — null to skip RAG)
        "template": "default",          (optional — template name)
        "templateDir": "/path/to/tpl",  (optional — custom template dir)
        "overwrite": false,             (optional — skip versioning)
        "pricing": {                    (optional — deterministic pricing)
            "teamSize": 5,
            "durationWeeks": 12,
            "ratePerWeek": 2500
        }
    }

Output (JSON on stdout):
    {
        "document": {
            "type": "proposal",
            "source": "proposal-generator",
            "content": "<markdown>",
            "metadata": { ... },
            "createdAt": "..."
        }
    }
"""

import sys
import json
import os
import re
import tempfile
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import yaml

# ---------------------------------------------------------------------------
# Provider and vector store imports
# ---------------------------------------------------------------------------

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))

from providers import create_provider

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

INGESTABLE_EXTENSIONS = frozenset(
    [".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log", ".yaml", ".yml"]
)

CHUNK_SIZE = 500
TOP_K = 5
MAX_SECTION_RETRIES = 1
PRICING_SECTION_TITLE = "Pricing & Commercials"

# ---------------------------------------------------------------------------
# Template loading
# ---------------------------------------------------------------------------


def default_template_dir():
    """Return the built-in templates directory next to this script."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")


def load_template(template_name, template_dir=None):
    """Load a YAML template by name.

    Args:
        template_name: Name of the template (without .yaml extension).
        template_dir: Directory to search in.  Defaults to the built-in
                      templates directory next to this script.

    Returns:
        Dict with keys: name, version, description, sections.

    Raises:
        FileNotFoundError: If the template file does not exist.
        ValueError: If the template is structurally invalid.
    """
    if template_dir is None:
        template_dir = default_template_dir()

    template_path = os.path.join(template_dir, f"{template_name}.yaml")

    if not os.path.isfile(template_path):
        available = [
            os.path.splitext(f)[0]
            for f in sorted(os.listdir(template_dir))
            if f.endswith(".yaml")
        ] if os.path.isdir(template_dir) else []
        raise FileNotFoundError(
            f"Template '{template_name}' not found at {template_path}. "
            f"Available templates: {', '.join(available) or '(none)'}"
        )

    with open(template_path, "r", encoding="utf-8") as f:
        tpl = yaml.safe_load(f)

    if not isinstance(tpl, dict):
        raise ValueError(f"Template '{template_name}' must be a YAML mapping")

    if "sections" not in tpl or not isinstance(tpl["sections"], list):
        raise ValueError(f"Template '{template_name}' must contain a 'sections' list")

    for idx, section in enumerate(tpl["sections"]):
        if not isinstance(section, dict):
            raise ValueError(f"Template section [{idx}] must be a mapping")
        for key in ("title", "query", "instruction"):
            if key not in section or not isinstance(section[key], str):
                raise ValueError(
                    f"Template section [{idx}] missing required string field: '{key}'"
                )

    return tpl


# ---------------------------------------------------------------------------
# Output versioning
# ---------------------------------------------------------------------------


def detect_next_version(output_dir, base_name):
    """Find the highest existing vN for base_name in output_dir.

    Scans for files matching ``<base_name>_v<N>.md`` and returns N+1.
    Returns 1 if no versioned files exist yet.
    """
    if not os.path.isdir(output_dir):
        return 1

    pattern = re.compile(
        r"^" + re.escape(base_name) + r"_v(\d+)\.md$"
    )
    max_version = 0
    for entry in sorted(os.listdir(output_dir)):
        match = pattern.match(entry)
        if match:
            v = int(match.group(1))
            if v > max_version:
                max_version = v

    return max_version + 1


def resolve_output_path(output_dir, client, overwrite):
    """Determine the versioned (or overwrite) output file path.

    Returns:
        Tuple of (output_path: str, version: int | None).
        version is None when overwrite is True.
    """
    base_name = safe_filename(client) + "_proposal"

    if overwrite:
        return os.path.join(output_dir, f"{base_name}.md"), None

    version = detect_next_version(output_dir, base_name)
    filename = f"{base_name}_v{version}.md"
    return os.path.join(output_dir, filename), version


# ---------------------------------------------------------------------------
# Deterministic pricing
# ---------------------------------------------------------------------------


def compute_pricing_section(team_size, duration_weeks, rate_per_week, client, industry):
    """Build a deterministic Pricing & Commercials section.

    All arithmetic is integer/float — no LLM involved.

    Returns:
        Markdown string for the pricing section.
    """
    weekly_cost = team_size * rate_per_week
    total_cost = weekly_cost * duration_weeks

    lines = [
        f"## {PRICING_SECTION_TITLE}",
        "",
        f"The pricing for this engagement with {client} is structured as follows:",
        "",
        "| Item | Value |",
        "|---|---|",
        f"| Team Size | {team_size} |",
        f"| Duration | {duration_weeks} weeks |",
        f"| Rate per Person per Week | ${rate_per_week:,.2f} |",
        f"| Weekly Cost | ${weekly_cost:,.2f} |",
        f"| **Total Estimated Cost** | **${total_cost:,.2f}** |",
        "",
        "**Payment Terms:** Net-30 from invoice date, billed monthly in arrears.",
        "",
        "**Assumptions:**",
        "",
        "- Rates are based on standard business hours.",
        "- Travel and expenses, if applicable, are billed separately at cost.",
        "- Pricing is valid for 30 days from the date of this proposal.",
    ]

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def safe_filename(client):
    """Convert a client name into a filesystem-safe filename."""
    name = re.sub(r"[^\w\s-]", "", client.strip())
    name = re.sub(r"[\s]+", "_", name)
    return name[:100] or "proposal"


def collect_documents(workdir):
    """Recursively collect ingestable text files from workdir.

    Returns a list of dicts: [{"fileName": "...", "content": "..."}]
    Sorted by fileName for deterministic ordering.
    """
    if not os.path.isdir(workdir):
        raise FileNotFoundError(f"Working directory does not exist: {workdir}")

    results = []

    for root, dirs, files in os.walk(workdir):
        dirs.sort()
        files.sort()
        # Skip hidden directories.
        dirs[:] = [d for d in dirs if not d.startswith(".")]

        for fname in files:
            if fname.startswith("."):
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext not in INGESTABLE_EXTENSIONS:
                continue
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, workdir)
            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except (UnicodeDecodeError, PermissionError):
                continue
            if content.strip():
                results.append({"fileName": rel_path, "content": content})

    results.sort(key=lambda d: d["fileName"])
    return results


def build_raw_context(documents, max_chars=8000):
    """Build a context block from raw document content, truncated to max_chars."""
    parts = []
    total = 0
    for doc in documents:
        remaining = max_chars - total
        if remaining <= 0:
            break
        snippet = doc["content"][:remaining]
        parts.append(f"--- {doc['fileName']} ---\n{snippet}")
        total += len(snippet)
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Section generation (with retry)
# ---------------------------------------------------------------------------


def build_memory_context(memory):
    """Build additional prompt context from structured memory.

    Args:
        memory: Dict with optional keys: clientProfile, pastLessons,
                avoidPhrases, preferredTone.

    Returns:
        A string block to append to section prompts, or empty string.
    """
    if not memory:
        return ""

    parts = []

    client_profile = memory.get("clientProfile")
    if client_profile:
        if isinstance(client_profile, dict):
            profile_text = json.dumps(client_profile, indent=2)
        else:
            profile_text = str(client_profile)
        parts.append(f"Client profile:\n{profile_text}")

    past_lessons = memory.get("pastLessons")
    if past_lessons and isinstance(past_lessons, list):
        lessons_text = "\n".join(f"- {lesson}" for lesson in past_lessons)
        parts.append(f"Lessons from past engagements:\n{lessons_text}")

    return "\n\n".join(parts)


def build_avoid_instruction(memory):
    """Build an instruction to avoid specific phrases from memory.

    Args:
        memory: Dict with optional avoidPhrases key.

    Returns:
        Instruction string, or empty string if no phrases to avoid.
    """
    if not memory:
        return ""

    avoid_phrases = memory.get("avoidPhrases")
    if not avoid_phrases or not isinstance(avoid_phrases, list):
        return ""

    quoted = ", ".join(f'"{phrase}"' for phrase in avoid_phrases)
    return f"\n\nIMPORTANT: Do NOT use any of the following phrases: {quoted}."


def generate_section(section_def, client, industry, context_text, provider, tone=None, memory=None):
    """Generate a single proposal section using the provider.

    Retries once on failure (max 1 retry).

    Args:
        section_def: Dict with title, query, instruction.
        client: Client name.
        industry: Industry name.
        context_text: Relevant context for the section.
        provider: LLMProvider instance.
        tone: Optional tone directive (e.g. "formal", "approachable").
        memory: Optional dict with clientProfile, pastLessons, avoidPhrases.

    Returns:
        Markdown string for the section.

    Raises:
        RuntimeError: If both attempts fail.
    """
    instruction = section_def["instruction"].format(client=client, industry=industry)

    # Tone directive
    tone_line = f"\n\nUse a {tone} tone throughout this section." if tone else ""

    # Avoid-phrases directive from memory
    avoid_line = build_avoid_instruction(memory)

    # Memory context (client profile, past lessons)
    memory_block = build_memory_context(memory)
    memory_section = f"\n\nAdditional context from memory:\n{memory_block}" if memory_block else ""

    if not context_text or not context_text.strip():
        return (
            f"## {section_def['title']}\n\n"
            "*[No source data was available to generate this section. "
            "Please upload the relevant documents and regenerate.]*"
        )

    prompt = (
        f"{instruction}"
        f"{tone_line}"
        f"{avoid_line}\n\n"
        "IMPORTANT: Base your response EXCLUSIVELY on the source material below. "
        "Do NOT use general knowledge, industry assumptions, or any information "
        "not explicitly present in the source material. "
        "If the source material does not contain enough information for part of "
        "this section, write '[Information not available in provided documents]' "
        "rather than assuming.\n\n"
        f"Source material:\n{context_text}"
        f"{memory_section}"
    )

    last_error = None
    for attempt in range(1 + MAX_SECTION_RETRIES):
        try:
            body = provider.generate(prompt)
            if not body or not body.strip():
                body = (
                    "*[No source data was available to generate this section. "
                    "Please provide the missing details and regenerate.]*"
                )
            # Demote any ## headings in the body to ### so they nest under
            # the ## section heading that generate_section prepends.
            body = re.sub(r'^## ', '### ', body, flags=re.MULTILINE)
            return f"## {section_def['title']}\n\n{body}"
        except Exception as exc:
            last_error = exc

    raise RuntimeError(
        f"Failed to generate section '{section_def['title']}' "
        f"after {1 + MAX_SECTION_RETRIES} attempt(s): {last_error}"
    )


# ---------------------------------------------------------------------------
# Atomic file write
# ---------------------------------------------------------------------------


def atomic_write(output_path, content):
    """Write content to output_path atomically via temp file + rename."""
    output_dir = os.path.dirname(output_path)
    os.makedirs(output_dir, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=output_dir, suffix=".md.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        shutil.move(tmp_path, output_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Main processor
# ---------------------------------------------------------------------------


def generate_proposal(
    workdir,
    output_dir,
    client,
    industry,
    namespace,
    provider,
    template_name="default",
    template_dir=None,
    overwrite=False,
    pricing=None,
    tone=None,
    memory=None,
    retrieved_context=None,
):
    """Generate a full proposal document.

    Args:
        workdir: Directory containing source documents.
        output_dir: Directory for the output Markdown file.
        client: Client name.
        industry: Industry name.
        namespace: FAISS namespace (or None to skip RAG).
        provider: LLMProvider instance.
        template_name: Name of the YAML template to load.
        template_dir: Custom template directory (or None for built-in).
        overwrite: If True, write without version suffix.
        pricing: Optional dict with teamSize, durationWeeks, ratePerWeek.
        tone: Optional tone directive for section generation.
        memory: Optional dict with clientProfile, pastLessons, avoidPhrases.

    Returns:
        Tuple of (markdown_content: str, output_path: str, metadata: dict).
    """
    # ── Load template ─────────────────────────────────────────
    template = load_template(template_name, template_dir)
    sections = template["sections"]

    # ── Collect source documents ──────────────────────────────
    # Scope to the namespace directory so documents from other namespaces
    # cannot bleed into this proposal via the raw_context fallback.
    ns_dir = os.path.join(workdir, "namespaces", namespace) if namespace else workdir
    documents = collect_documents(ns_dir)
    if not documents:
        raise ValueError(f"No ingestable documents found in: {ns_dir}")

    # ── Prepare retrieval context ─────────────────────────────
    use_rag = False
    rag_context = None

    if retrieved_context and isinstance(retrieved_context, list):
        valid_chunks = [
            c["text"] for c in retrieved_context
            if isinstance(c, dict) and c.get("text", "").strip()
        ]
        if valid_chunks:
            rag_context = "\n\n".join(valid_chunks)
            use_rag = True

    # Fallback: raw document context (truncated).
    raw_context = build_raw_context(documents)

    # ── Determine if pricing is deterministic ─────────────────
    has_deterministic_pricing = (
        pricing is not None
        and pricing.get("teamSize") is not None
        and pricing.get("durationWeeks") is not None
        and pricing.get("ratePerWeek") is not None
    )

    # ── Generate sections (parallel LLM calls, deterministic order preserved) ─
    section_texts = [None] * len(sections)
    retried_sections = []
    context_text = rag_context if use_rag else raw_context

    def _generate_one(idx, section_def):
        if has_deterministic_pricing and section_def["title"] == PRICING_SECTION_TITLE:
            return idx, compute_pricing_section(
                team_size=int(pricing["teamSize"]),
                duration_weeks=int(pricing["durationWeeks"]),
                rate_per_week=float(pricing["ratePerWeek"]),
                client=client,
                industry=industry,
            )
        try:
            md = generate_section(
                section_def, client, industry, context_text, provider,
                tone=tone, memory=memory,
            )
            return idx, md
        except RuntimeError:
            md = (
                f"## {section_def['title']}\n\n"
                f"*[Generation failed after {1 + MAX_SECTION_RETRIES} attempt(s). "
                f"Please complete this section manually.]*"
            )
            return idx, md, section_def["title"]

    with ThreadPoolExecutor(max_workers=len(sections)) as executor:
        futures = {
            executor.submit(_generate_one, idx, section_def): idx
            for idx, section_def in enumerate(sections)
        }
        for future in as_completed(futures):
            result = future.result()
            if len(result) == 3:
                idx, md, failed_title = result
                retried_sections.append(failed_title)
            else:
                idx, md = result
            section_texts[idx] = md

    # ── Resolve output path with versioning ───────────────────
    output_path, version = resolve_output_path(output_dir, client, overwrite)

    # ── Assemble Markdown ─────────────────────────────────────
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    version_line = f"**Version:** v{version}  \n" if version is not None else ""

    header = (
        f"# Proposal for {client}\n\n"
        f"**Industry:** {industry}  \n"
        f"**Date:** {timestamp}  \n"
        f"{version_line}"
        f"**Template:** {template.get('name', template_name)}  \n"
        f"**Generated by:** AI Engine — Proposal Generator v2\n\n"
        f"---\n"
    )

    markdown = header + "\n\n".join(section_texts) + "\n"

    # ── Atomic write ──────────────────────────────────────────
    atomic_write(output_path, markdown)

    # ── Metadata ──────────────────────────────────────────────
    source_files = [d["fileName"] for d in documents]
    metadata = {
        "client": client,
        "industry": industry,
        "template": template.get("name", template_name),
        "template_version": template.get("version", "unknown"),
        "version": version,
        "overwrite": overwrite,
        "sections": len(sections),
        "retried_sections": retried_sections,
        "source_documents": len(documents),
        "source_files": source_files,
        "retrieval_mode": "rag" if use_rag else "raw",
        "pricing_mode": "deterministic" if has_deterministic_pricing else "llm",
        "output_path": output_path,
        "tone": tone,
        "has_memory": memory is not None,
        "processor": "proposal-generator",
        "processor_version": "2.1",
    }

    return markdown, output_path, metadata


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    try:
        input_data = json.load(sys.stdin)

        workdir = input_data.get("workdir")
        if not workdir:
            raise ValueError("Missing required field: workdir")

        output_dir = input_data.get("outputDir", os.path.join(workdir, "output"))
        client = input_data.get("client", "Client")
        industry = input_data.get("industry", "General")
        namespace = input_data.get("namespace")
        template_name = input_data.get("template", "default")
        template_dir = input_data.get("templateDir")
        overwrite = input_data.get("overwrite", False)
        pricing = input_data.get("pricing")
        tone = input_data.get("tone")
        memory = input_data.get("memory")
        retrieved_context = input_data.get("retrievedContext")

        if not os.path.isdir(workdir):
            raise FileNotFoundError(f"Working directory does not exist: {workdir}")

        provider = create_provider()

        markdown, output_path, metadata = generate_proposal(
            workdir=workdir,
            output_dir=output_dir,
            client=client,
            industry=industry,
            namespace=namespace,
            provider=provider,
            template_name=template_name,
            template_dir=template_dir,
            overwrite=overwrite,
            pricing=pricing,
            tone=tone,
            memory=memory,
            retrieved_context=retrieved_context,
        )

        document = {
            "type": "proposal",
            "source": "proposal-generator",
            "content": markdown,
            "metadata": metadata,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

        json.dump({"document": document}, sys.stdout)
        sys.stdout.flush()

    except Exception as exc:
        json.dump(
            {"error": str(exc), "type": type(exc).__name__},
            sys.stderr,
        )
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
