import { appendFile, mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ConfigResolver,
  MemoryRegistry,
  AgentRunner,
  agentRegistry,
  registerDefaultAgents,
  toolRegistry,
  registerDefaultTools,
  createUsageRecorder,
  noopUsageRecorder,
} from '@ai-engine/core';
import type { AgentInput, Planner } from '@ai-engine/core';
import { generatePlan, executePlan } from '@ai-engine/planner';
import type { GenerateFn } from '@ai-engine/planner';
import { createNodeConfigLoader, FileMemoryStore, queryKnowledgeBase, getStorageProvider, OrgAssetStore, readOrgContextSettings } from '@ai-engine/runtime';
import { ProposalSectionAgent } from '@ai-engine/agent-proposal-section';
import { MicrositeGeneratorAgent } from '@ai-engine/agent-microsite-generator';
import { ExtractSectionTool } from '@ai-engine/tool-extract-section';
import { SearchDocumentsTool } from '@ai-engine/tool-search-documents';
import { GenerateContentTool } from '@ai-engine/tool-generate-content';
import { GenerateMermaidTool } from '@ai-engine/tool-generate-mermaid';
import { SaveAssetTool } from '@ai-engine/tool-save-asset';
import { resolvePolicy, executeWithPolicy, type ProviderPolicyConfig } from './provider-policy.js';
import { appendEpisodicEntry } from './memory-util.js';
import { buildPicsumUrl, fetchPexelsImageUrl, fetchLoremflickrUrl, fetchUnsplashImageUrl as fetchUnsplashFromRoutes } from './image-routes.js';
import { applyDesignSkill, injectThemeCSS } from './skills/design-skill-microsite.js';

import { env } from 'node:process';

/** Fetch a contextual landscape photo URL from the Unsplash API.
 *  Retries with progressively shorter queries if no photos are found.
 *  Returns null on any failure. */

// ---------------------------------------------------------------------------
// Register default agents and tools (idempotent)
// ---------------------------------------------------------------------------

let _registered = false;

export function ensureRegistered(workdir: string): void {
  if (_registered) return;

  registerDefaultAgents([new ProposalSectionAgent(), new MicrositeGeneratorAgent()]);

  registerDefaultTools([
    new ExtractSectionTool(),

    new SearchDocumentsTool({
      queryFn: async (namespace: string, question: string) => {
        const result = await queryKnowledgeBase({
          question,
          storageDir: path.join(workdir, 'namespaces', namespace),
          namespace,
        });
        return result.answer;
      },
    }),

    new GenerateContentTool({
      generateFn: llmGenerateFn,
    }),

    new GenerateMermaidTool({
      generateFn: (description: string) => spawnMermaidGenerator(description),
    }),

    new SaveAssetTool({
      /**
       * Per-namespace storage routing.
       *
       * At run-time the tool passes its AgentInput.namespace here.
       * We load the namespace config and delegate to getStorageProvider —
       * which returns LocalStorageProvider by default, or S3StorageProvider
       * when the namespace config has { storage: { type: "s3", ... } }.
       *
       * Existing namespaces with no "storage" key continue to use local
       * filesystem with no behaviour change.
       */
      storageProviderFn: async (namespace: string) => {
        const configLoader = createNodeConfigLoader(path.join(workdir, 'config'));
        const configResolver = new ConfigResolver(configLoader);
        const config = await configResolver.resolve({ namespace });
        return getStorageProvider({ namespace, config, workdir });
      },
    }),
  ]);

  _registered = true;
}

// ---------------------------------------------------------------------------
// Python bridge helpers
// ---------------------------------------------------------------------------

const PYTHON_BIN = env.PYTHON ?? 'python3';

// Compiled output is at services/api/dist/ → parent is services/api/
// → grandparent is services/ → great-grandparent is project root
const MERMAID_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'tools',
  'generate-mermaid',
  'mermaid_generator.py',
);

// Generic LLM bridge — used by the planner's GenerateFn
const LLM_BRIDGE_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'llm_bridge.py');
const LLM_BRIDGE_SERVER_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'llm_bridge_server.py');

