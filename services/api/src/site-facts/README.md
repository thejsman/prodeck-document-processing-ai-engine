# site-facts

Turns a website URL into an atomic, sourced **fact base** — not a narrative
summary. Every fact is one small, independently verifiable claim tied to
exactly where on the site it came from, so a downstream LLM can ground on it
without paraphrasing across pages. If you want prose one day, generate it
*from* this fact base — this pipeline's only job is producing the fact base
itself.

## Why not a summary?

A prose summary blends and paraphrases; a downstream LLM grounding on it
will eventually hallucinate around vague sentences. Many small, atomic
statements — each traceable to a `verbatim_support` quote — are auditable
instead.

## Pipeline

```
discover (robots.txt / sitemap.xml, or BFS from the homepage)
  -> crawl (headless Chrome via Puppeteer, one render per page)
  -> deterministic DOM extraction (no LLM: meta, headings, body text,
     JSON-LD, links, forms, images, contact info via regex)
  -> LLM fact extraction (one call per page, atomic claims only)
  -> dedupe (drop near-identical facts repeated across pages)
  -> site classification (one LLM call, whole-site metadata)
  -> storage (facts.jsonl, raw-pages.jsonl, site_manifest.json)
```

Note on headless browser choice: the original design called for Playwright,
but this repo already depends on Puppeteer (used elsewhere in `services/api`
for PDF/screenshot rendering) and has no Playwright install. Puppeteer is
used here instead to avoid a second headless-browser dependency — behavior
is equivalent for this use case (render, wait for network idle, read the DOM).

## Running it end-to-end on a single URL

From `services/api/`:

```bash
pnpm run build
pnpm run site-facts:extract -- https://example.com
```

Optional flags:

```bash
pnpm run site-facts:extract -- https://example.com --workdir ./workdir --max-pages 40 --max-depth 3
```

This requires the same LLM provider configuration as the rest of the API
(`LLM_PROVIDER` + the matching API key env var, e.g. `ANTHROPIC_API_KEY`),
since fact extraction and site classification both call the existing
`llmGenerateFn` bridge.

## Output layout

Output lands under `{workdir}/{hostname}/`:

```
{workdir}/
  example.com/
    site_manifest.json   # { site_url, crawl_date, pages_crawled, page_urls[], site_category }
    facts.jsonl           # one Fact object per line
    raw-pages.jsonl        # one RawPageExtraction object per line (per-page deterministic extraction)
```

`raw-pages.jsonl` is kept so facts can be re-derived later (better prompt,
different model) without re-crawling the site.

### Fact shape (`facts.jsonl`, one per line)

```json
{
  "fact_id": "uuid",
  "site_url": "https://example.com",
  "source_url": "https://example.com/about",
  "source_section": "h2: Our Story",
  "category": "company_info | product | pricing | audience | feature | contact | policy | team | other",
  "statement": "Founded in 2019, the company is headquartered in Austin, TX.",
  "confidence": "high | medium | low",
  "extracted_at": "2026-01-01T00:00:00.000Z",
  "verbatim_support": "Founded in 2019 and headquartered in Austin, TX"
}
```

`confidence` is `"low"` for marketing-toned or superlative claims (e.g.
"industry-leading") — still captured, since it's a fact about what the site
*claims*, just flagged so it isn't presented as objective truth downstream.

## Modules

| File | Responsibility |
|---|---|
| `discovery.ts` | robots.txt / sitemap.xml parsing, URL normalization, allow/deny checks (pure, one fetch boundary) |
| `dom-extraction.ts` | The in-browser extraction script (`runBrowserExtraction`, runs via `page.evaluate`) plus pure Node-side helpers: contact-info regex, link resolution |
| `crawler.service.ts` | Puppeteer BFS orchestration: launches one browser, visits pages up to `maxPages`/`maxDepth`, calls `dom-extraction` per page |
| `fact-extraction.service.ts` | The only LLM-touching extraction step. `FACT_EXTRACTION_PROMPT_TEMPLATE` is exported as a constant for review/tuning. `dedupeFacts` collapses near-identical facts |
| `site-classification.service.ts` | One LLM call to classify the whole site (manifest metadata only) |
| `store.ts` | Flat-file JSONL/JSON storage, atomic write-temp-then-rename |
| `retrieval.ts` | `getFactsForSite` (filter by category/source_url) and `getFactStatements` (flat list ready for a prompt or embeddings index) — no generation logic |
| `pipeline.ts` | `extractSiteFacts(url, opts)` — the orchestrator; the entry point most callers should use |
| `cli.ts` | Standalone CLI entrypoint (`pnpm run site-facts:extract`) |

## Using the retrieval helper

```ts
import { getFactStatements } from './retrieval.js';

const statements = await getFactStatements('/workdir/example.com', { category: 'pricing' });
// [{ statement, confidence, source_url }, ...] — drop straight into a prompt or an embeddings index.
```

## What this pipeline does *not* do

- No markdown/DOCX narrative generation — that consumes this fact base later, it doesn't live here.
- No speculative "gap filling" — if a page doesn't state something, no fact is produced for it.
- No site-type-specific crawl branches — `site_category` is manifest metadata only; crawling and extraction are identical regardless of what the site is built on (WordPress, Laravel, a plain static site, an SPA) or what kind of site it is.

## Integration with super-client creation

`POST /super-clients` (`super-client-routes.ts`) no longer asks the LLM to
guess at a company from a bare URL string. If a `url` is given, `extractSiteFacts`
runs in the background (not blocking the creation response, since a multi-page
crawl can take much longer than a single LLM call) and writes facts under
`workdir/super-clients/{name}/site-facts/{hostname}/`. Once facts are ready,
`generateSummaryDoc` turns them into `client-knowledge.md` (merged with
creation notes if given) — this is also the file `POST .../enrich-url`
(re)generates on demand. There is no separate `context.md` — it was removed;
creation notes and URL-derived knowledge both land in `client-knowledge.md`.
