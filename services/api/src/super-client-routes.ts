import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';
import { llmGenerateFn } from './agent-routes.js';
import { ClientMemoryService } from './memory/client-memory.service.js';
import type { ClientKnowledgeEntry } from './memory/client-memory.types.js';

// Strip preview-only injections that the UI adds to srcdoc iframes.
// These must never be saved to disk — if the client sends currentHtml that
// already contains them, strip them before patching and persisting.
const PREVIEW_INJECTION_IDS = [
  '__preview-cursor-reset',
  '__nav-anchor-fix',
  '__preview-reveal-fix',
  '__microsite-iframe-edit',
  '__scroll-restore',
];
function stripPreviewInjections(html: string): string {
  let out = html;
  for (const id of PREVIEW_INJECTION_IDS) {
    out = out.replace(
      new RegExp(`<(?:style|script)[^>]*\\bid="${id}"[\\s\\S]*?</(?:style|script)>\\s*`, 'g'),
      '',
    );
  }
  return out;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

interface SuperClientMeta {
  name: string;
  displayName: string;
  url?: string;
  createdAt: string;
}

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  editContext?: 'microsite' | 'proposal';
}

interface ScFile {
  fileName: string;
  size: number;
  uploadedAt: string;
  status: 'processing' | 'extracted' | 'failed';
  error?: string;
}

interface ScProposal {
  fileName: string;
  title: string;
  savedAt: string;
}

interface ScMicrosite {
  id: string;
  title: string;
  proposalTitle: string;
  savedAt: string;
  version: number;
}

interface GenerationEntry {
  id: string;
  clientSlug: string;
  type: 'proposal' | 'microsite';
  phase: 'generating' | 'complete' | 'error';
  title: string;
  steps: string[];
  createdAt?: string;
  charCount?: number;
  error?: string;
  result?: { fileName?: string; micrositeId?: string };
}

async function readGenerations(dir: string): Promise<GenerationEntry[]> {
  try {
    const raw = await readFile(path.join(dir, 'generations.json'), 'utf-8');
    return JSON.parse(raw) as GenerationEntry[];
  } catch {
    return [];
  }
}

async function writeGenerations(dir: string, gens: GenerationEntry[]): Promise<void> {
  await writeFile(path.join(dir, 'generations.json'), JSON.stringify(gens, null, 2));
}

async function readMeta(dir: string): Promise<SuperClientMeta> {
  const raw = await readFile(path.join(dir, 'meta.json'), 'utf-8');
  return JSON.parse(raw) as SuperClientMeta;
}

async function readHistory(dir: string): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(path.join(dir, 'history.json'), 'utf-8');
    const entries = JSON.parse(raw) as HistoryEntry[];
    // Sort ascending by createdAt. Entries without a timestamp (written before
    // this field existed) sort to the front so old history stays in place.
    return entries.sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return -1;
      if (!b.createdAt) return 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  } catch {
    return [];
  }
}

async function readContext(dir: string): Promise<string> {
  try {
    return await readFile(path.join(dir, 'context.md'), 'utf-8');
  } catch {
    return '';
  }
}

async function readScFiles(dir: string): Promise<ScFile[]> {
  try {
    const raw = await readFile(path.join(dir, 'files.json'), 'utf-8');
    return JSON.parse(raw) as ScFile[];
  } catch {
    return [];
  }
}

async function writeScFiles(dir: string, files: ScFile[]): Promise<void> {
  await writeFile(path.join(dir, 'files.json'), JSON.stringify(files, null, 2));
}

async function updateScFile(dir: string, fileName: string, status: ScFile['status'], error?: string): Promise<void> {
  const files = await readScFiles(dir);
  const idx = files.findIndex((f) => f.fileName === fileName);
  if (idx !== -1) {
    files[idx] = { ...files[idx], status, ...(error ? { error } : {}) };
    await writeScFiles(dir, files);
  }
}

async function readProposals(dir: string): Promise<ScProposal[]> {
  try {
    const raw = await readFile(path.join(dir, 'proposals.json'), 'utf-8');
    return JSON.parse(raw) as ScProposal[];
  } catch {
    return [];
  }
}

async function saveProposal(dir: string, title: string, content: string): Promise<ScProposal> {
  const proposalsDir = path.join(dir, 'proposals');
  await mkdir(proposalsDir, { recursive: true });

  const now = new Date();
  const slug = slugify(title) || 'proposal';
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `${ts}-${slug}.md`;

  await writeFile(path.join(proposalsDir, fileName), content, 'utf-8');

  const entry: ScProposal = { fileName, title, savedAt: now.toISOString() };
  const existing = await readProposals(dir);
  existing.unshift(entry);
  await writeFile(path.join(dir, 'proposals.json'), JSON.stringify(existing, null, 2));

  return entry;
}

async function updateProposal(dir: string, fileName: string, title: string, content: string): Promise<ScProposal> {
  const proposalsDir = path.join(dir, 'proposals');
  await writeFile(path.join(proposalsDir, fileName), content, 'utf-8');

  const updatedAt = new Date().toISOString();
  const entry: ScProposal = { fileName, title, savedAt: updatedAt };
  const existing = await readProposals(dir);
  const idx = existing.findIndex((p) => p.fileName === fileName);
  if (idx !== -1) existing[idx] = entry; else existing.unshift(entry);
  await writeFile(path.join(dir, 'proposals.json'), JSON.stringify(existing, null, 2));

  return entry;
}

function extractProposalTag(text: string): { title: string; content: string } | null {
  const match = text.match(/<proposal\s+title="([^"]+)">([\s\S]*?)<\/proposal>/i);
  if (!match) return null;
  return { title: match[1].trim(), content: match[2].trim() };
}

function stripProposalTag(text: string): string {
  return text.replace(/<proposal\s+title="[^"]*">[\s\S]*?<\/proposal>/i, '').trim();
}