// ---------------------------------------------------------------------------
// Per-request temperature context (AsyncLocalStorage — thread-safe)
// ---------------------------------------------------------------------------

const _temperatureStore = new AsyncLocalStorage<number | undefined>();

/**
 * Run fn within a context where llmGenerateFn uses the given temperature.
 * Handlers and utilities don't need to be modified — they read the temperature
 * transparently from the async context.
 */
export function withLlmTemperature<T>(temperature: number | undefined, fn: () => Promise<T>): Promise<T> {
  return _temperatureStore.run(temperature, fn);
}

// ---------------------------------------------------------------------------
// Persistent Python bridge pool (opt-in via LLM_BRIDGE_PERSISTENT=true)
// ---------------------------------------------------------------------------

type PendingReq = {
  prompt: string;
  temperature?: number;
  resolve: (result: string) => void;
  reject: (err: Error) => void;
};

class PythonWorker {
  private lineBuffer = '';
  private inflight: (PendingReq & { id: string }) | null = null;
  private proc: ReturnType<typeof spawn>;

  constructor(
    private readonly scriptPath: string,
    private readonly pythonBin: string,
    private readonly onFree: () => void,
  ) {
    this.proc = this.start();
  }

  private start(): ReturnType<typeof spawn> {
    const proc = spawn(this.pythonBin, [this.scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.lineBuffer += chunk.toString();
      let idx: number;
      while ((idx = this.lineBuffer.indexOf('\n')) !== -1) {
        const line = this.lineBuffer.slice(0, idx).trim();
        this.lineBuffer = this.lineBuffer.slice(idx + 1);
        if (line) this.handleLine(line);
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      console.error('[LLMBridgeServer]', chunk.toString().trim());
    });

    proc.on('close', () => {
      if (this.inflight) {
        this.inflight.reject(new Error('LLM bridge worker exited unexpectedly'));
        this.inflight = null;
      }
    });

    proc.on('error', (err) => {
      if (this.inflight) {
        this.inflight.reject(new Error(`LLM bridge worker error: ${err.message}`));
        this.inflight = null;
      }
    });

    return proc;
  }

  private handleLine(line: string): void {
    const req = this.inflight;
    this.inflight = null;
    if (!req) return;

    try {
      const parsed = JSON.parse(line) as { id?: string; result?: string; error?: string };
      if (parsed.error) {
        req.reject(new Error(parsed.error));
      } else {
        req.resolve(parsed.result ?? '');
      }
    } catch {
      req.reject(new Error(`LLM bridge worker returned invalid JSON: ${line.slice(0, 120)}`));
    }

    this.onFree();
  }

  get isFree(): boolean {
    return this.inflight === null;
  }

  send(id: string, req: PendingReq): void {
    this.inflight = { ...req, id };
    const payload: Record<string, unknown> = { id, prompt: req.prompt };
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    this.proc.stdin!.write(JSON.stringify(payload) + '\n');
  }

  close(): void {
    try { this.proc.stdin!.end(); } catch { /* ignore */ }
  }
}

class PythonBridgePool {
  private readonly workers: PythonWorker[];
  private readonly queue: PendingReq[] = [];

  constructor(scriptPath: string, pythonBin: string, poolSize: number) {
    this.workers = Array.from(
      { length: poolSize },
      () => new PythonWorker(scriptPath, pythonBin, () => this.drain()),
    );
    console.log(`[LLMBridgePool] Persistent pool started (${poolSize} workers, script: ${scriptPath})`);
  }

  private drain(): void {
    if (this.queue.length === 0) return;
    const free = this.workers.find((w) => w.isFree);
    if (!free) return;
    const next = this.queue.shift()!;
    free.send(crypto.randomUUID(), next);
  }

  generate(prompt: string, temperature?: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const req: PendingReq = { prompt, temperature, resolve, reject };
      const free = this.workers.find((w) => w.isFree);
      if (free) {
        free.send(crypto.randomUUID(), req);
      } else {
        this.queue.push(req);
      }
    });
  }

  shutdown(): void {
    for (const w of this.workers) w.close();
  }
}

