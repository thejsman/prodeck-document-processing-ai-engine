import { appendFile, mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
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
import { createNodeConfigLoader, FileMemoryStore, queryKnowledgeBase, getStorageProvider } from '@ai-engine/runtime';
import { ProposalSectionAgent } from '@ai-engine/agent-proposal-section';
import { MicrositeGeneratorAgent } from '@ai-engine/agent-microsite-generator';
import { ExtractSectionTool } from '@ai-engine/tool-extract-section';
import { SearchDocumentsTool } from '@ai-engine/tool-search-documents';
import { GenerateContentTool } from '@ai-engine/tool-generate-content';
import { GenerateMermaidTool } from '@ai-engine/tool-generate-mermaid';
import { SaveAssetTool } from '@ai-engine/tool-save-asset';
import { resolvePolicy, executeWithPolicy, type ProviderPolicyConfig } from './provider-policy.js';
import { appendEpisodicEntry } from './memory-util.js';

import { env } from 'node:process';

/** Fetch a contextual landscape photo URL from the Unsplash API.
 *  Retries with progressively shorter queries if no photos are found.
 *  Returns null on any failure. */
async function fetchUnsplashImageUrl(query: string): Promise<string | null> {
  const key = env.UNSPLASH_ACCESS_KEY;
  if (!key?.trim()) return null;

  const words = query.trim().split(/\s+/);
  // Try: full query → 3 words → 2 words → 1 word
  const candidates = [query, words.slice(0, 3).join(' '), words.slice(0, 2).join(' '), words[0]].filter(
    (q, i, arr) => q && arr.indexOf(q) === i,
  ); // unique, non-empty

  for (const q of candidates) {
    try {
      const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(q)}&orientation=landscape&client_id=${key}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const photo = (await res.json()) as { urls?: { regular?: string }; errors?: string[] };
      if (photo.errors?.length || !photo.urls?.regular) continue;
      return photo.urls.regular;
    } catch {
      continue;
    }
  }
  return null;
}

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
          storageDir: path.join(workdir, 'namespaces'),
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

/**
 * Call the generic LLM bridge with a prompt, returns the raw LLM response.
 * Used as the planner's GenerateFn.
 */
export const llmGenerateFn: GenerateFn = (prompt: string): Promise<string> => {
  return new Promise((resolve, reject) => {
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

    child.stdin.write(JSON.stringify({ prompt }));
    child.stdin.end();
  });
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
  app.post('/agent/run', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as
      | {
          agent?: unknown;
          namespace?: unknown;
          input?: unknown;
        }
      | undefined;

    if (!body?.agent || typeof body.agent !== 'string' || !body.agent.trim()) {
      return reply.code(400).send({ error: 'Missing required field: agent' });
    }

    if (!body?.namespace || typeof body.namespace !== 'string' || !body.namespace.trim()) {
      return reply.code(400).send({ error: 'Missing required field: namespace' });
    }

    const agentName = body.agent.trim();
    const namespace = body.namespace.trim();
    const inputOverrides = (body.input ?? {}) as Partial<AgentInput>;

    // Check the agent exists before building runner
    const knownAgent = agentRegistry.get(agentName);
    if (!knownAgent) {
      const available =
        agentRegistry
          .list()
          .map((a) => a.name)
          .join(', ') || 'none';
      return reply.code(404).send({
        error: `Unknown agent: "${agentName}". Available: ${available}`,
      });
    }

    const agentInput: AgentInput = {
      ...inputOverrides,
      namespace, // namespace from body is authoritative
    };

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

      // For microsite-generator-agent: resolve hero background image via Unsplash API
      if (agentName === 'microsite-generator-agent' && result.json) {
        const ast = result.json as {
          sections?: Array<{
            sectionType: string;
            image: { source: string; query: string; url: string | null };
            content: Record<string, unknown>;
          }>;
        };
        const hero = ast.sections?.find((s) => s.sectionType === 'hero' && s.image.source === 'unsplash');
        if (hero) {
          const query = (hero.content.imageQuery as string | undefined) || hero.image.query;
          if (query) {
            const imageUrl = await fetchUnsplashImageUrl(query);
            if (imageUrl) {
              hero.image.url = imageUrl;
              const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
              await fsWriteFile(astPath, JSON.stringify(ast, null, 2), 'utf-8').catch(() => {
                /* non-fatal */
              });
            }
          }
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