function extractTextReplacements(text: string): Array<{ find: string; replace: string }> {
  const matches = [...text.matchAll(/<text-replace\s+find="((?:[^"\\]|\\.)*)"\s+replace="((?:[^"\\]|\\.)*)"\s*\/?>/gi)];
  return matches.map((m) => ({
    find: m[1].replace(/\\"/g, '"'),
    replace: m[2].replace(/\\"/g, '"'),
  }));
}

function stripTextReplaceTags(text: string): string {
  return text.replace(/<text-replace\s+find="(?:[^"\\]|\\.)*"\s+replace="(?:[^"\\]|\\.)*"\s*\/?>/gi, '').trim();
}

function applyTextReplacements(original: string, replacements: Array<{ find: string; replace: string }>): string {
  let result = original;
  for (const r of replacements) {
    if (r.find) result = result.split(r.find).join(r.replace);
  }
  return result;
}

function extractSectionUpdates(text: string): Array<{ heading: string; content: string }> {
  const matches = [...text.matchAll(/<section-update\s+heading="([^"]+)">([\s\S]*?)<\/section-update>/gi)];
  return matches.map((m) => ({ heading: m[1].trim(), content: m[2].trim() }));
}

function stripSectionUpdateTags(text: string): string {
  return text.replace(/<section-update\s+heading="[^"]*">[\s\S]*?<\/section-update>/gi, '').trim();
}

function patchProposalSections(
  original: string,
  updates: Array<{ heading: string; content: string }>,
): string {
  const lines = original.split('\n');
  const sections: Array<{ heading: string; bodyLines: string[] }> = [];
  let cur: { heading: string; bodyLines: string[] } = { heading: '', bodyLines: [] };

  for (const line of lines) {
    if (/^#{1,3} /.test(line)) {
      sections.push(cur);
      cur = { heading: line, bodyLines: [] };
    } else {
      cur.bodyLines.push(line);
    }
  }
  sections.push(cur);

  const updateMap = new Map(
    updates.map((u) => [u.heading.replace(/^#+\s*/, '').toLowerCase().trim(), u]),
  );

  const patched = sections.map((s) => {
    const key = s.heading.replace(/^#+\s*/, '').toLowerCase().trim();
    const update = updateMap.get(key);
    if (update) {
      return [update.heading || s.heading, update.content].filter(Boolean).join('\n');
    }
    return [s.heading, ...s.bodyLines].filter((l, i) => i > 0 || l).join('\n');
  });

  return patched.join('\n').trim();
}

async function readMicrosites(dir: string): Promise<ScMicrosite[]> {
  try {
    const raw = await readFile(path.join(dir, 'microsites.json'), 'utf-8');
    return JSON.parse(raw) as ScMicrosite[];
  } catch {
    return [];
  }
}

async function writeMicrosites(dir: string, list: ScMicrosite[]): Promise<void> {
  await writeFile(path.join(dir, 'microsites.json'), JSON.stringify(list, null, 2));
}

// Max chars sent to the LLM for knowledge extraction.
// Chosen to fit within a 32K-token context window (Ollama/Mistral lower bound):
// 32K tokens × ~4 chars/token = ~128K chars total, minus 8K tokens reserved for
// response (~32K chars) and ~1K chars of prompt overhead → ~95K chars available.
// 80K is a conservative value that leaves headroom across all supported providers.
const EXCERPT_MAX_CHARS = 80_000;

async function extractFileToMemory(
  workdir: string,
  clientSlug: string,
  clientName: string,
  filePath: string,
  fileName: string,
  scDir: string,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    let text = '';
    if (fileName.endsWith('.pdf')) {
      const { default: pdfParse } = await import('pdf-parse') as { default: (buf: Buffer) => Promise<{ text: string }> };
      const buf = await readFile(filePath);
      const parsed = await pdfParse(buf);
      text = parsed.text;
    } else {
      text = await readFile(filePath, 'utf-8');
    }

    const excerpt = text.slice(0, EXCERPT_MAX_CHARS);

    const prompt = `You are a client intelligence extractor.
Extract facts worth remembering long-term from this document about client "${clientName}".
Focus on: company facts, preferences, constraints, requirements, stakeholders (name + role), brand traits,
business context, goals, and anything useful for future proposals or microsites.
Skip generic filler or information that would not apply to future work.

Categories (use the most specific one that fits):
- requirement  : A stated must-have or should-have capability or deliverable
- priority     : An explicitly ranked client priority
- metric       : A business number or KPI (budget, traffic, conversion rates, etc.)
- action_item  : A committed next step with a responsible party or deadline
- problem      : A business pain point or challenge
- opportunity  : A potential growth area or strategic opening
- decision     : A direction or choice that was agreed upon
- constraint   : A limitation, risk, or boundary condition
- preference   : A stated style or approach preference
- relationship : A stakeholder connection or reporting relationship
- context      : Background about the company, people, or situation

DOCUMENT (${fileName}):
${excerpt}

Return ONLY valid JSON (null for fields not found in the document):
{
  "stableFields": {
    "clientIndustry": "string or null",
    "projectType": "string or null",
    "contactName": "string or null"
  },
  "knowledge": [
    { "content": "...", "category": "requirement|priority|metric|action_item|problem|opportunity|decision|constraint|preference|relationship|context", "confidence": 0.0 }
  ],
  "stakeholders": [
    { "name": "...", "role": "...", "email": "", "notes": "" }
  ]
}`;

    const raw = await llmGenerateFn(prompt);
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const extracted = JSON.parse(json) as {
      stableFields?: { clientIndustry?: string | null; projectType?: string | null; contactName?: string | null };
      knowledge?: { content: string; category: string; confidence: number }[];
      stakeholders?: { name: string; role: string; email?: string; notes?: string }[];
    };

    const memService = new ClientMemoryService(workdir);
    if (!(await memService.get(clientSlug))) {
      await memService.createEmpty(clientName);
    }

    const sf = extracted.stableFields ?? {};
    if (sf.clientIndustry?.trim()) await memService.updateField(clientSlug, 'clientIndustry', sf.clientIndustry.trim());
    if (sf.projectType?.trim()) await memService.updateField(clientSlug, 'projectType', sf.projectType.trim());
    if (sf.contactName?.trim()) await memService.updateField(clientSlug, 'contactName', sf.contactName.trim());

    await memService.removeKnowledgeByDocument(clientSlug, fileName);
    for (const k of extracted.knowledge ?? []) {
      if (k.content?.trim()) {
        await memService.addKnowledge(clientSlug, k.content, k.category as ClientKnowledgeEntry['category'], k.confidence ?? 0.7, fileName);
      }
    }
    for (const s of extracted.stakeholders ?? []) {
      if (s.name?.trim() && s.role?.trim()) {
        await memService.upsertStakeholder(clientSlug, {
          name: s.name,
          role: s.role,
          ...(s.email?.trim() ? { email: s.email } : {}),
          ...(s.notes?.trim() ? { notes: s.notes } : {}),
        });
      }
    }

    await updateScFile(scDir, fileName, 'extracted');
  } catch (err) {
    log.warn({ err }, `[SuperClient] Extraction failed for ${fileName}`);
    await updateScFile(scDir, fileName, 'failed', (err as Error).message);
  }
}

// Fire-and-forget: extract facts from a chat turn and persist to ClientMemoryService.
// Uses llmGenerateFn → Python LLM bridge → respects configured provider/model.
async function distillChatTurn(
  workdir: string,
  clientSlug: string,
  clientName: string,
  userMessage: string,
  assistantReply: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const prompt = `You are a client intelligence extractor.
Given this chat exchange about a client, extract any facts worth remembering long-term.
Focus on: company facts, preferences, constraints, requirements, stakeholders (people + roles), brand traits.
Skip: conversational filler, questions without answers, project-specific one-off details.

Categories (use the most specific one that fits):
- requirement  : A stated must-have or should-have capability or deliverable
- priority     : An explicitly ranked client priority
- metric       : A business number or KPI (budget, traffic, conversion rates, etc.)
- action_item  : A committed next step with a responsible party or deadline
- problem      : A business pain point or challenge
- opportunity  : A potential growth area or strategic opening
- decision     : A direction or choice that was agreed upon
- constraint   : A limitation, risk, or boundary condition
- preference   : A stated style or approach preference
- relationship : A stakeholder connection or reporting relationship
- context      : Background about the company, people, or situation

CLIENT: ${clientName}

USER: ${userMessage}
ASSISTANT: ${assistantReply}

Return ONLY valid JSON (empty arrays if nothing notable):
{
  "knowledge": [
    { "content": "...", "category": "requirement|priority|metric|action_item|problem|opportunity|decision|constraint|preference|relationship|context", "confidence": 0.0 }
  ],
  "stakeholders": [
    { "name": "...", "role": "...", "email": "", "notes": "" }
  ]
}`;

  try {
    const raw = await llmGenerateFn(prompt);
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const extracted = JSON.parse(json) as {
      knowledge?: { content: string; category: string; confidence: number }[];
      stakeholders?: { name: string; role: string; email?: string; notes?: string }[];
    };

    const memService = new ClientMemoryService(workdir);
    if (!(await memService.get(clientSlug))) {
      await memService.createEmpty(clientName);
    }
    for (const k of extracted.knowledge ?? []) {
      if (k.content?.trim()) {
        await memService.addKnowledge(clientSlug, k.content, k.category as ClientKnowledgeEntry['category'], k.confidence ?? 0.7);
      }
    }
    for (const s of extracted.stakeholders ?? []) {
      if (s.name?.trim() && s.role?.trim()) {
        await memService.addStakeholder(clientSlug, {
          name: s.name,
          role: s.role,
          ...(s.email?.trim() ? { email: s.email } : {}),
          ...(s.notes?.trim() ? { notes: s.notes } : {}),
        });
      }
    }
  } catch (err) {
    log.warn({ err }, '[SuperClient] Memory distillation failed — chat unaffected');
  }
}

async function seedClientMemory(
  name: string,
  displayName: string,
  contextMd: string,
  workdir: string,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!contextMd.trim()) return;
  const memService = new ClientMemoryService(workdir);
  try {
    const extractPrompt = `You are a client intelligence extractor.
Extract facts worth remembering long-term from this client intelligence summary about "${displayName}".
Focus on: company facts, preferences, constraints, requirements, stakeholders (name + role), brand traits,
business context, goals, and anything useful for future proposals or microsites.
Skip generic filler or information that would not apply to future work.

Categories (use the most specific one that fits):
- requirement  : A stated must-have or should-have capability or deliverable
- priority     : An explicitly ranked client priority
- metric       : A business number or KPI (budget, traffic, conversion rates, etc.)
- action_item  : A committed next step with a responsible party or deadline
- problem      : A business pain point or challenge
- opportunity  : A potential growth area or strategic opening
- decision     : A direction or choice that was agreed upon
- constraint   : A limitation, risk, or boundary condition
- preference   : A stated style or approach preference
- relationship : A stakeholder connection or reporting relationship
- context      : Background about the company, people, or situation

CONTENT:
${contextMd.slice(0, 12000)}

Return ONLY valid JSON (null for fields not found):
{
  "stableFields": {
    "clientIndustry": "string or null",
    "projectType": "string or null",
    "contactName": "string or null"
  },
  "knowledge": [
    { "content": "...", "category": "requirement|priority|metric|action_item|problem|opportunity|decision|constraint|preference|relationship|context", "confidence": 0.0 }
  ],
  "stakeholders": [
    { "name": "...", "role": "...", "email": "", "notes": "" }
  ]
}`;
    const raw = await llmGenerateFn(extractPrompt);
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const extracted = JSON.parse(json) as {
      stableFields?: { clientIndustry?: string | null; projectType?: string | null; contactName?: string | null };
      knowledge?: { content: string; category: string; confidence: number }[];
      stakeholders?: { name: string; role: string; email?: string; notes?: string }[];
    };
    const sf = extracted.stableFields ?? {};
    if (sf.clientIndustry?.trim()) await memService.updateField(name, 'clientIndustry', sf.clientIndustry.trim());
    if (sf.projectType?.trim()) await memService.updateField(name, 'projectType', sf.projectType.trim());
    if (sf.contactName?.trim()) await memService.updateField(name, 'contactName', sf.contactName.trim());
    for (const k of extracted.knowledge ?? []) {
      if (k.content?.trim()) {
        await memService.addKnowledge(name, k.content, k.category as ClientKnowledgeEntry['category'], k.confidence ?? 0.8);
      }
    }
    for (const s of extracted.stakeholders ?? []) {
      if (s.name?.trim() && s.role?.trim()) {
        await memService.addStakeholder(name, {
          name: s.name,
          role: s.role,
          ...(s.email?.trim() ? { email: s.email } : {}),
          ...(s.notes?.trim() ? { notes: s.notes } : {}),
        });
      }
    }
  } catch (err) {
    log.warn({ err }, '[SuperClient] Failed to seed memory from contextMd');
  }
}

export function registerSuperClientRoutes(app: FastifyInstance, workdir: string): void {
  const superClientsRoot = path.join(workdir, 'super-clients');

  // GET /super-clients
  app.get('/super-clients', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      await mkdir(superClientsRoot, { recursive: true });
      const entries = await readdir(superClientsRoot, { withFileTypes: true });
      const clients: SuperClientMeta[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const meta = await readMeta(path.join(superClientsRoot, entry.name));
          clients.push(meta);
        } catch {
          // skip malformed entries
        }
      }
      clients.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return reply.send({ clients });
    } catch (err) {
      app.log.error(err, 'Failed to list super clients');
      return reply.code(500).send({ error: 'Failed to list super clients' });
    }
  });

  // POST /super-clients
  app.post('/super-clients', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { displayName?: string; url?: string; notes?: string } | undefined;

    const displayName = body?.displayName?.trim();
    if (!displayName) {
      return reply.code(400).send({ error: 'Missing required field: displayName' });
    }

    const name = slugify(displayName);
    if (!name) {
      return reply.code(400).send({ error: 'Client name must contain at least one letter or number' });
    }

    const dir = path.join(superClientsRoot, name);

    try {
      const s = await stat(dir);
      if (s.isDirectory()) {
        return reply.code(409).send({ error: `Super client "${name}" already exists` });
      }
    } catch { /* not found — proceed */ }

    await mkdir(dir, { recursive: true });

    const url = body?.url?.trim() || undefined;
    const notes = body?.notes?.trim() || undefined;

    const meta: SuperClientMeta = { name, displayName, url, createdAt: new Date().toISOString() };
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    // Initialize ClientMemory record (reuses existing memory infrastructure)
    const memService = new ClientMemoryService(workdir);
    if (!(await memService.get(name))) {
      await memService.createEmpty(displayName);
    }

    // Generate context.md via llmGenerateFn (respects configured provider/model)
    let contextMd = '';
    if (url || notes) {
      const parts: string[] = [
        'You are a client intelligence researcher. Given a company website URL and/or additional notes, extract structured information useful for building microsites and proposals.',
        'Focus on: product or service description, company tone and personality, industry and target market, key selling points and differentiators, visual brand cues (colors, style).',
        'Output clean, well-structured markdown without preamble.',
        '',
      ];
      if (url) parts.push(`Website URL: ${url}`);
      if (notes) parts.push(`Additional info:\n${notes}`);

      try {
        contextMd = await llmGenerateFn(parts.join('\n'));
      } catch (err) {
        app.log.warn({ err }, '[SuperClient] Context generation failed — creating empty context');
        contextMd = notes ?? '';
      }
    }

    await writeFile(path.join(dir, 'context.md'), contextMd);

    await seedClientMemory(name, displayName, contextMd, workdir, app.log);

    return reply.code(201).send({ name, displayName, contextMd });
  });

  // GET /super-clients/:name
  app.get('/super-clients/:name', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);

    try {
      const [meta, contextMd, history] = await Promise.all([
        readMeta(dir),
        readContext(dir),
        readHistory(dir),
      ]);
      return reply.send({ meta, contextMd, history });
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
  });

  // DELETE /super-clients/:name
  app.delete('/super-clients/:name', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);

    try {
      await rm(dir, { recursive: true, force: true });
      return reply.send({ ok: true });
    } catch (err) {
      app.log.error(err, 'Failed to delete super client');
      return reply.code(500).send({ error: 'Failed to delete super client' });
    }
  });

  // POST /super-clients/:name/chat  — SSE streaming chat
  // Note: streaming uses Anthropic SSE wire format directly (same constraint as other streaming
  // routes in this codebase). Non-streaming calls (context gen, distillation) use llmGenerateFn.
  app.post('/super-clients/:name/chat', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const body = req.body as { message?: string; activeProposalId?: string } | undefined;

    const message = body?.message?.trim();
    const activeProposalId = body?.activeProposalId?.trim() || undefined;
    if (!message) {
      return reply.code(400).send({ error: 'Missing required field: message' });
    }

    const dir = path.join(superClientsRoot, name);

    let meta: SuperClientMeta;
    try {
      meta = await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: unknown) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
    };

    try {
      const [contextMd, history, memResult, scFiles] = await Promise.all([
        readContext(dir),
        readHistory(dir),
        new ClientMemoryService(workdir).prepopulate(name),
        readScFiles(dir),
      ]);

      const extractedFiles = scFiles.filter((f) => f.status === 'extracted');

      // Build combined prompt — llmGenerateFn takes a single string and routes through
      // the Python LLM bridge which respects LLM_PROVIDER / provider-specific model config.
      const promptParts: string[] = [
        `You are a senior business development consultant and proposal strategist with 20+ years of experience crafting winning proposals across diverse industries. You are working on behalf of a team that manages the client "${meta.displayName}".`,
        ``,
        `For general questions: respond concisely with strategic insight. Stay focused on this client's world — their business, goals, audience, and brand.`,
        ``,
        `For proposals and formal documents: Write at a professional C-suite level. Use strong opening statements, evidence-based arguments, and compelling calls to action. Structure content with clear headings and purposeful body text — no filler, no generic statements. Draw exclusively from the client memory and ingested documents below; never invent facts not present in the context.`,
        ``,
        `NEVER ask the user to re-upload files listed in the Ingested Documents section — their content is already extracted into memory below.`,
        ``,
        `PROPOSAL GENERATION RULE: When the user asks you to create, write, generate, or draft a proposal (or any multi-section document), you MUST:`,
        `1. Write the full proposal in rich markdown — use # for the title, ## for section headings, **bold** for key terms, bullet lists, and a clear authoritative narrative body under each heading.`,
        `2. Wrap the ENTIRE proposal markdown inside a single XML tag like this:`,
        `<proposal title="Descriptive Proposal Title Here">`,
        `[full markdown content here]`,
        `</proposal>`,
        `3. Outside the tag, add only a brief 1-2 sentence confirmation that the proposal was saved.`,
        `Do NOT put any explanation or preamble inside the tag — only the markdown proposal body.`,
      ];

      // If the user has a proposal open, load it and inject into the prompt with two-mode editing rule
      let activeProposalContent: string | undefined;
      if (activeProposalId) {
        try {
          activeProposalContent = await readFile(path.join(dir, 'proposals', activeProposalId), 'utf-8');
          promptParts.push(
            `\n## Currently Open Proposal\n${activeProposalContent}`,
            `\nPROPOSAL EDITING RULE (applies only because a proposal is currently open):`,
            `When the user requests any change, use the LIGHTEST format that is sufficient:`,
            ``,
            `TIER 1 — PINPOINT (rename a heading, fix a number, change a date, replace a word or phrase):`,
            `  Use one or more self-closing <text-replace> tags — no section parsing needed:`,
            `  <text-replace find="exact original text" replace="new text" />`,
            `  • "exact original text" must appear verbatim in the proposal (copy it exactly).`,
            `  • Use the minimum number of replacements needed — usually just one.`,
            `  • Outside the tags write a brief 1-sentence confirmation only.`,
            ``,
            `TIER 2 — SECTION (reword a paragraph body, add/remove bullets, rewrite a section's content):`,
            `  Output ONE or MORE <section-update> tags — one per changed section only:`,
            `  <section-update heading="## Exact Heading Text">`,
            `  [full replacement body — do NOT include the heading line inside the tag]`,
            `  </section-update>`,
            `  Outside the tags write a brief 1-sentence confirmation only.`,
            `  NOTE: Tier 2 can only REPLACE section content — it cannot remove an entire section heading. To remove a section entirely, use Tier 3.`,
            ``,
            `TIER 3 — FULL REWRITE (add new sections, remove a section entirely, restructure, or change the whole proposal):`,
            `  Use the full <proposal title="...">...</proposal> tag containing the complete new markdown.`,
            `  When REMOVING a section, simply omit that section's heading and body from the new proposal.`,
            ``,
            `NEVER mix formats in one response. Default to Tier 1 for any single-string substitution.`,
          );
        } catch {
          // Proposal file not found — proceed without it
        }
      }

      if (extractedFiles.length > 0) {
        promptParts.push(
          `\n## Ingested Documents\nThe following files have been uploaded and their full content is extracted into memory below:\n` +
          extractedFiles.map((f) => `- ${f.fileName}`).join('\n'),
        );
      }

      if (contextMd.trim()) {
        promptParts.push(`\n## Client Intelligence\n\n${contextMd.trim()}`);
      }

      if (memResult.found && (Object.keys(memResult.stableFields).length > 0 || memResult.knowledge.length > 0 || memResult.stakeholders.length > 0)) {
        const memParts: string[] = ['\n## Accumulated Client Memory\nExtracted from ingested documents and prior conversations. Treat this as authoritative source material.'];

        const sf = memResult.stableFields;
        const profileLines: string[] = [];
        if (sf.clientIndustry?.value) profileLines.push(`- **Industry:** ${sf.clientIndustry.value}`);
        if (sf.projectType?.value) profileLines.push(`- **Project Type:** ${sf.projectType.value}`);
        if (sf.contactName?.value) profileLines.push(`- **Primary Contact:** ${sf.contactName.value}`);
        if (profileLines.length > 0) {
          memParts.push('\n### Client Profile');
          memParts.push(...profileLines);
        }

        if (memResult.stakeholders.length > 0) {
          memParts.push('\n### Key Stakeholders');
          for (const s of memResult.stakeholders) {
            memParts.push(`- **${s.name}** (${s.role})${s.email ? ` — ${s.email}` : ''}${s.notes ? `: ${s.notes}` : ''}`);
          }
        }
        if (memResult.knowledge.length > 0) {
          memParts.push('\n### Knowledge');
          for (const k of memResult.knowledge.slice(0, 60)) {
            memParts.push(`- [${k.category}] ${k.content}`);
          }
        }
        promptParts.push(memParts.join('\n'));
      }

      const recentHistory = history.slice(-20);
      if (recentHistory.length > 0) {
        promptParts.push('\n## Conversation History');
        for (const h of recentHistory) {
          promptParts.push(`${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`);
        }
      }

      promptParts.push(`\nUser: ${message}`);

      const combinedPrompt = promptParts.join('\n');

      // Call provider-agnostic LLM bridge — respects LLM_PROVIDER + model config
      const fullResponse = await llmGenerateFn(combinedPrompt);

      // Fake-stream word by word for a natural streaming UX
      const words = fullResponse.split(' ');
      for (const word of words) {
        send({ type: 'chunk', text: word + ' ' });
        await new Promise<void>((r) => setTimeout(r, 12));
      }

      // Detect proposal changes — apply the lightest format that fired
      let proposalSaved: ScProposal | undefined;
      let proposalUpdated: ScProposal | undefined;
      let displayResponse = fullResponse;

      const textReplacements = activeProposalId ? extractTextReplacements(fullResponse) : [];
      const sectionUpdates = activeProposalId ? extractSectionUpdates(fullResponse) : [];

      if (textReplacements.length > 0 && activeProposalId && activeProposalContent !== undefined) {
        // Tier 1: pinpoint string replacements — no section parsing
        try {
          const patchedContent = applyTextReplacements(activeProposalContent, textReplacements);
          const existingProposals = await readProposals(dir);
          const existingEntry = existingProposals.find((p) => p.fileName === activeProposalId);
          const title = existingEntry?.title ?? activeProposalId;
          proposalUpdated = await updateProposal(dir, activeProposalId, title, patchedContent);
        } catch (err) {
          app.log.warn({ err }, '[SuperClient] Failed to apply text replacements');
        }
        displayResponse = stripTextReplaceTags(fullResponse);
      } else if (sectionUpdates.length > 0 && activeProposalId && activeProposalContent !== undefined) {
        // Tier 2: section-body patches
        try {
          const patchedContent = patchProposalSections(activeProposalContent, sectionUpdates);
          const existingProposals = await readProposals(dir);
          const existingEntry = existingProposals.find((p) => p.fileName === activeProposalId);
          const title = existingEntry?.title ?? activeProposalId;
          proposalUpdated = await updateProposal(dir, activeProposalId, title, patchedContent);
        } catch (err) {
          app.log.warn({ err }, '[SuperClient] Failed to patch proposal sections');
        }
        displayResponse = stripSectionUpdateTags(fullResponse);
      } else {
        // Tier 3: full proposal tag
        const proposalMatch = extractProposalTag(fullResponse);
        if (proposalMatch) {
          try {
            if (activeProposalId && activeProposalContent !== undefined) {
              proposalUpdated = await updateProposal(dir, activeProposalId, proposalMatch.title, proposalMatch.content);
            } else {
              proposalSaved = await saveProposal(dir, proposalMatch.title, proposalMatch.content);
            }
          } catch (err) {
            app.log.warn({ err }, '[SuperClient] Failed to save/update proposal');
          }
          displayResponse = stripProposalTag(fullResponse);
        }
      }

      // Persist turn to history.
      // User and assistant get distinct timestamps (+1 ms apart) so timestamp-
      // based sort always places the user message before its paired assistant reply.
      const userTs      = new Date().toISOString();
      const assistantTs = new Date(Date.now() + 1).toISOString();
      const editCtx = activeProposalId ? ({ editContext: 'proposal' } as const) : {};
      const updatedHistory: HistoryEntry[] = [
        ...history,
        { role: 'user',      content: message,         createdAt: userTs,      ...editCtx },
        { role: 'assistant', content: displayResponse, createdAt: assistantTs, ...editCtx },
      ];
      await writeFile(path.join(dir, 'history.json'), JSON.stringify(updatedHistory, null, 2));

      send({
        type: 'done',
        text: displayResponse,
        ...(proposalSaved ? { proposalSaved } : {}),
        ...(proposalUpdated ? { proposalUpdated } : {}),
      });

      // Background memory distillation — non-blocking, uses llmGenerateFn
      void distillChatTurn(workdir, name, meta.displayName, message, displayResponse, app.log);

    } catch (err) {
      app.log.error(err, 'Super client chat error');
      send({ type: 'error', message: (err as Error).message });
    } finally {
      reply.raw.end();
    }
  });

  // POST /super-clients/:name/history/append — persist arbitrary messages (e.g. edit actions)
  app.post('/super-clients/:name/history/append', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
    const body = req.body as { messages?: Array<{ role: string; content: string; createdAt?: string; editContext?: string }> } | undefined;
    const entries = body?.messages ?? [];
    if (!Array.isArray(entries) || entries.length === 0) {
      return reply.code(400).send({ error: 'messages array required' });
    }
    const history = await readHistory(dir);
    const now = new Date().toISOString();
    const toAppend: HistoryEntry[] = entries.map((m) => ({
      role: (m.role === 'user' || m.role === 'assistant' ? m.role : 'user') as 'user' | 'assistant',
      content: String(m.content ?? ''),
      createdAt: m.createdAt ?? now,
      ...(m.editContext === 'microsite' || m.editContext === 'proposal' ? { editContext: m.editContext } : {}),
    }));
    await writeFile(path.join(dir, 'history.json'), JSON.stringify([...history, ...toAppend], null, 2));
    return reply.send({ ok: true });
  });

  // GET /super-clients/:name/documents
  app.get('/super-clients/:name/documents', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    try {
      await readMeta(dir);
      const files = await readScFiles(dir);
      return reply.send({ files });
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
  });

  // POST /super-clients/:name/documents/upload  — multipart, .pdf/.txt/.md, max 50 MB
  app.post('/super-clients/:name/documents/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);

    let meta: SuperClientMeta;
    try {
      meta = await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }

    const uploadsDir = path.join(dir, 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    const ALLOWED = ['.pdf', '.txt', '.md'];
    const MAX_SIZE = 50 * 1024 * 1024;

    const parts = req.parts();
    const added: ScFile[] = [];
    const filesToExtract: { destPath: string; safeName: string }[] = [];

    for await (const part of parts) {
      if (part.type !== 'file') continue;

      const rawName = part.filename ?? 'unnamed';
      const ext = path.extname(rawName).toLowerCase();
      if (!ALLOWED.includes(ext)) {
        await part.toBuffer();
        continue;
      }

      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const buffer = await part.toBuffer();

      if (buffer.length > MAX_SIZE) {
        return reply.code(400).send({ error: `File "${rawName}" exceeds the 50 MB limit` });
      }

      const destPath = path.join(uploadsDir, safeName);
      const resolved = path.resolve(destPath);
      if (!resolved.startsWith(path.resolve(uploadsDir))) {
        return reply.code(400).send({ error: `Invalid file name: ${rawName}` });
      }

      await writeFile(destPath, buffer);

      const entry: ScFile = { fileName: safeName, size: buffer.length, uploadedAt: new Date().toISOString(), status: 'processing' };
      const existing = await readScFiles(dir);
      const idx = existing.findIndex((f) => f.fileName === safeName);
      if (idx !== -1) existing[idx] = entry; else existing.push(entry);
      await writeScFiles(dir, existing);
      added.push(entry);
      filesToExtract.push({ destPath, safeName });
    }

    // Run extractions sequentially in the background to avoid concurrent
    // read-modify-write races on memory.json.
    void (async () => {
      for (const f of filesToExtract) {
        await extractFileToMemory(workdir, name, meta.displayName, f.destPath, f.safeName, dir, app.log);
      }
    })();

    if (added.length === 0) {
      return reply.code(400).send({ error: 'No valid files provided. Allowed: .pdf, .txt, .md' });
    }

    return reply.code(201).send({ files: added });
  });

  // DELETE /super-clients/:name/documents/:fileName
  app.delete('/super-clients/:name/documents/:fileName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, fileName } = req.params as { name: string; fileName: string };
    const dir = path.join(superClientsRoot, name);

    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }

    const filePath = path.join(dir, 'uploads', fileName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'uploads')))) {
      return reply.code(400).send({ error: 'Invalid file name' });
    }

    await rm(filePath, { force: true });
    const files = (await readScFiles(dir)).filter((f) => f.fileName !== fileName);
    await writeScFiles(dir, files);

    const memService = new ClientMemoryService(workdir);
    await memService.removeKnowledgeByDocument(name, fileName);

    return reply.send({ ok: true });
  });

  // GET /super-clients/:name/proposals
  app.get('/super-clients/:name/proposals', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    try {
      await readMeta(dir);
      return reply.send({ proposals: await readProposals(dir) });
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
  });

  // GET /super-clients/:name/proposals/:fileName
  app.get('/super-clients/:name/proposals/:fileName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, fileName } = req.params as { name: string; fileName: string };
    const filePath = path.join(superClientsRoot, name, 'proposals', fileName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(superClientsRoot, name, 'proposals')))) {
      return reply.code(400).send({ error: 'Invalid file name' });
    }
    try {
      const content = await readFile(filePath, 'utf-8');
      return reply.send({ content });
    } catch {
      return reply.code(404).send({ error: 'Proposal not found' });
    }
  });

  // DELETE /super-clients/:name/proposals/:fileName
  app.delete('/super-clients/:name/proposals/:fileName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, fileName } = req.params as { name: string; fileName: string };
    const dir = path.join(superClientsRoot, name);
    const filePath = path.join(dir, 'proposals', fileName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'proposals')))) {
      return reply.code(400).send({ error: 'Invalid file name' });
    }
    await rm(filePath, { force: true });
    const remaining = (await readProposals(dir)).filter((p) => p.fileName !== fileName);
    await writeFile(path.join(dir, 'proposals.json'), JSON.stringify(remaining, null, 2));
    return reply.send({ ok: true });
  });

  // POST /super-clients/:name/microsites  — save a generated microsite AST
  app.post('/super-clients/:name/microsites', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const body = req.body as { ast?: unknown; proposalTitle?: string } | undefined;
    if (!body?.ast) return reply.code(400).send({ error: 'Missing ast' });

    const dir = path.join(superClientsRoot, name);
    let meta: SuperClientMeta;
    try { meta = await readMeta(dir); } catch { return reply.code(404).send({ error: `Super client "${name}" not found` }); }

    const micrositesDir = path.join(dir, 'microsites');
    await mkdir(micrositesDir, { recursive: true });

    const now = new Date();
    // Include milliseconds + 4-char random suffix to prevent collisions when two
    // microsites are saved within the same second.
    const id = `${now.toISOString().replace(/[:.]/g, '-').slice(0, 23)}-${Math.random().toString(36).slice(2, 6)}`;
    const proposalTitle = body.proposalTitle?.trim() ?? 'Proposal';
    const micrositeTitle = proposalTitle.replace(/\bProposal\b/g, 'Microsite').replace(/\bproposal\b/g, 'microsite');

    const existing = await readMicrosites(dir);
    const priorCount = existing.filter((m) => m.proposalTitle === proposalTitle).length;
    const version = priorCount + 1;

    const entry: ScMicrosite = {
      id,
      title: `${micrositeTitle} (v${version})`,
      proposalTitle,
      savedAt: now.toISOString(),
      version,
    };

    await writeFile(path.join(micrositesDir, `${id}.json`), JSON.stringify(body.ast, null, 2));
    existing.unshift(entry);
    await writeMicrosites(dir, existing);

    return reply.code(201).send({ microsite: entry });
  });

  // GET /super-clients/:name/microsites
  app.get('/super-clients/:name/microsites', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    try { await readMeta(dir); } catch { return reply.code(404).send({ error: `Super client "${name}" not found` }); }
    return reply.send({ microsites: await readMicrosites(dir) });
  });

  // GET /super-clients/:name/microsites/:id
  app.get('/super-clients/:name/microsites/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    const filePath = path.join(superClientsRoot, name, 'microsites', `${id}.json`);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(superClientsRoot, name, 'microsites')))) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    try {
      const raw = await readFile(filePath, 'utf-8');
      return reply.send({ ast: JSON.parse(raw) });
    } catch {
      return reply.code(404).send({ error: 'Microsite not found' });
    }
  });

  // DELETE /super-clients/:name/microsites/:id
  app.delete('/super-clients/:name/microsites/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    const dir = path.join(superClientsRoot, name);
    const filePath = path.join(dir, 'microsites', `${id}.json`);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'microsites')))) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    await rm(filePath, { force: true });
    const remaining = (await readMicrosites(dir)).filter((m) => m.id !== id);
    await writeMicrosites(dir, remaining);
    return reply.send({ ok: true });
  });

  // GET /super-clients/:name/generations
  app.get('/super-clients/:name/generations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    try {
      await readMeta(dir); // 404 guard
      return reply.send(await readGenerations(dir));
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
  });

  // PUT /super-clients/:name/generations/:id — upsert one generation entry
  app.put('/super-clients/:name/generations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });
    const dir = path.join(superClientsRoot, name);
    const body = req.body as GenerationEntry | undefined;
    if (!body || body.id !== id) return reply.code(400).send({ error: 'Body must include matching id' });
    try {
      await readMeta(dir); // 404 guard
      const existing = await readGenerations(dir);
      const updated = [...existing.filter((g) => g.id !== id), body];
      await writeGenerations(dir, updated);
      return reply.send({ ok: true });
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
  });

  // DELETE /super-clients/:name/generations/:id
  app.delete('/super-clients/:name/generations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });
    const dir = path.join(superClientsRoot, name);
    try {
      await readMeta(dir); // 404 guard
      const existing = await readGenerations(dir);
      await writeGenerations(dir, existing.filter((g) => g.id !== id));
      return reply.send({ ok: true });
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
  });

  // POST /super-clients/:name/microsites/:id/edit  — LLM patch edit on microsite HTML
  app.post('/super-clients/:name/microsites/:id/edit', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });

    const body = req.body as { instruction?: string; currentHtml?: string } | undefined;
    const instruction = body?.instruction?.trim();
    if (!instruction) return reply.code(400).send({ error: 'Missing instruction' });

    const dir = path.join(superClientsRoot, name);
    const filePath = path.join(dir, 'microsites', `${id}.json`);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'microsites')))) {
      return reply.code(400).send({ error: 'Invalid id' });
    }

    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>;
    } catch {
      return reply.code(404).send({ error: 'Microsite not found' });
    }

    const sections = ast.sections as Array<Record<string, unknown>> | undefined;
    // Use client-provided HTML when available — it reflects in-memory edits that
    // may not have been persisted to disk yet (e.g. after a failed save).
    // Strip preview injections (srcdoc-only CSS/JS) so they are never saved to disk
    // and never confuse edit operations that search/replace within the raw HTML.
    const diskHtml = stripPreviewInjections((sections?.[0]?.customHtml as string | undefined) ?? '');
    const html = stripPreviewInjections(body?.currentHtml?.trim() || diskHtml) || '';
    if (!html) return reply.code(400).send({ error: 'Microsite has no HTML content' });

    // ── Microsite edit log — shows instruction type and key metadata ────────────
    {
      const instrType = instruction.split(':')[0] ?? instruction.slice(0, 40);
      const isLLM     = instruction.startsWith('__ELEMENT_EDIT__:');
      const userText  = instruction.includes('||')
        ? instruction.slice(instruction.lastIndexOf('||') + 2).slice(0, 120)
        : instruction.slice(0, 120);
      console.log('\n╔══ MICROSITE EDIT ════════════════════════════════════════════');
      console.log(`║ Microsite  : ${id}`);
      console.log(`║ Instruction: ${instrType}`);
      console.log(`║ HTML source: ${body?.currentHtml ? 'client (in-memory)' : 'disk'} — ${html.length} chars`);
      if (isLLM) {
        console.log(`║ → LLM call will be made`);
        console.log(`║ User prompt: ${userText}`);
      } else {
        console.log(`║ → Deterministic (no LLM)`);
      }
      console.log('╚══════════════════════════════════════════════════════════════');
    }

    // ── Instruction format convention ────────────────────────────────────────
    // Deterministic instructions follow: __VERB__:[cssPath]||[payload](||[hint])
    // The hint is the selected element's outerHTML (≤400 chars), sent by the
    // client to aid fallback lookups. It is ALWAYS the last ||-segment and
    // MUST be ignored by regexes that capture URLs or text values.
    // Safe pattern: ((?:https?://|data:)[^\|]+)(?:\|\|[\s\S]*)?$
    //   or for text: ([\s\S]+?)(?:\|\|[\s\S]*)?$  (non-greedy stops before hint)
    // Never use (.+)$ or ([\s\S]+)$ for a URL/text group — those eat the hint.
    // ─────────────────────────────────────────────────────────────────────────

    // Shared context flags used by both video removal and video injection below
    const userPart = instruction.includes('||') ? instruction.slice(instruction.lastIndexOf('||') + 2) : instruction;
    const isElementEditCtx = instruction.startsWith('__ELEMENT_EDIT__:');

    // ── Deterministic video-background removal ────────────────────────────────
    // Match only against the user-typed part of the instruction (after last ||)
    // to avoid false positives from outerHtml content in __ELEMENT_EDIT__ payloads.
    const isRemoveVideoIntent =
      /\b(?:remove|delete|clear|hide)\b[\s\S]{0,40}\b(?:video|background[\s-]video|video[\s-]background|vimeo|youtube)\b/i.test(userPart) ||
      /\b(?:video|background[\s-]video|video[\s-]background|vimeo|youtube)\b[\s\S]{0,40}\b(?:remove|delete|clear|hide)\b/i.test(userPart);
    if (isRemoveVideoIntent) {
      // Remove ALL iframe types — Vimeo, YouTube, and any other video embed
      // [\s\S]*? handles both same-line and multi-line iframes
      function removeVideoIframes(src: string): string {
        // Remove Vimeo/YouTube iframes (any format)
        let out = src.replace(
          /<iframe\b[^>]*src="[^"]*(?:vimeo\.com|youtube\.com|youtu\.be)[^"]*"[\s\S]*?<\/iframe>/gi, '',
        );
        // Also remove self-closing variant
        out = out.replace(/<iframe\b[^>]*src="[^"]*(?:vimeo\.com|youtube\.com|youtu\.be)[^"]*"[^>]*\/>/gi, '');
        // Also remove any generic video-player iframe (poster frame, etc.) that's position:absolute
        out = out.replace(
          /<iframe\b[^>]*style="[^"]*position\s*:\s*absolute[^"]*"[^>]*(?:allow="autoplay|pointer-events:none)[^>]*[\s\S]*?<\/iframe>/gi, '',
        );
        return out;
      }

      // If element was selected, scope removal to its parent section for safety
      const elementEditForRemoval = instruction.match(/^__ELEMENT_EDIT__:([\s\S]*?)\|\|/s);
      if (elementEditForRemoval) {
        const cssPath = elementEditForRemoval[1].trim();
        const elBounds = cssPath ? findByPath(html, cssPath) : null;
        const sectionBounds = extractAllTopLevelSections(html);
        const parentSec = elBounds
          ? sectionBounds.find(s => s.start <= elBounds.start && elBounds.end <= s.end)
          : null;
        if (parentSec) {
          const sectionHtml = html.slice(parentSec.start, parentSec.end);
          const cleaned = removeVideoIframes(sectionHtml);
          if (cleaned !== sectionHtml) {
            const updatedHtml = html.slice(0, parentSec.start) + cleaned + html.slice(parentSec.end);
            return saveValidatedEdit(updatedHtml, 'Video background removed');
          }
        }
      }

      // If user had an element selected, don't fall back to global removal —
      // that would remove the wrong section's video. Return a scoped error.
      if (isElementEditCtx) {
        return reply.code(422).send({ error: 'No video found in the selected section to remove' });
      }
      // No element context — apply globally across the whole microsite
      const withoutVideo = removeVideoIframes(html);
      if (withoutVideo !== html) {
        return saveValidatedEdit(withoutVideo, 'Video background removed');
      }
      return reply.code(422).send({
        error: 'No video iframe found in this microsite to remove',
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Deterministic video-background injection (bypasses LLM entirely) ──────
    const vimeoIdMatch = instruction.match(/vimeo\.com\/(\d+)/i);
    const youtubeIdMatch = instruction.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    // When the user has an element selected (__ELEMENT_EDIT__) and is NOT explicitly asking
    // for a background video, let the __ELEMENT_EDIT__ handler deal with the URL so the video
    // is placed where the user intended (below, beside, inside the section) rather than always
    // being injected as a fullscreen background in the first <section>.
    const isVideoBgIntent = /\b(?:background|bg)\b/i.test(userPart);
    if ((vimeoIdMatch ?? youtubeIdMatch) && !(isElementEditCtx && !isVideoBgIntent)) {
      const isVimeo = !!vimeoIdMatch;
      const videoId = (vimeoIdMatch ?? youtubeIdMatch)![1];
      const src = isVimeo
        ? `https://player.vimeo.com/video/${videoId}?background=1&autoplay=1&loop=1&muted=1&byline=0&title=0`
        : `https://www.youtube.com/embed/${videoId}?autoplay=1&loop=1&mute=1&controls=0&playlist=${videoId}`;
      // Cover trick: center + oversized so 16:9 video fills any aspect-ratio container
      const videoIframe = `<iframe src="${src}" style="position:absolute;top:50%;left:50%;width:100vw;height:56.25vw;min-height:100%;min-width:177.78vh;transform:translate(-50%,-50%);border:none;pointer-events:none;z-index:0" allow="autoplay; fullscreen; picture-in-picture" frameborder="0"></iframe>`;

      // Remove any existing video iframes
      let updatedHtml = html.replace(/<iframe\b[^>]*src="[^"]*(?:vimeo\.com|youtube\.com|youtu\.be)[^"]*"[^>]*><\/iframe>/gi, '');

      // Strip background-image from photo/background elements so video shows through
      updatedHtml = updatedHtml.replace(
        /(\.(?:hero|banner|splash)[-_]?(?:photo|image|img|bg|background)[^{]*\{[^}]*)background-image\s*:[^;]+;?\s*/gi,
        '$1',
      );

      // Helper: patch a <section> opening tag to add position:relative;overflow:hidden
      // then prepend the video iframe as its first child.
      function injectVideoIntoSection(src: string, secStart: number): string {
        const tagOpenEnd = src.indexOf('>', secStart);
        if (tagOpenEnd === -1) return src;
        const rawAttrs = src.slice(secStart + '<section'.length, tagOpenEnd);
        const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
        const styleMatch = styleRx.exec(rawAttrs);
        let patchedAttrs: string;
        if (styleMatch) {
          const cleaned = styleMatch[1]
            .replace(/\bposition\s*:[^;]+;?\s*/g, '')
            .replace(/\boverflow\s*:[^;]+;?\s*/g, '')
            .trim().replace(/;$/, '');
          patchedAttrs = rawAttrs.replace(styleRx, `style="${cleaned ? cleaned + '; ' : ''}position:relative;overflow:hidden"`);
        } else {
          patchedAttrs = `${rawAttrs} style="position:relative;overflow:hidden"`;
        }
        return src.slice(0, secStart) +
          `<section${patchedAttrs}>\n  ${videoIframe}` +
          src.slice(tagOpenEnd + 1);
      }

      // When the user selected a specific element, inject into its parent section.
      // Otherwise fall back to the first <section>.
      const elementEditForVideo = instruction.match(/^__ELEMENT_EDIT__:([\s\S]*?)\|\|[\s\S]*?\|\|[\s\S]+$/s);
      let injected = false;
      if (elementEditForVideo) {
        const cssPath = elementEditForVideo[1].trim();
        const elBounds = cssPath ? findByPath(updatedHtml, cssPath) : null;
        if (elBounds) {
          const sections = extractAllTopLevelSections(updatedHtml);
          const parentSec = sections.find(s => s.start <= elBounds.start && elBounds.end <= s.end);
          if (parentSec) {
            updatedHtml = injectVideoIntoSection(updatedHtml, parentSec.start);
            injected = true;
          }
        }
      }
      if (!injected) {
        // Default: inject into the first <section>
        const firstSecIdx = updatedHtml.search(/<section\b/i);
        if (firstSecIdx !== -1) {
          updatedHtml = injectVideoIntoSection(updatedHtml, firstSecIdx);
        }
      }

      const summary = `Added ${isVimeo ? 'Vimeo' : 'YouTube'} video background`;
      return saveValidatedEdit(updatedHtml, summary);
    }
    // ── Deterministic logo injection (bypasses LLM entirely) ─────────────────
    const logoInjectMatch = instruction.match(/^__LOGO_INJECT__:([\s\S]+)$/);
    if (logoInjectMatch) {
      const logoSrc = logoInjectMatch[1].trim();
      const logoDiv = `<div id="__brand-logo__" style="position:fixed;top:16px;left:20px;z-index:2147483647;pointer-events:none;"><img src="${logoSrc}" style="height:44px;width:auto;object-fit:contain;display:block;" alt="" /></div>`;
      const hideScript = `<script>/*__logo-inject__*/(function(){function h(){var els=document.querySelectorAll('*');for(var i=0;i<els.length;i++){var t=(els[i].children.length===0?els[i].textContent||'':'');if(/prepared\\s*by/i.test(t)){var p=els[i].parentElement;(p&&p!==document.body?p:els[i]).style.display='none';}}var hdr=document.querySelector('header,nav,[class*="header"],[class*="navbar"]');if(hdr){var brand=hdr.querySelector('[class*="logo"],[class*="brand"],[class*="navbar-brand"]');if(brand){brand.style.visibility='hidden';}else{var first=hdr.firstElementChild;if(first&&first.id!=='__brand-logo__'){first.style.visibility='hidden';}}}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',h);}else{h();}})()</script>`;
      const injection = logoDiv + hideScript;
      // Remove any existing logo injection (div + companion script)
      let updatedHtml = html
        .replace(/<div[^>]*id="__brand-logo__"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<script[^>]*>\/\*__logo-inject__\*\/[\s\S]*?<\/script>/gi, '');
      updatedHtml = /<body[^>]*>/i.test(updatedHtml)
        ? updatedHtml.replace(/(<body[^>]*>)/i, `$1${injection}`)
        : injection + updatedHtml;
      return saveValidatedEdit(updatedHtml, 'Logo updated');
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── Logo replacement — finds the actual logo <img> and replaces its src ───
    // More surgical than __LOGO_INJECT__ (which adds a floating overlay).
    // Tries four strategies: alt*=logo, class*=logo, first img in nav/header, img.logo.
    const logoReplaceMatch = instruction.match(/^__LOGO_REPLACE__:(https?:\/\/.+)$/);
    if (logoReplaceMatch) {
      const newSrc = logoReplaceMatch[1].trim();
      let updatedHtml = html;
      let replaced   = false;

      // Helper: replace src in a matched <img> tag regardless of attribute order
      const swapSrc = (tag: string) => {
        replaced = true;
        return tag
          .replace(/(\bsrc=["'])[^"']+(['"])/i, `$1${newSrc}$2`)
          .replace(/(\bsrc=)[^\s>]+/i, `$1"${newSrc}"`);
      };

      // 1. <img alt="...logo..."> — most reliable signal
      if (!replaced) {
        updatedHtml = html.replace(
          /<img\b[^>]*\balt="[^"]*logo[^"]*"[^>]*/gi,
          (tag) => swapSrc(tag),
        );
      }

      // 2. <img class="...logo...">
      if (!replaced) {
        updatedHtml = html.replace(
          /<img\b[^>]*\bclass="[^"]*logo[^"]*"[^>]*/gi,
          (tag) => swapSrc(tag),
        );
      }

      // 3. First <img> inside <nav> or <header>
      if (!replaced) {
        updatedHtml = html.replace(
          /(<(?:nav|header)\b[^>]*>[\s\S]*?)(<img\b[^>]*)/i,
          (_, before, imgTag) => `${before}${swapSrc(imgTag)}`,
        );
      }

      // 4. <img> with src that looks like a logo (contains "logo" in the URL)
      if (!replaced) {
        updatedHtml = html.replace(
          /<img\b[^>]*\bsrc="[^"]*logo[^"]*"[^>]*/gi,
          (tag) => swapSrc(tag),
        );
      }

      if (updatedHtml !== html) {
        return saveValidatedEdit(updatedHtml, 'Logo replaced');
      }

      // Fallback: use the existing overlay logo injection
      // (adds a fixed-position logo div — covers the old logo visually)
      const logoSrc = newSrc;
      const logoDiv = `<div id="__brand-logo__" style="position:fixed;top:16px;left:20px;z-index:2147483647;pointer-events:none;"><img src="${logoSrc}" style="height:44px;width:auto;object-fit:contain;display:block;" alt="" /></div>`;
      const hideScript = `<script>/*__logo-inject__*/(function(){function h(){var els=document.querySelectorAll('*');for(var i=0;i<els.length;i++){var t=(els[i].children.length===0?els[i].textContent||'':'');if(/prepared\\s*by/i.test(t)){var p=els[i].parentElement;(p&&p!==document.body?p:els[i]).style.display='none';}}var hdr=document.querySelector('header,nav,[class*="header"],[class*="navbar"]');if(hdr){var brand=hdr.querySelector('[class*="logo"],[class*="brand"],[class*="navbar-brand"]');if(brand){brand.style.visibility='hidden';}else{var first=hdr.firstElementChild;if(first&&first.id!=='__brand-logo__'){first.style.visibility='hidden';}}}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',h);}else{h();}})()</script>`;
      let overlayHtml = html
        .replace(/<div[^>]*id="__brand-logo__"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<script[^>]*>\/\*__logo-inject__\*\/[\s\S]*?<\/script>/gi, '');
      overlayHtml = /<body[^>]*>/i.test(overlayHtml)
        ? overlayHtml.replace(/(<body[^>]*>)/i, `$1${logoDiv}${hideScript}`)
        : logoDiv + hideScript + overlayHtml;
      return saveValidatedEdit(overlayHtml, 'Logo updated');
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Surgical logo swap — path-targeted ───────────────────────────────────
    // Format: __LOGO_SWAP__:[cssPath]||[imageUrl]
    // Handles three cases:
    //   SVG element   → replaces the entire <svg>…</svg> with <img src="…">
    //   img element   → replaces its src (strips onerror fallback)
    //   text element  → replaces inner content with <img>
    const logoSwapMatch = instruction.match(/^__LOGO_SWAP__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)$/s);
    if (logoSwapMatch) {
      const cssPath = logoSwapMatch[1].trim();
      const newSrc  = logoSwapMatch[2].trim();
      const imgTag  = `<img src="${newSrc}" alt="logo" style="height:44px;width:auto;max-width:180px;object-fit:contain;display:block;flex-shrink:0;">`;

      // Strip any prior overlay artifacts before patching
      const cleanedHtml = html
        .replace(/<div[^>]*id="__brand-logo__"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<script[^>]*>\/\*__logo-inject__\*\/[\s\S]*?<\/script>/gi, '');

      const bounds = findByPath(cleanedHtml, cssPath);
      if (bounds) {
        const elHtml = cleanedHtml.slice(bounds.start, bounds.end);

        // Case: SVG element — replace the entire element with an <img>
        if (/^<svg\b/i.test(elHtml)) {
          return saveValidatedEdit(
            cleanedHtml.slice(0, bounds.start) + imgTag + cleanedHtml.slice(bounds.end),
            'Logo updated',
          );
        }

        // Case: element already has an <img> child — replace its src + strip onerror
        // Non-greedy [^>]*? so we match the real src= not one inside onerror="...src=..."
        if (/<img\b/i.test(elHtml)) {
          const patched = elHtml
            .replace(/(<img\b[^>]*?)\bsrc="[^"]*"/i, `$1src="${newSrc}"`)
            .replace(/(<img\b[^>]*?)\bonerror="[^"]*"/gi, '$1');
          return saveValidatedEdit(
            cleanedHtml.slice(0, bounds.start) + patched + cleanedHtml.slice(bounds.end),
            'Logo updated',
          );
        }

        // Case: text/anchor element — keep outer tag, replace innerHTML with img
        const openTagEnd = elHtml.indexOf('>');
        const closeTagM  = elHtml.match(/<\/(\w+)>\s*$/);
        if (openTagEnd !== -1 && closeTagM) {
          const openTag  = elHtml.slice(0, openTagEnd + 1);
          const closeTag = closeTagM[0];
          return saveValidatedEdit(
            cleanedHtml.slice(0, bounds.start) + openTag + imgTag + closeTag + cleanedHtml.slice(bounds.end),
            'Logo updated',
          );
        }
      }

      // Fallback — overlay injection (path not found or unhandled shape)
      const logoDiv2 = `<div id="__brand-logo__" style="position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;height:64px;padding-left:20px;">${imgTag}</div>`;
      const fbHtml = /<body[^>]*>/i.test(cleanedHtml)
        ? cleanedHtml.replace(/(<body[^>]*>)/i, `$1${logoDiv2}`)
        : logoDiv2 + cleanedHtml;
      return saveValidatedEdit(fbHtml, 'Logo updated');
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Deterministic background-image / img-src injection ───────────────────
    const imageInjectMatch = instruction.match(/^__IMAGE_INJECT__:(https?:\/\/.+)$/);
    if (imageInjectMatch) {
      const newUrl = imageInjectMatch[1].trim();
      let updatedHtml = html;

      // 1. Replace any background-image: url(...) in style attributes and <style> blocks
      updatedHtml = updatedHtml.replace(
        /\bbackground-image\s*:\s*url\(\s*['"]?(https?:\/\/[^'")\s]+)['"]?\s*\)/gi,
        () => `background-image: url('${newUrl}')`,
      );

      // 2. If unchanged, try data-bg="..." attribute (lazy-load libs)
      if (updatedHtml === html) {
        updatedHtml = html.replace(
          /\bdata-bg=["'](https?:\/\/[^'"]+)["']/gi,
          () => `data-bg="${newUrl}"`,
        );
      }

      // 3. If still unchanged, replace first <img src="..."> in the document
      // Non-greedy [^>]*? prevents matching src= inside onerror handlers.
      if (updatedHtml === html) {
        updatedHtml = html.replace(
          /(<img\b[^>]*?\bsrc=["'])(https?:\/\/[^'"]+)(["'])/i,
          (_m, pre, _old, post) => `${pre}${newUrl}${post}`,
        );
      }

      if (updatedHtml !== html) {
        return saveValidatedEdit(updatedHtml, 'Image updated');
      }
      // No match found — fall through to LLM with original instruction text
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Scoped image injection — replaces image in a specific element ─────────
    // Triggered when user selects an element AND pastes an image URL.
    // Format: __IMAGE_INJECT_SCOPED__:[cssPath]||[imageUrl]
    // Tries to replace background-image / img src / data-bg within that element.
    // Falls back to the element's parent section if the element itself has no image.
    const scopedImageMatch = instruction.match(/^__IMAGE_INJECT_SCOPED__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|([\s\S]*))?$/s);
    if (scopedImageMatch) {
      const cssPath   = scopedImageMatch[1].trim();
      const newUrl    = scopedImageMatch[2].trim();
      const hintHtml  = (scopedImageMatch[3] ?? '').trim();

      function injectImageInto(target: string): string {
        // 1. CSS background-image (any URL format)
        let out = target.replace(
          /\bbackground-image\s*:\s*url\(\s*['"]?[^'")\s]+['"]?\s*\)/gi,
          () => `background-image: url('${newUrl}')`,
        );
        if (out !== target) return out;
        // 2. <img src="..."> — matches the FIRST src= in the tag (non-greedy [^>]*?).
        // Without ?, the greedy match skips the real src and lands on src= inside
        // onerror handlers (e.g. onerror="this.src='fallback'"), leaving the
        // visible image unchanged while only the fallback URL gets replaced.
        out = target.replace(
          /(<img\b[^>]*?\bsrc=["'])([^'"]+)(["'])/i,
          (_m, pre, _old, post) => `${pre}${newUrl}${post}`,
        );
        if (out !== target) return out;
        // 3. data-bg lazy-load attribute
        out = target.replace(/\bdata-bg=["'][^'"]*["']/gi, () => `data-bg="${newUrl}"`);
        return out;
      }

      // Also directly patch src attribute on a void element (img/source/input type=image)
      // when findByPath locates it — handles elements with relative or data: src values.
      // Uses <img\b[^>]*?\bsrc= (non-greedy) so the first src= in the tag is matched,
      // never the src= inside an onerror="this.src='fallback'" handler.
      function patchSrcOnElement(target: string): string {
        const patched = target.replace(
          /(<img\b[^>]*?\bsrc=["'])([^'"]+)(["'])/i,
          (_m, pre, _old, post) => `${pre}${newUrl}${post}`,
        );
        if (patched !== target) return patched;
        // Fallback for non-img void elements (source, input[type=image], etc.)
        return target.replace(
          /(\bsrc=["'])([^'"]+)(["'])/i,
          (_m, pre, _old, post) => `${pre}${newUrl}${post}`,
        );
      }

      const bounds = findByPath(html, cssPath);
      if (bounds) {
        const elementHtml = html.slice(bounds.start, bounds.end);
        const elTag = elementHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
        const VOID_TAGS = new Set(['img','source','input','video','audio']);

        // For void/media elements, always replace src directly — don't fall through
        if (VOID_TAGS.has(elTag)) {
          const patched = patchSrcOnElement(elementHtml);
          if (patched !== elementHtml) {
            return saveValidatedEdit(html.slice(0, bounds.start) + patched + html.slice(bounds.end), 'Image updated');
          }
        }

        const modifiedEl = injectImageInto(elementHtml);
        if (modifiedEl !== elementHtml) {
          const updatedHtml = html.slice(0, bounds.start) + modifiedEl + html.slice(bounds.end);
          return saveValidatedEdit(updatedHtml, 'Image updated');
        }

        // Element itself has no image — walk UP the CSS path one level at a time.
        // This handles any HTML structure (section, div, article, etc.) without
        // relying on extractAllTopLevelSections which only finds <section> tags.
        const pathParts = cssPath.split(/\s*>\s*/).filter(Boolean);
        for (let i = pathParts.length - 1; i >= 1; i--) {
          const ancestorPath = pathParts.slice(0, i).join(' > ');
          const ancestorBounds = findByPath(html, ancestorPath);
          if (!ancestorBounds) continue;
          const ancestorHtml = html.slice(ancestorBounds.start, ancestorBounds.end);
          const modifiedAncestor = injectImageInto(ancestorHtml);
          if (modifiedAncestor !== ancestorHtml) {
            return saveValidatedEdit(
              html.slice(0, ancestorBounds.start) + modifiedAncestor + html.slice(ancestorBounds.end),
              'Image updated',
            );
          }
        }

        // Final fallback: background-image lives in the <style> block as a CSS class rule,
        // not in any DOM element (common pattern: .hero-bg { background-image: url(...) }).
        // Extract the element's class/id names and patch the matching CSS rule.
        const cssRuleReplace = (src: string, selector: string): string => {
          const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(
            `((?:\\.|#)${escaped}\\b[^{]*\\{[^}]*)background-image\\s*:\\s*url\\([^)]+\\)`,
            'gi',
          );
          return src.replace(re, `$1background-image: url('${newUrl}')`);
        };

        // Try each class name of the selected element, then its id
        const classAttr = elementHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
        const idAttr    = elementHtml.match(/\bid="([^"]+)"/i)?.[1] ?? '';
        const candidates = [
          ...classAttr.trim().split(/\s+/).filter(Boolean),
          ...(idAttr ? [idAttr] : []),
        ];
        for (const name of candidates) {
          const patched = cssRuleReplace(html, name);
          if (patched !== html) {
            return saveValidatedEdit(patched, 'Image updated');
          }
        }
      }
      // findByPath failed — try content-based match using the hintHtml snippet
      if (hintHtml) {
        const hintStart = locateElement(html, hintHtml);
        if (hintStart !== -1) {
          const hintTagEnd = html.indexOf('>', hintStart);
          if (hintTagEnd !== -1) {
            const opening = html.slice(hintStart, hintTagEnd + 1);
            const patched = patchSrcOnElement(opening);
            if (patched !== opening) {
              const updatedHtml = html.slice(0, hintStart) + patched + html.slice(hintTagEnd + 1);
              return saveValidatedEdit(updatedHtml, 'Image updated');
            }
            const modifiedEl = injectImageInto(opening);
            if (modifiedEl !== opening) {
              const updatedHtml = html.slice(0, hintStart) + modifiedEl + html.slice(hintTagEnd + 1);
              return saveValidatedEdit(updatedHtml, 'Image updated');
            }
          }
        }
      }

      // Absolute final fallback: find the img by its current src URL, scoped to
      // the nearest section/id anchor from the CSS path so that if 2 images share
      // the same src URL the correct one (in the right section) is replaced.
      if (hintHtml) {
        // Browser outerHTML encodes & as &amp; — decode before searching stored HTML
        const rawHintSrc = hintHtml.match(/\bsrc="([^"]+)"/i)?.[1];
        const oldSrc = rawHintSrc ? rawHintSrc.replace(/&amp;/gi, '&') : undefined;
        if (oldSrc && oldSrc !== newUrl) {
          const escapedSrc = oldSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // Non-greedy [^>]*? prevents matching src= inside onerror= attribute values
          const imgRe = new RegExp(`(<img\\b[^>]*?\\bsrc=")${escapedSrc}("[^>]*>)`, 'i');

          // Try to scope the replacement to the element's section anchor
          const sectionM = cssPath.match(/\b(section|div|article|main)#([\w-]+)/);
          if (sectionM) {
            const anchorTag = sectionM[1];
            const anchorId  = sectionM[2];
            const anchorBounds = findByPath(html, `${anchorTag}#${anchorId}`);
            if (anchorBounds) {
              // Replace only within the section that contains the selected element
              const sectionHtml = html.slice(anchorBounds.start, anchorBounds.end);
              const scopedPatched = sectionHtml.replace(imgRe, `$1${newUrl}$2`);
              if (scopedPatched !== sectionHtml) {
                return saveValidatedEdit(
                  html.slice(0, anchorBounds.start) + scopedPatched + html.slice(anchorBounds.end),
                  'Image updated',
                );
              }
            }
          }

          // No section scope — replace first occurrence in entire document
          const patched = html.replace(imgRe, `$1${newUrl}$2`);
          if (patched !== html) {
            return saveValidatedEdit(patched, 'Image updated');
          }
        }
      }

      return reply.code(422).send({ error: 'Could not locate the selected image in the document — try clicking the image again to re-select it' });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Position-based element removal (preferred — uses CSS path) ───────────
    // Format: __REMOVE_BY_PATH__:[cssPath]||[hintHtml?]
    // hintHtml is optional — used as content-based fallback when findByPath fails.
    const removeByPathMatch = instruction.match(/^__REMOVE_BY_PATH__:([\s\S]+?)(?:\|\|([\s\S]*))?$/);
    if (removeByPathMatch) {
      const cssPath  = removeByPathMatch[1].trim();
      const hintHtml = (removeByPathMatch[2] ?? '').trim();
      let bounds = findByPath(html, cssPath);

      // Fallback: content-based element location when path doesn't match
      // (happens after LLM edits restructure the surrounding DOM)
      if (!bounds && hintHtml) {
        const hintStart = locateElement(html, hintHtml);
        if (hintStart !== -1) {
          const tagName = hintHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
          const VOID_TAGS_R = new Set(['area','base','br','col','embed','hr','img','input',
                                       'link','meta','param','source','track','wbr']);
          let end: number;
          if (VOID_TAGS_R.has(tagName) || hintHtml.trimEnd().endsWith('/>')) {
            end = html.indexOf('>', hintStart) + 1;
          } else {
            const close = `</${tagName}>`;
            let depth = 1, j = html.indexOf('>', hintStart) + 1;
            while (j < html.length && depth > 0) {
              const nO = html.indexOf(`<${tagName}`, j);
              const nC = html.indexOf(close, j);
              if (nC === -1) break;
              if (nO !== -1 && nO < nC) { depth++; j = nO + tagName.length + 1; }
              else { depth--; j = nC + close.length; }
            }
            end = j;
          }
          if (end > hintStart) bounds = { start: hintStart, end };
        }
      }

      if (!bounds) {
        return reply.code(422).send({ error: 'Element not found — click it again to retry' });
      }
      const updatedHtml = html.slice(0, bounds.start) + html.slice(bounds.end);
      if (updatedHtml === html) {
        return reply.code(422).send({ error: 'Element removal produced no change' });
      }
      return saveValidatedEdit(updatedHtml, 'Element removed');
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Content-based element removal (fallback when no path available) ───────
    const removeMatch = instruction.match(/^__REMOVE_ELEMENT__:([\s\S]+)$/);
    if (removeMatch) {
      const snippet = removeMatch[1];
      const openTag = snippet.match(/^<(\w+)/)?.[1] ?? '';
      let start = locateElement(html, snippet);
      if (start === -1) {
        return reply.code(422).send({ error: 'Could not locate that element — click it again and retry' });
      }

      // HTML void elements — never have a closing tag
      const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

      let updatedHtml = html;
      if (openTag) {
        const tagEnd = html.indexOf('>', start);
        if (tagEnd === -1) {
          return reply.code(422).send({ error: 'Malformed element — could not find closing > of opening tag' });
        }
        const isSelfClose = html[tagEnd - 1] === '/' || VOID_TAGS.has(openTag);
        if (isSelfClose) {
          // Void element: remove from start to end of its tag
          updatedHtml = html.slice(0, start) + html.slice(tagEnd + 1);
        } else {
          // Walk depth-aware from right after the opening > to find the close tag
          const closeTag = `</${openTag}>`;
          let depth = 1, i = tagEnd + 1;
          while (i < html.length && depth > 0) {
            const nextOpen  = html.indexOf(`<${openTag}`, i);
            const nextClose = html.indexOf(closeTag, i);
            if (nextClose === -1) break;
            if (nextOpen !== -1 && nextOpen < nextClose) {
              depth++; i = nextOpen + openTag.length + 1;
            } else {
              depth--; i = nextClose + closeTag.length;
            }
          }
          updatedHtml = html.slice(0, start) + html.slice(i);
        }
      } else {
        updatedHtml = html.replace(snippet, '');
      }

      if (updatedHtml !== html) {
        return saveValidatedEdit(updatedHtml, 'Element removed');
      }
      return reply.code(422).send({ error: 'Element removal produced no change — try rephrasing' });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── HTML integrity validation ─────────────────────────────────────────────
    // Run before EVERY write to disk — catches truncation, structure destruction,
    // CSS token removal, and oversized deletions caused by bad LLM output.
    function validateHtml(updated: string): { ok: true } | { ok: false; reason: string } {
      // 1. Must have closing HTML tags — catches truncated LLM responses
      if (!updated.includes('</body>') && !updated.includes('</html>')) {
        return { ok: false, reason: 'Result HTML is truncated (missing </body> — edit produced incomplete output)' };
      }

      // 2. Length guard — result must be at least 35% of the original.
      //    Skip when the original contains data: URIs (inline images) — replacing
      //    a large data URI with a URL legitimately shrinks the HTML by >65%.
      const originalHasDataUri = html.includes('data:image/') || html.includes('data:application/');
      if (!originalHasDataUri && updated.length < html.length * 0.35) {
        return { ok: false, reason: 'Edit removed too much content — result is less than 35% of the original size' };
      }

      // 3. Section structure — must retain at least one <section if original had any
      const origSections = (html.match(/<section[\s>]/gi) ?? []).length;
      const newSections  = (updated.match(/<section[\s>]/gi) ?? []).length;
      if (origSections > 1 && newSections === 0) {
        return { ok: false, reason: 'All sections were removed — microsite structure was destroyed' };
      }
      if (origSections > 2 && newSections < Math.ceil(origSections * 0.4)) {
        return { ok: false, reason: `Too many sections removed (had ${origSections}, result has ${newSections})` };
      }

      // 4. CSS design tokens — `:root` block must survive if it existed
      if (html.includes(':root') && !updated.includes(':root')) {
        return { ok: false, reason: 'CSS design tokens were removed — microsite styling will break' };
      }

      // 5. Unclosed <script> tags would break the page
      const scriptOpens  = (updated.match(/<script\b/gi) ?? []).length;
      const scriptCloses = (updated.match(/<\/script>/gi) ?? []).length;
      if (scriptOpens > scriptCloses + 1) {
        return { ok: false, reason: 'Result contains unclosed <script> tags' };
      }

      return { ok: true };
    }

    // Validated write — rejects invalid HTML before touching disk
    async function saveValidatedEdit(
      updatedHtml: string,
      editSummary: string,
      extras: Record<string, unknown> = {},
    ): Promise<ReturnType<typeof reply.send>> {
      const check = validateHtml(updatedHtml);
      if (!check.ok) {
        return reply.code(422).send({ error: `Edit validation failed: ${check.reason}` });
      }
      const updatedAst = {
        ...ast,
        sections: [
          { ...(sections![0] as object), customHtml: updatedHtml, previousHtml: html },
          ...((sections ?? []).slice(1)),
        ],
      };
      await writeFile(filePath, JSON.stringify(updatedAst, null, 2));
      return reply.send({ html: updatedHtml, summary: editSummary, ...extras });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Element-scoped replacement helper ────────────────────────────────────
    function replaceElement(fullHtml: string, elementHtml: string, replacement: string): string {
      const key = elementHtml.slice(0, 300);
      const idx = fullHtml.indexOf(key);
      if (idx === -1) return fullHtml;
      return fullHtml.slice(0, idx) + replacement + fullHtml.slice(idx + elementHtml.length);
    }

    // ── Position-based element finder ─────────────────────────────────────────
    // Traverses the HTML string using a CSS path with nth-of-type indices.
    // This is position-based, not content-based, so browser attribute normalization
    // never causes mismatches. Returns exact { start, end } byte positions.
    function findByPath(src: string, path: string): { start: number; end: number } | null {
      const VOID = new Set(['area','base','br','col','embed','hr','img','input',
                            'link','meta','param','source','track','wbr']);
      const parts = path.trim().split(/\s*>\s*/);
      let searchFrom = 0;
      let searchTo   = src.length;

      for (let i = 0; i < parts.length; i++) {
        const part   = parts[i].trim();
        const tag    = part.match(/^(\w+)/)?.[1];
        if (!tag) return null;

        const idVal  = part.match(/#([\w-]+)/)?.[1] ?? null;
        const clsVal = part.match(/\.([\w-]+)/)?.[1] ?? null;
        const nth    = parseInt(part.match(/:nth-of-type\((\d+)\)/)?.[1] ?? '1', 10);
        const isLast = i === parts.length - 1;

        let count = 0, pos = searchFrom, foundStart = -1, foundEnd = -1;

        while (pos < searchTo) {
          const ti = src.indexOf(`<${tag}`, pos);
          if (ti === -1 || ti >= searchTo) break;
          const te = src.indexOf('>', ti);
          if (te === -1) break;
          const opening = src.slice(ti, te + 1);

          const mId  = !idVal  || opening.includes(`id="${idVal}"`);
          const mCls = !clsVal || (opening.match(/\bclass="([^"]+)"/)?.[1] ?? '')
                                    .split(/\s+/).includes(clsVal);

          if (mId && mCls) {
            count++;
            if (count === nth) {
              foundStart = ti;
              if (VOID.has(tag) || opening.trimEnd().endsWith('/>')) {
                foundEnd = te + 1;
              } else {
                const close = `</${tag}>`;
                let depth = 1, j = te + 1;
                while (j < src.length && depth > 0) {
                  const nO = src.indexOf(`<${tag}`, j);
                  const nC = src.indexOf(close, j);
                  if (nC === -1) break;
                  if (nO !== -1 && nO < nC) { depth++; j = nO + tag.length + 1; }
                  else { depth--; j = nC + close.length; }
                }
                foundEnd = j;
              }
              break;
            }
          }
          pos = ti + 1;
        }

        if (foundStart === -1) return null;
        if (isLast) return { start: foundStart, end: foundEnd };

        // Narrow scope to inside this element for the next path segment
        const tagEnd = src.indexOf('>', foundStart);
        searchFrom = tagEnd + 1;
        searchTo   = foundEnd;
      }

      return null;
    }

    // ── Shared multi-strategy element locator ────────────────────────────────
    // Browsers normalise attribute order and inline styles in outerHTML, so exact
    // string match often fails. We try five increasingly-fuzzy strategies.
    function locateElement(src: string, snippet: string): number {
      const openTag = snippet.match(/^<(\w+)/)?.[1] ?? '';

      // 1. Exact substring (fastest — works when HTML is unmodified)
      let idx = src.indexOf(snippet.slice(0, 200));
      if (idx !== -1) return idx;

      // 2. id attribute (globally unique)
      const idVal = snippet.match(/\bid="([^"]+)"/)?.[1];
      if (idVal) {
        idx = src.indexOf(`id="${idVal}"`);
        if (idx !== -1) { let s = idx; while (s > 0 && src[s] !== '<') s--; return s; }
      }

      // 3. src URL for media elements (unique per page)
      // Decode &amp; → & because browser outerHTML encodes & as &amp; but stored HTML has raw &
      if (['img', 'video', 'source', 'iframe'].includes(openTag)) {
        const rawSrcVal = snippet.match(/\bsrc="([^"]+)"/)?.[1];
        const srcVal = rawSrcVal ? rawSrcVal.replace(/&amp;/gi, '&') : undefined;
        if (srcVal) {
          idx = src.indexOf(`src="${srcVal}"`);
          if (idx !== -1) { let s = idx; while (s > 0 && src[s] !== '<') s--; return s; }
        }
      }

      // 4. Most-specific class name — find first <openTag with this exact class token
      const classStr = snippet.match(/\bclass="([^"]+)"/)?.[1] ?? '';
      const classes  = classStr.trim().split(/\s+/).filter(Boolean);
      // Prefer longer (more specific) class names, avoid single-letter / generic ones
      const bestClass = classes.sort((a, b) => b.length - a.length).find(c => c.length > 2);
      if (bestClass && openTag) {
        let pos = 0;
        while (pos < src.length) {
          const ti = src.indexOf(`<${openTag}`, pos);
          if (ti === -1) break;
          const te = src.indexOf('>', ti);
          if (te === -1) break;
          const opening = src.slice(ti, te + 1);
          const elClasses = (opening.match(/\bclass="([^"]+)"/)?.[1] ?? '').split(/\s+/);
          if (elClasses.includes(bestClass)) return ti;
          pos = ti + 1;
        }
      }

      // 5. Attribute-set match (order-insensitive, ignores style which browsers reformat)
      if (openTag) {
        const extractNonStyle = (tag: string) =>
          [...tag.matchAll(/\b(?!style\b)(\w[\w-]*)="([^"]*)"/g)]
            .map(m => `${m[1]}="${m[2]}"`)
            .sort()
            .join(' ');
        const snippetAttrs = extractNonStyle(snippet.slice(0, 300));
        let pos = 0;
        while (pos < src.length) {
          const ti = src.indexOf(`<${openTag}`, pos);
          if (ti === -1) break;
          const te = src.indexOf('>', ti);
          if (te === -1) break;
          if (extractNonStyle(src.slice(ti, te + 1)) === snippetAttrs) return ti;
          pos = ti + 1;
        }
      }

      return -1;
    }

    // ── HTML extractor — strips LLM preamble/postamble from any response ──────
    // LLMs frequently prepend explanation text ("Looking at the element, I will…")
    // before the code block. This strips everything outside the actual HTML.
    function extractHtmlFromResponse(raw: string): string {
      const s = raw.trim();

      // Prefer content inside a ``` fence (even if it's not at the very start)
      const fenceMatch = s.match(/```(?:html)?\r?\n?([\s\S]+?)\r?\n?```/);
      if (fenceMatch) return fenceMatch[1].trim();

      // No fence — strip any prose before the first HTML tag
      const firstTag = s.indexOf('<');
      if (firstTag === -1) return s; // no HTML at all, return as-is and let validation catch it
      let result = s.slice(firstTag);

      // Strip any prose after the last closing tag
      const lastTag = result.lastIndexOf('>');
      if (lastTag !== -1) result = result.slice(0, lastTag + 1);

      return result.trim();
    }

    // ── Comprehensive background removal ─────────────────────────────────────────
    // Format: __REMOVE_BACKGROUND__:[cssPath]
    // Removes background from both the element AND its parent container so that
    // overlay divs (no own background) also clear the parent's background photo.
    const removeBgMatch = instruction.match(/^__REMOVE_BACKGROUND__:([\s\S]+)$/);
    if (removeBgMatch) {
      const cssPath = removeBgMatch[1].trim();
      const bounds  = findByPath(html, cssPath);
      if (!bounds) return reply.code(422).send({ error: 'Element not found — click it again to re-select' });

      let updated = html;

      // Helper: clear background from an element at given bounds in `src`
      function clearBgFromElement(src: string, b: { start: number; end: number }): string {
        const elHtml  = src.slice(b.start, b.end);
        const tagEnd  = elHtml.indexOf('>');
        if (tagEnd === -1) return src;

        const openTag = elHtml.slice(0, tagEnd);
        const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
        const sm      = styleRx.exec(openTag);
        let patchedOpen: string;
        if (sm) {
          // Remove all background-* declarations from existing inline style
          const stripped = sm[1]
            .replace(/\bbackground(?:-image|-color|-position|-size|-repeat|-attachment|-clip|-origin|-blend-mode)?\s*:[^;]+;?\s*/gi, '')
            .trim().replace(/;$/, '');
          patchedOpen = openTag.replace(styleRx,
            `style="${stripped ? stripped + ';' : ''}background:none;background-image:none"`);
        } else {
          patchedOpen = `${openTag} style="background:none;background-image:none"`;
        }

        // Remove background rules from <style> block for this element's class
        const classMatch = elHtml.match(/\bclass="([^"]+)"/i);
        let result = src.slice(0, b.start) + patchedOpen + elHtml.slice(tagEnd) + src.slice(b.end);
        if (classMatch) {
          const firstCls = classMatch[1].trim().split(/\s+/).find(c => c.length > 1);
          if (firstCls) {
            const clsRe = new RegExp(
              `(\\.${firstCls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:,[^{]*)?\\{[^}]*)background(?:-image|-color|-position|-size|-repeat|-attachment|-clip|-origin)?\\s*:[^;]+;?\\s*`,
              'gi',
            );
            result = result.replace(clsRe, '$1');
          }
        }

        // Also hide any <img> that is a DIRECT child of this element (background photo pattern)
        // by setting display:none on it
        const inner = result.slice(b.start, b.start + 3000);
        const imgRe = /(<img\b)([^>]*)(\/?>)/gi;
        result = result.replace(imgRe, (match, open, attrs, close) => {
          if (!inner.includes((open + attrs).slice(0, 60))) return match;
          // Already display:none — skip
          if (/\bdisplay\s*:\s*none\b/i.test(attrs)) return match;
          const styleM = attrs.match(/\bstyle="([^"]*)"/i);
          if (styleM) {
            return match.replace(/\bstyle="([^"]*)"/i, `style="${styleM[1].trim()};display:none"`);
          }
          return `${open}${attrs} style="display:none"${close}`;
        });

        return result;
      }

      // Apply to the selected element first (clears inline style + CSS class gradient)
      updated = clearBgFromElement(updated, bounds);

      // ALWAYS also try the parent container — the background photo (<img>) is typically
      // a sibling of an overlay div, living inside the parent (.hero-bg, etc.).
      // Doing this unconditionally means a single "remove background" prompt clears
      // both the gradient overlay AND the photo in one shot.
      const parentPath = cssPath.split(/\s*>\s*/).slice(0, -1).join(' > ');
      if (parentPath) {
        // Re-find parent bounds in the (possibly already modified) `updated` HTML
        const parentBounds = findByPath(updated, parentPath);
        if (parentBounds) {
          updated = clearBgFromElement(updated, parentBounds);
        }
      }

      if (updated === html) {
        return reply.code(422).send({ error: 'No background found on this element or its parent' });
      }
      return saveValidatedEdit(updated, 'Background removed');
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Inline style property patch (from InlineEditPanel) ─────────────────────
    // Format: __STYLE_PATCH__:[cssPath]||[property]||[value]||[hintHtml?]
    // hintHtml is optional — used for content-based fallback when findByPath fails.
    // Deterministic — no LLM. Whitelisted properties only.
    const stylePatchMatch = instruction.match(/^__STYLE_PATCH__:([\s\S]+?)\|\|([\w-]+)\|\|([\s\S]+?)(?:\|\|([\s\S]*))?$/s);
    if (stylePatchMatch) {
      const cssPath  = stylePatchMatch[1].trim();
      const prop     = stylePatchMatch[2].trim().toLowerCase();
      const rawValue = stylePatchMatch[3].trim();
      const hintHtml = (stylePatchMatch[4] ?? '').trim();

      const ALLOWED_STYLE_PROPS = new Set([
        'color', 'background-color', 'background-image', 'background',
        'font-size', 'font-family', 'font-weight', 'font-style',
        'opacity', 'border-radius', 'text-align', 'letter-spacing', 'line-height',
      ]);
      if (!ALLOWED_STYLE_PROPS.has(prop))
        return reply.code(400).send({ error: `Property "${prop}" is not patchable via __STYLE_PATCH__` });

      const value = rawValue.replace(/[;'"<>]/g, '').trim().slice(0, 120);
      if (!value) return reply.code(400).send({ error: 'Empty style value' });

      let bounds = findByPath(html, cssPath);
      // Content-based fallback when path doesn't match (e.g. after LLM restructured the DOM)
      if (!bounds && hintHtml) {
        const hs = locateElement(html, hintHtml);
        if (hs !== -1) {
          const ht = html.indexOf('>', hs);
          if (ht !== -1) bounds = { start: hs, end: ht + 1 };
        }
      }
      if (!bounds) return reply.code(422).send({ error: 'Target element not found — click it again to re-select' });

      const elementHtml = html.slice(bounds.start, bounds.end);
      const tagEnd = elementHtml.indexOf('>');
      if (tagEnd === -1) return reply.code(422).send({ error: 'Malformed element' });

      const openTag = elementHtml.slice(0, tagEnd);
      const rest    = elementHtml.slice(tagEnd);
      const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
      const sm = styleRx.exec(openTag);
      let patchedTag: string;
      if (sm) {
        const escaped = prop.replace(/-/g, '\\-');
        const existing = sm[1]
          .replace(new RegExp(`\\b${escaped}\\s*:[^;]+;?\\s*`, 'gi'), '')
          .trim().replace(/;$/, '');
        patchedTag = openTag.replace(styleRx, `style="${existing ? existing + '; ' : ''}${prop}:${value}"`);
      } else {
        patchedTag = `${openTag} style="${prop}:${value}"`;
      }
      const updatedHtml = html.slice(0, bounds.start) + patchedTag + rest + html.slice(bounds.end);
      return saveValidatedEdit(updatedHtml, `${prop} set to ${value}`);
    }

    // ── Inline text content patch (from InlineEditPanel) ────────────────────
    // Format: __TEXT_PATCH__:[cssPath]||[newText]
    // Deterministic — no LLM. Replaces text nodes, preserves child elements.
    // Format: __TEXT_PATCH__:[cssPath]||[newText](||[hint — ignored])
    // Non-greedy group 2 stops before the trailing ||hint so the hint's outerHTML
    // is never concatenated into the visible text content.
    const textPatchMatch = instruction.match(/^__TEXT_PATCH__:([\s\S]+?)\|\|([\s\S]+?)(?:\|\|[\s\S]*)?$/s);
    if (textPatchMatch) {
      const cssPath = textPatchMatch[1].trim();
      const newText = textPatchMatch[2].trim().slice(0, 2000);

      const bounds = findByPath(html, cssPath);
      if (!bounds) return reply.code(422).send({ error: 'Target element not found — click it again to re-select' });

      const elementHtml  = html.slice(bounds.start, bounds.end);
      const openTagMatch = elementHtml.match(/^(<[^>]+>)/);
      const closeTagMatch = elementHtml.match(/<\/(\w+)>\s*$/);
      if (!openTagMatch || !closeTagMatch)
        return reply.code(422).send({ error: 'Element is not a paired tag' });

      const openTag  = openTagMatch[1];
      const closeTag = `</${closeTagMatch[1]}>`;
      const innerHtml = elementHtml.slice(openTag.length, elementHtml.lastIndexOf(closeTag));
      const hasChildren = /<\w/.test(innerHtml);

      const newInner = hasChildren
        ? newText + innerHtml.replace(/^[^<]+/, '').replace(/>[^<]+</g, '><').replace(/[^>]+$/, '')
        : newText;

      const updatedHtml = html.slice(0, bounds.start) + openTag + newInner + closeTag + html.slice(bounds.end);
      return saveValidatedEdit(updatedHtml, 'Text updated');
    }

    // ── Background-image patch (from InlineEditPanel "BG Image" input) ─────────
    // Format: __BG_IMAGE_PATCH__:[cssPath]||[imageUrl](||[hint — ignored])
    // [^\|]+ stops at the next || so a trailing hint doesn't corrupt data: URLs.
    const bgImagePatchMatch = instruction.match(/^__BG_IMAGE_PATCH__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|[\s\S]*)?$/s);
    if (bgImagePatchMatch) {
      const cssPath = bgImagePatchMatch[1].trim();
      // Strip HTML-dangerous chars from https URLs; data: URLs are base64 and never contain them.
      const imgUrl  = bgImagePatchMatch[2].trim().replace(/['"<>]/g, (c) => bgImagePatchMatch[2].startsWith('data:') ? c : '');

      const bounds = findByPath(html, cssPath);
      if (!bounds) return reply.code(422).send({ error: 'Target element not found — click it again to re-select' });

      const elementHtml = html.slice(bounds.start, bounds.end);

      // Strategy 1 (CSS rules — runs FIRST): look in <style> blocks for rules whose
      // selector references the element's ID word (e.g. section#hero → .hero-bg, #hero).
      // This is the most common pattern: the visual background lives in a CSS class
      // (.hero-bg, .about-bg, etc.) not inline on the element itself. Running this first
      // prevents Strategy 2 from short-circuiting on stale inline styles left by earlier
      // fallback writes, which would update the invisible outer-element style while the
      // real .hero-bg CSS rule keeps showing the old image.
      const sectionId = cssPath.match(/#([\w-]+)/)?.[1] ?? '';
      if (sectionId) {
        const esc = sectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patchedHtml = html.replace(
          /([^{}]+)\{([^}]*\bbackground-image\s*:\s*url\([^)]*\)[^}]*)\}/gi,
          (match, selector, body) => {
            if (!new RegExp(`\\b${esc}\\b`, 'i').test(selector)) return match;
            const newBody = body.replace(
              /\bbackground-image\s*:\s*url\([^)]*\)/gi,
              `background-image:url('${imgUrl}')`,
            );
            return `${selector}{${newBody}}`;
          },
        );
        if (patchedHtml !== html) {
          return saveValidatedEdit(patchedHtml, 'Background image updated');
        }
      }

      // Strategy 2: replace every background-image:url() in the element's inline HTML
      // (opening tag inline style + nested child divs with inline background-image).
      const bgReplaceRe = /\bbackground-image\s*:\s*url\([^)]*\)/gi;
      if (bgReplaceRe.test(elementHtml)) {
        const fullPatched = elementHtml.replace(
          bgReplaceRe,
          `background-image:url('${imgUrl}')`,
        );
        return saveValidatedEdit(
          html.slice(0, bounds.start) + fullPatched + html.slice(bounds.end),
          'Background image updated',
        );
      }

      // Strategy 3: no existing background-image anywhere — add inline style to opening tag
      const tagEnd = elementHtml.indexOf('>');
      if (tagEnd === -1) return reply.code(422).send({ error: 'Malformed element' });

      const openTag = elementHtml.slice(0, tagEnd);
      const rest    = elementHtml.slice(tagEnd);
      const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
      const sm = styleRx.exec(openTag);
      const bgVal = `background-image:url('${imgUrl}');background-size:cover;background-position:center`;
      let patchedTag: string;
      if (sm) {
        // Use url\([^)]*\) to match the entire url(...) token — including data URIs
        // which contain internal semicolons (data:image/png;base64,...).
        const existing = sm[1]
          .replace(/\bbackground-image\s*:\s*(?:url\([^)]*\)|[^;]*)\s*;?\s*/gi, '')
          .replace(/\bbackground-size\s*:[^;]+;?\s*/gi, '')
          .replace(/\bbackground-position\s*:[^;]+;?\s*/gi, '')
          .trim().replace(/;$/, '');
        patchedTag = openTag.replace(styleRx, `style="${existing ? existing + ';' : ''}${bgVal}"`);
      } else {
        patchedTag = `${openTag} style="${bgVal}"`;
      }
      return saveValidatedEdit(
        html.slice(0, bounds.start) + patchedTag + rest + html.slice(bounds.end),
        'Background image updated',
      );
    }

    // ── Lucide SVG replacement — replaces element with raw SVG markup ─────────
    // Format: __SVG_REPLACE__:[cssPath]||[svgMarkup]
    // Used by the Lucide icon picker in InlineEditPanel.
    const svgReplaceMatch = instruction.match(/^__SVG_REPLACE__:([\s\S]+?)\|\|([\s\S]+)$/s);
    if (svgReplaceMatch) {
      const cssPath   = svgReplaceMatch[1].trim();
      let   svgMarkup = svgReplaceMatch[2].trim();

      if (!svgMarkup.startsWith('<svg'))
        return reply.code(400).send({ error: 'Payload must be an SVG element' });

      const bounds = findByPath(html, cssPath);
      if (!bounds) return reply.code(422).send({ error: 'Target element not found — click it again to re-select' });

      const originalHtml = html.slice(bounds.start, bounds.end);
      // Preserve class and inline style from the original element
      const cls   = originalHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
      const style = originalHtml.match(/\bstyle="([^"]+)"/i)?.[1] ?? '';
      // Inject class/style into the incoming SVG opening tag
      svgMarkup = svgMarkup.replace(/^<svg\b/, `<svg${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}`);
      // Remove duplicate class/style injected above if original SVG already had them
      svgMarkup = svgMarkup.replace(/(<svg[^>]*)\bclass="[^"]*"\s*class="[^"]*"/, '$1');

      const updatedHtml = html.slice(0, bounds.start) + svgMarkup + html.slice(bounds.end);
      return saveValidatedEdit(updatedHtml, 'Icon replaced');
    }

    // ── Icon / SVG replacement (from InlineEditPanel "Replace Icon" input) ─────
    // Format: __ICON_REPLACE__:[cssPath]||[imageUrl]
    // Replaces the selected SVG/icon element with an <img> pointing at the new URL.
    const iconReplaceMatch = instruction.match(/^__ICON_REPLACE__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|[\s\S]*)?$/s);
    if (iconReplaceMatch) {
      const cssPath = iconReplaceMatch[1].trim();
      const imgUrl  = iconReplaceMatch[2].trim().replace(/['"<>]/g, '');

      const bounds = findByPath(html, cssPath);
      if (!bounds) return reply.code(422).send({ error: 'Target element not found — click it again to re-select' });

      const elementHtml = html.slice(bounds.start, bounds.end);
      // Preserve width/height/class from the original element where possible
      const wMatch = elementHtml.match(/\bwidth="([^"]+)"/i) || elementHtml.match(/\bwidth\s*:\s*([^;'"]+)/i);
      const hMatch = elementHtml.match(/\bheight="([^"]+)"/i) || elementHtml.match(/\bheight\s*:\s*([^;'"]+)/i);
      const cls   = elementHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
      const style = elementHtml.match(/\bstyle="([^"]+)"/i)?.[1] ?? '';
      const w = wMatch?.[1] ?? '1em';
      const h = hMatch?.[1] ?? '1em';
      const imgTag = `<img src="${imgUrl}" alt="icon"${cls ? ` class="${cls}"` : ''} style="width:${w};height:${h};object-fit:contain;display:inline-block;${style ? style + ';' : ''}" />`;
      const updatedHtml = html.slice(0, bounds.start) + imgTag + html.slice(bounds.end);
      return saveValidatedEdit(updatedHtml, 'Icon replaced');
    }

    // ── Element-scoped LLM edit ───────────────────────────────────────────────
    // Three-part format: __ELEMENT_EDIT__:[cssPath]||[hintOuterHtml]||[instruction]
    //
    // Uses position-based findByPath() first — never fails due to browser attribute
    // normalization. Falls back to content-based locateElement() if no path provided.
    // The LLM receives ONLY the selected element's exact stored HTML, so it cannot
    // accidentally modify anything outside the clicked element's scope.
    const elementEditMatch = instruction.match(/^__ELEMENT_EDIT__:([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]+)$/s);
    if (elementEditMatch) {
      const cssPath         = elementEditMatch[1].trim();
      const hintHtml        = elementEditMatch[2];
      const editInstruction = elementEditMatch[3];

      // ── Locate the exact element position in stored HTML ─────────────────
      let bounds: { start: number; end: number } | null = null;

      // Primary: position-based (CSS path from bridge — immune to attr normalization)
      if (cssPath) {
        bounds = findByPath(html, cssPath);
      }

      // Fallback: content-based (for old messages or if path traversal failed)
      if (!bounds) {
        const fbStart = locateElement(html, hintHtml);
        if (fbStart !== -1) {
          const fbTag = hintHtml.match(/^<(\w+)/)?.[1] ?? '';
          const VOID = new Set(['area','base','br','col','embed','hr','img','input',
                                'link','meta','param','source','track','wbr']);
          const fbTagEnd = html.indexOf('>', fbStart);
          if (fbTagEnd !== -1) {
            const opening = html.slice(fbStart, fbTagEnd + 1);
            let fbEnd: number;
            if (VOID.has(fbTag) || opening.trimEnd().endsWith('/>')) {
              fbEnd = fbTagEnd + 1;
            } else {
              const close = `</${fbTag}>`;
              let depth = 1, j = fbTagEnd + 1;
              while (j < html.length && depth > 0) {
                const nO = html.indexOf(`<${fbTag}`, j);
                const nC = html.indexOf(close, j);
                if (nC === -1) break;
                if (nO !== -1 && nO < nC) { depth++; j = nO + fbTag.length + 1; }
                else { depth--; j = nC + close.length; }
              }
              fbEnd = j;
            }
            bounds = { start: fbStart, end: fbEnd };
          }
        }
      }

      if (!bounds) {
        return reply.code(422).send({
          error: 'Target element not found — click it again to re-select',
        });
      }

      // ── Extract the element's EXACT stored HTML ───────────────────────────
      const storedElementHtml = html.slice(bounds.start, bounds.end);

      // ── Build breadcrumb context (text only, not HTML) ────────────────────
      const sectionBounds = extractAllTopLevelSections(html);
      const parentSecIdx  = sectionBounds.findIndex(
        s => s.start <= bounds!.start && bounds!.end <= s.end,
      );
      const breadcrumb = parentSecIdx !== -1
        ? `Located in section ${parentSecIdx + 1} of ${sectionBounds.length}`
        : 'Located outside named sections';

      // ── Detect section-regeneration intent early — must happen before the
      // deterministic BG shortcuts below so a prompt that mentions "background"
      // or a hex colour (e.g. "Background: #020509") doesn't get intercepted
      // by the colour-patch shortcut instead of reaching the redesign flow.
      const isRedesignIntent = /\b(regenerat|redesign|completely new|redo|rebuild|restyle|overhaul)\b/i.test(editInstruction);

      // ── Deterministic background-image injection for element edits ──────────
      // When the instruction contains an image URL AND "background" intent,
      // patch the CSS directly instead of sending to LLM (LLM adds <img> tags
      // instead of setting background-image, which looks like a logo overlay).
      // Skip when the user is doing a full section redesign — let that flow handle it.
      const bgUrlMatch = editInstruction.match(/(https?:\/\/\S+)/);
      const isBgImageIntent = /\b(?:background|bg)\b/i.test(editInstruction) &&
        /\b(?:add|set|use|change|put|apply|inject)\b/i.test(editInstruction);
      if (!isRedesignIntent && bgUrlMatch && isBgImageIntent) {
        const rawUrl = bgUrlMatch[1].replace(/['"]/g, '').replace(/[,)]+$/, '');
        // Apply background-image to the first matching element (section, div, header, etc.)
        const tagEnd = storedElementHtml.indexOf('>');
        if (tagEnd !== -1) {
          const openTag = storedElementHtml.slice(0, tagEnd);
          const rest    = storedElementHtml.slice(tagEnd);
          const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
          const sm = styleRx.exec(openTag);
          let patchedTag: string;
          if (sm) {
            const existing = sm[1]
              .replace(/\bbackground-image\s*:\s*(?:url\([^)]*\)|[^;]*)\s*;?\s*/g, '')
              .replace(/\bbackground-size\s*:[^;]+;?\s*/g, '')
              .replace(/\bbackground-position\s*:[^;]+;?\s*/g, '')
              .replace(/\bbackground-repeat\s*:[^;]+;?\s*/g, '')
              .trim().replace(/;$/, '');
            const extra = `background-image:url('${rawUrl}');background-size:cover;background-position:center;background-repeat:no-repeat`;
            patchedTag = openTag.replace(styleRx, `style="${existing ? existing + ';' : ''}${extra}"`);
          } else {
            patchedTag = `${openTag} style="background-image:url('${rawUrl}');background-size:cover;background-position:center;background-repeat:no-repeat"`;
          }
          const patched = patchedTag + rest;
          const updatedHtml = html.slice(0, bounds.start) + patched + html.slice(bounds.end);
          return saveValidatedEdit(updatedHtml, 'Background image applied');
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      // ── Deterministic background-color patch ─────────────────────────────
      // LLMs confuse hex values like #32a852 with CSS ID selectors and return
      // the element unchanged. Patch inline style directly when a color value
      // and "background" intent are detected.
      // Skip for section redesigns — they reference many colours in their spec.
      const isBgColorIntent = /\b(?:background[\s-]?color|bg[\s-]?color|background)\b/i.test(editInstruction)
        && !/https?:\/\//.test(editInstruction);
      const colorValueMatch = editInstruction.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/i);
      if (!isRedesignIntent && isBgColorIntent && colorValueMatch) {
        const colorValue = colorValueMatch[1];
        const tagEnd = storedElementHtml.indexOf('>');
        if (tagEnd !== -1) {
          const openTag = storedElementHtml.slice(0, tagEnd);
          const rest    = storedElementHtml.slice(tagEnd);
          const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
          const sm = styleRx.exec(openTag);
          let patchedTag: string;
          if (sm) {
            const existing = sm[1].replace(/\bbackground-color\s*:[^;]+;?\s*/g, '').trim().replace(/;$/, '');
            patchedTag = openTag.replace(styleRx, `style="${existing ? existing + ';' : ''}background-color:${colorValue}"`);
          } else {
            patchedTag = `${openTag} style="background-color:${colorValue}"`;
          }
          const patched     = patchedTag + rest;
          const updatedHtml = html.slice(0, bounds.start) + patched + html.slice(bounds.end);
          return saveValidatedEdit(updatedHtml, `Background color set to ${colorValue}`);
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      // ── Section-regeneration flow ─────────────────────────────────────────
      // isRedesignIntent already computed above (before the deterministic shortcuts).
      // "Regenerate/redesign/redo the hero section" is fundamentally different
      // from an element-level edit. When detected:
      //  1. Auto-elevate the target to the enclosing <section> (so the wrong
      //     selected element never corrupts the page structure).
      //  2. Use a section-safe LLM prompt that allows scoped <style>/<script>.
      //  3. Hoist returned <style>/<script> to <head>/<body> so the page stays
      //     well-formed after the splice.

      let targetBounds = bounds;
      let targetHtml   = storedElementHtml;

      if (isRedesignIntent) {
        // Find the enclosing <section> for the selected element.
        const allSections = extractAllTopLevelSections(html);
        const enclosing   = allSections.find(s => s.start <= bounds.start && bounds.end <= s.end);

        // Also check if any section id/class matches a keyword in the instruction.
        const mentionedName = /\b(hero|about|features?|pricing|contact|footer|header|cta|stats|team|process|next.?step)\b/i
          .exec(editInstruction)?.[1]?.toLowerCase() ?? '';
        const namedSection  = allSections.find(s => {
          const txt = html.slice(s.start, s.start + 200).toLowerCase();
          return mentionedName && txt.includes(mentionedName);
        });

        const section = namedSection ?? enclosing;
        if (section) {
          targetBounds = section;
          targetHtml   = html.slice(section.start, section.end);
          console.log(`⬆ Section-regeneration intent detected — target elevated to section (${targetHtml.length} chars)`);
        }
      }

      // ── Detect element type for specialised prompt guidance ──────────────
      const elTag = targetHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
      const isImgEl = elTag === 'img';
      const currentSrc = isImgEl
        ? (targetHtml.match(/\bsrc="([^"]+)"/)?.[1] ?? '')
        : '';
      const currentAlt = isImgEl
        ? (targetHtml.match(/\balt="([^"]*)"/)?.[1] ?? '')
        : '';

      // ── Build the LLM prompt (element-edit vs section-redesign) ──────────
      const imageGuidance = isImgEl ? `
IMAGE-SPECIFIC RULES (this element is an <img>):
- Current src: ${currentSrc}
- Current alt: ${currentAlt || '(none)'}
- If the instruction asks to change/replace/update the image without specifying a URL:
  • Choose a high-quality Unsplash image that fits the alt text and current URL context
  • Use format: https://images.unsplash.com/photo-XXXXXXXXXXXXXXX?w=1200&auto=format&fit=crop&q=80
  • Replace ONLY the src attribute value — keep all other attributes unchanged
- If the instruction provides a specific URL, use that URL exactly` : '';

      const elementPrompt = isRedesignIntent
        ? `You are regenerating a complete HTML section. Return ONLY the <section> element — nothing before or after it.

SECTION TO REDESIGN:
${targetHtml}

INSTRUCTION: ${editInstruction}

Output rules (strictly enforced):
- Start your output with the section's opening tag and end with </section>
- Do NOT output <!DOCTYPE>, <html>, <head>, or <body>
- All CSS MUST be inside a single <style> tag placed as the LAST child of <section>, before </section>
- All CSS selectors MUST be scoped with a unique prefix (e.g. .regen-${Date.now().toString(36)}-) — zero style leakage to other sections
- All JS MUST be inside a single <script> tag placed as the LAST child of <section>, just before </section>
- All JS MUST be wrapped in an IIFE: (function(){ ... })(); — no global variable declarations
- Keep ALL existing text content exactly as-is — only visual/structural design changes
- No external libraries except Google Fonts (loaded via @import inside the <style> tag)`
        : `You are making a precise edit to one HTML element. Return ONLY the modified element — same root tag, same nesting. Do not return any surrounding HTML, parent elements, or the full section.

ELEMENT PATH: ${cssPath || hintHtml.slice(0, 80)}
CONTEXT: ${breadcrumb}

ELEMENT TO EDIT:
${targetHtml}

INSTRUCTION: ${editInstruction}
${imageGuidance}
Strict rules:
- Return ONLY this element starting with its opening tag and ending with its closing tag
- Do NOT include any parent or sibling elements
- For text changes: update only the specific text node described
- For style changes: modify inline style properties on this element or its children
- For image changes: update src or background-image on this element or its children
- For adding/removing a child: do so while preserving all other children unchanged
- Never truncate or omit any part of this element`;

      // ── LLM call with clear logging ──────────────────────────────────────────
      console.log('\n┌─ LLM PROMPT ─────────────────────────────────────────────────');
      console.log(elementPrompt.slice(0, 1000));
      console.log('└──────────────────────────────────────────────────────────────');

      const raw      = await llmGenerateFn(elementPrompt);
      const modified = extractHtmlFromResponse(raw);

      console.log('\n┌─ LLM RESPONSE (raw) ─────────────────────────────────────────');
      console.log(raw?.slice(0, 2000) ?? '(empty)');
      console.log('├─ EXTRACTED HTML ──────────────────────────────────────────────');
      console.log(modified?.slice(0, 1000) ?? '(none — extraction failed)');
      console.log(`└─ Status: ${modified ? '✓ HTML extracted successfully' : '✗ No HTML extracted'}`);

      if (!modified) {
        return reply.code(502).send({ error: 'LLM returned empty response — try rephrasing' });
      }

      // ── Guard: reject full-page HTML — these would corrupt the document ──
      if (/<!doctype|<html[\s>]/i.test(modified) || /<\/?(head|body)\b/i.test(modified)) {
        console.log('✗ LLM returned full-page HTML — rejecting');
        return reply.code(422).send({
          error: 'LLM returned a full HTML page instead of just the section. Try selecting the specific section element and rephrasing.',
        });
      }

      // ── Guard: root tag mismatch (element-level edits only) ──────────────
      if (!isRedesignIntent) {
        const originalRoot = targetHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
        const returnedRoot = modified.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
        if (originalRoot && returnedRoot && returnedRoot !== originalRoot) {
          console.log(`✗ Root tag mismatch: expected <${originalRoot}>, got <${returnedRoot}>`);
          return reply.code(422).send({
            error: `Edit mismatch: you selected a <${originalRoot}> element but the edit targets a <${returnedRoot}>. Click directly on the section you want to redesign, then retry.`,
          });
        }
      }

      // ── Hoist <style>/<script> from section body to <head>/<body> ────────
      // LLMs embed <style> and <script> inside <section> even when asked to
      // put them at the end. Hoisting keeps the document well-formed and
      // prevents styles being applied before the stylesheet is parsed.
      let splicedSection = modified;
      const hoistedStyles:  string[] = [];
      const hoistedScripts: string[] = [];

      if (isRedesignIntent) {
        splicedSection = splicedSection
          .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m) => {
            hoistedStyles.push(m);
            return '';
          })
          .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (m) => {
            hoistedScripts.push(m);
            return '';
          });
        console.log(`⬆ Hoisting ${hoistedStyles.length} <style> block(s) and ${hoistedScripts.length} <script> block(s)`);
      }

      // ── Exact positional splice — no string matching needed ───────────────
      let updatedHtml = html.slice(0, targetBounds.start) + splicedSection + html.slice(targetBounds.end);

      // Inject hoisted styles before </head> and scripts before </body>
      if (hoistedStyles.length) {
        const headClose = updatedHtml.indexOf('</head>');
        const styleBlock = hoistedStyles.join('\n');
        updatedHtml = headClose !== -1
          ? updatedHtml.slice(0, headClose) + styleBlock + '\n' + updatedHtml.slice(headClose)
          : styleBlock + '\n' + updatedHtml;
      }
      if (hoistedScripts.length) {
        const bodyClose = updatedHtml.lastIndexOf('</body>');
        const scriptBlock = hoistedScripts.join('\n');
        updatedHtml = bodyClose !== -1
          ? updatedHtml.slice(0, bodyClose) + scriptBlock + '\n' + updatedHtml.slice(bodyClose)
          : updatedHtml + '\n' + scriptBlock;
      }

      if (updatedHtml === html) {
        console.log('⚠ LLM edit produced no change in the HTML');
        return reply.code(422).send({ error: 'Edit produced no change — try being more specific' });
      }

      console.log('✓ Edit applied successfully\n');
      return saveValidatedEdit(updatedHtml, editInstruction.replace(/^\[[^\]]+\]\s*/, '').slice(0, 80));
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Section extraction helpers ────────────────────────────────────────────
    type SectionSlice = { before: string; section: string; after: string; tag: string };

    function extractAllTopLevelSections(src: string): Array<{ start: number; end: number }> {
      const out: Array<{ start: number; end: number }> = [];
      let pos = 0;
      while (pos < src.length) {
        const openIdx = src.indexOf('<section', pos);
        if (openIdx === -1) break;
        const tagEnd = src.indexOf('>', openIdx);
        if (tagEnd === -1) break;
        let depth = 1, i = tagEnd + 1, sectionEnd = -1;
        while (i < src.length && depth > 0) {
          const nextOpen = src.indexOf('<section', i);
          const nextClose = src.indexOf('</section>', i);
          if (nextClose === -1) break;
          if (nextOpen !== -1 && nextOpen < nextClose) { depth++; i = nextOpen + 8; }
          else { depth--; i = nextClose + 10; if (depth === 0) sectionEnd = i; }
        }
        if (sectionEnd !== -1) { out.push({ start: openIdx, end: sectionEnd }); pos = sectionEnd; }
        else { pos = tagEnd + 1; }
      }
      return out;
    }

    function extractBestSection(src: string, hint: string): SectionSlice | null {
      const secs = extractAllTopLevelSections(src);
      if (secs.length === 0) return null;
      const hintLower = hint.toLowerCase();
      const words = hintLower.split(/\W+/).filter(w => w.length > 2);

      let best = secs[0], bestScore = -1;
      for (let i = 0; i < secs.length; i++) {
        const text = src.slice(secs[i].start, secs[i].end);
        const textLower = text.toLowerCase();
        let score = 0;

        // High-weight: id and class attributes contain section names like "hero", "about", "features"
        const idVal = (/\bid="([^"]+)"/.exec(text)?.[1] ?? '').toLowerCase();
        const classVal = (/\bclass="([^"]+)"/.exec(text)?.[1] ?? '').toLowerCase();
        const dataSection = (/\bdata-section="([^"]+)"/.exec(text)?.[1] ?? '').toLowerCase();
        const attrs = `${idVal} ${classVal} ${dataSection}`;

        // High-weight: first heading text inside the section
        const headingText = (/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/i.exec(text)?.[1] ?? '').toLowerCase();

        for (const w of words) {
          if (attrs.includes(w)) score += 4;       // id/class match is the strongest signal
          if (headingText.includes(w)) score += 3; // heading text is second strongest
          if (textLower.includes(w)) score += 1;   // general content match
        }

        // Positional aliases: "hero" or "first" → first section; "footer"/"last" → last
        if (i === 0 && /\b(?:hero|banner|intro|first|top)\b/.test(hintLower)) score += 6;
        if (i === secs.length - 1 && /\b(?:footer|last|bottom|end)\b/.test(hintLower)) score += 6;

        if (score > bestScore) { bestScore = score; best = secs[i]; }
      }
      return { before: src.slice(0, best.start), section: src.slice(best.start, best.end), after: src.slice(best.end), tag: 'section' };
    }

    function extractHeaderBlock(src: string): SectionSlice | null {
      const rx = /<(header|nav)\b[^>]*>[\s\S]*?<\/\1>/i;
      const m = rx.exec(src);
      if (!m) return null;
      return { before: src.slice(0, m.index), section: m[0], after: src.slice(m.index + m[0].length), tag: m[1].toLowerCase() };
    }
    // ──────────────────────────────────────────────────────────────────────────

    function applyPatches(base: string, patches: Array<{ find: string; replace: string }>): { html: string; applied: number; missed: number } {
      let result = base;
      let applied = 0, missed = 0;
      for (const p of patches) {
        if (!p.find || p.replace === undefined) continue;
        if (!result.includes(p.find)) { missed++; continue; }
        result = result.split(p.find).join(p.replace);
        applied++;
      }
      return { html: result, applied, missed };
    }

    function parseJsonPatches(rawText: string): { patches: Array<{ find: string; replace: string }>; summary: string } | null {
      const start = rawText.indexOf('{');
      if (start === -1) return null;
      // Use brace-depth tracking to find the END of the first complete JSON object.
      // lastIndexOf('}') would include any LLM reasoning text appended after the JSON.
      let depth = 0, end = -1, inString = false, escaped = false;
      for (let i = start; i < rawText.length; i++) {
        const c = rawText[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\' && inString) { escaped = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) return null;
      try {
        const slice = rawText.slice(start, end + 1)
          .replace(/("(?:[^"\\]|\\.)*")/gs, (m) => m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
        const parsed = JSON.parse(slice) as { patches?: Array<{ find: string; replace: string }>; summary?: string };
        return { patches: parsed.patches ?? [], summary: parsed.summary ?? 'Applied edit' };
      } catch { return null; }
    }

    function extractBlockFromResponse(rawText: string): { block: string; tag: string } | null {
      // Reject JSON responses — LLM "find" values contain HTML tags that would be
      // extracted as fake blocks and written as garbage into the microsite.
      const trimmed = rawText.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null;
      const stripped = extractHtmlFromResponse(rawText);
      for (const tag of ['section', 'header', 'nav', 'div']) {
        const startIdx = stripped.search(new RegExp(`<${tag}[\\s>]`, 'i'));
        if (startIdx === -1) continue;
        const closeTag = `</${tag}>`;
        const endIdx = stripped.lastIndexOf(closeTag);
        if (endIdx !== -1 && endIdx > startIdx) {
          return { block: stripped.slice(startIdx, endIdx + closeTag.length), tag };
        }
      }
      return null;
    }

    // Extract CSS :root block so the LLM knows available design tokens
    const cssVarsBlock = /:root\s*\{[^}]+\}/i.exec(html)?.[0] ?? '';

    const LARGE_HTML = 15000;
    const isLarge = html.length > LARGE_HTML;

    // "regenerate/rewrite/rebuild/redesign" → skip patches, go straight to section rewrite
    const isRegenIntent = /\b(?:regenerate|rewrite|rebuild|redesign|redo|remake|recreate)\b/i.test(instruction);

    // For logo/header/nav instructions on large HTML, prefer to extract the header block
    const isHeaderInstruction = /\b(?:logo|brand|icon|favicon|header|nav(?:bar)?)\b/i.test(instruction);

    let sectionCtx: SectionSlice | null = null;
    if (isLarge) {
      sectionCtx = (isHeaderInstruction ? extractHeaderBlock(html) : null) ?? extractBestSection(html, instruction);
    }

    // ── Section regeneration helper (used by regen intent + fallback) ─────────
    async function regenSection(ctx: SectionSlice): Promise<string> {
      const regenPrompt = `You are rewriting one section of an HTML microsite.

Apply the instruction exactly. You may change: text content, headings, body copy, colors, backgrounds, fonts, font sizes, font weights, spacing, layout, images, icons, buttons, links — whatever the instruction requires.
Preserve: overall section structure unless told otherwise, CSS class names, responsive/grid patterns, and references to CSS design tokens below.

Output ONLY the replacement HTML block — start with the opening tag (<section, <header, <nav, or <div), end with its closing tag. No preamble, no explanation, no markdown fences.
${cssVarsBlock ? `\nCSS DESIGN TOKENS (use var(--name) for colors/fonts/spacing where applicable):\n${cssVarsBlock}\n` : ''}
INSTRUCTION: ${instruction}

CURRENT SECTION:
${ctx.section}`;
      const regenRaw = await llmGenerateFn(regenPrompt);
      const block = extractBlockFromResponse(regenRaw);
      if (!block) throw new Error('LLM did not return a valid HTML block');
      return ctx.before + block.block + ctx.after;
    }
    // ──────────────────────────────────────────────────────────────────────────

    const EDIT_TYPE_HINT = `
Edit type examples (all supported):
- Text/content  : "change heading to X", "update body copy", "add bullet point"
- Color         : "make background dark blue", "change primary color to #e05", "update button color"
- Font/typography: "use Inter font", "make headings bold", "increase font size to 18px"
- Images        : "replace hero image with X", "add logo", "change background image"
- Layout/spacing: "add more padding", "make two columns", "center the text"
- Style         : "make it more modern", "add a gradient background", "remove border"
- Regeneration  : "regenerate this section", "rewrite with dark theme"`;

    let combinedPrompt: string;

    if (isLarge && sectionCtx && !isRegenIntent) {
      combinedPrompt = `You are editing a section of an HTML microsite. Apply the instruction using the lightest format that works.
${EDIT_TYPE_HINT}

OPTION 1 — surgical patches (preferred for targeted changes: text, colors, fonts, images, styles, attributes):
Output ONLY a JSON object, no preamble:
{ "patches": [{ "find": "exact substring", "replace": "replacement" }], "summary": "one-line description" }
Patch rules:
- Copy "find" strings EXACTLY from the HTML/CSS below — character-for-character, no rewording
- Include 15–30 chars of surrounding context so each "find" is unique in the full document
- NEVER put newlines inside "find" or "replace" — single-line strings only
- For COLORS: patch the CSS variable value → find "--color-primary: #aabbcc", replace "--color-primary: #112233"
- For FONTS: patch font variable → find "--font-heading: 'OldFont'", replace "--font-heading: 'NewFont'" OR patch font-family in a style attribute
- For TEXT: patch the exact text node or attribute value with enough surrounding markup to be unique
- For IMAGES: patch src="old-url" with src="new-url"
- For INLINE STYLES: patch the specific style property string
- Use 1–8 patches; use multiple patches for the same change across multiple places

OPTION 2 — full section rewrite (use for: add/remove elements, major layout change, section restructure):
Output ONLY the complete replacement HTML block — start with the opening tag, end with closing tag. No preamble, no code fences.

CSS DESIGN TOKENS (patch these variables for color/font/spacing changes):
${cssVarsBlock}

SECTION HTML (copy "find" strings EXACTLY from this text):
${sectionCtx.section}

EDIT INSTRUCTION: ${instruction}`;
    } else if (!isLarge) {
      combinedPrompt = `You are an HTML microsite editor. Apply the edit instruction with minimal, surgical changes.
${EDIT_TYPE_HINT}

OPTION 1 — surgical patches (preferred for targeted changes: text, colors, fonts, images, styles, attributes):
Respond with ONLY a JSON object (no preamble, start with {, end with }):
{ "patches": [{ "find": "exact substring", "replace": "replacement" }], "summary": "one-line description" }
Patch rules:
- Copy "find" strings EXACTLY from the HTML below — character-for-character
- Include enough surrounding context to make each "find" unique in the document
- NEVER put newlines inside "find" or "replace" — single-line strings only
- For COLORS: patch CSS variable → find "--color-bg: #fff", replace "--color-bg: #1a1a2e"
- For FONTS: patch font variable or font-family in style attribute
- For TEXT: patch the exact visible text with surrounding markup for uniqueness
- For IMAGES: patch src="old" with src="new"
- For STYLES: patch specific inline style property strings
- Use 1–8 patches

OPTION 2 — full HTML rewrite (for: adding/removing entire sections, major structural redesign, complete regeneration):
Output the sentinel line then a complete valid HTML document:
REWRITE
<!DOCTYPE html>
...complete new HTML...

EDIT INSTRUCTION: ${instruction}

CURRENT HTML:
${html}`;
    } else {
      combinedPrompt = ''; // handled by isRegenIntent path
    }

    const raw = combinedPrompt ? await llmGenerateFn(combinedPrompt) : '';

    let updatedHtml = html;
    let summary = 'Applied edit';
    let changedTexts: string[] = [];

    if (isLarge && sectionCtx) {
      if (isRegenIntent) {
        // User explicitly asked for regeneration — skip patches entirely
        try {
          updatedHtml = await regenSection(sectionCtx);
          summary = 'Section regenerated';
        } catch {
          return reply.code(502).send({ error: 'Could not regenerate section — try providing more detail in your instruction' });
        }
      } else {
        // Try OPTION 1 patches first
        const parsed = parseJsonPatches(raw);
        if (parsed && parsed.patches.length > 0) {
          const { html: patched, applied, missed } = applyPatches(html, parsed.patches);
          if (applied > 0) {
            updatedHtml = patched;
            summary = parsed.summary;
            changedTexts = parsed.patches.filter(p => p.replace !== undefined).map(p => p.replace);
            if (missed > 0) summary += ` (${missed} patch${missed > 1 ? 'es' : ''} skipped — text not found)`;
          } else {
            // All patches missed — fall back to section rewrite
            const blockResult = extractBlockFromResponse(raw);
            if (blockResult) {
              updatedHtml = sectionCtx.before + blockResult.block + sectionCtx.after;
              summary = 'Section rewritten';
            } else {
              try {
                updatedHtml = await regenSection(sectionCtx);
                summary = 'Section regenerated (patch fallback)';
              } catch {
                return reply.code(502).send({ error: 'Could not apply edit — try rephrasing your instruction' });
              }
            }
          }
        } else {
          // No JSON patches — try block extraction (LLM may have chosen OPTION 2 directly)
          const blockResult = extractBlockFromResponse(raw);
          if (blockResult) {
            updatedHtml = sectionCtx.before + blockResult.block + sectionCtx.after;
            summary = 'Section updated';
          } else {
            // Empty patches or unparseable — fall back to regen
            try {
              updatedHtml = await regenSection(sectionCtx);
              summary = 'Section regenerated';
            } catch {
              return reply.code(502).send({ error: 'Could not apply edit — try rephrasing your instruction' });
            }
          }
        }
      }
    } else {
      // Small HTML: try patches, then REWRITE sentinel
      const rewriteMatch = raw.match(/REWRITE\s*\r?\n([\s\S]+)/);
      if (rewriteMatch) {
        const candidate = extractHtmlFromResponse(rewriteMatch[1]);
        if (!candidate.includes('</body>') && !candidate.includes('</html>')) {
          return reply.code(502).send({ error: 'Generated HTML appears truncated — try a more targeted edit instruction' });
        }
        updatedHtml = candidate;
        summary = 'Full rewrite applied';
      } else {
        const parsed = parseJsonPatches(raw);
        if (!parsed) return reply.code(502).send({ error: 'LLM returned no recognisable format — try rephrasing' });
        const { html: patched, applied, missed } = applyPatches(html, parsed.patches);
        if (applied === 0) {
          return reply.code(502).send({ error: 'Edit could not be applied — the target text was not found. Try being more specific.' });
        }
        updatedHtml = patched;
        summary = parsed.summary;
        changedTexts = parsed.patches.filter(p => p.replace !== undefined).map(p => p.replace);
        if (missed > 0) summary += ` (${missed} patch${missed > 1 ? 'es' : ''} skipped — text not found)`;
      }
    }

    return saveValidatedEdit(updatedHtml, summary, { changedTexts });
  });

  // GET /super-clients/:name/microsites/:id/sections  — list top-level sections with index + preview
  app.get('/super-clients/:name/microsites/:id/sections', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });

    const filePath = path.join(superClientsRoot, name, 'microsites', `${id}.json`);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(superClientsRoot, name, 'microsites')))) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>;
    } catch { return reply.code(404).send({ error: 'Microsite not found' }); }

    const astSections = ast.sections as Array<Record<string, unknown>> | undefined;
    const html = (astSections?.[0]?.customHtml as string | undefined) ?? '';

    // extractAllTopLevelSections is a local fn inside the edit handler, so inline a copy here
    const sectionBounds: Array<{ start: number; end: number }> = [];
    let pos = 0;
    while (pos < html.length) {
      const openIdx = html.indexOf('<section', pos);
      if (openIdx === -1) break;
      const tagEnd = html.indexOf('>', openIdx);
      if (tagEnd === -1) break;
      let depth = 1, i = tagEnd + 1, sectionEnd = -1;
      while (i < html.length && depth > 0) {
        const nOpen = html.indexOf('<section', i);
        const nClose = html.indexOf('</section>', i);
        if (nClose === -1) break;
        if (nOpen !== -1 && nOpen < nClose) { depth++; i = nOpen + 8; }
        else { depth--; i = nClose + 10; if (depth === 0) sectionEnd = i; }
      }
      if (sectionEnd !== -1) { sectionBounds.push({ start: openIdx, end: sectionEnd }); pos = sectionEnd; }
      else { pos = tagEnd + 1; }
    }

    const sections = sectionBounds.map((s, i) => {
      const text = html.slice(s.start, s.end);
      const headingMatch = /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i.exec(text);
      const idMatch = /\bid="([^"]+)"/.exec(text);
      const classMatch = /\bclass="([^"]+)"/.exec(text);
      const label = headingMatch?.[1]?.trim() ?? idMatch?.[1]?.trim() ?? classMatch?.[1]?.split(/\s+/)[0] ?? `Section ${i + 1}`;
      return { index: i, label, length: text.length, preview: text.slice(0, 200) };
    });

    return reply.send({ sections, total: sections.length });
  });

  // POST /super-clients/:name/microsites/:id/sections/regenerate  — rewrite one section with LLM
  app.post('/super-clients/:name/microsites/:id/sections/regenerate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });

    const body = req.body as { instruction?: string; sectionIndex?: number } | undefined;
    const instruction = body?.instruction?.trim();
    if (!instruction) return reply.code(400).send({ error: 'Missing instruction' });

    const dir = path.join(superClientsRoot, name);
    const filePath = path.join(dir, 'microsites', `${id}.json`);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'microsites')))) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>;
    } catch { return reply.code(404).send({ error: 'Microsite not found' }); }

    const astSections = ast.sections as Array<Record<string, unknown>> | undefined;
    const html = (astSections?.[0]?.customHtml as string | undefined) ?? '';
    if (!html) return reply.code(400).send({ error: 'Microsite has no HTML content' });

    // Locate the target section (by index or best keyword match)
    const bounds: Array<{ start: number; end: number }> = [];
    let p = 0;
    while (p < html.length) {
      const oi = html.indexOf('<section', p);
      if (oi === -1) break;
      const te = html.indexOf('>', oi);
      if (te === -1) break;
      let depth = 1, ci = te + 1, se = -1;
      while (ci < html.length && depth > 0) {
        const no = html.indexOf('<section', ci);
        const nc = html.indexOf('</section>', ci);
        if (nc === -1) break;
        if (no !== -1 && no < nc) { depth++; ci = no + 8; }
        else { depth--; ci = nc + 10; if (depth === 0) se = ci; }
      }
      if (se !== -1) { bounds.push({ start: oi, end: se }); p = se; } else { p = te + 1; }
    }

    if (bounds.length === 0) return reply.code(400).send({ error: 'No sections found in microsite HTML' });

    let target = bounds[0];
    const idx = body?.sectionIndex ?? -1;
    if (idx >= 0 && idx < bounds.length) {
      target = bounds[idx];
    } else {
      // Score by id/class/heading match (same logic as edit endpoint)
      const hintLower = instruction.toLowerCase();
      const words = hintLower.split(/\W+/).filter(w => w.length > 2);
      let best = bounds[0], bestScore = -1;
      for (let i = 0; i < bounds.length; i++) {
        const text = html.slice(bounds[i].start, bounds[i].end);
        const textLower = text.toLowerCase();
        let score = 0;
        const attrs = [
          (/\bid="([^"]+)"/.exec(text)?.[1] ?? ''),
          (/\bclass="([^"]+)"/.exec(text)?.[1] ?? ''),
        ].join(' ').toLowerCase();
        const heading = (/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/i.exec(text)?.[1] ?? '').toLowerCase();
        for (const w of words) {
          if (attrs.includes(w)) score += 4;
          if (heading.includes(w)) score += 3;
          if (textLower.includes(w)) score += 1;
        }
        if (i === 0 && /\b(?:hero|banner|intro|first|top)\b/.test(hintLower)) score += 6;
        if (i === bounds.length - 1 && /\b(?:footer|last|bottom|end)\b/.test(hintLower)) score += 6;
        if (score > bestScore) { bestScore = score; best = bounds[i]; }
      }
      target = best;
    }

    const sectionHtml = html.slice(target.start, target.end);
    const cssVarsBlock = /:root\s*\{[^}]+\}/i.exec(html)?.[0] ?? '';

    const prompt = `You are rewriting one section of an HTML microsite.

Apply the instruction exactly. You may change: text content, headings, body copy, colors, backgrounds, fonts, font sizes, font weights, spacing, layout, images, icons, buttons, links — whatever the instruction requires.
Preserve: overall section structure unless told otherwise, CSS class names, responsive patterns.

Output ONLY the replacement HTML block — start with the opening tag (<section, <header, <nav, or <div), end with its closing tag. No preamble, no explanation, no markdown fences.
${cssVarsBlock ? `\nCSS DESIGN TOKENS (use var(--name) for colors/fonts/spacing where applicable):\n${cssVarsBlock}\n` : ''}
INSTRUCTION: ${instruction}

CURRENT SECTION:
${sectionHtml}`;

    const regenRaw = await llmGenerateFn(prompt);
    const sectionMatch = regenRaw.match(/<section[\s\S]*<\/section>/i);
    if (!sectionMatch) return reply.code(502).send({ error: 'LLM did not return a valid section — try rephrasing' });

    const updatedHtml = html.slice(0, target.start) + sectionMatch[0] + html.slice(target.end);
    const updatedAst = { ...ast, sections: [{ ...astSections![0], customHtml: updatedHtml, previousHtml: html }, ...((astSections ?? []).slice(1))] };
    await writeFile(filePath, JSON.stringify(updatedAst, null, 2));

    return reply.send({ html: updatedHtml, sectionHtml: sectionMatch[0], sectionIndex: idx >= 0 ? idx : null, summary: 'Section regenerated' });
  });

  // POST /super-clients/:name/microsites/:id/revert  — undo last edit
  app.post('/super-clients/:name/microsites/:id/revert', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.status(400).send({ error: 'Invalid id' });

    const dir = path.join(superClientsRoot, name);
    const filePath = path.join(dir, 'microsites', `${id}.json`);
    try { await readMeta(dir); } catch { return reply.status(404).send({ error: 'Client not found' }); }

    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    } catch { return reply.status(404).send({ error: 'Microsite not found' }); }

    const sections = ast.sections as Array<Record<string, unknown>> | undefined;
    const currentHtml = (sections?.[0]?.customHtml as string | undefined) ?? '';
    const previousHtml = sections?.[0]?.previousHtml as string | undefined;

    if (!previousHtml) return reply.status(409).send({ error: 'No previous version to revert to' });

    const revertedAst = { ...ast, sections: [{ ...sections![0], customHtml: previousHtml, previousHtml: currentHtml }, ...((sections ?? []).slice(1))] };
    await writeFile(filePath, JSON.stringify(revertedAst, null, 2));

    return reply.send({ html: previousHtml });
  });

  // PATCH /super-clients/:name/microsites/:id/html  — directly overwrite customHtml (no LLM)
  app.patch('/super-clients/:name/microsites/:id/html', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { customHtml: rawCustomHtml } = (req.body ?? {}) as { customHtml?: string };
    if (typeof rawCustomHtml !== 'string' || !rawCustomHtml.trim()) return reply.code(400).send({ error: 'Missing customHtml' });
    const customHtml = stripPreviewInjections(rawCustomHtml);

    const dir = path.join(superClientsRoot, name);
    const filePath = path.join(dir, 'microsites', `${id}.json`);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'microsites')))) return reply.code(400).send({ error: 'Invalid id' });

    let ast: Record<string, unknown>;
    try { ast = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>; }
    catch { return reply.code(404).send({ error: 'Microsite not found' }); }

    const sections = ast.sections as Array<Record<string, unknown>> | undefined;
    const prevHtml = (sections?.[0]?.customHtml as string | undefined) ?? '';
    const updatedAst = { ...ast, sections: [{ ...(sections?.[0] ?? {}), customHtml, previousHtml: prevHtml }, ...((sections ?? []).slice(1))] };
    await writeFile(filePath, JSON.stringify(updatedAst, null, 2));
    return reply.send({ ok: true });
  });

  // PATCH /super-clients/:name/context  — update context.md manually
  app.patch('/super-clients/:name/context', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const body = req.body as { contextMd?: string } | undefined;

    const dir = path.join(superClientsRoot, name);
    try {
      await readMeta(dir);
      await writeFile(path.join(dir, 'context.md'), body?.contextMd ?? '');
      return reply.send({ ok: true });
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
  });

  // POST /super-clients/:name/enrich-url  — (re)generate context from a website URL
  app.post('/super-clients/:name/enrich-url', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const body = req.body as { url?: string } | undefined;
    const url = body?.url?.trim();

    if (!url) {
      return reply.code(400).send({ error: 'Missing required field: url' });
    }

    const dir = path.join(superClientsRoot, name);
    let meta: SuperClientMeta;
    try {
      meta = await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }

    meta.url = url;
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    const parts: string[] = [
      'You are a client intelligence researcher. Given a company website URL, extract structured information useful for building microsites and proposals.',
      'Focus on: product or service description, company tone and personality, industry and target market, key selling points and differentiators, visual brand cues (colors, style).',
      'Output clean, well-structured markdown without preamble.',
      '',
      `Website URL: ${url}`,
    ];

    let contextMd: string;
    try {
      contextMd = await llmGenerateFn(parts.join('\n'));
    } catch (err) {
      app.log.warn({ err }, '[SuperClient] URL enrichment context generation failed');
      return reply.code(500).send({ error: 'Context generation failed' });
    }

    await writeFile(path.join(dir, 'context.md'), contextMd);
    await seedClientMemory(name, meta.displayName, contextMd, workdir, app.log);

    return reply.send({ meta, contextMd });
  });
}