const _persistentPool: PythonBridgePool | null =
  env.LLM_BRIDGE_PERSISTENT === 'true'
    ? new PythonBridgePool(
        LLM_BRIDGE_SERVER_SCRIPT,
        PYTHON_BIN,
        Math.max(1, parseInt(env.LLM_BRIDGE_POOL_SIZE ?? '2', 10)),
      )
    : null;

// ---------------------------------------------------------------------------
// LLM call logging
// ---------------------------------------------------------------------------

let _llmCallCounter = 0;

function logLLMPrompt(callId: number, prompt: string): void {
  const preview = prompt.length > 300 ? prompt.slice(0, 300) + '…' : prompt;
  console.log(`[LLM →] #${callId} prompt (${prompt.length} chars)\n${preview}`);
}

function logLLMResponse(callId: number, result: string, durationMs: number): void {
  const preview = result.length > 300 ? result.slice(0, 300) + '…' : result;
  console.log(`[LLM ←] #${callId} response (${result.length} chars, ${durationMs}ms)\n${preview}`);
}

/**
 * Call the generic LLM bridge with a prompt, returns the raw LLM response.
 * Used as the planner's GenerateFn.
 *
 * When LLM_BRIDGE_PERSISTENT=true, requests are dispatched to a persistent
 * pool of Python workers (eliminating ~500ms–1s spawn overhead per call).
 * When the env var is absent or false, falls back to the original one-shot
 * spawn behaviour so there is no regression risk.
 */
export const llmGenerateFn: GenerateFn = async (prompt: string): Promise<string> => {
  // Strip lone Unicode surrogates (U+D800–U+DFFF) before sending to the Python bridge.
  // They appear when the source document contains invalid UTF-8 bytes decoded by Node as
  // surrogate pairs.  Python's UTF-8 encoder rejects them, causing every LLM call to fail.
  const safePrompt = prompt.replace(/[\uD800-\uDFFF]/g, '');

  const callId = ++_llmCallCounter;
  const t0 = Date.now();
  logLLMPrompt(callId, safePrompt);

  let result: string;

  const temperature = _temperatureStore.getStore();

  if (_persistentPool) {
    result = await _persistentPool.generate(safePrompt, temperature);
  } else {
    result = await new Promise<string>((resolve, reject) => {
      const child = spawn(PYTHON_BIN, [LLM_BRIDGE_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn llm_bridge: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          let message = `llm_bridge exited with code ${code}`;
          if (stderr) {
            try {
              const parsed = JSON.parse(stderr) as { error?: string };
              message = parsed.error ?? message;
            } catch {
              message = stderr.trim() || message;
            }
          }
          reject(new Error(message));
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as { result?: string; error?: string };
          if (parsed.error) {
            reject(new Error(parsed.error));
            return;
          }
          resolve(parsed.result ?? '');
        } catch {
          reject(new Error('llm_bridge returned invalid JSON'));
        }
      });

      const payload: Record<string, unknown> = { prompt: safePrompt };
      if (temperature !== undefined) payload.temperature = temperature;
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }

  logLLMResponse(callId, result, Date.now() - t0);
  return result;
};

/**
 * Create a Planner instance that conforms to the core Planner interface,
 * backed by the planner package + the LLM bridge GenerateFn.
 */
function createPlanner(): Planner {
  return {
    generatePlan: (input) => generatePlan(input, llmGenerateFn),
    executePlan: (plan, tools) => executePlan(plan, tools),
  };
}

function spawnMermaidGenerator(description: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [MERMAID_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn mermaid_generator: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        let message = `mermaid_generator exited with code ${code}`;
        if (stderr) {
          try {
            const parsed = JSON.parse(stderr) as { error?: string };
            message = parsed.error ?? message;
          } catch {
            message = stderr.trim() || message;
          }
        }
        reject(new Error(message));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { result?: string; error?: string };
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        resolve(parsed.result ?? '');
      } catch {
        reject(new Error('mermaid_generator returned invalid JSON'));
      }
    });

    child.stdin.write(JSON.stringify({ description }));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Runner factory
