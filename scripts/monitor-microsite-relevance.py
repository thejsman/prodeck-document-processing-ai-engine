#!/usr/bin/env python3
"""
Dynamic microsite section relevance monitor.
Reads context.json to derive service/client domain signals.
Flags sections where client-domain words dominate with no service-domain words.
"""
import json
import re
import sys
import time
from pathlib import Path

WORKDIR = Path(__file__).parent.parent / "workdir"

def load_context(namespace: str) -> dict:
    ctx_path = WORKDIR / "namespaces" / namespace / "context.json"
    if not ctx_path.exists():
        return {}
    with open(ctx_path, encoding="utf-8") as f:
        return json.load(f)

def derive_domain_words(phrase: str) -> list[str]:
    """Split a phrase into meaningful words (2+ chars, lowercase)."""
    return [w.lower() for w in re.split(r'[\s\-_/,]+', phrase) if len(w) > 2]

def build_signals(context: dict) -> tuple[list[str], list[str]]:
    fields = context.get("requirements", {}).get("fields", {})
    project_type = (fields.get("projectType") or {}).get("value") or "professional services"
    client_name = (fields.get("clientName") or {}).get("value") or ""
    client_industry = (fields.get("clientIndustry") or {}).get("value") or ""

    service_words = derive_domain_words(project_type)
    # Add common synonyms based on detected category
    pt = project_type.lower()
    if re.search(r'marketing|digital|brand|seo|social|content|advertising', pt):
        service_words += ["campaign", "audience", "traffic", "engagement", "conversion", "brand", "reach", "analytics", "ads", "promotion"]
    elif re.search(r'software|development|engineering|platform|app|api', pt):
        service_words += ["deploy", "codebase", "integration", "backend", "frontend", "api", "architecture", "sprint", "release"]
    elif re.search(r'consult|strateg|advisory|research|audit', pt):
        service_words += ["strategy", "roadmap", "assessment", "recommendation", "framework", "analysis", "insight"]

    client_words = derive_domain_words(client_name) + derive_domain_words(client_industry)

    return list(set(service_words)), list(set(client_words))

def check_section(title: str, content: str, service_words: list[str], client_words: list[str]) -> str | None:
    text = (title + " " + content).lower()
    words_in_text = re.findall(r'\b\w+\b', text)

    service_hits = [w for w in service_words if w in words_in_text]
    client_hits = [w for w in client_words if w in words_in_text]

    if client_hits and not service_hits:
        return f"CLIENT-DOMAIN ONLY — client words: {client_hits[:3]}, no service words found"
    return None

def monitor(namespace: str):
    ast_path = WORKDIR / "assets" / "presentations" / namespace / "site-ast.json"
    print(f"[monitor] Watching: {ast_path}", flush=True)
    print(f"[monitor] Context: {WORKDIR / 'namespaces' / namespace / 'context.json'}", flush=True)

    last_mtime = 0.0
    last_section_count = 0

    while True:
        try:
            if not ast_path.exists():
                time.sleep(2)
                continue

            mtime = ast_path.stat().st_mtime
            if mtime == last_mtime:
                time.sleep(2)
                continue

            last_mtime = mtime

            with open(ast_path, encoding="utf-8") as f:
                ast = json.load(f)

            sections = ast.get("sections", [])
            if len(sections) == last_section_count:
                continue
            last_section_count = len(sections)

            # Reload context fresh each cycle (may have been updated)
            ctx = load_context(namespace)
            service_words, client_words = build_signals(ctx)

            fields = ctx.get("requirements", {}).get("fields", {})
            project_type = (fields.get("projectType") or {}).get("value") or "professional services"
            client_name = (fields.get("clientName") or {}).get("value") or "the client"

            print(f"\n[monitor] {len(sections)} sections — projectType={project_type!r}, client={client_name!r}", flush=True)
            print(f"[monitor] Service signals: {service_words[:8]}", flush=True)
            print(f"[monitor] Client signals:  {client_words[:8]}", flush=True)

            flagged = 0
            for s in sections:
                title = s.get("title") or s.get("type") or ""
                raw_content = s.get("content") or ""
                content = json.dumps(raw_content) if isinstance(raw_content, (dict, list)) else str(raw_content)
                issue = check_section(title, content, service_words, client_words)
                if issue:
                    flagged += 1
                    print(f"  [FLAG] {title!r}: {issue}", flush=True)
                else:
                    print(f"  [OK]   {title!r}", flush=True)

            print(f"[monitor] Result: {flagged}/{len(sections)} sections flagged", flush=True)

        except (json.JSONDecodeError, OSError):
            pass
        except KeyboardInterrupt:
            print("[monitor] Stopped.", flush=True)
            break
        time.sleep(2)

if __name__ == "__main__":
    ns = sys.argv[1] if len(sys.argv) > 1 else "lnp"
    monitor(ns)
