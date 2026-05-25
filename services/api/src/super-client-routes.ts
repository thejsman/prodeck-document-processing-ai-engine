import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';
import { llmGenerateFn } from './agent-routes.js';
import { ClientMemoryService } from './memory/client-memory.service.js';
import type { ClientKnowledgeEntry } from './memory/client-memory.types.js';

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

async function readMeta(dir: string): Promise<SuperClientMeta> {
  const raw = await readFile(path.join(dir, 'meta.json'), 'utf-8');
  return JSON.parse(raw) as SuperClientMeta;
}

async function readHistory(dir: string): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(path.join(dir, 'history.json'), 'utf-8');
    return JSON.parse(raw) as HistoryEntry[];
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

    const excerpt = text.slice(0, 12000);

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

    for (const k of extracted.knowledge ?? []) {
      if (k.content?.trim()) {
        await memService.addKnowledge(clientSlug, k.content, k.category as ClientKnowledgeEntry['category'], k.confidence ?? 0.7, fileName);
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

    // Seed ClientMemory by extracting structured knowledge from contextMd (same pipeline as document ingestion)
    if (contextMd.trim()) {
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
        app.log.warn({ err }, '[SuperClient] Failed to seed memory from contextMd');
      }
    }

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
      'Content-Type': 'text/event-stream',
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
            `When the user requests any change to the proposal above, choose the lightest format:`,
            ``,
            `SMALL / TARGETED change (update a price, reword a paragraph, add/remove a bullet, fix a number, change a date):`,
            `  Output ONE or MORE <section-update> tags — one per changed section only:`,
            `  <section-update heading="## Exact Heading Text">`,
            `  [full replacement body for that section — do NOT repeat the heading line inside the tag]`,
            `  </section-update>`,
            `  Outside the tags write a brief 1-sentence confirmation only.`,
            ``,
            `MAJOR rewrite / restructure (add new sections, reorder, change the whole proposal):`,
            `  Use the full <proposal title="...">...</proposal> tag as normal.`,
            ``,
            `NEVER output both formats in the same response. Default to <section-update> unless the change clearly spans the entire document.`,
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

      // Detect proposal changes — section-level patch takes priority over full regeneration
      let proposalSaved: ScProposal | undefined;
      let proposalUpdated: ScProposal | undefined;

      const sectionUpdates = activeProposalId ? extractSectionUpdates(fullResponse) : [];

      if (sectionUpdates.length > 0 && activeProposalId && activeProposalContent !== undefined) {
        try {
          const patchedContent = patchProposalSections(activeProposalContent, sectionUpdates);
          const existingProposals = await readProposals(dir);
          const existingEntry = existingProposals.find((p) => p.fileName === activeProposalId);
          const title = existingEntry?.title ?? activeProposalId;
          proposalUpdated = await updateProposal(dir, activeProposalId, title, patchedContent);
        } catch (err) {
          app.log.warn({ err }, '[SuperClient] Failed to patch proposal sections');
        }
      } else {
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
        }
      }

      // Strip all XML tags from display text
      const displayResponse = sectionUpdates.length > 0
        ? stripSectionUpdateTags(fullResponse)
        : (extractProposalTag(fullResponse) ? stripProposalTag(fullResponse) : fullResponse);

      // Persist turn to history
      const now = new Date().toISOString();
      const updatedHistory: HistoryEntry[] = [
        ...history,
        { role: 'user', content: message, createdAt: now },
        { role: 'assistant', content: displayResponse, createdAt: now },
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

      void extractFileToMemory(workdir, name, meta.displayName, destPath, safeName, dir, app.log);
    }

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
    const id = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const proposalTitle = body.proposalTitle?.trim() ?? 'Proposal';

    const existing = await readMicrosites(dir);
    const priorCount = existing.filter((m) => m.proposalTitle === proposalTitle).length;
    const version = priorCount + 1;

    const entry: ScMicrosite = {
      id,
      title: `${proposalTitle} (v${version})`,
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

  // POST /super-clients/:name/microsites/:id/edit  — LLM patch edit on microsite HTML
  app.post('/super-clients/:name/microsites/:id/edit', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });

    const body = req.body as { instruction?: string } | undefined;
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
    const html = (sections?.[0]?.customHtml as string | undefined) ?? '';
    if (!html) return reply.code(400).send({ error: 'Microsite has no HTML content' });

    const combinedPrompt = `You are an HTML microsite editor. Given a complete HTML microsite and an edit instruction, choose one of two response formats:

FORMAT A — targeted changes (colors, fonts, text, spacing). Use this for most edits.
Respond with ONLY a JSON object (no preamble, start with {, end with }):
{ "patches": [{ "find": "exact single-line string", "replace": "new single-line string" }], "summary": "one-line description" }

Patch rules:
- ONLY target CSS custom properties defined in the :root block — these are always single-line (e.g. find "--color-bg: #ffffff", replace "--color-bg: #0a1628")
- NEVER include newlines inside "find" or "replace" values — single-line strings only
- If the change cannot be expressed as :root variable swaps, use FORMAT B instead
- Each "find" must appear exactly once in the document
- Use the minimum patches needed (usually 1–3)

FORMAT B — use when patches would require multi-line strings, or for structural changes (add/remove sections, complete redesign).
Respond with this exact format — the sentinel line first, then the complete HTML:
REWRITE
<!DOCTYPE html>
...complete new HTML document...

VIDEO BACKGROUND RULE:
If the instruction references a Vimeo or YouTube URL for a background:
- Vimeo: extract the numeric ID from the URL (e.g. vimeo.com/789106059 → ID is 789106059), embed as:
  <iframe src="https://player.vimeo.com/video/{ID}?background=1&autoplay=1&loop=1&muted=1&byline=0&title=0" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;pointer-events:none;z-index:0" allow="autoplay; fullscreen" frameborder="0"></iframe>
- YouTube: extract the video ID, embed as:
  <iframe src="https://www.youtube.com/embed/{ID}?autoplay=1&loop=1&mute=1&controls=0&playlist={ID}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;pointer-events:none;z-index:0" allow="autoplay; fullscreen" frameborder="0"></iframe>
- Place the iframe as the first child of the hero section; set the hero section to position:relative and overflow:hidden
- Ensure all hero text/content elements have position:relative and z-index:1 so they appear above the video
- Remove any existing background-image or background CSS from the hero section
- This always requires FORMAT B (REWRITE) since it modifies HTML structure

EDIT INSTRUCTION: ${instruction}

CURRENT HTML:
${html}`;

    const raw = await llmGenerateFn(combinedPrompt);

    let updatedHtml = html;
    let summary = 'Applied edit';

    // Detect FORMAT B: response starts with REWRITE sentinel (possibly after whitespace/fences)
    const rewriteMatch = raw.match(/REWRITE\s*\n([\s\S]+)/);
    if (rewriteMatch) {
      updatedHtml = rewriteMatch[1].trim();
      summary = 'Full rewrite applied';
    } else {
      // FORMAT A: JSON patches
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) return reply.code(502).send({ error: 'LLM returned no recognisable format' });

      let parsed: { patches?: Array<{ find: string; replace: string }>; summary?: string };
      try {
        // Sanitize literal newlines inside JSON string values (LLM sometimes forgets to escape them)
        const jsonSlice = raw.slice(jsonStart, jsonEnd + 1)
          .replace(/("(?:[^"\\]|\\.)*")/g, (m) => m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
        parsed = JSON.parse(jsonSlice) as typeof parsed;
      } catch {
        return reply.code(502).send({ error: 'LLM returned malformed JSON' });
      }

      summary = parsed.summary ?? summary;
      for (const patch of parsed.patches ?? []) {
        if (patch.find && patch.replace !== undefined) {
          updatedHtml = updatedHtml.split(patch.find).join(patch.replace);
        }
      }
    }

    // Write updated ast back to disk, preserving old HTML for one-level undo
    const updatedAst = { ...ast, sections: [{ ...sections![0], customHtml: updatedHtml, previousHtml: html }, ...((sections ?? []).slice(1))] };
    await writeFile(filePath, JSON.stringify(updatedAst, null, 2));

    return reply.send({ html: updatedHtml, summary });
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
}