// ---------------------------------------------------------------------------

export async function buildRunner(workdir: string): Promise<AgentRunner> {
  ensureRegistered(workdir);
  const configBasePath = path.join(workdir, 'config');
  const memoryBasePath = path.join(workdir, 'memory');
  const usageEventsPath = path.join(workdir, 'data', 'usage', 'events.jsonl');

  const configLoader = createNodeConfigLoader(configBasePath);
  const configResolver = new ConfigResolver(configLoader);

  const memoryStore = new FileMemoryStore(memoryBasePath);
  const memoryRegistry = new MemoryRegistry(memoryStore);

  let usageRecorder = noopUsageRecorder;
  try {
    await mkdir(path.dirname(usageEventsPath), { recursive: true });
    usageRecorder = createUsageRecorder(async (line) => {
      await appendFile(usageEventsPath, line + '\n', 'utf-8');
    });
  } catch {
    // Non-fatal — proceed without recording
  }

  const planner = createPlanner();

  return new AgentRunner(agentRegistry, configResolver, memoryRegistry, usageRecorder, toolRegistry, planner);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAgentRoutes(
  app: FastifyInstance,
  workdir: string,
  policyConfig: ProviderPolicyConfig | null,
): void {
  ensureRegistered(workdir);

  // POST /agent/run
  app.post(
    '/agent/run',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as {
        agent?: unknown;
        namespace?: unknown;
        prompt?: unknown;
        input?: unknown;
      } | undefined;

    if (!body?.agent || typeof body.agent !== 'string' || !body.agent.trim()) {
      return reply.code(400).send({ error: 'Missing required field: agent' });
    }

    if (!body?.namespace || typeof body.namespace !== 'string' || !body.namespace.trim()) {
      return reply.code(400).send({ error: 'Missing required field: namespace' });
    }

    const agentName = body.agent.trim();
    const namespace = body.namespace.trim();
    const inputOverrides = (body.input ?? {}) as Partial<AgentInput>;

      // Top-level prompt: accepted as body.prompt and injected with highest priority.
      // Merges into both input.prompt and input.metadata.customInstructions so the
      // agent always sees it regardless of which field it reads first.
      const topLevelPrompt = typeof body.prompt === 'string' && body.prompt.trim()
        ? body.prompt.trim()
        : undefined;

      // Check the agent exists before building runner
      const knownAgent = agentRegistry.get(agentName);
      if (!knownAgent) {
        const available = agentRegistry.list().map((a) => a.name).join(', ') || 'none';
        return reply.code(404).send({
          error: `Unknown agent: "${agentName}". Available: ${available}`,
        });
      }

      const agentInput: AgentInput = {
        ...inputOverrides,
        namespace, // namespace from body is authoritative
        // top-level prompt wins over anything inside input
        ...(topLevelPrompt ? { prompt: topLevelPrompt } : {}),
        metadata: {
          ...(inputOverrides.metadata as Record<string, unknown> | undefined ?? {}),
          // inject into metadata.customInstructions so agent always picks it up
          ...(topLevelPrompt ? { customInstructions: topLevelPrompt } : {}),
        },
      };

    // Phase 2 — Design Kit gap-fill for microsite-generator-agent (body values always win)
    if (agentName === 'microsite-generator-agent') {
      const _orgSettings = await readOrgContextSettings(workdir).catch(() => null);
      if (_orgSettings?.applyDesignKit !== false) {
        const _kit = await new OrgAssetStore(workdir).getDesignKit().catch(() => null);
        if (_kit) {
          const meta = agentInput.metadata as Record<string, unknown>;
          if (!meta.brand && _kit.primaryColor) meta.brand = { primaryColor: _kit.primaryColor };
          if (!meta.designBrief && _kit.designBrief) meta.designBrief = _kit.designBrief;
          if (!meta.referenceFile && _kit.heroBase64) {
            meta.referenceFile = {
              base64: _kit.heroBase64,
              mediaType: _kit.heroMediaType ?? 'image/jpeg',
              fileName: 'design-kit-hero',
              ...(_kit.dominantColors.length >= 2 ? { dominantColors: _kit.dominantColors } : {}),
            };
          }
        }
      }
    }

    // Design skill — enrich metadata with frontend-design directives before agent runs
    const { metadata: skillMetadata, tone: designTone } = applyDesignSkill(
      agentName,
      agentInput.metadata as Record<string, unknown>,
    );
    agentInput.metadata = skillMetadata;

    let runner: AgentRunner;
    try {
      runner = await buildRunner(workdir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `Failed to initialize agent runner: ${message}` });
    }

    try {
      let result;

      if (policyConfig) {
        const policy = resolvePolicy(policyConfig, namespace, 'query');
        const { result: r } = await executeWithPolicy(policy, () => runner.run(agentName, agentInput));
        result = r;
      } else {
        result = await runner.run(agentName, agentInput);
      }

      // For microsite-generator-agent: persist the AST and optionally resolve hero image
      if (agentName === 'microsite-generator-agent' && result.json) {
        const ast = result.json as {
          sections?: Array<{
            sectionType: string;
            image: { source: string; query: string; url: string | null };
            content: Record<string, unknown>;
          }>;
        };
        if (ast.sections?.length) {
          const imagesDir = path.join(workdir, 'assets', 'presentations', namespace, 'images');
          await mkdir(imagesDir, { recursive: true });

          // Persist ALL expiring image URLs (DALL-E Azure Blob) to local disk so they survive the 2-hour expiry.
          // Unsplash and loremflickr CDN URLs are permanent and don't need persisting.
          await Promise.allSettled(
            ast.sections.map(async (section) => {
              const url = section.image?.url;
              if (!url || url.startsWith('/presentation-images/')) return;
              // Only persist Azure Blob Storage URLs (DALL-E) — they expire after 2 hours
              if (!url.includes('.blob.core.windows.net') && !url.includes('oaidalleapiprodscus')) return;
              try {
                const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
                const filename = `${section.sectionType}-${hash}.jpg`;
                const destPath = path.join(imagesDir, filename);
                const imgRes = await fetch(url, { signal: AbortSignal.timeout(15000) });
                if (imgRes.ok) {
                  const buf = Buffer.from(await imgRes.arrayBuffer());
                  await fsWriteFile(destPath, buf);
                  section.image.url = `/presentation-images/${namespace}/${filename}`;
                  console.log(`[agent-routes] Persisted DALL-E image for "${section.sectionType}" → ${section.image.url}`);
                }
              } catch {
                /* non-fatal — keep original URL */
              }
            }),
          );

          // Resolve real images for ALL sections — cascade: Pexels → loremflickr → Unsplash → Picsum
          // Includes gradient sections — every section deserves a real image for Phase 3 HTML
          const hasPexels = !!(process.env.PEXELS_API_KEY?.trim());
          const usedImageUrls = new Set<string>(); // dedup tracker — prevents same photo on multiple sections

          // Build a content-based fallback query from section data when cinematic prompt sanitizes poorly
          type AstSection = { sectionType: string; image: { source: string; query: string; url: string | null }; content: Record<string, unknown> };
          function buildFallbackQuery(section: AstSection): string {
            const eyebrow = (section.content?.eyebrow as string | undefined) ?? '';
            const headline = (section.content?.headline as string | undefined) ?? '';
            const sectionType = section.sectionType ?? '';
            const words = `${eyebrow} ${headline}`
              .replace(/[^a-zA-Z0-9 ]/g, ' ')
              .split(/\s+/)
              .filter((w) => w.length > 3)
              .slice(0, 4)
              .join(' ');
            return words || sectionType;
          }

          await Promise.allSettled(
            ast.sections
              .filter((s) => {
                const q = s.image?.query || (s.content?.imageQuery as string | undefined);
                return !!q; // fetch for ALL sections that have any image query
              })
              .map(async (section) => {
                const rawQuery = (section.content?.imageQuery as string | undefined) || section.image?.query || '';

                let remoteUrl: string | null = null;

                if (hasPexels) {
                  remoteUrl = await fetchPexelsImageUrl(rawQuery);
                  // If Pexels returned a duplicate, try the content-based fallback query
                  if (remoteUrl && usedImageUrls.has(remoteUrl)) {
                    const fallback = buildFallbackQuery(section);
                    const alt = fallback !== rawQuery ? await fetchPexelsImageUrl(fallback) : null;
                    remoteUrl = alt && !usedImageUrls.has(alt) ? alt : null;
                  }
                }
                if (!remoteUrl) remoteUrl = await fetchLoremflickrUrl(rawQuery);
                if (!remoteUrl) remoteUrl = await fetchUnsplashFromRoutes(rawQuery);
                if (!remoteUrl) remoteUrl = buildPicsumUrl(rawQuery);

                if (!remoteUrl) return;
                usedImageUrls.add(remoteUrl);

                try {
                  const hash = createHash('sha1').update(remoteUrl).digest('hex').slice(0, 8);
                  const filename = `${section.sectionType}-${hash}.jpg`;
                  const destPath = path.join(imagesDir, filename);
                  const imgRes = await fetch(remoteUrl, { signal: AbortSignal.timeout(15000) });
                  if (imgRes.ok) {
                    const buf = Buffer.from(await imgRes.arrayBuffer());
                    // Deduplicate by file content hash — prevents same bytes saved under different names
                    const contentHash = createHash('sha1').update(buf).digest('hex').slice(0, 8);
                    if ([...usedImageUrls].some((u) => u.includes(contentHash))) {
                      // Same file content already used — fall back to loremflickr with section-specific seed
                      const flickrUrl = await fetchLoremflickrUrl(`${section.sectionType} ${buildFallbackQuery(section)}`);
                      if (flickrUrl) {
                        section.image.url = flickrUrl;
                        section.image.source = 'loremflickr';
                      }
                      return;
                    }
                    usedImageUrls.add(contentHash);
                    await fsWriteFile(destPath, buf);
                    section.image.url = `/presentation-images/${namespace}/${filename}`;
                    section.image.source = hasPexels && remoteUrl !== buildPicsumUrl(rawQuery) ? 'pexels' : 'loremflickr';
                    console.log(`[agent-routes] Image resolved for "${section.sectionType}" → ${section.image.url}`);
                  } else {
                    section.image.url = remoteUrl;
                  }
                } catch {
                  section.image.url = remoteUrl;
                }
              }),
          );
          // Design skill Phase 2 — generate and inject CSS theme into LayoutAST before persisting
          await injectThemeCSS(
            ast as unknown as Record<string, unknown>,
            designTone,
            ((skillMetadata.brand as Record<string, unknown> | undefined)?.primaryColor as string | undefined),
            llmGenerateFn,
          );

          // Always persist the AST so page-reloads can restore the latest generation
          const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
          await mkdir(path.dirname(astPath), { recursive: true });
          await fsWriteFile(astPath, JSON.stringify(ast, null, 2), 'utf-8').catch(() => {
            /* non-fatal */
          });
        }
      }

      // Fire-and-forget episodic memory entry
      appendEpisodicEntry(workdir, namespace, {
        timestamp: new Date().toISOString(),
        source: `agent:${agentName}`,
        content: `Agent "${agentName}" executed successfully`,
      }).catch(() => {
        /* non-fatal */
      });

      return reply.send({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Agent execution failed: ${message}` });
    }
  });

  // GET /agent/list — discover available agents
  app.get('/agent/list', async (_req: FastifyRequest, reply: FastifyReply) => {
    ensureRegistered(workdir);
    const agents = agentRegistry.list().map((a) => ({
      name: a.name,
      description: a.description,
    }));
    return reply.send({ agents });
  });

  // GET /tools/list — discover available tools
  app.get('/tools/list', async (_req: FastifyRequest, reply: FastifyReply) => {
    ensureRegistered(workdir);
    return reply.send({ tools: toolRegistry.list() });
  });
}
