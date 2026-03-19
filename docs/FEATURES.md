# AI Engine Document Processing — Feature Documentation

> Complete reference for every feature, its architecture, implementation details,
> and step-by-step usage instructions with examples.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Core Packages](#3-core-packages)
   - 3.1 [Types Package](#31-types-package-packagestypes)
   - 3.2 [Core Package](#32-core-package-packagescore)
   - 3.3 [Runtime Package](#33-runtime-package-packagesruntime)
   - 3.4 [CLI Package](#34-cli-package-packagescli)
   - 3.5 [Plugin SDK Package](#35-plugin-sdk-package-packagesplugin-sdk)
   - 3.6 [Providers Package](#36-providers-package-packagesproviders)
4. [Feature 1 — Pipeline Engine](#4-feature-1--pipeline-engine)
5. [Feature 2 — Plugin System](#5-feature-2--plugin-system)
6. [Feature 3 — PDF Extractor Plugin](#6-feature-3--pdf-extractor-plugin)
7. [Feature 4 — Summarizer Processor Plugin](#7-feature-4--summarizer-processor-plugin)
8. [Feature 5 — JSON Exporter Plugin](#8-feature-5--json-exporter-plugin)
9. [Feature 6 — Python Processor Bridge](#9-feature-6--python-processor-bridge)
10. [Feature 7 — Local Ollama Processor Plugin](#10-feature-7--local-ollama-processor-plugin)
11. [Feature 8 — LangChain Summarize Processor Plugin](#11-feature-8--langchain-summarize-processor-plugin)
12. [Feature 9 — In-Memory RAG Processor Plugin (Ollama)](#12-feature-9--in-memory-rag-processor-plugin-ollama)
13. [Feature 10 — Persistent FAISS RAG Processor Plugin](#13-feature-10--persistent-faiss-rag-processor-plugin)
14. [Feature 11 — VectorStore Abstraction Layer](#14-feature-11--vectorstore-abstraction-layer)
15. [Feature 12 — CLI Command Runner](#15-feature-12--cli-command-runner)
16. [Feature 13 — Multi-Document Knowledge Ingestion](#16-feature-13--multi-document-knowledge-ingestion)
17. [Feature 14 — Knowledge Base Query Mode](#17-feature-14--knowledge-base-query-mode)
18. [Feature 15 — LLM Provider Abstraction Layer](#18-feature-15--llm-provider-abstraction-layer)
19. [Feature 16 — Namespace Isolation](#19-feature-16--namespace-isolation)
20. [Feature 17 — Knowledge Bridge (Runtime)](#20-feature-17--knowledge-bridge-runtime)
21. [Feature 18 — API Service with RBAC](#21-feature-18--api-service-with-rbac)
22. [Feature 19 — Provider Routing Policy Layer](#22-feature-19--provider-routing-policy-layer)
23. [Feature 20 — Evaluation Harness](#23-feature-20--evaluation-harness)
24. [Feature 21 — Proposal Generator Processor Plugin](#24-feature-21--proposal-generator-processor-plugin)
25. [Pipeline Examples](#25-pipeline-examples)
26. [Error Handling Architecture](#26-error-handling-architecture)
27. [Quick Reference Cheat Sheet](#27-quick-reference-cheat-sheet)

---

## 1. Project Overview

**AI Engine Document Processing** is a CLI-first, open-source AI document processing
engine. It runs locally, supports arbitrary document types, executes configurable
pipelines, and is extensible via plugins without coupling to any cloud, SaaS, or vendor.

```
Key Design Principles:
  - Local-first: all processing can run entirely on-machine
  - Pipeline-driven: YAML-defined, sequential step execution
  - Plugin-based: every capability (extract, process, export) is a plugin
  - Multi-language: TypeScript core with Python plugin support
  - Vendor-neutral: swap AI providers without changing pipelines
```

### Tech Stack

| Layer        | Technology              |
|--------------|-------------------------|
| Language     | TypeScript (core), Python (plugins) |
| Runtime      | Node.js (ES2022 modules) |
| Build        | TypeScript compiler, pnpm workspaces |
| AI (local)   | Ollama (Mistral, nomic-embed-text) |
| AI (cloud)   | OpenAI (gpt-4o-mini via LangChain) |
| Vector Store | FAISS (faiss-cpu + numpy) |
| Package Mgr  | pnpm with workspace protocol |

### Repository Layout

```
ai-engine-document-processing/
├── packages/
│   ├── types/              # Shared TypeScript type definitions
│   ├── core/               # Pipeline schema, validation, plugin registry
│   ├── runtime/            # Pipeline runner, plugin loader, Python bridge
│   ├── cli/                # CLI entry point and command handlers
│   ├── plugin-sdk/         # SDK for plugin authors (base classes)
│   ├── pipelines/          # Built-in pipeline YAML definitions
│   └── providers/          # AI provider adapters (OpenAI, Anthropic, local)
├── plugins/
│   ├── extractor-pdf/      # PDF text extraction
│   ├── extractor-audio/    # Audio extraction (placeholder)
│   ├── processor-summarize/        # Simple text summarizer
│   ├── processor-local-ollama/     # Ollama-based summarizer
│   ├── processor-local-rag-ollama/ # In-memory RAG with Ollama
│   ├── processor-local-faiss-rag/  # Persistent FAISS RAG with Ollama
│   ├── processor-langchain-summarize/ # LangChain + OpenAI summarizer
│   ├── processor-proposal-generator/  # Proposal generation (template + pricing)
│   ├── python-processor-template/  # Template for Python plugins
│   ├── exporter-json/      # JSON file exporter
│   └── shared/              # Shared plugin utilities
│       └── providers/       # LLM provider abstraction layer
├── services/
│   └── api/                 # HTTP API with auth, RBAC, audit, and provider routing
├── config/
│   ├── api_keys.example.json # Example API key configuration
│   └── provider_policy.json  # Provider routing policy config
├── deployment/              # Docker Compose on-prem blueprint
├── examples/
│   ├── generic-documents/   # Example: generic document pipeline
│   └── meeting-transcript/  # Example: meeting transcript pipeline
├── docs/                    # Documentation
├── package.json             # Root workspace config
├── pnpm-workspace.yaml      # Workspace package list
└── tsconfig.base.json       # Shared TypeScript config
```

---

## 2. System Architecture

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLI (packages/cli)                          │
│  ┌───────────┐  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │  Arg      │  │   Console    │  │     Command: run             │  │
│  │  Parser   │──│   Reporter   │──│  ai-engine run pipeline.yaml │  │
│  └───────────┘  └──────────────┘  └──────────────┬──────────────┘  │
└──────────────────────────────────────────────────┬──────────────────┘
                                                   │
                        ┌──────────────────────────▼──────────────────┐
                        │          RUNTIME (packages/runtime)          │
                        │                                              │
                        │  ┌────────────────┐  ┌────────────────────┐ │
                        │  │ Pipeline Loader │  │   Plugin Loader    │ │
                        │  │ (YAML → schema) │  │ (dir → validated   │ │
                        │  └───────┬────────┘  │   plugin instance) │ │
                        │          │           └────────┬───────────┘ │
                        │          │                    │              │
                        │  ┌───────▼────────────────────▼───────────┐ │
                        │  │           Pipeline Runner               │ │
                        │  │  for each step: resolve → execute       │ │
                        │  │  data flows: extract → process → export │ │
                        │  └───────┬────────────────────────────────┘ │
                        │          │                                   │
                        │  ┌───────▼─────────────────────────┐        │
                        │  │    Python Processor Runner       │        │
                        │  │ spawn python3 → stdin JSON       │        │
                        │  │ → stdout JSON → parse result     │        │
                        │  └─────────────────────────────────┘        │
                        └─────────────────────────────────────────────┘
                                                   │
               ┌───────────────────────────────────┼───────────────────┐
               │              CORE (packages/core)  │                   │
               │  ┌─────────────────┐  ┌───────────▼─────────────────┐ │
               │  │ Pipeline Schema │  │    Pipeline Registry         │ │
               │  │ & Validator     │  │  ┌───────────────────────┐  │ │
               │  │ (YAML rules)    │  │  │ Extractor Registry    │  │ │
               │  └─────────────────┘  │  │ Processor Registry    │  │ │
               │                       │  │ Exporter Registry     │  │ │
               │                       │  └───────────────────────┘  │ │
               │                       └─────────────────────────────┘ │
               └───────────────────────────────────────────────────────┘
                                                   │
          ┌────────────────────────────────────────┼────────────────────┐
          │                    PLUGINS (plugins/*)   │                    │
          │                                          │                    │
          │  ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐   │
          │  │  Extractors   │  │   Processors    │  │  Exporters   │   │
          │  │              │  │                 │  │              │   │
          │  │ pdf-extractor│  │ summarizer      │  │ json-exporter│   │
          │  │              │  │ local-ollama    │  │              │   │
          │  │              │  │ local-rag-ollama│  │              │   │
          │  │              │  │ local-faiss-rag │  │              │   │
          │  │              │  │ langchain-sum.. │  │              │   │
          │  └──────────────┘  └─────────────────┘  └──────────────┘   │
          └────────────────────────────────────────────────────────────┘
```

### Data Flow Through a Pipeline

```
                    ┌──────────┐
                    │  Input   │
                    │  File    │ (Buffer: PDF, TXT, etc.)
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ EXTRACT  │  Extractor plugin reads raw bytes
                    │  step    │  and produces a Document object
                    └────┬─────┘
                         │
                    ┌────▼─────────────────────────┐
                    │      Document Object          │
                    │  {                            │
                    │    type: "text",              │
                    │    source: "pdf",             │
                    │    content: "...",            │
                    │    metadata: {},              │
                    │    createdAt: "ISO8601"       │
                    │  }                            │
                    └────┬─────────────────────────┘
                         │
                    ┌────▼─────┐
                    │ PROCESS  │  Processor plugin transforms the
                    │  step    │  Document (e.g., summarize, RAG)
                    │ (1..N)   │  Each step receives output of prior
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ EXPORT   │  Exporter plugin serializes the
                    │  step    │  final Document to output format
                    └────┬─────┘
                         │
                    ┌────▼──────┐
                    │  Output   │
                    │  File     │ (JSON, TXT, etc.)
                    └───────────┘
```

### Plugin Loading Sequence

```
  CLI run command
       │
       ▼
  For each --plugins directory:
       │
       ├─→ Read plugin.json (manifest)
       │     ├─ Validate: name, type, apiVersion, entry
       │     └─ Check API version compatibility (major version = 0)
       │
       ├─→ Assert package.json exists
       │
       ├─→ Import entry JS file (dist/index.js)
       │     ├─ Must have default export
       │     ├─ Export must have .name string
       │     └─ Export .name must match manifest .name
       │
       └─→ Register in PipelineRegistry
             ├─ type: "extractor" → ExtractorRegistry
             ├─ type: "processor" → ProcessorRegistry
             └─ type: "exporter"  → ExporterRegistry
```

---

## 3. Core Packages

### 3.1 Types Package (`packages/types`)

**Purpose:** Shared TypeScript type definitions for the entire engine.

**Status:** Interface stubs (TODO placeholders for Document, Extractor, Processor,
Exporter, Pipeline, Provider, Context, Plugin, Error types).

**Files:**
| File | Planned Interface |
|------|-------------------|
| `document.ts` | Document, DocumentMetadata |
| `extractor.ts` | Extractor, ExtractionResult |
| `processor.ts` | Processor, ProcessingResult |
| `exporter.ts` | Exporter, ExportResult |
| `pipeline.ts` | PipelineConfig, PipelineStep |
| `context.ts` | ExecutionContext, ContextOptions |
| `plugin.ts` | Plugin, PluginManifest |
| `provider.ts` | Provider, ProviderConfig |
| `errors.ts` | EngineError, PipelineError |

---

### 3.2 Core Package (`packages/core`)

**Purpose:** Pipeline schema definition, YAML validation, and plugin registries.

**Key Components:**

#### Pipeline Schema (`pipeline-schema.ts`)
Defines the shape of a valid pipeline:
```typescript
interface PipelineDefinition {
  name: string;        // Pipeline name
  version: string;     // Semantic version
  steps: PipelineStepDefinition[];
}

interface PipelineStepDefinition {
  type: "extract" | "process" | "export";
  ref: string;          // Plugin name reference
  config?: Record<string, unknown>;  // Optional step config
}
```

#### Pipeline Validator (`pipeline-validator.ts`)
Strict validation rules:
- Pipeline must be a non-null object
- Required fields: `name`, `version`, `steps`
- No unknown top-level fields
- Steps must be non-empty array
- Each step requires `type` (extract/process/export) and `ref`
- Step order enforced: extract → process → export
- Exactly one `export` step, must be last
- Optional `config` must be a plain object

#### Plugin Registries
Three separate registries, one per plugin type:

```
PipelineRegistry
  ├── ExtractorRegistry  (Map<name, Extractor>)
  ├── ProcessorRegistry  (Map<name, Processor>)
  └── ExporterRegistry   (Map<name, Exporter>)
```

Each registry enforces:
- No duplicate plugin names
- Lookup by name with step-index context for error messages

---

### 3.3 Runtime Package (`packages/runtime`)

**Purpose:** Execution engine — loads pipelines, loads plugins, runs steps.

**Key Components:**

#### Pipeline Loader (`pipeline-loader.ts`)
- Reads YAML file from disk
- Parses with `yaml` library
- Validates through core's `validatePipeline()`

#### Plugin Loader (`plugin-loader.ts`)
- Reads `plugin.json` manifest from each plugin directory
- Validates manifest fields and API version
- Asserts `package.json` exists
- Dynamically imports the JS entry file
- Validates the default export has matching `.name`
- Registers plugin in the `PipelineRegistry`

#### Pipeline Runner (`pipeline-runner.ts`)
- Resolves each step's plugin from the registry
- Asserts plugins implement their required method:
  - Extractors: `extract()`
  - Processors: `process()`
  - Exporters: `export()`
- Executes steps sequentially, passing output → input
- Passes `ExecutionContext` (runId, workingDirectory, logger)

#### Python Processor Runner (`python-processor-runner.ts`)
Bridges TypeScript to Python processors:

```
TypeScript                    Python
─────────                    ──────
Document + Context ──JSON──→ stdin
                             processor.py executes
stdout ←──JSON── {"document": {...}}
stderr ←──JSON── {"error": "...", "type": "..."}
```

Protocol:
- Spawns `python3 <script.py>` as child process
- Sends JSON via stdin: `{ document, context: { runId, workingDirectory } }`
- Reads JSON from stdout: `{ document }`
- Reads JSON from stderr on failure: `{ error, type }`
- Non-zero exit code = error

#### Knowledge Bridge (`knowledge/knowledge-bridge.ts`)
Shared programmatic interface for the FAISS knowledge store. Both the CLI and
the API service import from this module instead of implementing their own
subprocess bridge.

Exported functions:

| Function | Purpose |
|----------|---------|
| `ingestDocuments(params)` | Ingest documents into a FAISS namespace |
| `queryKnowledgeBase(params)` | Query a namespace with RAG |
| `listNamespaces(workdir)` | List namespaces that contain a valid FAISS index |

All three delegate to `knowledge_store.py` via the JSON-over-stdin protocol.

---

### 3.4 CLI Package (`packages/cli`)

**Purpose:** User-facing command-line interface.

**Entry Point:** `ai-engine <command> [options]`

**Commands:**
| Command | Description |
|---------|-------------|
| `run <pipeline.yaml> <inputPath>` | Execute a pipeline |
| `ingest <path>` | Ingest documents into persistent FAISS index |
| `query "<question>"` | Query the knowledge base using RAG |
| `namespaces` | List available namespaces |

**Flags:**
| Flag | Description |
|------|-------------|
| `--plugins <path>` | Plugin directory (repeatable, `run` only) |
| `--workdir <path>` | Working directory (default: cwd) |
| `--namespace <name>` | Namespace for index isolation (default: `"default"`, `ingest`/`query` only) |
| `--stream` | Enable streaming output (`run`, `query`) |

**Input handling:**
- Single file: processes that one file
- Directory: processes all non-hidden files (sorted alphabetically)

**Output:**
- Creates `<workdir>/output/<runId>/` directory
- Writes one output file per input file
- Logs to stderr: `[info]` and `[error]` prefixed lines

---

### 3.5 Plugin SDK Package (`packages/plugin-sdk`)

**Purpose:** Base classes and helpers for plugin authors.

**Status:** Stubs (TODO placeholders for BaseExtractor, BaseProcessor, BaseExporter,
PluginManifest validation, versioning checks).

---

### 3.6 Providers Package (`packages/providers`)

**Purpose:** AI provider adapters for different LLM backends.

**Planned Providers:**
| Provider | Status |
|----------|--------|
| `openai` | Stub |
| `anthropic` | Stub |
| `local` | Stub |

---

## 4. Feature 1 — Pipeline Engine

### What It Does
Executes multi-step document processing workflows defined in YAML.

### Architecture

```
pipeline.yaml                PipelineDefinition
─────────────                ──────────────────
name: "my-pipeline"    ───→  { name, version,
version: "1.0"               steps: [
steps:                          { type, ref, config? },
  - type: extract               ...
    ref: pdf-extractor         ]
  - type: process            }
    ref: summarizer
  - type: export
    ref: json-exporter
```

```
Execution Flow:
─────────────────────────────────────────────────────────
  Input Buffer
       │
       ▼
  Step 0: extract "pdf-extractor"
       │  plugin.extract(buffer) → Document
       ▼
  Step 1: process "summarizer"
       │  plugin.process(document) → Document
       ▼
  Step 2: export "json-exporter"
       │  plugin.export(document) → string
       ▼
  Output written to disk
```

### Pipeline YAML Schema

```yaml
name: string          # Required. Pipeline display name.
version: string       # Required. Semantic version.
steps:                # Required. Non-empty array.
  - type: extract     # "extract" | "process" | "export"
    ref: plugin-name  # Must match a registered plugin name
    config:           # Optional. Passed to the plugin.
      key: value
```

### Validation Rules
1. Must be a YAML object (not array, not scalar)
2. Only allowed top-level fields: `name`, `version`, `steps`
3. `steps` must be a non-empty array
4. Each step must have `type` and `ref`
5. `type` must be one of: `extract`, `process`, `export`
6. Step order: extract steps first, then process, then export
7. Exactly one `export` step, and it must be last

### Step-by-Step Usage

**1. Write a pipeline YAML file:**

```yaml
# my-pipeline.yaml
name: my-document-processor
version: "1.0"
steps:
  - type: extract
    ref: pdf-extractor
  - type: process
    ref: summarizer
  - type: export
    ref: json-exporter
```

**2. Build all plugins:**

```bash
pnpm build
```

**3. Run the pipeline:**

```bash
ai-engine run my-pipeline.yaml ./input.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-summarize \
  --plugins plugins/exporter-json
```

**4. Check output:**

```bash
ls output/<run-id>/
# → input.pdf (contains the JSON result)
```

---

## 5. Feature 2 — Plugin System

### What It Does
Dynamic plugin loading, validation, and registration. Allows extending the engine
with new extractors, processors, and exporters without modifying core code.

### Plugin Architecture

```
plugins/my-plugin/
├── plugin.json        # Manifest: name, type, apiVersion, entry
├── package.json       # Node.js package (required by loader)
├── tsconfig.json      # TypeScript config
├── src/
│   └── index.ts       # Plugin implementation (default export)
└── dist/
    └── index.js       # Compiled entry point
```

### Plugin Manifest (`plugin.json`)

```json
{
  "name": "my-plugin",        // Unique plugin name
  "type": "processor",        // "extractor" | "processor" | "exporter"
  "apiVersion": "0.1",        // Must match runtime's major version (0)
  "entry": "dist/index.js"    // Path to compiled JS entry
}
```

### Plugin Contract

Every plugin must export a default object with:
- `name` (string): must match manifest name
- Type-specific method:
  - Extractor: `extract(input, config?, context?)`
  - Processor: `process(data, config?, context?)`
  - Exporter: `export(data, config?, context?)`

### Plugin Types

```
┌─────────────────────────────────────────────────────────┐
│                     Plugin Types                         │
├───────────────┬──────────────────────┬──────────────────┤
│   Extractor   │     Processor        │    Exporter      │
├───────────────┼──────────────────────┼──────────────────┤
│ Reads raw     │ Transforms a         │ Serializes the   │
│ input bytes   │ Document object      │ final Document   │
│ and produces  │ (summarize, enrich,  │ to an output     │
│ a Document    │ classify, RAG, etc.) │ format           │
│ object        │                      │                  │
├───────────────┼──────────────────────┼──────────────────┤
│ Method:       │ Method:              │ Method:          │
│ extract()     │ process()            │ export()         │
└───────────────┴──────────────────────┴──────────────────┘
```

### Step-by-Step: Creating a New Plugin

**1. Create plugin directory:**

```bash
mkdir -p plugins/my-custom-processor/src
```

**2. Create `plugin.json`:**

```json
{
  "name": "my-custom",
  "type": "processor",
  "apiVersion": "0.1",
  "entry": "dist/index.js"
}
```

**3. Create `package.json`:**

```json
{
  "name": "@ai-engine/plugin-my-custom",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "scripts": { "build": "tsc", "clean": "rm -rf dist" },
  "dependencies": { "@ai-engine/runtime": "workspace:*" },
  "devDependencies": { "typescript": "^5.7.3" }
}
```

**4. Create `tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"]
}
```

**5. Implement `src/index.ts`:**

```typescript
const processor = {
  name: 'my-custom' as const,
  async process(data: unknown): Promise<unknown> {
    const document = data as { content: string };
    return { ...document, content: document.content.toUpperCase() };
  },
};
export default processor;
```

**6. Build and use:**

```bash
pnpm install && pnpm --filter @ai-engine/plugin-my-custom build
ai-engine run pipeline.yaml input.txt --plugins plugins/my-custom-processor
```

---

## 6. Feature 3 — PDF Extractor Plugin

### What It Does
Extracts text content from PDF files (currently reads raw buffer as UTF-8).

### Plugin Details

| Field | Value |
|-------|-------|
| Name | `pdf-extractor` |
| Type | `extractor` |
| Location | `plugins/extractor-pdf/` |
| Language | TypeScript |

### Architecture

```
Input: Buffer (raw PDF file bytes)
        │
        ▼
  pdf-extractor.extract(buffer)
        │
        ├─ Converts buffer to UTF-8 string
        ├─ Creates Document object:
        │    type: "text"
        │    source: "pdf"
        │    content: <extracted text>
        │    metadata: {}
        │    createdAt: <ISO8601 timestamp>
        │
        ▼
Output: Document
```

### Usage

```yaml
# pipeline.yaml
steps:
  - type: extract
    ref: pdf-extractor
  # ... process and export steps
```

```bash
ai-engine run pipeline.yaml document.pdf --plugins plugins/extractor-pdf
```

---

## 7. Feature 4 — Summarizer Processor Plugin

### What It Does
Simple text processor that appends `[processed]` to document content.
Useful as a placeholder and for testing pipeline wiring.

### Plugin Details

| Field | Value |
|-------|-------|
| Name | `summarizer` |
| Type | `processor` |
| Location | `plugins/processor-summarize/` |
| Language | TypeScript |

### Architecture

```
Input: Document { content: "original text..." }
        │
        ▼
  summarizer.process(document)
        │
        └─ Returns: { ...document, content: content + " [processed]" }
        │
        ▼
Output: Document { content: "original text... [processed]" }
```

### Usage

```yaml
steps:
  - type: process
    ref: summarizer
```

```bash
ai-engine run pipeline.yaml input.txt \
  --plugins plugins/processor-summarize
```

---

## 8. Feature 5 — JSON Exporter Plugin

### What It Does
Serializes the final Document to pretty-printed JSON.

### Plugin Details

| Field | Value |
|-------|-------|
| Name | `json-exporter` |
| Type | `exporter` |
| Location | `plugins/exporter-json/` |
| Language | TypeScript |

### Architecture

```
Input: Document (any object)
        │
        ▼
  json-exporter.export(data)
        │
        └─ JSON.stringify(data, null, 2)
        │
        ▼
Output: string (pretty JSON)
```

### Usage

```yaml
steps:
  # ... extract and process steps
  - type: export
    ref: json-exporter
```

### Example Output

```json
{
  "type": "text",
  "source": "pdf",
  "content": "Summarized content here...",
  "metadata": {},
  "createdAt": "2026-02-11T10:00:00.000Z"
}
```

---

## 9. Feature 6 — Python Processor Bridge

### What It Does
Enables writing processor plugins in Python. The TypeScript wrapper spawns a
Python child process, communicates via stdin/stdout JSON, and returns the result.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TypeScript Wrapper                         │
│  src/index.ts                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. Receive Document + ExecutionContext               │   │
│  │  2. Serialize to JSON:                                │   │
│  │     { document, context: { runId, workingDirectory }} │   │
│  │  3. Spawn: python3 processor.py                       │   │
│  │  4. Write JSON to stdin                               │   │
│  │  5. Read JSON from stdout                             │   │
│  │  6. Return parsed Document                            │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ spawn + stdin/stdout
                ┌──────────▼──────────┐
                │   Python Script     │
                │   processor.py      │
                │                     │
                │  1. json.load(stdin) │
                │  2. Process document│
                │  3. json.dump(stdout│
                │     {"document":..})│
                │                     │
                │  On error:          │
                │  json.dump(stderr,  │
                │  {"error","type"})  │
                │  sys.exit(1)        │
                └─────────────────────┘
```

### Python Script Contract

**Input (stdin):**
```json
{
  "document": {
    "type": "text",
    "source": "pdf",
    "content": "document text...",
    "metadata": {},
    "createdAt": "2026-02-11T00:00:00Z"
  },
  "context": {
    "runId": "uuid-string",
    "workingDirectory": "/path/to/workdir"
  }
}
```

**Output (stdout):**
```json
{
  "document": {
    "type": "text",
    "source": "pdf",
    "content": "processed text...",
    "metadata": {},
    "createdAt": "2026-02-11T00:00:00Z"
  }
}
```

**Error (stderr + exit code 1):**
```json
{
  "error": "Error description",
  "type": "ValueError"
}
```

### Step-by-Step: Creating a Python Processor

**1. Copy the template:**

```bash
cp -r plugins/python-processor-template plugins/my-python-processor
```

**2. Edit `plugin.json`** — change name:

```json
{ "name": "my-python-proc", "type": "processor", "apiVersion": "0.1", "entry": "dist/index.js" }
```

**3. Edit `src/index.ts`** — update plugin name:

```typescript
const processor = {
  name: 'my-python-proc' as const,
  // ... rest stays the same, just update the name string in runPythonProcessor call
};
```

**4. Edit `processor.py`** — implement your logic:

```python
def process_document(document):
    document['content'] = document['content'].upper()
    return document
```

**5. Build and run:**

```bash
pnpm install && pnpm --filter @ai-engine/plugin-my-python-processor build
ai-engine run pipeline.yaml input.txt --plugins plugins/my-python-processor
```

---

## 10. Feature 7 — Local Ollama Processor Plugin

### What It Does
Sends document content to a locally running Ollama instance (Mistral model) for
AI-powered summarization. Produces a 5-bullet-point summary.

### Plugin Details

| Field | Value |
|-------|-------|
| Name | `local-ollama` |
| Type | `processor` |
| Location | `plugins/processor-local-ollama/` |
| Language | Python (via TS bridge) |
| AI Model | `mistral` via Ollama |
| API | `POST http://localhost:11434/api/generate` |

### Architecture

```
Input Document
     │
     ▼
┌──────────────────────────────────────────┐
│           processor.py                    │
│                                           │
│  1. Read document.content from stdin      │
│  2. Build prompt:                         │
│     "Summarize the following text in      │
│      5 bullet points:\n\n{content}"       │
│  3. POST to Ollama /api/generate          │
│     { model: "mistral", prompt, stream: false }
│  4. Replace document.content with         │
│     Ollama's response                     │
│  5. Output updated document to stdout     │
└──────────────────────────────────────────┘
     │
     ▼
Output Document (content = AI summary)
```

### Prerequisites

```bash
# Install and start Ollama
ollama serve

# Pull the model
ollama pull mistral
```

### Step-by-Step Usage

**1. Ensure Ollama is running:**

```bash
ollama serve &
ollama pull mistral
```

**2. Build the plugin:**

```bash
pnpm --filter @ai-engine/plugin-local-ollama build
```

**3. Create a pipeline:**

```yaml
# ollama-pipeline.yaml
name: ollama-summarize
version: "1.0"
steps:
  - type: extract
    ref: pdf-extractor
  - type: process
    ref: local-ollama
  - type: export
    ref: json-exporter
```

**4. Run:**

```bash
ai-engine run ollama-pipeline.yaml document.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-local-ollama \
  --plugins plugins/exporter-json
```

**5. Example output:**

```json
{
  "type": "text",
  "source": "pdf",
  "content": "- Key point one about the document...\n- Key point two...\n- ...",
  "metadata": {},
  "createdAt": "2026-02-11T10:00:00.000Z"
}
```

---

## 11. Feature 8 — LangChain Summarize Processor Plugin

### What It Does
Uses LangChain with OpenAI's GPT-4o-mini to generate cloud-based AI summaries.

### Plugin Details

| Field | Value |
|-------|-------|
| Name | `langchain-summarizer` |
| Type | `processor` |
| Location | `plugins/processor-langchain-summarize/` |
| Language | Python (via TS bridge) |
| AI Model | `gpt-4o-mini` via OpenAI API |
| Dependencies | `langchain-openai`, `langchain-core` |

### Architecture

```
Input Document
     │
     ▼
┌───────────────────────────────────────────────────┐
│             processor.py                           │
│                                                    │
│  1. Read OPENAI_API_KEY from environment           │
│  2. Read document.content from stdin               │
│  3. Create LangChain ChatOpenAI(gpt-4o-mini, t=0) │
│  4. Send HumanMessage:                             │
│     "Summarize the following text in               │
│      5 bullet points:\n\n{content}"                │
│  5. Replace document.content with response         │
│  6. Output updated document to stdout              │
└───────────────────────────────────────────────────┘
     │
     ▼
Output Document (content = GPT-4o-mini summary)
```

### Prerequisites

```bash
# Set your OpenAI API key
export OPENAI_API_KEY="sk-..."

# Install Python dependencies
pip install langchain-openai langchain-core
```

### Step-by-Step Usage

**1. Set API key:**

```bash
export OPENAI_API_KEY="sk-your-key-here"
```

**2. Install Python dependencies:**

```bash
pip install langchain-openai langchain-core
```

**3. Build the plugin:**

```bash
pnpm --filter @ai-engine/plugin-langchain-summarize build
```

**4. Create a pipeline:**

```yaml
# langchain-pipeline.yaml
name: langchain-summarize
version: "1.0"
steps:
  - type: extract
    ref: pdf-extractor
  - type: process
    ref: langchain-summarizer
  - type: export
    ref: json-exporter
```

**5. Run:**

```bash
ai-engine run langchain-pipeline.yaml document.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-langchain-summarize \
  --plugins plugins/exporter-json
```

---

## 12. Feature 9 — In-Memory RAG Processor Plugin (Ollama)

### What It Does
Retrieval-Augmented Generation that chunks a document, embeds chunks locally,
performs cosine-similarity retrieval, and generates a focused summary using only
the most relevant chunks. All in-memory (no persistence between runs).

### Plugin Details

| Field | Value |
|-------|-------|
| Name | `local-rag-ollama` |
| Type | `processor` |
| Location | `plugins/processor-local-rag-ollama/` |
| Language | Python (via TS bridge) |
| Embedding Model | `nomic-embed-text` via Ollama |
| Generation Model | `mistral` via Ollama |
| Chunk Size | ~500 characters |
| Top-K Retrieval | 3 chunks |
| Persistence | None (in-memory only) |

### Architecture

```
Input Document
     │
     ▼
┌────────────────────────────────────────────────────────┐
│                  processor.py                           │
│                                                         │
│  ┌──────────────┐                                       │
│  │ 1. CHUNK     │  Split content into ~500-char chunks  │
│  └──────┬───────┘                                       │
│         │                                               │
│  ┌──────▼───────┐                                       │
│  │ 2. EMBED     │  Embed each chunk via Ollama          │
│  │              │  POST /api/embeddings                  │
│  │              │  model: nomic-embed-text               │
│  └──────┬───────┘                                       │
│         │                                               │
│  ┌──────▼───────┐                                       │
│  │ 3. RETRIEVE  │  Embed query, compute cosine          │
│  │              │  similarity, select top-3 chunks       │
│  └──────┬───────┘                                       │
│         │                                               │
│  ┌──────▼───────┐                                       │
│  │ 4. GENERATE  │  Send retrieved chunks as context     │
│  │              │  to Mistral via /api/generate          │
│  │              │  "Summarize in 5 bullet points"        │
│  └──────┬───────┘                                       │
│         │                                               │
│  Output: Document with AI summary as content            │
└────────────────────────────────────────────────────────┘
```

### RAG vs Direct Summarization

```
Direct (local-ollama):           RAG (local-rag-ollama):
─────────────────────            ──────────────────────
Send ENTIRE document    ──vs──   Send only TOP 3 RELEVANT
to LLM                           chunks to LLM

Problem: token limits,           Benefit: focused context,
irrelevant noise                 better summaries
```

### Prerequisites

```bash
ollama serve
ollama pull mistral
ollama pull nomic-embed-text
```

### Step-by-Step Usage

**1. Start Ollama and pull models:**

```bash
ollama serve &
ollama pull mistral
ollama pull nomic-embed-text
```

**2. Build:**

```bash
pnpm --filter @ai-engine/plugin-local-rag-ollama build
```

**3. Pipeline:**

```yaml
# rag-pipeline.yaml
name: rag-summarize
version: "1.0"
steps:
  - type: extract
    ref: pdf-extractor
  - type: process
    ref: local-rag-ollama
  - type: export
    ref: json-exporter
```

**4. Run:**

```bash
ai-engine run rag-pipeline.yaml document.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-local-rag-ollama \
  --plugins plugins/exporter-json
```

---

## 13. Feature 10 — Persistent FAISS RAG Processor Plugin

### What It Does
Same RAG approach as the in-memory version, but stores the FAISS vector index
and chunk metadata to disk. On subsequent runs, it loads the existing index and
appends new chunks — giving the pipeline **memory across invocations**.

### Plugin Details

| Field | Value |
|-------|-------|
| Name | `local-faiss-rag` |
| Type | `processor` |
| Location | `plugins/processor-local-faiss-rag/` |
| Language | Python (via TS bridge) |
| Embedding Model | Configurable via LLM provider (default: `nomic-embed-text` via Ollama) |
| Generation Model | Configurable via LLM provider (default: `mistral` via Ollama) |
| LLM Provider | Pluggable via `LLM_PROVIDER` env var (`ollama` or `openai`) |
| Vector Store | FAISS `IndexFlatIP` (cosine similarity) |
| Chunk Size | ~500 characters |
| Top-K Retrieval | 5 chunks |
| Persistence | `<workdir>/namespaces/<namespace>/index.faiss` + `chunks.json` |
| Dependencies | `requests`, `numpy`, `faiss-cpu` |

### Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                 processor.py  (orchestrator)                       │
│                                                                    │
│  No FAISS imports. No numpy imports. No direct HTTP calls.        │
│  Depends only on VectorStore + LLMProvider interfaces.            │
│                                                                    │
│  ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌──────────────┐ │
│  │ 1. CHUNK │──▶│ 2. EMBED  │──▶│ 3. STORE │──▶│ 4. PERSIST   │ │
│  │ ~500 char│   │ via       │   │ via      │   │ via          │ │
│  │ splits   │   │ LLMProvid.│   │ VectorSt.│   │ VectorStore  │ │
│  └──────────┘   └───────────┘   └──────────┘   └──────────────┘ │
│                                                                    │
│  ┌──────────────┐   ┌────────────────┐   ┌─────────────────────┐ │
│  │ 5. RETRIEVE  │──▶│ 6. BUILD PROMPT│──▶│ 7. GENERATE via     │ │
│  │ via          │   │ from top-5     │   │    LLMProvider       │ │
│  │ VectorStore  │   │ chunks         │   │                     │ │
│  └──────────────┘   └────────────────┘   └─────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
         │                                         │
         ▼                                         ▼
┌─────────────────────┐                   ┌──────────────────────┐
│  vector_store.py     │                   │  LLMProvider          │
│  FaissVectorStore    │                   │  (Ollama or OpenAI)   │
│                      │                   └──────────────────────┘
│  ┌────────────────┐  │
│  │ FAISS IndexFlat│  │
│  │ IP (cosine sim)│  │
│  └────────┬───────┘  │
│           │          │
│  ┌────────▼───────┐  │
│  │ Disk Files:    │  │
│  │ index.faiss    │  │
│  │ chunks.json    │  │
│  └────────────────┘  │
└──────────────────────┘
```

### Persistence Lifecycle

```
First Run:                          Second Run:
───────────                         ────────────
1. load() → no files found          1. load() → reads index.faiss
2. Chunk document A                            + chunks.json
3. Embed chunks                     2. Existing: 10 chunks from doc A
4. add() → create new index         3. Chunk document B
5. persist() → write files           4. Embed new chunks
6. search() → query top-5           5. add() → append to index
7. generate() → summary             6. persist() → write updated files
                                    7. search() → query across ALL
                                       chunks (doc A + doc B)
                                    8. generate() → summary using
                                       context from both documents

Files on disk after run 1:          Files on disk after run 2:
  index.faiss  (10 vectors)           index.faiss  (20 vectors)
  chunks.json  (10 entries)           chunks.json  (20 entries)
```

### Prerequisites

```bash
# Start Ollama and pull models
ollama serve
ollama pull mistral
ollama pull nomic-embed-text

# Install Python dependencies
pip install requests numpy faiss-cpu
```

### Step-by-Step Usage

**1. Install prerequisites:**

```bash
ollama serve &
ollama pull mistral && ollama pull nomic-embed-text
pip install -r plugins/processor-local-faiss-rag/requirements.txt
```

**2. Build:**

```bash
pnpm --filter @ai-engine/plugin-local-faiss-rag build
```

**3. Create pipeline:**

```yaml
# faiss-rag-pipeline.yaml
name: persistent-rag
version: "1.0"
steps:
  - type: extract
    ref: pdf-extractor
  - type: process
    ref: local-faiss-rag
  - type: export
    ref: json-exporter
```

**4. First run (builds index):**

```bash
ai-engine run faiss-rag-pipeline.yaml document1.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-local-faiss-rag \
  --plugins plugins/exporter-json \
  --workdir ./my-workspace
```

**5. Verify persistence files:**

```bash
ls my-workspace/namespaces/default/
# → index.faiss  chunks.json
```

**6. Second run (reuses + extends index):**

```bash
ai-engine run faiss-rag-pipeline.yaml document2.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-local-faiss-rag \
  --plugins plugins/exporter-json \
  --workdir ./my-workspace
```

Now the index contains chunks from **both** documents, and retrieval
searches across all accumulated knowledge.

**7. Example output metadata:**

```json
{
  "type": "text",
  "source": "pdf",
  "content": "- Bullet point 1...\n- Bullet point 2...\n...",
  "metadata": {
    "index_size": 20,
    "chunks_retrieved": 5,
    "processor": "local-faiss-rag"
  },
  "createdAt": "2026-02-11T10:00:00.000Z"
}
```

---

## 14. Feature 11 — VectorStore Abstraction Layer

### What It Does
Provides a clean separation between the RAG processor logic and the vector
storage backend. The processor depends only on the abstract `VectorStore`
interface, making FAISS completely replaceable.

### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    processor.py                                │
│                                                                │
│  Imports: VectorStore + LLMProvider interfaces only            │
│  No FAISS. No numpy. No HTTP calls.                           │
│                                                                │
│  Responsibilities:                                             │
│    - Chunking text                                             │
│    - Calling provider.embed() for embeddings                   │
│    - Calling provider.generate() for generation                │
│    - Prompt construction                                       │
│    - Orchestrating the RAG pipeline                            │
│                                                                │
│  Uses store.load(), store.add(), store.persist(), store.search │
│  Uses provider.embed(), provider.generate()                    │
└────────────────────────────┬──────────────────────────────────┘
                             │ depends on (interface only)
                ┌────────────▼────────────────┐
                │     VectorStore (ABC)       │
                │                             │
                │  add(texts, embeddings)     │
                │  search(query_emb, top_k)   │
                │  persist()                  │
                │  load()                     │
                │  size (property)            │
                └────────────┬────────────────┘
                             │ implements
                ┌────────────▼────────────────┐
                │   FaissVectorStore          │
                │                             │
                │  FAISS IndexFlatIP          │
                │  L2 normalization           │
                │  numpy array conversion     │
                │  index.faiss persistence    │
                │  chunks.json persistence    │
                │  Dimension validation       │
                │  Consistency checks         │
                └─────────────────────────────┘

    Future implementations (no processor changes needed):
                ┌─────────────────────────────┐
                │  ChromaVectorStore          │
                │  PineconeVectorStore        │
                │  QdrantVectorStore          │
                │  InMemoryVectorStore        │
                │  SQLiteVectorStore          │
                └─────────────────────────────┘
```

### VectorStore Interface

```python
from abc import ABC, abstractmethod

class VectorStore(ABC):
    @abstractmethod
    def add(self, texts, embeddings):
        """Add texts with their embedding vectors (plain Python lists)."""

    @abstractmethod
    def search(self, query_embedding, top_k):
        """Return top-k most similar chunk text strings."""

    @abstractmethod
    def persist(self):
        """Save current state to disk."""

    @abstractmethod
    def load(self):
        """Load state from disk if it exists."""

    @property
    @abstractmethod
    def size(self):
        """Total number of stored vectors."""
```

### FaissVectorStore Implementation Details

| Aspect | Detail |
|--------|--------|
| Index type | `faiss.IndexFlatIP` (inner product) |
| Similarity | Cosine (via L2 normalization before indexing) |
| Storage files | `index.faiss` (binary), `chunks.json` (JSON array) |
| Dimension handling | Auto-detected on first `add()`, validated on subsequent |
| Consistency | Validates `index.ntotal == len(chunks)` on every `load()` |

### Step-by-Step: Implementing a Custom VectorStore

**1. Create your implementation in `vector_store.py`:**

```python
from vector_store import VectorStore

class MyCustomVectorStore(VectorStore):
    def __init__(self, storage_dir):
        self._storage_dir = storage_dir
        self._data = []

    def add(self, texts, embeddings):
        for text, emb in zip(texts, embeddings):
            self._data.append({"text": text, "embedding": emb})

    def search(self, query_embedding, top_k):
        # Your similarity search logic here
        ...

    def persist(self):
        # Save to disk
        ...

    def load(self):
        # Load from disk
        ...

    @property
    def size(self):
        return len(self._data)
```

**2. Swap in `processor.py` main():**

```python
# Change this one line:
store = MyCustomVectorStore(working_dir)
# Everything else stays exactly the same
```

---

## 15. Feature 12 — CLI Command Runner

### What It Does
The user-facing command-line interface that orchestrates everything: parses
arguments, loads plugins, loads pipelines, executes runs, and writes output.

### Architecture

```
$ ai-engine <command> [options]
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│  CLI Entry (packages/cli/src/index.ts)                    │
│  1. Parse argv → command name + args                      │
│  2. Extract global --stream flag                          │
│  3. Dispatch to command handler (run | ingest | query)    │
└──────────────────────┬───────────────────────────────────┘
                       │
         ┌─────────────▼─────────────────────────────┐
         │  run() (packages/cli/src/commands/run.ts)  │
         │                                            │
         │  1. Parse flags: --plugins, --workdir      │
         │  2. Resolve all paths to absolute           │
         │  3. Generate runId (UUID)                   │
         │  4. Create ExecutionContext                  │
         │  5. Create PipelineRegistry                 │
         │  6. loadPlugins(pluginDirs, registry)       │
         │  7. loadPipelineFromFile(path)               │
         │  8. prepareInputs(inputPath)                │
         │     - Single file → [{ fileName, content }] │
         │     - Directory → all non-hidden files       │
         │  9. For each input file:                     │
         │     a. runPipeline(pipeline, buffer,          │
         │        registry, context)                    │
         │     b. Serialize output                      │
         │     c. Write to output/<runId>/<fileName>    │
         │ 10. Log completion                           │
         └─────────────────────────────────────────────┘
                       │
         ┌─────────────▼──────────────────────────────────┐
         │  ingest() (packages/cli/src/commands/ingest.ts) │
         │                                                  │
         │  1. Parse flags: --workdir, --namespace           │
         │  2. Resolve paths to absolute                    │
         │  3. Compute: <workdir>/namespaces/<namespace>/   │
         │  4. Ensure namespace directory exists             │
         │  5. Collect text files recursively                │
         │     - Deterministic sort (localeCompare)         │
         │     - Skip dotfiles, filter by extension         │
         │  6. Spawn knowledge_store.py (ingest operation)  │
         │     - Resolve LLMProvider from env                │
         │     - Chunk → embed → add to FAISS index         │
         │     - Persist index.faiss + chunks.json          │
         │  7. Print: "Indexed X docs, Y chunks into        │
         │     namespace '<namespace>'"                     │
         └─────────────────────────────────────────────────┘
                       │
         ┌─────────────▼──────────────────────────────────┐
         │  query() (packages/cli/src/commands/query.ts)   │
         │                                                  │
         │  1. Parse flags: --workdir, --namespace, --stream│
         │  2. Resolve workdir to absolute                  │
         │  3. Compute: <workdir>/namespaces/<namespace>/   │
         │  4. Spawn knowledge_store.py (query operation)   │
         │     - Resolve LLMProvider from env                │
         │     - Load FAISS index from namespace dir         │
         │     - Embed question via provider.embed()         │
         │     - Retrieve top-5 chunks                      │
         │     - Build RAG prompt                           │
         │     - Generate answer via provider.generate()     │
         │  5. Print answer to stdout                       │
         │     - If --stream: tokens printed incrementally  │
         │     - If no stream: full answer printed at once  │
         └─────────────────────────────────────────────────┘
```

### Full CLI Reference

```
USAGE:
  ai-engine run <pipeline.yaml> <inputPath> [options]
  ai-engine ingest <path> [--workdir <dir>] [--namespace <name>]
  ai-engine query "<question>" [--workdir <dir>] [--namespace <name>] [--stream]

COMMANDS:
  run       Execute a pipeline on input files
  ingest    Ingest text documents into a persistent FAISS knowledge base
  query     Query the knowledge base with a natural language question

ARGUMENTS (run):
  pipeline.yaml    Path to the pipeline YAML definition file
  inputPath        Path to input file or directory

ARGUMENTS (ingest):
  path             Path to a text file or directory of text files

ARGUMENTS (query):
  question         Natural language question string

OPTIONS:
  --plugins <dir>      Path to a plugin directory (can be repeated, run only)
  --workdir <dir>      Working directory for output and state (default: cwd)
  --namespace <name>   Namespace for index isolation (default: "default", ingest/query)
  --stream             Enable streaming output (run, query)
  --help, -h           Show help message

ENVIRONMENT VARIABLES:
  LLM_PROVIDER             LLM backend: "ollama" (default) or "openai"
  OLLAMA_BASE_URL           Ollama server URL (default: http://localhost:11434)
  OLLAMA_GENERATION_MODEL   Ollama generation model (default: mistral)
  OLLAMA_EMBEDDING_MODEL    Ollama embedding model (default: nomic-embed-text)
  OPENAI_API_KEY            OpenAI API key (required when LLM_PROVIDER=openai)
  OPENAI_GENERATION_MODEL   OpenAI chat model (default: gpt-4o-mini)
  OPENAI_EMBEDDING_MODEL    OpenAI embedding model (default: text-embedding-3-small)

OUTPUT (run):
  Results are written to: <workdir>/output/<run-id>/<input-filename>
  Logs are written to stderr with [info] and [error] prefixes

OUTPUT (ingest):
  Prints: 'Indexed X documents, Y chunks into namespace "<name>"'
  Persists: index.faiss + chunks.json in <workdir>/namespaces/<namespace>/

OUTPUT (query):
  Prints the generated answer to stdout
  With --stream: tokens printed incrementally as they arrive

EXAMPLES:

  # Process a single PDF
  ai-engine run pipeline.yaml report.pdf \
    --plugins plugins/extractor-pdf \
    --plugins plugins/processor-summarize \
    --plugins plugins/exporter-json

  # Ingest documents into the default namespace
  ai-engine ingest ./docs/ --workdir ./knowledge-base

  # Ingest into a named namespace
  ai-engine ingest ./papers/ --workdir ./kb --namespace research

  # Query the default namespace
  ai-engine query "What are the key design decisions?" \
    --workdir ./knowledge-base

  # Query a specific namespace
  ai-engine query "What are the findings?" \
    --workdir ./kb --namespace research

  # Query with streaming output
  ai-engine query "Summarize the architecture" \
    --workdir ./kb --namespace research --stream

  # Use OpenAI instead of Ollama
  LLM_PROVIDER=openai OPENAI_API_KEY=sk-... \
    ai-engine query "Summarize" --workdir ./kb
```

---

## 16. Feature 13 — Multi-Document Knowledge Ingestion

### What It Does
Ingests text documents (file or directory) into a persistent FAISS vector index.
Recursively collects text files, chunks them, embeds via Ollama, and persists the
index to disk. This turns the engine into a persistent knowledge base that
accumulates knowledge across multiple ingestion runs.

### Command Details

| Field | Value |
|-------|-------|
| Command | `ai-engine ingest <path> [--namespace <name>]` |
| Location | `packages/cli/src/commands/ingest.ts` |
| Backend | `plugins/processor-local-faiss-rag/knowledge_store.py` |
| LLM Provider | Pluggable via `LLM_PROVIDER` env var (default: Ollama) |
| Embedding Model | Configurable per provider (default: `nomic-embed-text`) |
| Chunk Size | ~500 characters |
| Persistence | `<workdir>/namespaces/<namespace>/index.faiss` + `chunks.json` |
| Default Namespace | `"default"` |

### Architecture

```
$ ai-engine ingest ./documents/ --workdir ./kb --namespace research
         │
         ▼
┌────────────────────────────────────────────────────────────┐
│  ingest() — CLI Orchestration (TypeScript)                  │
│                                                              │
│  1. Parse args: <path>, --workdir, --namespace              │
│  2. Resolve paths to absolute                                │
│  3. Compute storageDir: <workdir>/namespaces/<namespace>/   │
│  4. Create storageDir if it doesn't exist                    │
│  5. Collect text files:                                      │
│     ├─ Single file → validate extension → read content       │
│     └─ Directory → recursive walk:                           │
│          ├─ Sort entries by name (localeCompare)             │
│          ├─ Skip dotfiles                                    │
│          ├─ Filter by text file extension                    │
│          └─ Recurse into subdirectories                      │
│  6. Send documents to Python knowledge_store.py via stdin    │
│  7. Print: 'Indexed X documents, Y chunks into namespace    │
│     "<namespace>"'                                           │
└──────────────────────────┬─────────────────────────────────┘
                           │ spawn python3 + JSON stdin
              ┌────────────▼─────────────────────────────┐
              │  knowledge_store.py — Vector Logic         │
              │                                            │
              │  1. Receive { operation: "ingest",          │
              │     storageDir, namespace, documents }      │
              │  2. Instantiate LLMProvider via factory     │
              │  3. Create FaissVectorStore(storageDir)     │
              │  4. Load existing index (if any)            │
              │  5. For each document:                      │
              │     a. Split content into ~500-char chunks  │
              │     b. Embed each chunk via provider.embed()│
              │     c. Add chunks + embeddings to store     │
              │  6. Persist updated index to disk            │
              │  7. Return { documents, chunks } counts      │
              └────────────────────────────────────────────┘
                           │
              ┌────────────▼──────────────────────────────────┐
              │  Disk (<workdir>/namespaces/<namespace>/)       │
              │  ├── index.faiss  (FAISS binary)               │
              │  └── chunks.json  (JSON array)                 │
              └────────────────────────────────────────────────┘
```

### Supported Text File Extensions

```
Documents:   .txt  .md  .csv  .json  .xml  .html  .htm  .log
Config:      .yaml .yml .toml .ini  .cfg  .conf
Code:        .ts  .js  .py  .java .c   .cpp .h   .hpp .rs  .go
             .rb  .php .sh  .bash .zsh .css .scss .less .sql
             .r   .m   .swift .kt .scala .ex .exs .erl .hs .lua
             .pl  .pm
Markup:      .tex .rst .adoc .org
```

### Ingestion Lifecycle

```
First ingest:                        Second ingest:
─────────────                        ──────────────
1. No index on disk                  1. Load existing index.faiss
2. Collect 3 files (8 chunks)            + chunks.json (8 chunks)
3. Embed 8 chunks via Ollama         2. Collect 2 new files (5 chunks)
4. Create new FAISS index            3. Embed 5 new chunks
5. Persist: index.faiss (8 vecs)     4. Append to existing index
   + chunks.json (8 entries)         5. Persist: index.faiss (13 vecs)
                                        + chunks.json (13 entries)
```

### Prerequisites

```bash
# Ollama running with embedding model
ollama serve
ollama pull nomic-embed-text

# Python dependencies
pip install requests numpy faiss-cpu
```

### Step-by-Step Usage

**1. Ingest a single file (default namespace):**

```bash
ai-engine ingest report.txt --workdir ./knowledge-base
# Output: Indexed 1 documents, 3 chunks into namespace "default"
```

**2. Ingest into a named namespace:**

```bash
ai-engine ingest ./research-papers/ --workdir ./knowledge-base --namespace research
# Output: Indexed 12 documents, 47 chunks into namespace "research"
```

**3. Ingest more files later (accumulative within namespace):**

```bash
ai-engine ingest ./more-papers/ --workdir ./knowledge-base --namespace research
# Output: Indexed 5 documents, 18 chunks into namespace "research"
# Total "research" index now: 65 chunks (47 + 18)
```

**4. Ingest into a separate namespace (isolated from "research"):**

```bash
ai-engine ingest ./meeting-notes/ --workdir ./knowledge-base --namespace meetings
# Output: Indexed 3 documents, 12 chunks into namespace "meetings"
```

**5. Verify namespace directory structure:**

```bash
ls ./knowledge-base/namespaces/
# → default/  research/  meetings/

ls ./knowledge-base/namespaces/research/
# → index.faiss  chunks.json
```

**6. Use OpenAI for embeddings instead of Ollama:**

```bash
LLM_PROVIDER=openai OPENAI_API_KEY=sk-... \
  ai-engine ingest ./docs/ --workdir ./kb --namespace cloud-indexed
```

### Error Handling

| Scenario | Error |
|----------|-------|
| Path does not exist | `ENOENT: no such file or directory` |
| Non-text file passed | `Not a recognized text file: /path/to/file.bin` |
| No text files found | `No text files found to ingest` (info, not error) |
| Ollama not running | `Cannot reach Ollama at http://localhost:11434/api/embeddings. Is it running?` |
| Unknown LLM provider | `Unknown LLM provider 'foo'. Supported providers: ollama, openai` |
| Missing OpenAI key | `OpenAI provider requires an API key. Set the OPENAI_API_KEY environment variable...` |

---

## 17. Feature 14 — Knowledge Base Query Mode

### What It Does
Queries a previously-ingested FAISS knowledge base with a natural language question.
Embeds the question, retrieves the top-5 most relevant chunks via cosine similarity,
builds a RAG prompt, and generates an answer using Ollama. Supports streaming output.

### Command Details

| Field | Value |
|-------|-------|
| Command | `ai-engine query "<question>" [--namespace <name>]` |
| Location | `packages/cli/src/commands/query.ts` |
| Backend | `plugins/processor-local-faiss-rag/knowledge_store.py` |
| LLM Provider | Pluggable via `LLM_PROVIDER` env var (default: Ollama) |
| Embedding Model | Configurable per provider (default: `nomic-embed-text`) |
| Generation Model | Configurable per provider (default: `mistral`) |
| Top-K Retrieval | 5 chunks |
| Default Namespace | `"default"` |
| Streaming | Supported via `--stream` flag |

### Architecture

```
$ ai-engine query "What are the key design decisions?" --workdir ./kb --namespace research
         │
         ▼
┌────────────────────────────────────────────────────────────┐
│  query() — CLI Orchestration (TypeScript)                   │
│                                                              │
│  1. Parse args: <question>, --workdir, --namespace, --stream│
│  2. Resolve workdir to absolute                              │
│  3. Compute storageDir: <workdir>/namespaces/<namespace>/   │
│  4. Send query to Python knowledge_store.py via stdin        │
│  5. If --stream: pipe stdout tokens directly to console      │
│     If no stream: parse JSON result, print answer            │
└──────────────────────────┬─────────────────────────────────┘
                           │ spawn python3 + JSON stdin
              ┌────────────▼─────────────────────────────────┐
              │  knowledge_store.py — Query Logic               │
              │                                                 │
              │  1. Receive { operation: "query",                │
              │     storageDir, namespace, question, stream }    │
              │  2. Verify index.faiss + chunks.json exist       │
              │     └─ If missing: FileNotFoundError with        │
              │        namespace name in error message            │
              │  3. Instantiate LLMProvider via factory           │
              │  4. Load FaissVectorStore from disk               │
              │  5. Embed question via provider.embed()           │
              │  6. Search index → top-5 most similar chunks      │
              │  7. Build prompt:                                 │
              │     "Using the context below, answer the         │
              │      question:                                   │
              │                                                  │
              │      Question: <question>                        │
              │                                                  │
              │      Context:                                    │
              │      <chunk 1>                                   │
              │                                                  │
              │      <chunk 2>                                   │
              │      ..."                                        │
              │  8. Generate answer via provider.generate()       │
              └──────────────────────────────────────────────────┘
                           │
              ┌────────────▼──────────────────────┐
              │  LLMProvider                        │
              │  (Ollama or OpenAI, resolved from   │
              │   LLM_PROVIDER env var)              │
              └─────────────────────────────────────┘
```

### RAG Prompt Template

```
Using the context below, answer the question:

Question: <user's question>

Context:
<chunk 1>

<chunk 2>

<chunk 3>

<chunk 4>

<chunk 5>
```

### Streaming vs Non-Streaming

```
Non-streaming (default):                Streaming (--stream):
────────────────────────                ─────────────────────
1. Ollama generates full response       1. Ollama streams tokens
2. Python returns JSON to TypeScript    2. Python writes tokens to stdout
3. TypeScript parses JSON               3. TypeScript pipes stdout to console
4. Prints complete answer               4. Tokens appear as generated

Pros: Clean JSON protocol               Pros: Real-time output, lower
Cons: Wait for full response             perceived latency
                                        Cons: No structured JSON return
```

### Prerequisites

```bash
# Ollama running with both models
ollama serve
ollama pull mistral            # For generation
ollama pull nomic-embed-text   # For embeddings

# Python dependencies
pip install requests numpy faiss-cpu

# A previously ingested knowledge base
ai-engine ingest ./docs/ --workdir ./knowledge-base
```

### Step-by-Step Usage

**1. Query the default namespace:**

```bash
ai-engine query "What are the main features?" --workdir ./knowledge-base
```

**2. Query a specific namespace:**

```bash
ai-engine query "What are the main findings?" --workdir ./knowledge-base --namespace research
```

**3. Query with streaming:**

```bash
ai-engine query "Explain the architecture" --workdir ./knowledge-base --namespace research --stream
```

**4. Full workflow (ingest + query with namespaces):**

```bash
# Step 1: Build namespaced knowledge bases
ai-engine ingest ./project-docs/ --workdir ./kb --namespace codebase
# Output: Indexed 15 documents, 62 chunks into namespace "codebase"

ai-engine ingest ./meeting-notes/ --workdir ./kb --namespace meetings
# Output: Indexed 8 documents, 34 chunks into namespace "meetings"

# Step 2: Query each namespace independently
ai-engine query "What database does the project use?" --workdir ./kb --namespace codebase
ai-engine query "What was discussed last Friday?" --workdir ./kb --namespace meetings
```

**5. Use OpenAI instead of Ollama:**

```bash
LLM_PROVIDER=openai OPENAI_API_KEY=sk-... \
  ai-engine query "Summarize the key decisions" --workdir ./kb --namespace codebase
```

### Error Handling

| Scenario | Error |
|----------|-------|
| No index for namespace | `No FAISS index found for namespace 'research'. Run 'ai-engine ingest <path> --namespace research' first.` |
| Ollama not running | `Cannot reach Ollama at http://localhost:11434/api/embeddings. Is it running?` |
| Empty retrieval results | `Vector store retrieval returned no valid chunks` |
| No question provided | `Usage: ai-engine query "<question>" [--workdir <path>] [--namespace <name>] [--stream]` |
| Unknown LLM provider | `Unknown LLM provider 'foo'. Supported providers: ollama, openai` |

### Knowledge Store Python Script

The `knowledge_store.py` script (`plugins/processor-local-faiss-rag/knowledge_store.py`)
is the shared backend for both `ingest` and `query`. It follows the same stdin/stdout
JSON protocol used by the existing Python processor bridge:

```
TypeScript                         Python
─────────                          ──────
{ operation, storageDir,     ──→   stdin (JSON)
  namespace,                       knowledge_store.py dispatches
  documents | question,            to ingest_documents() or query_index()
  stream }                         LLMProvider resolved from LLM_PROVIDER env
                               ←── stdout (JSON result or stream tokens)
                               ←── stderr (JSON error on failure)
```

This script reuses the existing `FaissVectorStore` from `vector_store.py`
and delegates all LLM calls to the pluggable `LLMProvider` from
`plugins/shared/providers/`, maintaining clean separation between CLI
orchestration, vector logic, and LLM backend.

---

## 18. Feature 15 — LLM Provider Abstraction Layer

### What It Does
Decouples all LLM calls (text generation and embeddings) from specific backends.
The RAG plugin and knowledge store no longer contain direct HTTP calls to Ollama.
Instead, they call `provider.generate()` and `provider.embed()` on an abstract
`LLMProvider` interface. Switching from Ollama to OpenAI requires only an
environment variable change — no code changes.

### Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│              plugins/shared/providers/                              │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    LLMProvider (ABC)                          │ │
│  │                                                              │ │
│  │  @abstractmethod generate(prompt: str) -> str                │ │
│  │  @abstractmethod embed(text: str) -> list[float]             │ │
│  └──────────────────────┬───────────────────────────────────────┘ │
│                          │ implements                              │
│            ┌─────────────┼─────────────────┐                      │
│            │                               │                      │
│  ┌─────────▼──────────┐        ┌───────────▼──────────┐          │
│  │  OllamaProvider    │        │  OpenAIProvider       │          │
│  │                    │        │                       │          │
│  │  POST /api/generate│        │  chat.completions     │          │
│  │  POST /api/embed.. │        │  embeddings.create    │          │
│  │                    │        │                       │          │
│  │  Configurable:     │        │  Configurable:        │          │
│  │  - base_url        │        │  - api_key            │          │
│  │  - generation_model│        │  - generation_model   │          │
│  │  - embedding_model │        │  - embedding_model    │          │
│  └────────────────────┘        └───────────────────────┘          │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                   create_provider() factory                   │ │
│  │                                                              │ │
│  │  Resolves provider from:                                     │ │
│  │    1. Explicit argument                                      │ │
│  │    2. LLM_PROVIDER env var                                   │ │
│  │    3. Default: "ollama"                                      │ │
│  │                                                              │ │
│  │  Reads model/URL config from environment variables           │ │
│  └──────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
                            │
          Used by:          │
          ├─ processor.py   │ (pipeline-mode RAG)
          └─ knowledge_store.py  (ingest + query CLI)
```

### File Layout

```
plugins/shared/providers/
├── __init__.py          # Exports: LLMProvider, create_provider
├── base_provider.py     # Abstract base class (LLMProvider)
├── ollama_provider.py   # OllamaProvider (HTTP to local Ollama)
├── openai_provider.py   # OpenAIProvider (official OpenAI SDK)
└── factory.py           # create_provider() factory function
```

### LLMProvider Interface

```python
from abc import ABC, abstractmethod

class LLMProvider(ABC):
    @abstractmethod
    def generate(self, prompt: str) -> str:
        """Generate text given a prompt."""

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        """Produce an embedding vector for the given text."""
```

### OllamaProvider

| Aspect | Detail |
|--------|--------|
| Generate endpoint | `POST <base_url>/api/generate` |
| Embed endpoint | `POST <base_url>/api/embeddings` |
| Default base URL | `http://localhost:11434` |
| Default generation model | `mistral` |
| Default embedding model | `nomic-embed-text` |
| Streaming | Disabled (batch mode only) |
| Dependencies | `requests` |

### OpenAIProvider

| Aspect | Detail |
|--------|--------|
| Generate method | `client.chat.completions.create()` |
| Embed method | `client.embeddings.create()` |
| API key | Required via `OPENAI_API_KEY` env var or constructor |
| Default generation model | `gpt-4o-mini` |
| Default embedding model | `text-embedding-3-small` |
| Dependencies | `openai` (official SDK) |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | Provider to use (`ollama` or `openai`) | `ollama` |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |
| `OLLAMA_GENERATION_MODEL` | Ollama generation model | `mistral` |
| `OLLAMA_EMBEDDING_MODEL` | Ollama embedding model | `nomic-embed-text` |
| `OPENAI_API_KEY` | OpenAI API key (required for OpenAI) | — |
| `OPENAI_GENERATION_MODEL` | OpenAI chat model | `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | OpenAI embedding model | `text-embedding-3-small` |

### Step-by-Step Usage

**1. Default (Ollama, no changes needed):**

```bash
# Uses Ollama at localhost:11434 with mistral + nomic-embed-text
ai-engine ingest ./docs/ --workdir ./kb
ai-engine query "What is this about?" --workdir ./kb
```

**2. Switch to OpenAI:**

```bash
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-your-key-here

ai-engine ingest ./docs/ --workdir ./kb
ai-engine query "What is this about?" --workdir ./kb
```

**3. Use a remote Ollama instance with a different model:**

```bash
export OLLAMA_BASE_URL=http://192.168.1.50:11434
export OLLAMA_GENERATION_MODEL=llama3
export OLLAMA_EMBEDDING_MODEL=mxbai-embed-large

ai-engine ingest ./docs/ --workdir ./kb
```

**4. Use OpenAI with specific models:**

```bash
LLM_PROVIDER=openai \
OPENAI_API_KEY=sk-... \
OPENAI_GENERATION_MODEL=gpt-4o \
OPENAI_EMBEDDING_MODEL=text-embedding-3-large \
  ai-engine query "Summarize the project" --workdir ./kb
```

### Error Handling

| Scenario | Error |
|----------|-------|
| Unknown provider name | `Unknown LLM provider 'foo'. Supported providers: ollama, openai` |
| OpenAI key missing | `OpenAI provider requires an API key. Set the OPENAI_API_KEY environment variable or pass api_key explicitly.` |
| `openai` package not installed | `The 'openai' package is required for the OpenAI provider. Install it with: pip install openai` |
| Ollama unreachable | `Cannot reach Ollama at http://localhost:11434/api/generate. Is it running?` |
| OpenAI API error | `OpenAI chat completion failed: <error detail>` |

### Design Decisions

- **No LangChain** — providers use direct HTTP (`requests`) or the official SDK (`openai`)
- **No global state** — each provider is instantiated per invocation via the factory
- **Lazy imports** — `openai` package is only imported when the OpenAI provider is selected
- **Plugin-layer only** — `packages/core`, pipeline runner, and CLI are untouched
- **Extensible** — adding a new provider requires one file + a factory branch

---

## 19. Feature 16 — Namespace Isolation

### What It Does
Allows multiple independent knowledge bases within a single working directory.
Each namespace has its own FAISS index and chunk metadata, completely isolated
from other namespaces. This enables use cases like separate indexes for different
document collections (e.g., meetings, research, codebase) without file conflicts.

### Architecture

```
$ ai-engine ingest ./docs/ --workdir ./kb --namespace research
$ ai-engine ingest ./notes/ --workdir ./kb --namespace meetings
$ ai-engine query "..." --workdir ./kb --namespace research

         │
         ▼
┌────────────────────────────────────────────────────────────┐
│  CLI (ingest.ts / query.ts)                                  │
│                                                              │
│  1. Parse --namespace flag (default: "default")              │
│  2. Compute storage path:                                    │
│     storageDir = <workdir>/namespaces/<namespace>/           │
│  3. Pass storageDir + namespace name to knowledge_store.py   │
└──────────────────────────┬─────────────────────────────────┘
                           │
              ┌────────────▼─────────────────────────────┐
              │  knowledge_store.py                        │
              │                                            │
              │  ingest: os.makedirs(storageDir) on write  │
              │  query: clear error if namespace missing    │
              └────────────────────────────────────────────┘
                           │
              ┌────────────▼──────────────────────────────┐
              │  Disk Layout:                               │
              │                                             │
              │  <workdir>/                                 │
              │  └── namespaces/                            │
              │      ├── default/                           │
              │      │   ├── index.faiss                    │
              │      │   └── chunks.json                    │
              │      ├── research/                          │
              │      │   ├── index.faiss                    │
              │      │   └── chunks.json                    │
              │      └── meetings/                          │
              │          ├── index.faiss                    │
              │          └── chunks.json                    │
              └─────────────────────────────────────────────┘
```

### CLI Flags

| Flag | Commands | Default | Description |
|------|----------|---------|-------------|
| `--namespace <name>` | `ingest`, `query` | `"default"` | Isolate index to a named namespace |

### Storage Path Resolution

```
storageDir = path.join(workdir, "namespaces", namespace)
```

Examples:
| workdir | namespace | storageDir |
|---------|-----------|------------|
| `./kb` | (none) | `./kb/namespaces/default/` |
| `./kb` | `research` | `./kb/namespaces/research/` |
| `./kb` | `meetings` | `./kb/namespaces/meetings/` |
| `/data/ai` | `prod-v2` | `/data/ai/namespaces/prod-v2/` |

### Backward Compatibility

When no `--namespace` flag is provided, the default namespace `"default"` is used.
This means all existing workflows continue to work without modification — the only
visible change is that index files now live under `<workdir>/namespaces/default/`
instead of directly in `<workdir>/`.

### Step-by-Step Usage

**1. Ingest into separate namespaces:**

```bash
# Research papers
ai-engine ingest ./research-papers/ --workdir ./kb --namespace research
# Output: Indexed 12 documents, 47 chunks into namespace "research"

# Meeting notes
ai-engine ingest ./meeting-notes/ --workdir ./kb --namespace meetings
# Output: Indexed 8 documents, 34 chunks into namespace "meetings"

# Project codebase
ai-engine ingest ./src/ --workdir ./kb --namespace codebase
# Output: Indexed 25 documents, 120 chunks into namespace "codebase"
```

**2. Query specific namespaces:**

```bash
ai-engine query "What are the main findings?" --workdir ./kb --namespace research
ai-engine query "What was decided last Friday?" --workdir ./kb --namespace meetings
ai-engine query "How does authentication work?" --workdir ./kb --namespace codebase
```

**3. Default namespace (backward compatible):**

```bash
# These two are equivalent:
ai-engine ingest ./docs/ --workdir ./kb
ai-engine ingest ./docs/ --workdir ./kb --namespace default

# And these two are equivalent:
ai-engine query "What is this?" --workdir ./kb
ai-engine query "What is this?" --workdir ./kb --namespace default
```

**4. Accumulate within a namespace:**

```bash
# First batch
ai-engine ingest ./papers-2025/ --workdir ./kb --namespace research
# Output: Indexed 5 documents, 20 chunks into namespace "research"

# Second batch (appends to same namespace)
ai-engine ingest ./papers-2026/ --workdir ./kb --namespace research
# Output: Indexed 3 documents, 15 chunks into namespace "research"
# Total "research" index: 35 chunks
```

**5. Inspect namespace storage:**

```bash
ls ./kb/namespaces/
# → codebase/  default/  meetings/  research/

ls ./kb/namespaces/research/
# → index.faiss  chunks.json
```

### Error Handling

| Scenario | Error |
|----------|-------|
| Query non-existent namespace | `No FAISS index found for namespace 'finance'. Run 'ai-engine ingest <path> --namespace finance' first.` |
| Missing --namespace value | `--namespace requires a name argument` |

### Design Decisions

- **CLI-layer resolution** — the namespace path is computed in TypeScript, Python receives a flat `storageDir`
- **No namespace registry** — namespaces are just directories, no metadata to manage
- **Automatic creation** — `ingest` creates the namespace directory; `query` expects it to exist
- **No cross-namespace queries** — each query targets exactly one namespace (keeps behavior deterministic)

---

## 20. Feature 17 — Knowledge Bridge (Runtime)

### What It Does

Provides a shared programmatic interface for FAISS knowledge-store operations.
Before this module, the Python subprocess bridge was embedded directly in the
CLI commands. Now both the CLI and the API service import from
`packages/runtime/src/knowledge/knowledge-bridge.ts`.

### Architecture

```
CLI (ingest/query/namespaces)          API Service (routes.ts)
         │                                      │
         └──────────┬───────────────────────────┘
                    │
         ┌──────────▼──────────────────────────────┐
         │  @ai-engine/runtime — knowledge bridge   │
         │                                          │
         │  ingestDocuments()  ─┐                   │
         │  queryKnowledgeBase()├─ spawn python3    │
         │  listNamespaces()   ─┘  knowledge_store  │
         └──────────────────────────────────────────┘
                    │
         ┌──────────▼──────────────────────────────┐
         │  plugins/processor-local-faiss-rag/      │
         │  knowledge_store.py                      │
         │  vector_store.py                         │
         │  plugins/shared/providers/               │
         └──────────────────────────────────────────┘
```

### Key Functions

**`ingestDocuments(params: IngestParams): Promise<IngestResult>`**

Sends `{ operation: "ingest", documents, storageDir, namespace }` to
`knowledge_store.py` via stdin. Returns `{ documents, chunks }` counts.

**`queryKnowledgeBase(params: QueryParams): Promise<QueryResult>`**

Sends `{ operation: "query", question, storageDir, namespace, stream }` to
`knowledge_store.py`. Supports streaming via `onChunk` callback. Returns
`{ answer }`.

**`listNamespaces(workdir: string): Promise<string[]>`**

Reads `<workdir>/namespaces/` and returns directory names that contain a
valid `index.faiss` file. Pure filesystem operation — no Python involved.

### Files

| File | Purpose |
|------|---------|
| `packages/runtime/src/knowledge/knowledge-bridge.ts` | Bridge implementation |
| `packages/runtime/src/knowledge/index.ts` | Re-exports |

---

## 21. Feature 18 — API Service with RBAC

### What It Does

Exposes the engine's ingest, query, and namespace-listing functionality over
HTTP with API-key authentication, namespace-based access control, and
append-only audit logging.

### Architecture

```
         HTTP Client
              │
              ▼
     ┌─────────────────────────────────────────────┐
     │  Fastify Server (services/api)               │
     │                                               │
     │  ┌───────────┐  ┌─────────────┐              │
     │  │ Auth Hook  │  │ Audit Hook  │              │
     │  │ (onRequest)│  │ (onResponse)│              │
     │  └─────┬─────┘  └──────┬──────┘              │
     │        │                │                      │
     │  ┌─────▼────────────────▼──────────────────┐  │
     │  │              Routes                      │  │
     │  │  POST /ingest     → ingestDocuments()    │  │
     │  │  POST /query      → queryKnowledgeBase() │  │
     │  │  GET  /namespaces → listNamespaces()     │  │
     │  │  GET  /health     → { status: "ok" }     │  │
     │  └──────────────────────────────────────────┘  │
     └──────────────────────┬──────────────────────────┘
                            │
               ┌────────────▼────────────────┐
               │  @ai-engine/runtime          │
               │  knowledge bridge            │
               └──────────────────────────────┘
```

### Endpoints

**`GET /health`** — No auth required.

```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"2025-01-15T10:30:00.000Z"}
```

**`POST /ingest`** — Requires API key with namespace access.

```bash
curl -X POST http://localhost:3000/ingest \
  -H "Authorization: Bearer legal-team-key" \
  -H "Content-Type: application/json" \
  -d '{"path": "documents/contracts", "namespace": "legal"}'
# → {"documents":5,"chunks":42}
```

**`POST /query`** — Requires API key with namespace access.

```bash
curl -X POST http://localhost:3000/query \
  -H "Authorization: Bearer legal-team-key" \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the payment terms?", "namespace": "legal"}'
# → {"answer":"Based on the contracts..."}
```

Streaming (SSE):

```bash
curl -N -X POST http://localhost:3000/query \
  -H "Authorization: Bearer legal-team-key" \
  -H "Content-Type: application/json" \
  -d '{"question": "Summarize", "namespace": "legal", "stream": true}'
```

**`GET /namespaces`** — Returns only namespaces the key has access to.

```bash
curl http://localhost:3000/namespaces \
  -H "Authorization: Bearer admin-key"
# → {"namespaces":["finance","legal","research"]}
```

### Authentication and RBAC

API keys are stored in `config/api_keys.json`:

```json
{
  "legal-team-key": ["legal"],
  "finance-team-key": ["finance"],
  "admin-key": ["*"]
}
```

- Each key maps to an array of allowed namespace names.
- `["*"]` grants access to all namespaces.
- Missing or invalid key → `401 Unauthorized`.
- Key without access to the requested namespace → `403 Forbidden`.

### Audit Logging

Every authenticated request appends a JSON line to `audit.log`:

```json
{"timestamp":"2025-01-15T10:30:00.000Z","apiKey":"legal-team-key","method":"POST","path":"/query","namespace":"legal","question":"What are the payment terms?","statusCode":200}
```

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server listen port |
| `HOST` | `0.0.0.0` | Server bind address |
| `WORKDIR` | cwd | Data directory for namespaces |
| `API_KEYS_PATH` | `config/api_keys.json` | Path to API keys file |
| `AUDIT_LOG_PATH` | `audit.log` | Path to audit log file |
| `PROVIDER_POLICY_PATH` | — (disabled) | Path to provider routing policy JSON |

### Files

| File | Purpose |
|------|---------|
| `services/api/src/index.ts` | Entry point — reads env config, starts Fastify |
| `services/api/src/server.ts` | Fastify instance, wires hooks and routes |
| `services/api/src/auth.ts` | API-key validation and namespace RBAC |
| `services/api/src/audit.ts` | Append-only JSON-line audit logger |
| `services/api/src/routes.ts` | Route handlers delegating to runtime |
| `services/api/src/provider-policy.ts` | Provider routing policy layer |
| `config/api_keys.example.json` | Example API keys (committed) |
| `config/provider_policy.json` | Provider routing policy (committed) |

---

## 22. Feature 19 — Provider Routing Policy Layer

### What It Does

Adds a policy-driven routing layer to the API service that selects AI providers
(Ollama or OpenAI) per namespace and operation (ingest/query). This enables
hybrid local/cloud execution without modifying core, runtime, or provider code.

The policy is loaded from a JSON config file at startup. For each request the
layer resolves which provider to use, sets the appropriate environment variables
synchronously before the runtime spawns its Python subprocess, then restores
the original env immediately — all before yielding to the event loop.

If a fallback provider is defined and the primary fails, the operation is
retried once with the fallback configuration.

### Architecture

```
         HTTP Client
              │
              ▼
     ┌─────────────────────────────────────────────────────────┐
     │  Fastify Server (services/api)                           │
     │                                                          │
     │  ┌────────────────────────────────────────────────────┐  │
     │  │  Provider Policy Layer (provider-policy.ts)         │  │
     │  │                                                     │  │
     │  │  1. loadProviderPolicy(path)  — startup, validate   │  │
     │  │  2. resolvePolicy(config, ns, op) — per request     │  │
     │  │  3. buildEnvOverrides(policy) — env var mapping      │  │
     │  │  4. withProviderEnv(policy, fn) — sync env wrapper   │  │
     │  │  5. executeWithPolicy(policy, fn) — primary+fallback │  │
     │  └────────────────────────────────────────────────────┘  │
     │                        │                                  │
     │  ┌─────────────────────▼──────────────────────────────┐  │
     │  │              Route Handlers                         │  │
     │  │                                                     │  │
     │  │  POST /ingest  → resolvePolicy(ns, "ingest")        │  │
     │  │                → executeWithPolicy(fn) [fallback OK] │  │
     │  │                                                     │  │
     │  │  POST /query   → resolvePolicy(ns, "query")         │  │
     │  │    non-stream  → executeWithPolicy(fn) [fallback OK] │  │
     │  │    stream      → withProviderEnv(fn) [no fallback]   │  │
     │  └─────────────────────────────────────────────────────┘  │
     │                        │                                  │
     │  ┌─────────────────────▼──────────────────────────────┐  │
     │  │  Audit Hook — logs provider, usedFallback, source   │  │
     │  └─────────────────────────────────────────────────────┘  │
     └──────────────────────────────────────────────────────────┘
                              │
                ┌─────────────▼───────────────────┐
                │  @ai-engine/runtime              │
                │  knowledge bridge (spawn python3) │
                │  inherits process.env at spawn()  │
                └──────────────────────────────────┘
```

### Concurrency-Safe Env Mutation

```
setEnv(overrides)  →  fn() [spawn() captures env synchronously]  →  restoreEnv()  →  await promise
                   └────────── all synchronous, no interleaving ──────────────────┘
```

Node.js is single-threaded. `spawn()` inside the Promise constructor reads
`process.env` synchronously. The three steps before `await` are all synchronous,
so no other request handler can see the temporary env changes.

### Policy Config Format

**File:** `config/provider_policy.json`

```json
{
  "version": "1.0",
  "default": {
    "ingest": {
      "provider": "ollama",
      "models": {},
      "options": {},
      "fallback": null
    },
    "query": {
      "provider": "ollama",
      "models": {},
      "options": {},
      "fallback": null
    }
  },
  "namespaces": {
    "legal": {
      "query": {
        "provider": "openai",
        "models": { "generation": "gpt-4o" },
        "options": {},
        "fallback": {
          "provider": "ollama",
          "models": {},
          "options": {},
          "fallback": null
        }
      }
    }
  }
}
```

Each operation entry has:

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"ollama"` \| `"openai"` | Provider name |
| `models` | `{ generation?, embedding? }` | Optional model overrides |
| `options` | `{ base_url? }` | Optional provider options |
| `fallback` | `OperationPolicy \| null` | Retry config (depth = 1 max) |

### Env Vars Controlled Per Policy

| Policy Field | Env Var Set |
|---|---|
| `provider` | `LLM_PROVIDER` |
| `models.generation` | `OLLAMA_GENERATION_MODEL` or `OPENAI_GENERATION_MODEL` |
| `models.embedding` | `OLLAMA_EMBEDDING_MODEL` or `OPENAI_EMBEDDING_MODEL` |
| `options.base_url` | `OLLAMA_BASE_URL` |

Only defined values are set — undefined values leave existing env vars untouched.
No secrets are stored in the policy file — `OPENAI_API_KEY` stays in `process.env`.

### Audit Log Extension

Every request now includes three additional fields in the audit log:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "apiKey": "legal-team-key",
  "method": "POST",
  "path": "/query",
  "namespace": "legal",
  "question": "What are the payment terms?",
  "statusCode": 200,
  "provider": "openai",
  "usedFallback": false,
  "policySource": "namespace:legal"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `string \| null` | Provider that served the request |
| `usedFallback` | `boolean \| null` | Whether the fallback was triggered |
| `policySource` | `string \| null` | `"default"` or `"namespace:<name>"` |

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PROVIDER_POLICY_PATH` | — (disabled) | Path to policy JSON file |

When unset, the feature is completely disabled and behavior is identical to
the original API service.

### Files

| File | Purpose |
|------|---------|
| `config/provider_policy.json` | Example policy config |
| `services/api/src/provider-policy.ts` | Core module — types, loading, validation, resolution, env mutation, fallback |
| `services/api/src/audit.ts` | Extended audit entry with provider fields |
| `services/api/src/server.ts` | Wires policy loading at startup |
| `services/api/src/index.ts` | Reads `PROVIDER_POLICY_PATH` env var |
| `services/api/src/routes.ts` | Integrates routing into ingest/query handlers |

### Step-by-Step Usage

**1. Start without policy (backward compatible):**

```bash
node services/api/dist/index.js
# Behavior unchanged — uses global env vars
```

**2. Start with a policy:**

```bash
PROVIDER_POLICY_PATH=config/provider_policy.json node services/api/dist/index.js
```

**3. Configure namespace-specific routing:**

Edit `config/provider_policy.json`:
```json
{
  "version": "1.0",
  "default": {
    "ingest": { "provider": "ollama", "models": {}, "options": {}, "fallback": null },
    "query":  { "provider": "ollama", "models": {}, "options": {}, "fallback": null }
  },
  "namespaces": {
    "premium": {
      "query": {
        "provider": "openai",
        "models": { "generation": "gpt-4o" },
        "options": {},
        "fallback": {
          "provider": "ollama",
          "models": {},
          "options": {},
          "fallback": null
        }
      }
    }
  }
}
```

Now `POST /query { "namespace": "premium" }` uses OpenAI, with Ollama as
fallback. All other namespaces use Ollama for both operations.

**4. Verify via audit log:**

```bash
tail -1 audit.log | python3 -m json.tool
```

### Error Handling

| Scenario | Error |
|----------|-------|
| Invalid policy file | Server refuses to start with validation error |
| Unknown provider in policy | `"provider" must be one of: ollama, openai` |
| Nested fallback (depth > 1) | `"fallback.fallback" is not allowed` |
| Missing default section | `Provider policy must include a "default" section` |
| Primary + fallback both fail | Combined error message with both failures |

### Design Decisions

- **Policy is optional** — `null` = no routing, backward compatible
- **No secrets in policy file** — API keys stay in process env
- **Streaming queries skip fallback** — partial SSE data already sent, can't retry
- **Fallback depth = 1** — simple and predictable
- **`withProviderEnv` is synchronous** — env restored before yielding to event loop
- **Policy loaded once at startup** — follows existing pattern, hot-reload is a future enhancement

---

## 23. Feature 20 — Evaluation Harness

### What It Does

Measures retrieval and generation quality of the knowledge base against a
labeled dataset. The `eval` CLI command runs each question through the full
RAG pipeline and reports:

- **Keyword hit rate** — expected keywords found in generated answers
- **Retrieval overlap** — expected source documents found in retrieved chunks
- **Latency** — per-question and average response time
- **Provider comparison** — when multiple providers are used

Human summary is printed to stderr; structured JSON report goes to stdout.

### Architecture

```
$ ai-engine eval --dataset eval.json --namespace research --workdir ./kb
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  eval.ts — CLI Orchestration (TypeScript)                     │
│                                                               │
│  1. Parse args: --dataset, --namespace, --workdir, --source-dir│
│  2. Load + validate JSON dataset                               │
│  3. Spawn eval_runner.py with all questions                    │
│  4. For each case: measure keywords + retrieval overlap        │
│  5. Format summary → stderr                                   │
│  6. Build JSON report → stdout                                 │
└──────────────────────────┬───────────────────────────────────┘
                           │ spawn python3 + JSON stdin
              ┌────────────▼─────────────────────────────────┐
              │  eval_runner.py — Batch Query (Python)         │
              │                                                │
              │  For each question:                            │
              │  1. Embed question via provider.embed()         │
              │  2. Search FAISS index → top-5 chunks           │
              │  3. Build RAG prompt with context               │
              │  4. Generate answer via provider.generate()     │
              │  5. Record latency, chunks, provider            │
              │                                                │
              │  Returns: { results: [...] }                    │
              └────────────────────────────────────────────────┘
                           │
              ┌────────────▼──────────────────────────────────┐
              │  Measurement Layer (TypeScript)                  │
              │                                                 │
              │  measureKeywords():                             │
              │    case-insensitive substring match              │
              │    against expected keywords in answer           │
              │                                                 │
              │  measureRetrieval():                            │
              │    read expected source files from disk          │
              │    check if any retrieved chunk is a substring   │
              │    of the source content                         │
              └─────────────────────────────────────────────────┘
```

### Dataset Format

The dataset is a JSON array where each entry describes one evaluation case:

```json
[
  {
    "question": "What are the key risk factors?",
    "expectedKeywords": ["risk", "liability", "compliance"],
    "expectedSources": ["contract1.txt", "terms.md"]
  },
  {
    "question": "Explain the payment terms",
    "expectedKeywords": ["payment", "invoice", "30 days"],
    "expectedSources": ["contract1.txt"]
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `question` | `string` | Query to send to the RAG pipeline |
| `expectedKeywords` | `string[]` | Keywords expected in the generated answer |
| `expectedSources` | `string[]` | Source filenames expected in retrieved chunks |

### CLI Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--dataset <file>` | Yes | — | Path to evaluation dataset JSON |
| `--namespace <name>` | No | `"default"` | Namespace to evaluate against |
| `--workdir <path>` | No | cwd | Knowledge base working directory |
| `--source-dir <path>` | No | workdir | Directory containing expected source files |

### Output Format

**Human summary (stderr):**

```
========================================================================
  EVALUATION RESULTS
========================================================================

─── Case 1/3 ───
  Question:          What are the key risk factors?
  Provider:          ollama
  Latency:           1234 ms
  Keywords:          2/3 hit  (missed: compliance)
  Retrieval:         2/2 hit

─── Case 2/3 ───
  Question:          Explain the payment terms
  Provider:          ollama
  Latency:           987 ms
  Keywords:          3/3 hit
  Retrieval:         1/1 hit

========================================================================
  SUMMARY
========================================================================
  Questions evaluated:   3
  Retrieval accuracy:    100.0%  (3/3 sources)
  Keyword hit rate:      83.3%  (5/6 keywords)
  Avg latency:           1110 ms
========================================================================
```

**JSON report (stdout):**

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "namespace": "research",
  "dataset": "/path/to/eval.json",
  "cases": [ ... ],
  "summary": {
    "totalQuestions": 3,
    "retrievalAccuracyPct": 100.0,
    "keywordHitRatePct": 83.3,
    "avgLatencyMs": 1110
  }
}
```

### Files

| File | Purpose |
|------|---------|
| `packages/cli/src/commands/eval.ts` | CLI command — orchestration, measurement, reporting |
| `plugins/processor-local-faiss-rag/eval_runner.py` | Python batch query with per-question metrics |

### Step-by-Step Usage

**1. Create a dataset:**

```bash
cat > eval.json << 'EOF'
[
  {
    "question": "What database does the project use?",
    "expectedKeywords": ["postgres", "database"],
    "expectedSources": ["architecture.md"]
  },
  {
    "question": "How does authentication work?",
    "expectedKeywords": ["token", "jwt", "auth"],
    "expectedSources": ["auth.md", "security.md"]
  }
]
EOF
```

**2. Ingest documents (if not already done):**

```bash
ai-engine ingest ./docs/ --workdir ./kb --namespace codebase
```

**3. Run evaluation:**

```bash
ai-engine eval --dataset eval.json --namespace codebase --workdir ./kb --source-dir ./docs/
```

**4. Save JSON report:**

```bash
ai-engine eval --dataset eval.json --namespace codebase --workdir ./kb > report.json
```

**5. Compare providers:**

```bash
# Evaluate with Ollama
LLM_PROVIDER=ollama ai-engine eval --dataset eval.json --namespace codebase --workdir ./kb > ollama-report.json

# Evaluate with OpenAI
LLM_PROVIDER=openai OPENAI_API_KEY=sk-... ai-engine eval --dataset eval.json --namespace codebase --workdir ./kb > openai-report.json
```

### Prerequisites

```bash
# A previously ingested namespace
ai-engine ingest ./docs/ --workdir ./kb --namespace codebase

# Python dependencies (same as FAISS RAG plugin)
pip install requests numpy faiss-cpu

# Ollama or OpenAI configured
```

### Error Handling

| Scenario | Error |
|----------|-------|
| Missing `--dataset` flag | Usage message with required flags |
| Empty dataset | `Evaluation dataset is empty` |
| Invalid dataset entry | `Dataset entry [N]: "question" must be a non-empty string` |
| No FAISS index for namespace | `No FAISS index found for namespace 'X'. Run 'ai-engine ingest...' first.` |
| Source file not found | Counted as retrieval miss (does not fail the run) |

---

## 24. Feature 21 — Proposal Generator Processor Plugin

### What It Does

Generates structured, multi-section business proposals. The plugin reads
source documents from a working directory, optionally retrieves context
from a FAISS knowledge base (RAG), and generates each section via the
configured LLM provider.

**Key capabilities (v2):**
- **YAML template system** — customizable section definitions
- **Versioned output** — auto-incrementing `_v1`, `_v2`, etc. (unless `--overwrite`)
- **Deterministic pricing** — bypasses LLM when team-size, duration, and rate are provided
- **Per-section retry** — failed sections retry once before giving up
- **Atomic writes** — temp file + rename prevents partial output

### Architecture

```
$ ai-engine generate-proposal --client "Acme Corp" --industry "Finance" \
    --namespace acme --template default --team-size 5 --duration-weeks 12 --rate-per-week 2500
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  generate-proposal.ts — CLI (TypeScript)                      │
│                                                               │
│  1. Parse 11 CLI flags                                        │
│  2. Validate pricing (all three or none)                      │
│  3. Build JSON payload                                        │
│  4. Spawn processor.py                                        │
│  5. Report metadata: sections, sources, version, pricing mode │
└──────────────────────────┬───────────────────────────────────┘
                           │ spawn python3 + JSON stdin
              ┌────────────▼──────────────────────────────────────┐
              │  processor.py — Proposal Engine (Python)            │
              │                                                    │
              │  1. Load YAML template (or built-in default)       │
              │  2. Read source documents from workdir (*.txt, etc.)│
              │  3. Optionally query FAISS namespace for context    │
              │  4. For each section in template:                   │
              │     a. Build prompt with instruction + context       │
              │     b. If pricing section + deterministic → compute │
              │     c. Generate via provider.generate()              │
              │     d. On failure: retry once (MAX_RETRIES = 1)     │
              │  5. Resolve output path with versioning             │
              │  6. Atomic write: tempfile → rename                 │
              │  7. Return Document JSON to stdout                  │
              └────────────────────────────────────────────────────┘
                           │
              ┌────────────▼──────────────────────────────────────┐
              │  LLMProvider (Ollama or OpenAI)                      │
              │  FaissVectorStore (optional, for RAG context)        │
              └─────────────────────────────────────────────────────┘
```

### Template System

Templates are YAML files that define the sections to generate:

**File:** `plugins/processor-proposal-generator/templates/default.yaml`

```yaml
name: default
version: "2.0"
description: Standard enterprise proposal template

sections:
  - title: "Executive Summary"
    query: "executive summary overview of the engagement scope"
    instruction: >
      Write a concise Executive Summary for a proposal to {client}
      in the {industry} industry. Summarise the engagement scope,
      key objectives, and value proposition.

  - title: "Understanding of Requirements"
    query: "client requirements needs challenges"
    instruction: >
      Write the 'Understanding of Requirements' section...

  # ... 9 sections total in the default template
```

Each section has:

| Field | Description |
|-------|-------------|
| `title` | Section heading in the output Markdown |
| `query` | Used for FAISS retrieval (when namespace is provided) |
| `instruction` | LLM prompt with `{client}` and `{industry}` placeholders |

Custom templates can be placed in any directory and referenced via
`--template <name> --template-dir <path>`.

### Default Template Sections

1. Executive Summary
2. Understanding of Requirements
3. Proposed Solution
4. Scope of Work
5. Implementation Plan
6. Timeline
7. Pricing & Commercials
8. Risk & Compliance Considerations
9. Next Steps

### Versioned Output

```
output/
├── proposal_acme-corp.md          # --overwrite mode
├── proposal_acme-corp_v1.md       # first run (default)
├── proposal_acme-corp_v2.md       # second run
└── proposal_acme-corp_v3.md       # third run
```

The version scanner uses regex to find existing `_v<N>.md` files and
auto-increments. When `--overwrite` is set, no version suffix is added.

### Deterministic Pricing

When all three pricing flags are provided (`--team-size`, `--duration-weeks`,
`--rate-per-week`), the "Pricing & Commercials" section bypasses the LLM
entirely and generates a deterministic pricing table:

```markdown
## Pricing & Commercials

| Item | Detail |
|------|--------|
| Team Size | 5 people |
| Duration | 12 weeks |
| Rate per Person-Week | $2,500.00 |
| **Total Engagement Cost** | **$150,000.00** |

> Pricing is based on a fixed-scope engagement.
```

When any pricing flag is missing, all sections (including pricing) are
generated by the LLM.

### CLI Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--client <name>` | Yes | — | Client name for the proposal |
| `--industry <name>` | No | `"General"` | Industry context |
| `--workdir <path>` | No | cwd | Source documents directory |
| `--output-dir <path>` | No | `<workdir>/output` | Output directory |
| `--namespace <name>` | No | — | FAISS namespace for RAG context |
| `--template <name>` | No | `"default"` | Template name |
| `--template-dir <path>` | No | built-in | Directory containing template YAML files |
| `--overwrite` | No | `false` | Skip versioning, overwrite existing file |
| `--team-size <n>` | No | — | Team size for deterministic pricing |
| `--duration-weeks <n>` | No | — | Engagement duration in weeks |
| `--rate-per-week <n>` | No | — | Rate per person per week |

### Pipeline Integration

The plugin also works via pipeline YAML:

```yaml
name: proposal-pipeline
version: "1.0"
steps:
  - type: process
    ref: proposal-generator
    config:
      client: "Acme Corp"
      industry: "Financial Services"
      namespace: "acme"
      template: "default"
      pricing:
        teamSize: 5
        durationWeeks: 12
        ratePerWeek: 2500
```

### Output Metadata

The processor returns a Document with metadata:

```json
{
  "type": "proposal",
  "source": "proposal-generator",
  "content": "# Proposal for Acme Corp\n\n## Executive Summary\n...",
  "metadata": {
    "client": "Acme Corp",
    "industry": "Finance",
    "sections": 9,
    "source_documents": 5,
    "retrieval_mode": "faiss",
    "pricing_mode": "deterministic",
    "template": "default",
    "template_version": "2.0",
    "version": 3,
    "overwrite": false,
    "retried_sections": [],
    "output_path": "/path/to/proposal_acme-corp_v3.md",
    "processor_version": "2.0"
  },
  "createdAt": "2025-01-15T10:30:00.000Z"
}
```

### Files

| File | Purpose |
|------|---------|
| `plugins/processor-proposal-generator/plugin.json` | Plugin manifest |
| `plugins/processor-proposal-generator/package.json` | Package config |
| `plugins/processor-proposal-generator/tsconfig.json` | TypeScript config |
| `plugins/processor-proposal-generator/src/index.ts` | TS wrapper + pipeline integration |
| `plugins/processor-proposal-generator/processor.py` | Python engine (v2) |
| `plugins/processor-proposal-generator/templates/default.yaml` | Default 9-section template |
| `packages/cli/src/commands/generate-proposal.ts` | CLI command |

### Step-by-Step Usage

**1. Basic proposal generation:**

```bash
ai-engine generate-proposal --client "Acme Corp" --industry "Technology"
```

**2. With RAG context from an ingested namespace:**

```bash
# First ingest relevant documents
ai-engine ingest ./rfp-documents/ --workdir ./kb --namespace acme

# Generate proposal using RAG context
ai-engine generate-proposal \
  --client "Acme Corp" \
  --industry "Technology" \
  --namespace acme \
  --workdir ./kb
```

**3. With deterministic pricing:**

```bash
ai-engine generate-proposal \
  --client "Acme Corp" \
  --industry "Finance" \
  --team-size 5 \
  --duration-weeks 12 \
  --rate-per-week 2500
```

**4. Custom template with versioning disabled:**

```bash
ai-engine generate-proposal \
  --client "Acme Corp" \
  --industry "Healthcare" \
  --template healthcare \
  --template-dir ./my-templates/ \
  --overwrite
```

**5. Full workflow with all options:**

```bash
ai-engine generate-proposal \
  --client "Acme Corp" \
  --industry "Financial Services" \
  --workdir ./project-docs \
  --output-dir ./proposals \
  --namespace acme \
  --template default \
  --team-size 8 \
  --duration-weeks 16 \
  --rate-per-week 3000
```

### Prerequisites

```bash
# Python dependencies
pip install requests numpy faiss-cpu pyyaml

# Ollama running (or set LLM_PROVIDER=openai)
ollama serve
ollama pull mistral
ollama pull nomic-embed-text  # Only if using --namespace (RAG)
```

### Error Handling

| Scenario | Error |
|----------|-------|
| Missing `--client` flag | Usage message |
| Partial pricing flags | `Deterministic pricing requires all three flags: --team-size, --duration-weeks, --rate-per-week` |
| Template not found | `Template '<name>' not found in <path>` |
| Section generation failure after retry | Section included in `retried_sections` metadata |
| FAISS index not found for namespace | `No FAISS index found for namespace 'X'` |
| Invalid team-size / duration / rate | `--team-size must be a positive integer` |

### Design Decisions

- **Plugin, not core** — proposal generation is domain-specific, lives in `plugins/`
- **Python engine** — reuses existing provider and vector store infrastructure
- **YAML templates** — declarative, easy to customize without code changes
- **Deterministic pricing** — avoids LLM hallucination for financial figures
- **Atomic writes** — tempfile + rename prevents partial output on failure
- **Version = 1 retry** — balances reliability vs. excessive retries
- **Pipeline + CLI dual mode** — usable both as standalone command and pipeline step

---

## 25. Pipeline Examples

### Example 1: Generic Document Processing

**File:** `examples/generic-documents/pipeline.yaml`

```yaml
name: generic-documents
version: "1.0"
steps:
  - type: extract
    ref: pdf-extractor
  - type: process
    ref: summarizer
  - type: export
    ref: json-exporter
```

**Run:**

```bash
ai-engine run examples/generic-documents/pipeline.yaml input.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-summarize \
  --plugins plugins/exporter-json
```

**What happens:**
1. PDF bytes → text extraction
2. Text → appends `[processed]` marker
3. Document → pretty-printed JSON file

---

### Example 2: Local AI Summarization

```yaml
name: local-ai-summarize
version: "1.0"
steps:
  - type: extract
    ref: pdf-extractor
  - type: process
    ref: local-ollama
  - type: export
    ref: json-exporter
```

**Run:**

```bash
ollama serve &
ai-engine run local-ai-pipeline.yaml report.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-local-ollama \
  --plugins plugins/exporter-json
```

**What happens:**
1. PDF → text extraction
2. Full text sent to local Mistral → 5-bullet summary
3. Summary → JSON output

---

### Example 3: RAG with Persistent Memory

```yaml
name: persistent-rag-knowledge
version: "1.0"
steps:
  - type: extract
    ref: pdf-extractor
  - type: process
    ref: local-faiss-rag
  - type: export
    ref: json-exporter
```

**Run (building knowledge over time):**

```bash
# Day 1: Process company handbook
ai-engine run rag.yaml handbook.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-local-faiss-rag \
  --plugins plugins/exporter-json \
  --workdir ./knowledge-base

# Day 2: Process meeting notes (searches across handbook + notes)
ai-engine run rag.yaml meeting-notes.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-local-faiss-rag \
  --plugins plugins/exporter-json \
  --workdir ./knowledge-base

# Day 3: Process quarterly report (searches across all 3 documents)
ai-engine run rag.yaml q4-report.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-local-faiss-rag \
  --plugins plugins/exporter-json \
  --workdir ./knowledge-base
```

---

### Example 4: Knowledge Base with Namespaces

**Build isolated knowledge bases and query them independently:**

```bash
# Ingest project docs into the "codebase" namespace
ai-engine ingest ./project-docs/ --workdir ./kb --namespace codebase
# Output: Indexed 8 documents, 34 chunks into namespace "codebase"

# Ingest meeting notes into a separate "meetings" namespace
ai-engine ingest ./meeting-notes/ --workdir ./kb --namespace meetings
# Output: Indexed 3 documents, 12 chunks into namespace "meetings"

# Query each namespace independently
ai-engine query "What are the key design decisions?" --workdir ./kb --namespace codebase
ai-engine query "What was discussed last Friday?" --workdir ./kb --namespace meetings

# Query with streaming
ai-engine query "Summarize the architecture" --workdir ./kb --namespace codebase --stream

# Accumulate more docs into an existing namespace
ai-engine ingest ./more-docs/ --workdir ./kb --namespace codebase
# Output: Indexed 5 documents, 20 chunks into namespace "codebase"
# Total "codebase" index: 54 chunks (34 + 20)
```

**What happens:**
1. Ingest: text files collected recursively, chunked, embedded, stored in namespace-isolated FAISS index
2. Query: question embedded, top-5 chunks retrieved from the target namespace, RAG prompt built, answer generated
3. Namespaces are independent — `codebase` and `meetings` never mix
4. Subsequent ingests to the same namespace append to its existing index

---

### Example 5: Using OpenAI Instead of Ollama

**Switch the LLM provider without changing any code:**

```bash
# Set provider to OpenAI
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-your-key-here

# Ingest using OpenAI embeddings
ai-engine ingest ./docs/ --workdir ./kb --namespace cloud-indexed
# Output: Indexed 10 documents, 42 chunks into namespace "cloud-indexed"

# Query using OpenAI for both embedding and generation
ai-engine query "What are the main themes?" --workdir ./kb --namespace cloud-indexed
```

**What happens:**
1. `create_provider()` reads `LLM_PROVIDER=openai` and instantiates `OpenAIProvider`
2. Embeddings use `text-embedding-3-small` via the OpenAI API
3. Generation uses `gpt-4o-mini` via the OpenAI API
4. FAISS storage and retrieval work identically regardless of provider

---

### Example 6: Cloud AI with LangChain

```yaml
name: cloud-ai-summarize
version: "1.0"
steps:
  - type: extract
    ref: pdf-extractor
  - type: process
    ref: langchain-summarizer
  - type: export
    ref: json-exporter
```

**Run:**

```bash
export OPENAI_API_KEY="sk-..."
ai-engine run cloud-pipeline.yaml document.pdf \
  --plugins plugins/extractor-pdf \
  --plugins plugins/processor-langchain-summarize \
  --plugins plugins/exporter-json
```

---

## 26. Error Handling Architecture

### Error Hierarchy

```
Error
 ├── PipelineValidationError    (packages/core)
 │   Codes: INVALID_TOP_LEVEL, MISSING_FIELD, INVALID_FIELD_TYPE,
 │          UNKNOWN_FIELD, EMPTY_STEPS, INVALID_STEP_TYPE,
 │          EMPTY_REF, INVALID_STEP_ORDER, MISSING_EXPORT,
 │          MULTIPLE_EXPORTS, EXPORT_NOT_LAST, INVALID_CONFIG_TYPE
 │
 ├── PluginRegistryError        (packages/core)
 │   Codes: DUPLICATE_PLUGIN, PLUGIN_NOT_FOUND
 │
 ├── PluginLoaderError          (packages/runtime)
 │   Codes: FILE_NOT_FOUND, MANIFEST_READ_ERROR, MANIFEST_INVALID,
 │          API_VERSION_MISMATCH, ENTRY_IMPORT_ERROR,
 │          INVALID_EXPORT, DUPLICATE_PLUGIN_NAME
 │
 ├── PipelineRunError           (packages/runtime)
 │   Codes: PLUGIN_NOT_EXECUTABLE, STEP_EXECUTION_FAILED
 │
 └── PythonPluginError          (packages/runtime)
     Codes: SPAWN_FAILED, PROCESS_ERROR, INVALID_OUTPUT, TIMEOUT
```

### Python Plugin Error Protocol

```
Python processor errors follow a strict protocol:

  ┌─────────────────────────────────────────────────┐
  │  try:                                           │
  │      # ... process document ...                 │
  │  except Exception as exc:                       │
  │      json.dump({                                │
  │          "error": str(exc),                     │
  │          "type": type(exc).__name__             │
  │      }, sys.stderr)                             │
  │      sys.exit(1)                                │
  └─────────────────────────────────────────────────┘

  stdout = ONLY used for successful JSON output
  stderr = ONLY used for JSON error objects
  exit 0 = success
  exit 1 = failure
```

---

## 27. Quick Reference Cheat Sheet

### All Available Plugins

| Plugin Name | Type | Language | AI Backend | Persistence |
|-------------|------|----------|------------|-------------|
| `pdf-extractor` | extractor | TypeScript | None | No |
| `summarizer` | processor | TypeScript | None | No |
| `local-ollama` | processor | Python | Ollama (Mistral) | No |
| `local-rag-ollama` | processor | Python | Ollama (Mistral + nomic-embed-text) | No (in-memory) |
| `local-faiss-rag` | processor | Python | Ollama (Mistral + nomic-embed-text) | Yes (FAISS) |
| `langchain-summarizer` | processor | Python | OpenAI (gpt-4o-mini) | No |
| `proposal-generator` | processor | Python | Pluggable (Ollama or OpenAI) | Yes (Markdown) |
| `python-processor` | processor | Python | None (template) | No |
| `json-exporter` | exporter | TypeScript | None | No |

### Processor Comparison

```
                    │ local-  │ local-    │ local-     │ langchain-
                    │ ollama  │ rag-ollama│ faiss-rag  │ summarizer
────────────────────┼─────────┼───────────┼────────────┼───────────
AI Backend          │ Ollama  │ Ollama    │ Pluggable  │ OpenAI
                    │         │           │ (Ollama or │
                    │         │           │  OpenAI)   │
Runs Locally        │ Yes     │ Yes       │ Yes/No*    │ No (cloud)
Uses RAG            │ No      │ Yes       │ Yes        │ No
Persistent Index    │ N/A     │ No        │ Yes (FAISS)│ N/A
Namespace Isolation │ N/A     │ N/A       │ Yes        │ N/A
Cross-run Memory    │ No      │ No        │ Yes        │ No
Vector Store        │ N/A     │ In-memory │ FAISS disk │ N/A
Embedding Model     │ N/A     │ nomic     │ Configurable│ N/A
Generation Model    │ mistral │ mistral   │ Configurable│ gpt-4o-mini
Top-K Retrieval     │ N/A     │ 3         │ 5          │ N/A
Chunk Size          │ N/A     │ 500 chars │ 500 chars  │ N/A
API Key Required    │ No      │ No        │ Depends*   │ Yes (OpenAI)
Python Dependencies │ None    │ None      │ requests,  │ langchain-
                    │         │           │ numpy,     │ openai,
                    │         │           │ faiss-cpu  │ langchain-core

* local-faiss-rag: runs locally with Ollama, or uses cloud with OpenAI
  depending on LLM_PROVIDER env var. API key required only for OpenAI.
```

### All CLI Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `ai-engine run <pipeline> <input>` | Execute a pipeline | `--plugins`, `--workdir`, `--stream` |
| `ai-engine ingest <path>` | Ingest documents into FAISS index | `--workdir`, `--namespace` |
| `ai-engine query "<question>"` | Query the knowledge base | `--workdir`, `--namespace`, `--stream` |
| `ai-engine eval --dataset <file>` | Evaluate retrieval & generation quality | `--namespace`, `--workdir`, `--source-dir` |
| `ai-engine generate-proposal --client <n>` | Generate a structured proposal | `--industry`, `--namespace`, `--template`, `--team-size`, `--duration-weeks`, `--rate-per-week`, `--overwrite` |
| `ai-engine namespaces` | List available namespaces | `--workdir` |
| `ai-engine` (no args) | Enter interactive mode | `--stream` |
| `ai-engine --help` | Show help | |

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check |
| `POST` | `/ingest` | Yes | Ingest documents into a namespace |
| `POST` | `/query` | Yes | Query a namespace with RAG |
| `GET` | `/namespaces` | Yes | List accessible namespaces |

### Build Commands

```bash
# Build everything
pnpm build

# Build individual plugins
pnpm --filter @ai-engine/plugin-local-faiss-rag build
pnpm --filter @ai-engine/plugin-local-rag-ollama build
pnpm --filter @ai-engine/plugin-local-ollama build
pnpm --filter @ai-engine/plugin-langchain-summarize build

# Clean everything
pnpm clean
```

### Ollama Setup

```bash
# Install Ollama (Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Start server
ollama serve

# Pull required models
ollama pull mistral            # For generation
ollama pull nomic-embed-text   # For embeddings (RAG plugins)

# Verify models
ollama list
```

### LLM Provider Environment Variables

```bash
# Switch to OpenAI (default is ollama)
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-your-key

# Customize Ollama
export OLLAMA_BASE_URL=http://192.168.1.50:11434
export OLLAMA_GENERATION_MODEL=llama3
export OLLAMA_EMBEDDING_MODEL=mxbai-embed-large

# Customize OpenAI models
export OPENAI_GENERATION_MODEL=gpt-4o
export OPENAI_EMBEDDING_MODEL=text-embedding-3-large
```

### Python Dependencies

```bash
# For FAISS RAG plugin (core)
pip install requests numpy faiss-cpu

# For OpenAI provider (optional)
pip install openai

# For proposal generator plugin
pip install requests numpy faiss-cpu pyyaml

# For LangChain plugin
pip install langchain-openai langchain-core
```
