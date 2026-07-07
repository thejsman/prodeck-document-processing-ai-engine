import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';
import { llmGenerateFn } from './agent-routes.js';
import { fetchPexelsImageUrl } from './image-routes.js';
import { ClientMemoryService } from './memory/client-memory.service.js';
import type { ClientKnowledgeEntry } from './memory/client-memory.types.js';
import { readOrgContextSettings, resolveVoiceBlock, superClientWorkdir, getMimeType } from '@ai-engine/runtime';
import { findBestDocumentSkill, loadSkill, formatSkillForSlides, listSkills } from './skills/skill.service.js';
import { saveDocumentDirect, getDocumentContent, getDocumentMeta } from './documents/document-generator.js';
import { parseRequestedFormat, detectPresentationIntent, detectSlideOrientation } from './documents/format-detector.js';
import { validateSlideHtml, countSlides, extractTitle, resolveSlideOrientation } from './slides/slide-generator.js';
import type { SavedSlide } from './slides/slide-generator.js';
import { patchHtml, toVideoEmbedUrl, findByPath, locateElement, hideCoveringImage } from './html-patch.js';

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

// Strip constructs that would render source code as visible text in the microsite.
// Called on every LLM response before it is written into customHtml.
function sanitizeHtmlOutput(html: string): string {
  return html
    // Embedded markdown code fence blocks inside HTML body → remove entirely
    .replace(/```(?:html|css|js|javascript|typescript|text|xml)?\s*\r?\n([\s\S]*?)\r?\n```/g, '')
    // <pre> blocks containing HTML entities (escaped HTML/CSS/JS code) → remove
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (match) =>
      /&lt;|&gt;|&amp;lt;/.test(match) ? '' : match,
    );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// Locate the Chrome binary that Puppeteer downloaded to ~/.cache/puppeteer/chrome.
// Returns null if nothing is found — caller should surface a 503.
async function findChromeBinary(): Promise<string | null> {
  const { homedir } = await import('node:os');
  const cacheDir = path.join(homedir(), '.cache', 'puppeteer', 'chrome');
  let versions: string[];
  try {
    versions = await readdir(cacheDir);
  } catch {
    return null;
  }
  for (const v of versions.sort().reverse()) {
    const candidates = [
      // macOS
      path.join(cacheDir, v, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(cacheDir, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      // Linux
      path.join(cacheDir, v, 'chrome-linux64', 'chrome'),
      path.join(cacheDir, v, 'chrome-linux', 'chrome'),
    ];
    for (const candidate of candidates) {
      try {
        await stat(candidate);
        return candidate;
      } catch { /* try next */ }
    }
  }
  return null;
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
  editContext?: 'microsite' | 'proposal' | 'document';
  // Set on an assistant turn when it asked a clarifying question, so the next
  // turn can resolve the deferred intent instead of re-classifying from scratch.
  pendingClarification?: PendingClarification;
}

interface ScFile {
  fileName: string;
  originalName?: string;
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
  pdfPresentation?: boolean;
  pdfOrientation?: 'landscape' | 'portrait';
}

interface GenerationEntry {
  id: string;
  clientSlug: string;
  type: 'proposal' | 'microsite' | 'slide';
  phase: 'generating' | 'complete' | 'error';
  title: string;
  steps: string[];
  createdAt?: string;
  charCount?: number;
  error?: string;
  result?: { fileName?: string; micrositeId?: string; slideId?: string };
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

/** The pending clarification carried by the most recent assistant turn, if any. */
function lastAssistantPending(history: HistoryEntry[]): PendingClarification | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') return history[i].pendingClarification;
  }
  return undefined;
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

async function updateDocumentContent(
  workdir: string,
  clientSlug: string,
  id: string,
  content: string,
): Promise<import('./skills/skill.types.js').GeneratedDocumentMeta> {
  const docsDir = path.join(workdir, 'super-clients', clientSlug, 'documents');
  await writeFile(path.join(docsDir, `${id}.md`), content, 'utf-8');
  // Update updatedAt in meta
  const meta = await getDocumentMeta(workdir, clientSlug, id);
  const updatedMeta = { ...meta, updatedAt: new Date().toISOString() };
  await writeFile(path.join(docsDir, `${id}.meta.json`), JSON.stringify(updatedMeta, null, 2), 'utf-8');
  // Update index entry
  const indexPath = path.join(workdir, 'super-clients', clientSlug, 'documents.json');
  try {
    const raw = await readFile(indexPath, 'utf-8');
    const index = JSON.parse(raw) as Array<Record<string, unknown>>;
    const idx = index.findIndex((e) => e['id'] === id);
    if (idx !== -1) index[idx] = { ...index[idx], updatedAt: updatedMeta.updatedAt };
    await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch { /* index update is best-effort */ }
  return updatedMeta;
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

function extractDocumentTag(
  text: string,
): { title: string; type: string; format: string; content: string } | null {
  const match = text.match(
    /<document\s+title="([^"]+)"(?:\s+type="([^"]*)")?(?:\s+format="([^"]*)")?>([\s\S]*?)<\/document>/i,
  );
  if (!match) return null;
  return {
    title: match[1].trim(),
    type: match[2]?.trim() ?? 'document',
    format: match[3]?.trim() ?? 'md',
    content: match[4].trim(),
  };
}

function stripDocumentTag(text: string): string {
  return text
    .replace(/<document\s+title="[^"]*"(?:\s+type="[^"]*")?(?:\s+format="[^"]*")?>[\s\S]*?<\/document>/i, '')
    .trim();
}

function extractSlidesTag(text: string): { html: string } | null {
  const m = text.match(/<slides>([\s\S]*?)<\/slides>/i);
  if (!m) return null;
  return { html: m[1].trim() };
}

function stripSlidesTag(text: string): string {
  return text.replace(/<slides>[\s\S]*?<\/slides>/i, '').trim();
}

async function saveSlide(
  dir: string,
  clientSlug: string,
  html: string,
  orientation: 'landscape' | 'portrait' = 'landscape',
): Promise<SavedSlide> {
  const slidesDir = path.join(dir, 'slides');
  await mkdir(slidesDir, { recursive: true });

  const now = new Date();
  const id = `${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
  const entry: SavedSlide = {
    id,
    title: extractTitle(html),
    client: clientSlug,
    slideCount: countSlides(html),
    savedAt: now.toISOString(),
    orientation,
  };

  await writeFile(path.join(slidesDir, `${id}.html`), html);

  // Update slides index
  let index: SavedSlide[] = [];
  try {
    const raw = await readFile(path.join(dir, 'slides.json'), 'utf-8');
    index = JSON.parse(raw) as SavedSlide[];
  } catch { /* first slide */ }
  index.unshift(entry);
  await writeFile(path.join(dir, 'slides.json'), JSON.stringify(index, null, 2));

  return entry;
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

const TONE_PATTERNS = [
  /\buse\s+a?\s*([\w][\w\s-]{1,30}?)\s+tone\b/i,
  /\bwrite\s+(?:in\s+)?a?\s*([\w][\w\s-]{1,30}?)\s+(?:tone|style|voice)\b/i,
  /\bsound(?:s)?\s+more\s+([\w-]+)\b/i,
  /\bbe\s+more\s+([\w-]+)\b/i,
  /\bswitch\s+(?:to\s+)?(?:a?\s*)?([\w\s-]{2,20}?)\s+(?:tone|style|voice)\b/i,
  /\badopt\s+(?:a?\s*)?([\w\s-]{2,20}?)\s+(?:tone|style|voice)\b/i,
  /\bmake\s+(?:it|this)\s+(?:sound\s+)?(?:more\s+)?([\w-]+)\b/i,
];

const TONE_WORDS = new Set([
  'casual', 'informal', 'friendly', 'warm', 'conversational', 'relaxed',
  'formal', 'professional', 'corporate', 'serious', 'authoritative', 'assertive',
  'confident', 'direct', 'concise', 'aggressive', 'bold',
  'consultative', 'empathetic', 'collaborative', 'inclusive',
  'enthusiastic', 'energetic', 'passionate', 'neutral', 'objective',
  'technical', 'simple', 'plain', 'persuasive', 'compelling', 'playful',
]);

/**
 * Scan the current message and recent user messages for an explicit tone/style
 * override request. Returns the matched phrase if found, null otherwise.
 * Checks the current message first (highest recency), then walks back through
 * the last 5 user turns so a tone set earlier in the conversation still wins.
 */
function detectToneOverride(
  currentMessage: string,
  history: Array<{ role: string; content: string }>,
): string | null {
  const recentUserMessages = history
    .filter((h) => h.role === 'user')
    .slice(-5)
    .map((h) => h.content);

  for (const text of [currentMessage, ...recentUserMessages]) {
    for (const pattern of TONE_PATTERNS) {
      const match = text.match(pattern);
      if (!match) continue;
      const captured = match[1]?.toLowerCase().trim() ?? '';
      const hasToneWord = [...TONE_WORDS].some((tw) => captured.includes(tw));
      if (hasToneWord) return match[0].trim();
    }
  }
  return null;
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

// Drop entries below this confidence — anything the model is unsure about is
// noise, not durable memory.
const MEMORY_MIN_CONFIDENCE = 0.6;
// Hedging language is a tell that the "fact" is a guess, not knowledge.
const HEDGE_PATTERN = /\b(possibly|maybe|perhaps|might be|could be|based on context|presumably|likely|seems? to)\b/i;

export interface MemoryDistillSummary {
  knowledgeAdded: number;
  stakeholdersAdded: number;
  skipped: number;
}

// Extract NEW facts from a chat turn and persist to ClientMemoryService.
// Uses llmGenerateFn → Python LLM bridge → respects configured provider/model.
// Returns a summary of what was learned (or null on failure) so the caller can
// confirm it to the user. Never throws — memory must never break the chat reply.
async function distillChatTurn(
  workdir: string,
  clientSlug: string,
  clientName: string,
  userMessage: string,
  assistantReply: string,
  log: FastifyBaseLogger,
): Promise<MemoryDistillSummary | null> {
  try {
    const memService = new ClientMemoryService(workdir);
    const existing = await memService.get(clientSlug);
    // Feed the model everything already known so it stops re-extracting and
    // hedging over facts we already hold (e.g. the company name).
    const knownFacts = (existing?.knowledge ?? [])
      .filter((k) => !k.supersededBy)
      .map((k) => k.content.trim())
      .filter(Boolean);
    const knownNorm = new Set(knownFacts.map((c) => c.toLowerCase()));
    const knownBlock = knownFacts.length
      ? `\nALREADY KNOWN — do NOT re-extract these or minor rephrasings of them:\n${knownFacts.map((c) => `- ${c}`).join('\n')}\n`
      : '';

    const prompt = `You are a client intelligence extractor.
Given this chat exchange about a client, extract ONLY NEW, durable facts worth remembering long-term.
Focus on: company facts, preferences, constraints, requirements, stakeholders (people + roles), brand traits.
Skip: conversational filler, questions without answers, project-specific one-off details, and anything already known.

STRICT RULES:
- Do NOT hedge or speculate. If a fact is not stated clearly, omit it — never write "possibly", "maybe", "likely", or "based on context".
- Do NOT restate facts already known (see the ALREADY KNOWN list) or facts already obvious from the client profile.
- Prefer a few high-signal facts over many weak ones. Score confidence honestly (0.0–1.0); if you are not confident, omit the fact rather than giving it a low score.

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
${knownBlock}
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

    const raw = await llmGenerateFn(prompt);
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const extracted = JSON.parse(json) as {
      knowledge?: { content: string; category: string; confidence: number }[];
      stakeholders?: { name: string; role: string; email?: string; notes?: string }[];
    };

    if (!existing) {
      await memService.createEmpty(clientName);
    }

    let knowledgeAdded = 0;
    let skipped = 0;
    for (const k of extracted.knowledge ?? []) {
      const content = k.content?.trim();
      if (!content) continue;
      const confidence = k.confidence ?? 0.7;
      // Reject low-confidence guesses, hedged phrasing, and anything we already know.
      if (
        confidence < MEMORY_MIN_CONFIDENCE ||
        HEDGE_PATTERN.test(content) ||
        knownNorm.has(content.toLowerCase())
      ) {
        skipped++;
        continue;
      }
      await memService.addKnowledge(clientSlug, content, k.category as ClientKnowledgeEntry['category'], confidence);
      knownNorm.add(content.toLowerCase());
      knowledgeAdded++;
    }

    let stakeholdersAdded = 0;
    for (const s of extracted.stakeholders ?? []) {
      if (s.name?.trim() && s.role?.trim()) {
        await memService.addStakeholder(clientSlug, {
          name: s.name,
          role: s.role,
          ...(s.email?.trim() ? { email: s.email } : {}),
          ...(s.notes?.trim() ? { notes: s.notes } : {}),
        });
        stakeholdersAdded++;
      }
    }

    log.info(
      { clientSlug, knowledgeAdded, stakeholdersAdded, skipped },
      '[SuperClient] Memory distillation complete',
    );
    return { knowledgeAdded, stakeholdersAdded, skipped };
  } catch (err) {
    log.warn({ err }, '[SuperClient] Memory distillation failed — chat unaffected');
    return null;
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
    const body = req.body as { message?: string; activeProposalId?: string; activeDocumentId?: string } | undefined;

    const message = body?.message?.trim();
    const activeProposalId = body?.activeProposalId?.trim() || undefined;
    const activeDocumentId = body?.activeDocumentId?.trim() || undefined;
    if (!message) {
      return reply.code(400).send({ error: 'Missing required field: message' });
    }

    const detectedFormat = parseRequestedFormat(message);

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
      const [contextMd, history, memResult, scFiles, authorVoiceBlock, orgSettings] = await Promise.all([
        readContext(dir),
        readHistory(dir),
        new ClientMemoryService(workdir).prepopulate(name),
        readScFiles(dir),
        resolveVoiceBlock(workdir, superClientWorkdir(workdir, name)),
        readOrgContextSettings(workdir),
      ]);

      const extractedFiles = scFiles.filter((f) => f.status === 'extracted');

      // Stream a plain assistant message word-by-word (matches the generation UX)
      // and persist the turn — used by the intent-gate terminal branches below.
      const streamAssistant = async (text: string) => {
        for (const w of text.split(' ')) {
          send({ type: 'chunk', text: w + ' ' });
          await new Promise<void>((r) => setTimeout(r, 12));
        }
      };
      const persistTurn = async (assistantText: string, pending?: PendingClarification) => {
        const updated: HistoryEntry[] = [
          ...history,
          { role: 'user', content: message, createdAt: new Date().toISOString() },
          {
            role: 'assistant',
            content: assistantText,
            createdAt: new Date(Date.now() + 1).toISOString(),
            ...(pending ? { pendingClarification: pending } : {}),
          },
        ];
        await writeFile(path.join(dir, 'history.json'), JSON.stringify(updated, null, 2));
      };

      // Resolve skill match BEFORE building the prompt so we can branch the generation rules.
      let matchedDocumentSkill: Awaited<ReturnType<typeof findBestDocumentSkill>> = null;
      let matchedSkillInstructionsMd: string | undefined;
      let matchedSkillSections: Awaited<ReturnType<typeof loadSkill>>['sections'] | undefined;
      try {
        matchedDocumentSkill = await findBestDocumentSkill(workdir, message);
        if (matchedDocumentSkill) {
          const loaded = await loadSkill(workdir, matchedDocumentSkill.slug);
          matchedSkillInstructionsMd = loaded?.instructionsMd;
          matchedSkillSections = loaded?.sections;
        }
      } catch {
        // Non-critical — skill matching failure should not block generation
      }

      const msgLower = message.toLowerCase();
      const isEdit = !!(activeProposalId || activeDocumentId);

      // ── Intent gate ────────────────────────────────────────────────────────
      // Fresh (non-edit) requests pass through the intelligent gate: it decides
      // whether to generate, ask a clarifying question, or decline off-topic —
      // rather than generating immediately on any keyword match. Edits keep their
      // existing behavior (the gate would only interfere with a live edit).
      let decision: IntentDecision | null = null;
      if (!isEdit) {
        const proposalsList = await readProposals(dir).catch(() => []);
        const docSkills = await listSkills(workdir, { type: 'document' }).catch(() => []);
        decision = await classifyChatIntent({
          message,
          history,
          clientName: meta.displayName,
          skills: docSkills.map((s) => ({
            slug: s.slug,
            displayName: s.displayName,
            description: s.description,
            triggers: s.triggers,
            outputFormats: s.outputFormats,
          })),
          hasProposals: proposalsList.length > 0,
          matchedSkillSlug: matchedDocumentSkill?.slug,
          pendingClarification: lastAssistantPending(history),
          generateFn: llmGenerateFn,
        });

        // Terminal intents — respond and stop before any generation.
        if (decision.intent === 'off_topic') {
          const text = `I'm focused on ${meta.displayName} — I can help you create proposals, documents, presentations, or microsites for them, or answer questions about their business. What would you like to do for ${meta.displayName}?`;
          await streamAssistant(text);
          await persistTurn(text);
          send({ type: 'done', text });
          return;
        }
        if (decision.intent === 'clarify') {
          const text = decision.clarifyingQuestion ?? `Just to confirm — what would you like me to do for ${meta.displayName}?`;
          // Carry the matched skill into the pending marker so a confirmed resume
          // ("yes go ahead") re-applies it even though the reply text matches no skill.
          const pendingSkillSlug = decision.skillSlug ?? matchedDocumentSkill?.slug;
          const pending: PendingClarification | undefined = decision.proposedIntent
            ? {
                proposedIntent: decision.proposedIntent,
                ...(pendingSkillSlug ? { skillSlug: pendingSkillSlug } : {}),
                ...(decision.format ? { format: decision.format } : {}),
              }
            : undefined;
          await streamAssistant(text);
          await persistTurn(text, pending);
          send({ type: 'done', text });
          return;
        }
        if (decision.intent === 'generate_microsite') {
          const text = proposalsList.length > 0
            ? 'Pick a proposal below to generate its microsite.'
            : `You'll need a proposal first — ask me to generate one for ${meta.displayName}, then I can turn it into a microsite.`;
          await streamAssistant(text);
          await persistTurn(text);
          send({ type: 'done', text });
          return;
        }
      }

      // Honor the gate's skill resolution: on a resumed clarification ("yes go
      // ahead") the reply text matches no skill, but the pending marker carries
      // the one matched on the original request — load it so the generation is
      // shaped by the same skill the user was asked about.
      if (!isEdit && decision?.skillSlug && matchedDocumentSkill?.slug !== decision.skillSlug) {
        try {
          const loaded = await loadSkill(workdir, decision.skillSlug);
          matchedDocumentSkill = loaded.skill;
          matchedSkillInstructionsMd = loaded.instructionsMd;
          matchedSkillSections = loaded.sections;
        } catch {
          // Non-critical — fall back to whatever the message-text match found
        }
      }

      // Presentation mode is now an OUTPUT of the intent gate (not raw regex). For
      // edits, preserve the historical detection so live edits are unaffected.
      const isPresentationRequest = isEdit
        ? (matchedDocumentSkill?.slug === 'presentation' || detectPresentationIntent(message))
        : decision?.intent === 'generate_presentation';
      // When the gate resolved to a conversational answer, tell the generator not
      // to emit an artifact for this turn.
      const isAnswerIntent = !isEdit && decision?.intent === 'answer';
      // Orientation follows an explicit aspect-ratio mention: 9:16 → portrait,
      // otherwise landscape (the historical default, kept byte-for-byte unchanged).
      const slideOrientation = detectSlideOrientation(message);

      // Orientation-dependent prompt fragments. For landscape these resolve to the
      // exact historical strings, so the existing 16:9 prompt is unchanged.
      const isPortrait = slideOrientation === 'portrait';
      const slideAspect = isPortrait ? '9/16' : '16/9';
      const slideHeightNote = isPortrait ? 'height = 177.78vw' : 'height = 56.25vw';
      const portraitDesignNote =
        `- PORTRAIT FORMAT (9:16): every slide is tall and narrow like a phone screen / story frame. Stack content vertically with generous spacing; prefer justify-content:space-between or flex-start over always centering. Keep one focused idea per slide, oversized headlines, and design for a vertical mobile reading experience.`;

      // Build combined prompt — llmGenerateFn takes a single string and routes through
      // the Python LLM bridge which respects LLM_PROVIDER / provider-specific model config.
      const promptParts: string[] = isPresentationRequest ? [
        // ── PRESENTATION MODE — no proposal/document rules ──────────────────
        `You are a world-class presentation designer working on behalf of a team that manages the client "${meta.displayName}".`,
        ``,
        `NEVER ask the user to re-upload files listed in the Ingested Documents section — their content is already extracted into memory below.`,
        ``,
        `SLIDES GENERATION RULE — this is the ONLY output format for this request:`,
        `Output a complete, standalone HTML presentation wrapped in <slides>...</slides>. Do NOT use <proposal> or <document> tags. Do NOT output markdown.`,
        ``,
        `HARD CONSTRAINTS:`,
        `- Full HTML document: <!DOCTYPE html> … </html>`,
        `- VERTICAL SCROLL LAYOUT: all slides stack top-to-bottom in a single scrollable page. Do NOT use absolute positioning, visibility toggling, or JS navigation to show/hide slides. Every slide is always visible.`,
        `- Each slide: width:100%, aspect-ratio:${slideAspect} (i.e. ${slideHeightNote}). Give every slide element the class "slide".`,
        `- Gap between slides: exactly 12px (use gap:12px on the flex container, or margin-bottom:12px on each slide except the last).`,
        `- Wrap all slides in a single container div with class "deck" using: display:flex; flex-direction:column; gap:12px;`,
        `- Body background: always #111111 (near-black). The system enforces this — do not set a body background. Design every slide to have its own solid background so it looks prominent against the dark surround.`,
        `- Self-contained: inline ALL CSS and JS. No external URLs. System fonts only (-apple-system, Georgia, etc).`,
        `- <title> tag = presentation title`,
        `- No keyboard nav, no click zones, no JS slide transitions — scroll is the navigation.`,
        `- NEVER break a single word across two lines. Do NOT use word-break:break-all, overflow-wrap:break-word/anywhere, or hyphens. Text wraps only at spaces. Choose a headline font-size that lets each word fit on one line inside its container — if a word would overflow, reduce the font-size (or widen the text column); never split or clip it.`,
        ...(isPortrait ? [portraitDesignNote] : []),
        ``,
        `VISUAL DESIGN STANDARD — this must look like a premium designed deck, not a web page or document:`,
        `- Use large, bold typography. Slide titles: 48–80px. Body text: 20–28px. Never smaller.`,
        `- Every slide has a deliberate background: solid color, gradient, or split. White backgrounds are for content slides only, and even then add visual structure.`,
        `- Use color intentionally — pick a palette of 2–3 colors and apply consistently. Cover and closing slides use the darkest/richest treatment.`,
        `- Add real visual hierarchy: eyebrow labels (10–12px uppercase tracked), oversized headlines, supporting body, callout boxes with border-left accents.`,
        `- Use CSS for visual elements: clip-path for diagonal splits, border-radius for accent shapes, box-shadow for card depth, ::before/::after for decorative lines or dots.`,
        `- Every element must be positioned in normal document flow (static or relative) within its own slide. Never use position:absolute/fixed, negative margins, or transform offsets to place content — each slide is a self-contained box and nothing may render outside its own boundary or overlap the slide before/after it.`,
        `- Vary layouts across the deck. No two consecutive slides should look identical.`,
        ``,
        `EXAMPLE STRUCTURE (adapt fully — this is pattern only):`,
        `<div class="deck" style="display:flex;flex-direction:column;gap:12px;background:#0a0a0a;padding:0;">`,
        `  <div class="slide" style="width:100%;aspect-ratio:${slideAspect};background:linear-gradient(135deg,#0f1923 0%,#1a3a5c 100%);display:flex;flex-direction:column;justify-content:center;padding:6% 8%;position:relative;overflow:hidden;">`,
        `    <div style="font-size:clamp(9px,1vw,13px);letter-spacing:4px;text-transform:uppercase;color:#4fa3e0;margin-bottom:3%;">Confidential — Q3 2025</div>`,
        `    <h1 style="font-size:clamp(28px,5.5vw,80px);font-weight:800;color:#fff;line-height:1.05;letter-spacing:-1px;max-width:70%;">Scaling to<br>10M Users</h1>`,
        `    <p style="font-size:clamp(13px,1.8vw,24px);color:rgba(255,255,255,0.6);margin-top:3%;font-weight:300;">A growth infrastructure roadmap for Acme Corp</p>`,
        `  </div>`,
        `  <div class="slide" style="width:100%;aspect-ratio:${slideAspect};background:#fff;display:flex;flex-direction:column;justify-content:center;padding:6% 8%;position:relative;">`,
        `    <div style="font-size:clamp(9px,1vw,12px);letter-spacing:3px;text-transform:uppercase;color:#4fa3e0;margin-bottom:2%;">The Problem</div>`,
        `    <h2 style="font-size:clamp(20px,3.5vw,52px);font-weight:700;color:#0f1923;line-height:1.15;margin-bottom:4%;">Current infra fails above 2M concurrent users</h2>`,
        `    <ul style="list-style:none;display:flex;flex-direction:column;gap:1.5%;padding:0;">`,
        `      <li style="font-size:clamp(12px,1.5vw,20px);color:#444;display:flex;align-items:center;gap:1em;"><span style="color:#4fa3e0;font-weight:700;">—</span>P99 latency spikes to 8s under load</li>`,
        `    </ul>`,
        `  </div>`,
        `</div>`,
        ``,
        `CONTENT:`,
        `- Draw ALL facts from client context, ingested documents, and conversation. Never invent.`,
        `- Slide titles are insights, not labels — "Revenue grew 3× in 12 months" beats "Revenue Growth"`,
        `- Use the slide count the user specified, or 10–12 if not mentioned`,
        ``,
        `Output: ONLY the <slides>...</slides> tag with the full HTML document inside. After the tag, one sentence confirmation.`,
      ] : [
        // ── STANDARD MODE — proposal + document rules ────────────────────────
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
        ``,
        `DOCUMENT GENERATION RULE: When the user asks you to write, create, generate, or draft any document that is NOT a proposal — such as a strategy document, blog post, marketing brief, executive report, press release, competitive analysis, case study, go-to-market plan, one-pager, compliance checklist, or any other standalone document — you MUST:`,
        `1. Write the full document in rich markdown — use # for the title, ## for section headings, **bold** for key terms, and appropriate structure driven by the content type.`,
        `2. Wrap the ENTIRE document markdown inside a single XML tag like this:`,
        `<document title="Descriptive Document Title" type="inferred-type-slug" format="${detectedFormat ?? 'md'}">`,
        `[full markdown content here]`,
        `</document>`,
        `   - title: a descriptive title for the document`,
        `   - type: a lowercase kebab-case slug inferred from the document's purpose — use any slug that fits (e.g. "blog-post", "press-release", "case-study", "competitive-analysis", "onboarding-guide", "compliance-checklist", "go-to-market-plan") — no fixed list, choose freely`,
        `   - format: ${detectedFormat ?? 'md'} (use exactly this value — detected from the user's request)`,
        `3. Outside the tag, add only a brief 1-2 sentence confirmation that the document was saved.`,
        `Do NOT put any explanation or preamble inside the tag — only the markdown document body.`,
        `IMPORTANT: Use <proposal> for multi-section consulting proposals. Use <document> for text-based documents (blogs, strategy docs, reports, briefs).`,
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

      // If the user has a document open, load it and inject with the same 3-tier editing rule
      let activeDocumentContent: string | undefined;
      if (activeDocumentId) {
        try {
          activeDocumentContent = await getDocumentContent(workdir, name, activeDocumentId);
          promptParts.push(
            `\n## Currently Open Document\n${activeDocumentContent}`,
            `\nDOCUMENT EDITING RULE (applies only because a document is currently open):`,
            `When the user requests any change, use the LIGHTEST format that is sufficient:`,
            ``,
            `TIER 1 — PINPOINT (fix a word, number, date, rename a heading, replace a phrase):`,
            `  Use one or more self-closing <text-replace> tags:`,
            `  <text-replace find="exact original text" replace="new text" />`,
            `  • "exact original text" must appear verbatim in the document (copy it exactly).`,
            `  • Outside the tags write a brief 1-sentence confirmation only.`,
            ``,
            `TIER 2 — SECTION (reword a paragraph, add/remove bullets, rewrite a section body):`,
            `  Output one or more <section-update> tags — one per changed section only:`,
            `  <section-update heading="## Exact Heading Text">`,
            `  [full replacement body — do NOT include the heading line inside the tag]`,
            `  </section-update>`,
            `  Outside the tags write a brief 1-sentence confirmation only.`,
            ``,
            `TIER 3 — FULL REWRITE (add new sections, remove a section entirely, restructure):`,
            `  Use the full <document title="..." type="..." format="...">...</document> tag containing the complete new markdown.`,
            ``,
            `NEVER mix formats in one response. Default to Tier 1 for any single-string substitution.`,
          );
        } catch {
          // Document file not found — proceed without it
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

      // Org-level Author Voice — STYLE ONLY (no client facts). Injected when the
      // org has learned a voice from past proposals and the toggle is on.
      if (orgSettings.applyAuthorVoice && authorVoiceBlock) {
        promptParts.push(`\n${authorVoiceBlock}`);

        const toneOverride = detectToneOverride(message, history);
        if (toneOverride) {
          promptParts.push(
            `\n⚡ USER TONE OVERRIDE ACTIVE: The user has requested "${toneOverride}". This takes absolute priority over every tone, voice, and style directive in the Author Voice block above. Ignore those style directives entirely and apply the user's requested style instead. You may still use structural patterns (section order, headings) from the Author Voice if they don't conflict with the user's request.`,
          );
        }
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

      // For non-presentation document requests, inject the matched skill's persona
      if (matchedDocumentSkill && !isPresentationRequest && matchedSkillInstructionsMd) {
        promptParts.push(`\n## Document Generation Expertise\n${matchedSkillInstructionsMd.trim()}`);
      }

      // For presentation requests, a slide-capable document skill (e.g. pitch-deck)
      // shapes the deck's narrative + recommended arc. Gated on outputFormats so a
      // non-slide skill that merely matched cannot pollute a deck. The requested
      // slide count and the hardcoded HTML/visual rules above stay authoritative.
      if (
        matchedDocumentSkill &&
        isPresentationRequest &&
        matchedSkillInstructionsMd &&
        matchedDocumentSkill.outputFormats?.includes('pptx')
      ) {
        const block = formatSkillForSlides(matchedDocumentSkill, matchedSkillInstructionsMd, matchedSkillSections ?? []);
        if (block) promptParts.push(block);
      }

      const recentHistory = history.slice(-20);
      if (recentHistory.length > 0) {
        promptParts.push('\n## Conversation History');
        for (const h of recentHistory) {
          promptParts.push(`${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`);
        }
      }

      // Inject format-specific content structuring directive when the user requested a specific format
      const FORMAT_DIRECTIVES: Partial<Record<import('./skills/skill.types.js').OutputFormat, string>> = {
        pptx: 'FORMAT DIRECTIVE: The user wants a PowerPoint presentation. Write rich, well-structured content using natural headings (# Title, ## Section Name) and bullet points. Do NOT use "## Slide N:" numbering — the system automatically converts your structured content into beautifully designed slides using a visual layout engine. Focus on compelling, well-organised content.',
        docx: 'FORMAT DIRECTIVE: The user wants a Microsoft Word document. Use clean heading hierarchy (#, ##, ###), standard paragraphs, and bulleted lists. Avoid complex markdown tables — Word renders them poorly.',
        txt: 'FORMAT DIRECTIVE: The user wants plain text. Do NOT use any markdown syntax — no **, no #, no dashes for bullets, no backticks. Write in clear prose with section titles as plain uppercase labels followed by a colon.',
        notion: 'FORMAT DIRECTIVE: The user wants Notion-compatible output. Use > blockquotes for callout blocks, --- horizontal dividers between major sections, and standard heading hierarchy (# ## ###).',
        pdf: 'FORMAT DIRECTIVE: The user wants a PDF. Use rich markdown — headings, bullets, **bold** key terms, blockquotes for callouts — it will be rendered and typeset to PDF.',
      };
      if (!isPresentationRequest && detectedFormat && detectedFormat !== 'md') {
        const directive = FORMAT_DIRECTIVES[detectedFormat];
        if (directive) promptParts.push(`\n${directive}`);
      }

      if (isAnswerIntent) {
        promptParts.push(`\nThe user is asking a question or making conversation — respond helpfully and concisely about ${meta.displayName}. Do NOT generate a proposal, document, or slides in this reply; just answer.`);
      }

      promptParts.push(`\nUser: ${message}`);

      const combinedPrompt = promptParts.join('\n');

      // ── Generation-turn resolution ────────────────────────────────────────
      // The intent gate's decision (not raw regex) determines whether this turn
      // produces an artifact, what type it is, and which skill shapes it. Edits
      // and conversational answers keep the legacy streaming behavior.
      const isGenerationTurn = !isEdit && (
        decision?.intent === 'generate_proposal' ||
        decision?.intent === 'generate_document' ||
        decision?.intent === 'generate_presentation'
      );
      const artifactType: 'slide' | 'proposal' | 'document' | undefined = !isGenerationTurn
        ? undefined
        : decision!.intent === 'generate_presentation' ? 'slide'
        : decision!.intent === 'generate_proposal' ? 'proposal'
        : 'document';
      // The skill is only "used" when its guidance is actually injected into the
      // prompt — mirror the injection gates above (presentation: pptx-capable;
      // document: standard-mode instructions present; proposal: none).
      const ackSkill =
        artifactType === 'slide' && matchedDocumentSkill && matchedSkillInstructionsMd && matchedDocumentSkill.outputFormats?.includes('pptx')
          ? matchedDocumentSkill
          : artifactType === 'document' && matchedDocumentSkill && matchedSkillInstructionsMd
            ? matchedDocumentSkill
            : null;
      const artifactLabel = artifactType === 'slide'
        ? 'presentation'
        : artifactType === 'proposal'
          ? 'proposal'
          : (ackSkill?.displayName ?? matchedDocumentSkill?.displayName ?? 'document').toLowerCase();

      // ── Acknowledgment + planning announcement ───────────────────────────
      // Acknowledge in chat BEFORE generating — naming the skill in use — so the
      // turn reads as interactive rather than an abrupt jump into generation.
      let ackText = '';
      if (isGenerationTurn) {
        ackText = ackSkill
          ? `Using the **${ackSkill.displayName}** skill to create this ${artifactLabel} for ${meta.displayName} — give me a moment…`
          : `Creating a ${artifactLabel} for ${meta.displayName} — give me a moment…`;
        await streamAssistant(ackText);

        const countMatch = message.match(/\b(\d+)[\s\-]*(page|slide|screen)s?\b/i);
        const count = countMatch ? countMatch[1] : null;
        const planText = artifactType === 'slide'
          ? (count
              ? `Building a ${count}-slide presentation for ${meta.displayName}…`
              : `Building a presentation for ${meta.displayName}…`)
          : artifactType === 'proposal'
            ? `Drafting a proposal for ${meta.displayName}…`
            : `Writing a ${artifactLabel} for ${meta.displayName}…`;
        send({
          type: 'planning',
          text: planText,
          artifactType,
          ...(ackSkill ? { skillSlug: ackSkill.slug, skillName: ackSkill.displayName } : {}),
          genTitle: ackSkill?.displayName
            ?? (artifactType === 'slide' ? 'Presentation' : artifactType === 'proposal' ? 'Proposal' : 'Document'),
        });
      }

      // ── LLM call with heartbeat progress ─────────────────────────────────
      // The generation is one opaque blocking call, so — exactly like the
      // microsite generate-v2-stream route — a heartbeat cycles progress steps
      // to keep the UI's generation card alive while the model works.
      const HEARTBEAT_STEPS: Record<'slide' | 'proposal' | 'document', string[]> = {
        slide: ['Reading client context…', 'Analyzing presentation requirements…', 'Structuring slides…', 'Writing slide content…', 'Applying design and layout…', 'Finalizing presentation…'],
        proposal: ['Reading client context…', 'Analyzing requirements…', 'Drafting proposal sections…', 'Refining content…', 'Finalizing proposal…'],
        document: ['Reading client context…', 'Researching topic…', 'Structuring document…', 'Writing sections…', 'Reviewing and refining…', 'Preparing document…'],
      };
      let hbTimer: ReturnType<typeof setInterval> | null = null;
      if (isGenerationTurn && artifactType) {
        const steps = [...HEARTBEAT_STEPS[artifactType]];
        if (ackSkill) steps.splice(2, 0, `Applying the ${ackSkill.displayName} structure…`);
        send({ type: 'progress', message: steps[0] });
        let hbIdx = 1;
        hbTimer = setInterval(() => {
          send({ type: 'progress', message: steps[hbIdx % steps.length] });
          hbIdx++;
        }, 6000);
      }

      // Call provider-agnostic LLM bridge — respects LLM_PROVIDER + model config
      let fullResponse: string;
      try {
        fullResponse = await llmGenerateFn(combinedPrompt);
      } finally {
        if (hbTimer) clearInterval(hbTimer);
      }

      if (isGenerationTurn) {
        send({ type: 'progress', message: `Saving ${artifactLabel}…` });
      } else {
        // Conversational / edit turns: fake-stream the full reply word by word
        // as before. Generation turns stream only the stripped confirmation
        // AFTER parsing, so raw <slides>/<proposal> markup never floods the chat.
        const words = fullResponse.split(' ');
        for (const word of words) {
          send({ type: 'chunk', text: word + ' ' });
          await new Promise<void>((r) => setTimeout(r, 12));
        }
      }

      // Apply the lightest edit format that fired (proposals and documents share the same 3-tier logic)
      let proposalSaved: ScProposal | undefined;
      let proposalUpdated: ScProposal | undefined;
      let documentSaved: import('./skills/skill.types.js').GeneratedDocumentMeta | undefined;
      let documentUpdated: import('./skills/skill.types.js').GeneratedDocumentMeta | undefined;
      let slideSaved: SavedSlide | undefined;
      let displayResponse = fullResponse;

      const activeEditId = activeProposalId ?? activeDocumentId;
      const textReplacements = activeEditId ? extractTextReplacements(fullResponse) : [];
      const sectionUpdates = activeEditId ? extractSectionUpdates(fullResponse) : [];

      if (textReplacements.length > 0 && activeEditId) {
        // Tier 1: pinpoint string replacements
        if (activeProposalId && activeProposalContent !== undefined) {
          try {
            const patchedContent = applyTextReplacements(activeProposalContent, textReplacements);
            const existingProposals = await readProposals(dir);
            const existingEntry = existingProposals.find((p) => p.fileName === activeProposalId);
            const title = existingEntry?.title ?? activeProposalId;
            proposalUpdated = await updateProposal(dir, activeProposalId, title, patchedContent);
          } catch (err) {
            app.log.warn({ err }, '[SuperClient] Failed to apply text replacements to proposal');
          }
        } else if (activeDocumentId && activeDocumentContent !== undefined) {
          try {
            const patchedContent = applyTextReplacements(activeDocumentContent, textReplacements);
            documentUpdated = await updateDocumentContent(workdir, name, activeDocumentId, patchedContent);
          } catch (err) {
            app.log.warn({ err }, '[SuperClient] Failed to apply text replacements to document');
          }
        }
        displayResponse = stripTextReplaceTags(fullResponse);
      } else if (sectionUpdates.length > 0 && activeEditId) {
        // Tier 2: section-body patches
        if (activeProposalId && activeProposalContent !== undefined) {
          try {
            const patchedContent = patchProposalSections(activeProposalContent, sectionUpdates);
            const existingProposals = await readProposals(dir);
            const existingEntry = existingProposals.find((p) => p.fileName === activeProposalId);
            const title = existingEntry?.title ?? activeProposalId;
            proposalUpdated = await updateProposal(dir, activeProposalId, title, patchedContent);
          } catch (err) {
            app.log.warn({ err }, '[SuperClient] Failed to patch proposal sections');
          }
        } else if (activeDocumentId && activeDocumentContent !== undefined) {
          try {
            const patchedContent = patchProposalSections(activeDocumentContent, sectionUpdates);
            documentUpdated = await updateDocumentContent(workdir, name, activeDocumentId, patchedContent);
          } catch (err) {
            app.log.warn({ err }, '[SuperClient] Failed to patch document sections');
          }
        }
        displayResponse = stripSectionUpdateTags(fullResponse);
      } else {
        // Tier 3: full tag rewrite
        const proposalMatch = extractProposalTag(fullResponse);
        const slidesTagMatch = !proposalMatch ? extractSlidesTag(fullResponse) : null;
        const documentMatch = !proposalMatch && !slidesTagMatch ? extractDocumentTag(fullResponse) : null;

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
        } else if (documentMatch) {
          try {
            if (activeDocumentId && activeDocumentContent !== undefined) {
              documentUpdated = await updateDocumentContent(workdir, name, activeDocumentId, documentMatch.content);
            } else {
              documentSaved = await saveDocumentDirect(
                workdir,
                name,
                documentMatch.title,
                documentMatch.type,
                // Prefer the format detected from the user's natural language over
                // the LLM-generated attribute — they should agree, but detectedFormat
                // is the authoritative source from the user's actual request.
                (detectedFormat ?? documentMatch.format) as import('./skills/skill.types.js').OutputFormat,
                documentMatch.content,
              );

            }
          } catch (err) {
            app.log.warn({ err }, '[SuperClient] Failed to save/update document');
          }
          displayResponse = stripDocumentTag(fullResponse);
        } else if (slidesTagMatch) {
          try {
            // The requested orientation drove the prompt, but the model may have
            // designed a different one. Trust the actual HTML so the enforcer,
            // the stored index, and the rendered deck all agree.
            const finalOrientation = resolveSlideOrientation(slidesTagMatch.html, slideOrientation);
            const html = validateSlideHtml(slidesTagMatch.html, finalOrientation);
            slideSaved = await saveSlide(dir, name, html, finalOrientation);
          } catch (err) {
            app.log.warn({ err }, '[SuperClient] Failed to save slides');
          }
          displayResponse = stripSlidesTag(fullResponse);
        }
      }

      // Generation turns: the raw response was never fake-streamed (only the ack
      // was). Stream the stripped confirmation now, then keep the ack at the top
      // of the persisted/final text so the turn reads as one coherent message.
      if (isGenerationTurn) {
        if (displayResponse.trim()) {
          await streamAssistant(displayResponse.trim());
        }
        displayResponse = [ackText, displayResponse.trim()].filter(Boolean).join('\n\n');
      }

      // Persist turn to history.
      const userTs      = new Date().toISOString();
      const assistantTs = new Date(Date.now() + 1).toISOString();
      const editCtx = activeProposalId
        ? ({ editContext: 'proposal' } as const)
        : activeDocumentId
          ? ({ editContext: 'document' } as const)
          : {};
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
        ...(documentSaved ? { documentSaved } : {}),
        ...(documentUpdated ? { documentUpdated } : {}),
        ...(slideSaved ? { slideSaved } : {}),
      });

      // Memory distillation runs after the answer is delivered (the `done` event
      // above already carries the reply + any saved artifacts, so the UI renders
      // immediately). It is awaited only so we can confirm what was learned back
      // to the client; distillChatTurn has its own try/catch and returns null on
      // failure, so it can never break the chat response.
      const learned = await distillChatTurn(workdir, name, meta.displayName, message, displayResponse, app.log);
      if (learned && (learned.knowledgeAdded > 0 || learned.stakeholdersAdded > 0)) {
        send({
          type: 'memory',
          knowledgeAdded: learned.knowledgeAdded,
          stakeholdersAdded: learned.stakeholdersAdded,
        });
      }

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
      ...(m.editContext === 'microsite' || m.editContext === 'proposal' || m.editContext === 'document' ? { editContext: m.editContext } : {}),
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

      const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const buffer = await part.toBuffer();

      if (buffer.length > MAX_SIZE) {
        return reply.code(400).send({ error: `File "${rawName}" exceeds the 50 MB limit` });
      }

      const sanitizedExt = path.extname(sanitizedName);
      const sanitizedBase = sanitizedName.slice(0, sanitizedName.length - sanitizedExt.length);
      const safeName = `${sanitizedBase}-${Date.now()}${sanitizedExt}`;

      const destPath = path.join(uploadsDir, safeName);
      const resolved = path.resolve(destPath);
      if (!resolved.startsWith(path.resolve(uploadsDir))) {
        return reply.code(400).send({ error: `Invalid file name: ${rawName}` });
      }

      await writeFile(destPath, buffer);

      const entry: ScFile = { fileName: safeName, originalName: rawName, size: buffer.length, uploadedAt: new Date().toISOString(), status: 'processing' };
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

  // GET /super-clients/:name/documents/:fileName/download
  app.get('/super-clients/:name/documents/:fileName/download', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, fileName } = req.params as { name: string; fileName: string };
    const dir = path.join(superClientsRoot, name);

    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }

    const uploadsDir = path.join(dir, 'uploads');
    const filePath = path.join(uploadsDir, fileName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(uploadsDir))) {
      return reply.code(400).send({ error: 'Invalid file name' });
    }

    try {
      const fileStat = await stat(resolved);
      if (!fileStat.isFile()) {
        return reply.code(404).send({ error: `File not found: ${fileName}` });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: `File not found: ${fileName}` });
      }
      throw err;
    }

    const mimeType = getMimeType(fileName);
    const encodedName = encodeURIComponent(fileName);
    reply.header('Content-Type', mimeType);
    reply.header('Content-Disposition', `inline; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
    return reply.send(createReadStream(resolved));
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

    const astObj = body.ast as Record<string, unknown> | undefined;
    const entry: ScMicrosite = {
      id,
      title: `${micrositeTitle} (v${version})`,
      proposalTitle,
      savedAt: now.toISOString(),
      version,
      ...(astObj?.pdfPresentation ? { pdfPresentation: true } : {}),
      ...(astObj?.pdfOrientation ? { pdfOrientation: astObj.pdfOrientation as 'landscape' | 'portrait' } : {}),
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

    // ── Video URL → embed URL normalization (pure format transform, not an intent
    // guess — used later to hand the global LLM op-picker a ready-made embed URL
    // instead of letting it invent embed syntax). Kept at handler scope so both
    // the global augmented-instruction step below and __VIDEO_INJECT__-style
    // paths can format a watch-page URL the same way.
    function toEmbedUrl(raw: string): string {
      const vimeoM = raw.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)([?&]\S*)?/i);
      if (vimeoM) {
        const id     = vimeoM[1];
        const params = vimeoM[2] ?? '?autoplay=1&loop=1&muted=1&title=0&byline=0&portrait=0';
        return `https://player.vimeo.com/video/${id}${params}`;
      }
      const ytW = raw.match(/youtube\.com\/watch\?.*\bv=([a-zA-Z0-9_-]{11})/i);
      if (ytW) return `https://www.youtube.com/embed/${ytW[1]}?autoplay=1&loop=1&mute=1&controls=0&playlist=${ytW[1]}`;
      const ytS = raw.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
      if (ytS) return `https://www.youtube.com/embed/${ytS[1]}?autoplay=1&loop=1&mute=1&controls=0&playlist=${ytS[1]}`;
      return raw;
    }

    // NOTE: global (no-element-selected) video add/remove used to be handled by
    // three separate free-text intent-guessing branches here (isRemoveVideoIntent,
    // __VIDEO_IN_SECTION__, and a deterministic "any bare video URL → inject as
    // hero background" branch). They were removed because each one guessed intent
    // from an open-ended sentence and they collided on compound instructions (e.g.
    // "remove background image and add this video ... in background of X section"
    // was misread as "remove video" before the add-video request ever ran). Global
    // video add/remove now flows through the unified LLM operation-picker below
    // (see the video-URL pre-fetch step and the extended opPrompt), which sees the
    // full instruction and full document instead of a 40-character regex window.
    // ── Video src replacement — replaces the iframe src in a video container ───
    // Format: __VIDEO_INJECT__:[cssPath]||[videoUrl]||[hintHtml?]
    // Converts watch-page URLs to embed format before patching.
    const videoInjectMatch = instruction.match(/^__VIDEO_INJECT__:([\s\S]+?)\|\|(https?:\/\/[^\|]+)(?:\|\|[\s\S]*)?$/s);
    if (videoInjectMatch) {
      const cssPath = videoInjectMatch[1].trim();
      const rawUrl  = videoInjectMatch[2].trim();

      function normalizeVideoUrl(raw: string): string {
        const ytWatch = raw.match(/youtube\.com\/watch\?.*\bv=([a-zA-Z0-9_-]{11})/i);
        if (ytWatch) {
          const id = ytWatch[1];
          return `https://www.youtube.com/embed/${id}?autoplay=1&loop=1&mute=1&controls=0&playlist=${id}`;
        }
        const ytShort = raw.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
        if (ytShort) {
          const id = ytShort[1];
          return `https://www.youtube.com/embed/${id}?autoplay=1&loop=1&mute=1&controls=0&playlist=${id}`;
        }
        const vimeoWatch = raw.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i);
        if (vimeoWatch) {
          return `https://player.vimeo.com/video/${vimeoWatch[1]}?background=1&autoplay=1&loop=1&muted=1`;
        }
        return raw; // already an embed URL or custom src — use as-is
      }

      const newSrc = normalizeVideoUrl(rawUrl);

      function patchIframeSrc(target: string): string {
        return target.replace(
          /(<iframe\b[^>]*?\bsrc=["'])([^'"]+)(["'])/i,
          (_m, pre, _old, post) => `${pre}${newSrc}${post}`,
        );
      }

      const bounds = findByPath(html, cssPath);
      if (bounds) {
        const elementHtml = html.slice(bounds.start, bounds.end);
        const patched = patchIframeSrc(elementHtml);
        if (patched !== elementHtml) {
          return saveValidatedEdit(
            html.slice(0, bounds.start) + patched + html.slice(bounds.end),
            'Video updated',
          );
        }
        // Element located but holds no player yet — insert a responsive embed as
        // its last child instead of patching some OTHER element's iframe (which
        // would silently edit the wrong section) or erroring out.
        const closeM = elementHtml.match(/<\/(\w+)>\s*$/);
        if (closeM) {
          const closeIdx = elementHtml.lastIndexOf(closeM[0]);
          const embed = `<div style="position:relative;padding-top:56.25%;width:100%"><iframe src="${newSrc}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
          return saveValidatedEdit(
            html.slice(0, bounds.start) + elementHtml.slice(0, closeIdx) + embed + elementHtml.slice(closeIdx) + html.slice(bounds.end),
            'Video added',
          );
        }
      }
      // Path lookup failed entirely — fall back to the first video iframe in the document
      const globalPatched = patchIframeSrc(html);
      if (globalPatched !== html) {
        return saveValidatedEdit(globalPatched, 'Video updated');
      }
      return reply.code(400).send({ error: 'Could not locate video iframe in the document' });
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
        // 3. data-bg / data-src lazy-load attributes (JS copies these into src at
        // runtime, so the browser DOM shows an <img src> the stored HTML lacks)
        out = target.replace(/\bdata-bg=["'][^'"]*["']/gi, () => `data-bg="${newUrl}"`);
        if (out !== target) return out;
        out = target.replace(/(<img\b[^>]*?\bdata-src=["'])([^'"]+)(["'])/i,
          (_m, pre, _old, post) => `${pre}${newUrl}${post}`);
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

      // ── Graceful fallback: the element was located but holds no replaceable
      // image reference in the STORED HTML (its visible image may be injected
      // by JS at runtime, or it never had one). The user still asked to put
      // this image on the selected element — apply it as a cover background on
      // the element itself instead of dead-ending with an error. !important
      // beats any CSS-class background so the change is always visible.
      if (bounds) {
        const elementHtml = html.slice(bounds.start, bounds.end);
        const tagEnd = elementHtml.indexOf('>');
        if (tagEnd !== -1) {
          const openTag = elementHtml.slice(0, tagEnd);
          const rest    = elementHtml.slice(tagEnd);
          const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
          const sm      = styleRx.exec(openTag);
          const bgVal   = `background-image:url('${newUrl}') !important;background-size:cover !important;background-position:center !important`;
          let patchedTag: string;
          if (sm) {
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
            'Image applied as background',
          );
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

    // findByPath / locateElement are imported from ./html-patch.js (single
    // shared implementation with the slide editor). This route used to carry
    // its own local copy of findByPath that restricted matching to
    // direct-children-only starting from the whole document as one flat
    // level: any id-anchored path (the common case — getCssPath() on the
    // client stops walking up at the first id it finds, e.g. "section#hero")
    // always failed unless the id'd element happened to be a literal
    // top-level sibling of <html>, because the very first mismatched tag
    // (<html> itself) caused the entire document to be skipped as "one
    // non-matching child's subtree". The imported version scans for the tag
    // anywhere within the current search range instead of restricting to
    // direct children, so id/class anchors resolve correctly regardless of
    // nesting depth.

    // ── HTML extractor — strips LLM preamble/postamble from any response ──────
    // LLMs frequently prepend explanation text ("Looking at the element, I will…")
    // before the code block. This strips everything outside the actual HTML.
    function extractHtmlFromResponse(raw: string): string {
      const s = raw.trim();

      // Prefer content inside a ``` fence (even if it's not at the very start)
      const fenceMatch = s.match(/```(?:html)?\r?\n?([\s\S]+?)\r?\n?```/);
      if (fenceMatch) return sanitizeHtmlOutput(fenceMatch[1].trim());

      // No fence — strip any prose before the first HTML tag
      const firstTag = s.indexOf('<');
      if (firstTag === -1) return s; // no HTML at all, return as-is and let validation catch it
      let result = s.slice(firstTag);

      // Strip any prose after the last closing tag
      const lastTag = result.lastIndexOf('>');
      if (lastTag !== -1) result = result.slice(0, lastTag + 1);

      return sanitizeHtmlOutput(result.trim());
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
        return hideCoveringImage(result, b.start);
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
      // When setting a solid background, also clear background-image so the color shows
      // (bg-image renders on top of bg-color; CSS class bg-image needs !important override)
      const clearBgImage = prop === 'background-color' || prop === 'background';
      let patchedTag: string;
      if (sm) {
        const escaped = prop.replace(/-/g, '\\-');
        let existing = sm[1]
          .replace(new RegExp(`\\b${escaped}\\s*:[^;]+;?\\s*`, 'gi'), '')
          .trim().replace(/;$/, '');
        if (clearBgImage) {
          existing = existing.replace(/background-image\s*:[^;]+;?\s*/gi, '').trim().replace(/;$/, '');
        }
        const extra = clearBgImage ? '; background-image:none !important' : '';
        patchedTag = openTag.replace(styleRx, `style="${existing ? existing + '; ' : ''}${prop}:${value}${extra}"`);
      } else {
        const extra = clearBgImage ? '; background-image:none !important' : '';
        patchedTag = `${openTag} style="${prop}:${value}${extra}"`;
      }
      let updatedHtml = html.slice(0, bounds.start) + patchedTag + rest + html.slice(bounds.end);
      // A covering <img> (photo-as-background pattern) would otherwise hide the new color.
      if (clearBgImage) updatedHtml = hideCoveringImage(updatedHtml, bounds.start);
      return saveValidatedEdit(updatedHtml, `${prop} set to ${value}`);
    }

    // ── Inline text content patch (from InlineEditPanel) ────────────────────
    // Format: __TEXT_PATCH__:[cssPath]||[newText]
    // Deterministic — no LLM. Replaces text nodes, preserves child elements.
    // Format: __TEXT_PATCH__:[cssPath]||[newText](||[hint — ignored])
    // Non-greedy group 2 stops before the trailing ||hint so the hint's outerHTML
    // is never concatenated into the visible text content.
    const textPatchMatch = instruction.match(/^__TEXT_PATCH__:([\s\S]+?)\|\|([\s\S]+?)(?:\|\|([\s\S]*))?$/s);
    if (textPatchMatch) {
      const cssPath  = textPatchMatch[1].trim();
      const newText  = textPatchMatch[2].trim().slice(0, 2000);
      const hintHtml = (textPatchMatch[3] ?? '').trim();

      let bounds = findByPath(html, cssPath);
      // Content-based fallback when the path doesn't match (e.g. after an LLM
      // edit restructured the DOM) — same strategy as the slide-route version.
      if (!bounds && hintHtml) {
        const hintStart = locateElement(html, hintHtml);
        if (hintStart !== -1) {
          const tagName = hintHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
          if (tagName) {
            const tagEnd = html.indexOf('>', hintStart);
            if (tagEnd !== -1) {
              const close = `</${tagName}>`;
              let depth = 1, j = tagEnd + 1;
              while (j < html.length && depth > 0) {
                const nO = html.indexOf(`<${tagName}`, j);
                const nC = html.indexOf(close, j);
                if (nC === -1) break;
                if (nO !== -1 && nO < nC) { depth++; j = nO + tagName.length + 1; }
                else { depth--; j = nC + close.length; }
              }
              bounds = { start: hintStart, end: j };
            }
          }
        }
      }
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
      const bgVal = `background-image:url('${imgUrl}') !important;background-size:cover !important;background-position:center !important`;
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
    const iconReplaceMatch = instruction.match(/^__ICON_REPLACE__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|([\s\S]*))?$/s);
    if (iconReplaceMatch) {
      const cssPath  = iconReplaceMatch[1].trim();
      const imgUrl   = iconReplaceMatch[2].trim().replace(/['"<>]/g, '');
      const hintHtml = (iconReplaceMatch[3] ?? '').trim();

      let bounds = findByPath(html, cssPath);
      // Content-based fallback when the path doesn't match (e.g. after an LLM
      // edit restructured the DOM around the icon)
      if (!bounds && hintHtml) {
        const hintStart = locateElement(html, hintHtml);
        if (hintStart !== -1) {
          const tagName = hintHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
          if (tagName) {
            const tagEnd = html.indexOf('>', hintStart);
            if (tagEnd !== -1) {
              const opening = html.slice(hintStart, tagEnd + 1);
              if (tagName === 'img' || opening.trimEnd().endsWith('/>')) {
                bounds = { start: hintStart, end: tagEnd + 1 };
              } else {
                const close = `</${tagName}>`;
                let depth = 1, j = tagEnd + 1;
                while (j < html.length && depth > 0) {
                  const nO = html.indexOf(`<${tagName}`, j);
                  const nC = html.indexOf(close, j);
                  if (nC === -1) break;
                  if (nO !== -1 && nO < nC) { depth++; j = nO + tagName.length + 1; }
                  else { depth--; j = nC + close.length; }
                }
                bounds = { start: hintStart, end: j };
              }
            }
          }
        }
      }
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
      // Skip video URLs too: CSS background-image cannot render a YouTube/Vimeo
      // page or a video file — "add this video as the background" must reach the
      // LLM flow below, which embeds it as an absolutely-positioned <iframe>.
      const bgUrlMatch = editInstruction.match(/(https?:\/\/\S+)/);
      const isVideoUrlInstruction = !!bgUrlMatch &&
        /youtube\.com|youtu\.be|vimeo\.com|\.(?:mp4|webm|ogv)(?:[?#]|$)/i.test(bgUrlMatch[1]);
      const isBgImageIntent = /\b(?:background|bg)\b/i.test(editInstruction) &&
        /\b(?:add|set|use|change|put|apply|inject)\b/i.test(editInstruction);
      if (!isRedesignIntent && bgUrlMatch && !isVideoUrlInstruction && isBgImageIntent) {
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
            const existing = sm[1]
              .replace(/\bbackground-color\s*:[^;]+;?\s*/g, '')
              .replace(/\bbackground-image\s*:[^;]+;?\s*/g, '')
              .trim().replace(/;$/, '');
            patchedTag = openTag.replace(styleRx, `style="${existing ? existing + ';' : ''}background-color:${colorValue};background-image:none !important"`);
          } else {
            patchedTag = `${openTag} style="background-color:${colorValue};background-image:none !important"`;
          }
          const patched     = patchedTag + rest;
          let updatedHtml   = html.slice(0, bounds.start) + patched + html.slice(bounds.end);
          // A covering <img> (photo-as-background pattern) would otherwise hide the new color.
          updatedHtml = hideCoveringImage(updatedHtml, bounds.start);
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
      const isImgEl   = elTag === 'img';
      const hasImgChild = !isImgEl && /<img\b/i.test(targetHtml);
      const hasImg    = isImgEl || hasImgChild;
      // Also detect elements whose background IS an image via CSS (no <img> child needed)
      const hasBgImage = /background-image\s*:\s*url\(/i.test(targetHtml);
      // Pre-strip instruction prefix so we can use it in the shortcut gate below
      const strippedEdit = editInstruction
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/^<[^>]+>:\s*/, '')
        .trim();
      const isBgImgDescIntent = /\b(?:background|bg)\b/i.test(strippedEdit) &&
        /\b(?:image|photo|picture|pic|img)\b/i.test(strippedEdit);
      const currentSrc = hasImg
        ? (targetHtml.match(/\bsrc="([^"]+)"/)?.[1] ?? '')
        : '';
      const currentAlt = hasImg
        ? (targetHtml.match(/\balt="([^"]*)"/)?.[1] ?? '')
        : '';

      // ── Pexels shortcut — descriptive image replacement (no URL) ─────────
      // When the user describes the desired image without providing a URL,
      // search Pexels for a contextually matching photo and inject it directly.
      // This avoids asking the LLM to recall a valid Unsplash photo ID from
      // training memory, which reliably produces wrong or stale URLs.
      // Fire for: existing <img>, CSS background-image, OR explicit "background image" desc intent
      if (!isRedesignIntent && (hasImg || hasBgImage || isBgImgDescIntent) && !(/https?:\/\//.test(editInstruction))) {
        const stripped = strippedEdit; // already computed above

        // Gate: must mention an image noun or have explicit bg+image intent
        const mentionsImage = /\b(?:image|photo|picture|pic|img)\b/i.test(stripped) || isBgImgDescIntent;

        if (mentionsImage) {
          // Ask the LLM to extract a clean search query — this handles any verb or
          // phrasing ("use", "take", "grab", "find", etc.) without enumerating them.
          // The LLM is reliable at understanding intent; only unreliable at picking URLs.
          const extractPrompt = `Extract a concise 2-5 keyword image search query from this instruction. Return ONLY the keywords, nothing else.\n\nInstruction: ${stripped}`;
          let pexelsQuery = '';
          try {
            pexelsQuery = (await llmGenerateFn(extractPrompt))
              .trim()
              .replace(/^["'`]|["'`]$/g, '')
              .trim()
              .slice(0, 80);
            console.log(`🔍 Image query extracted: "${pexelsQuery}"`);
          } catch { /* fall through to LLM edit */ }

          if (pexelsQuery) {
            const pexelsUrl = await fetchPexelsImageUrl(pexelsQuery);
            console.log(`📸 Pexels result for "${pexelsQuery}": ${pexelsUrl ?? '(no result — using Unsplash Source fallback)'}`);
            const imageUrl = pexelsUrl
              ?? `https://source.unsplash.com/featured/1200x800/?${encodeURIComponent(pexelsQuery)}`;
            const injectUrl = (target: string, url: string): string => {
              // 1. Replace existing background-image url()
              let out = target.replace(
                /\bbackground-image\s*:\s*url\(\s*['"]?[^'")\s]+['"]?\s*\)/gi,
                () => `background-image: url('${url}')`,
              );
              if (out !== target) return out;
              // 2. Replace existing <img> src
              out = target.replace(
                /(<img\b[^>]*?\bsrc=["'])([^'"]+)(["'])/i,
                (_m, pre, _old, post) => `${pre}${url}${post}`,
              );
              if (out !== target) return out;
              // 3. ADD background-image to section/div/header that has neither
              if (isBgImgDescIntent) {
                const tagEndIdx = target.indexOf('>');
                if (tagEndIdx !== -1) {
                  const openTag = target.slice(0, tagEndIdx);
                  const rest    = target.slice(tagEndIdx);
                  const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
                  const sm      = styleRx.exec(openTag);
                  const bgStyle = `background-image:url('${url}');background-size:cover;background-position:center;background-repeat:no-repeat`;
                  if (sm) {
                    const existing = sm[1].replace(/background-image[^;]+;?\s*/g, '').trim().replace(/;$/, '');
                    return openTag.replace(styleRx, `style="${existing ? existing + ';' : ''}${bgStyle}"`) + rest;
                  }
                  return `${openTag} style="${bgStyle}"` + rest;
                }
              }
              return out;
            };
            const patched = injectUrl(targetHtml, imageUrl);
            if (patched !== targetHtml) {
              console.log(`⚡ Image shortcut (${pexelsUrl ? 'pexels' : 'unsplash-source'}): "${pexelsQuery}" → ${imageUrl}`);
              return saveValidatedEdit(
                html.slice(0, targetBounds.start) + patched + html.slice(targetBounds.end),
                'Image updated',
              );
            }
          }
        }
      }

      // ── Build the LLM prompt (element-edit vs section-redesign) ──────────
      // Video URL in an element-scoped instruction: hand the LLM a ready-made
      // embed URL (watch-page URLs are blocked from iframes by X-Frame-Options)
      // and the two standard placements, so any phrasing — background fill,
      // inline embed, "choose the best position" — produces a working iframe.
      const elVideoUrlMatch = editInstruction.match(/https?:\/\/\S*(?:youtube\.com|youtu\.be|vimeo\.com)\S*/i);
      const videoGuidance = elVideoUrlMatch ? `
VIDEO-SPECIFIC RULES (the instruction contains a video URL):
- Use this exact embed URL as the iframe src (do NOT alter it or invent another): ${toEmbedUrl(elVideoUrlMatch[0].replace(/['"<>)\],.]+$/, ''))}
- Background/full-bleed placement: add position:relative;overflow:hidden to this element's inline style and insert as its FIRST child:
  <iframe src="[embed URL]" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border:0;z-index:0" allow="autoplay; fullscreen" frameborder="0"></iframe>
  (then make sure the element's direct content children have position:relative and a higher z-index so they stay visible above the video)
- Inline/content placement: insert where it reads naturally:
  <div style="position:relative;padding-top:56.25%"><iframe src="[embed URL]" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>
- If the instruction asks to replace an existing video, change the existing iframe's src instead of adding a second iframe` : '';

      const imageGuidance = hasImg ? `
IMAGE-SPECIFIC RULES (this element contains an image):
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
${imageGuidance}${videoGuidance}
Strict rules:
- Return ONLY this element starting with its opening tag and ending with its closing tag
- Do NOT include any parent or sibling elements
- For text changes: update only the specific text node described
- For style changes: modify inline style properties on this element or its children
- For image changes: update src or background-image on this element or its children
- For adding/removing a child: do so while preserving all other children unchanged
- Never truncate or omit any part of this element
- COLOR/STYLE TARGETING: identify the exact content the instruction describes
  (e.g. "light text" = elements whose inline color is a light value, not a
  background, gradient, or border) and change ONLY that property on ONLY that
  content. Do not "balance" the change by adjusting an unrelated property
  (background, gradient, border) instead of the one named.
- DESCENDANT OVERRIDES: an inline "color"/"background-color" on a child element
  overrides anything inherited from a parent. If the described text lives on a
  child (e.g. an <h2> or <p> inside this element) with its own inline color,
  you MUST update that child's own inline color directly — setting color on
  this element's own style has no visual effect if every child overrides it.
  Update every descendant that carries the color being described, not just the
  outermost element.`;

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

      // Exact id/data-section match — bypass fuzzy scoring entirely when the hint
      // IS one of the document's actual section identifiers (e.g. the LLM's own
      // "anchor" field echoing back a value from the "KNOWN SECTIONS: slide-1,
      // slide-2, ..." list we gave it). This matters because the fuzzy scorer
      // below tokenizes on \W+ and drops short/numeric tokens — "slide-3" becomes
      // just "slide" once "3" is filtered out, which every "slide-N" id also
      // contains, so every section ties and the tie-break always picks the
      // first one. An exact match is unambiguous and must win outright.
      for (let i = 0; i < secs.length; i++) {
        const text = src.slice(secs[i].start, secs[i].end);
        const idVal = (/\bid="([^"]+)"/.exec(text)?.[1] ?? '').toLowerCase();
        const dataSection = (/\bdata-section(?:-id)?="([^"]+)"/.exec(text)?.[1] ?? '').toLowerCase();
        if (hintLower === idVal || hintLower === dataSection) {
          return { before: src.slice(0, secs[i].start), section: text, after: src.slice(secs[i].end), tag: 'section' };
        }
      }

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
        if (!result.includes(p.find)) {
          console.warn(`⚠️  Patch MISS: find="${p.find.slice(0, 80)}" → replace="${p.replace.slice(0, 40)}"`);
          missed++;
          continue;
        }
        console.log(`✅ Patch HIT:  find="${p.find.slice(0, 80)}" → replace="${p.replace.slice(0, 40)}"`);
        result = result.split(p.find).join(p.replace);
        applied++;
      }
      return { html: result, applied, missed };
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

    // NOTE: a global bg-image shortcut used to live here — it duplicated the
    // Pexels URL-resolution below AND separately guessed section placement
    // itself (bypassing the LLM for the "which section, replace vs add" call).
    // Removed: the URL-resolution half is covered by the pre-fetch step below,
    // and the placement half is covered by opPrompt's "patches"/"section_replace"
    // ops, which get the full document and the LLM's own judgment instead of a
    // second, independent guess.

    // Extract CSS :root block so the LLM knows available design tokens
    const cssVarsBlock = /:root\s*\{[^}]+\}/i.exec(html)?.[0] ?? '';

    // "regenerate/redesign" with explicit intent → still uses single-section regen
    const isRegenIntent = /\b(?:regenerate|rewrite|rebuild|redesign|redo|remake|recreate)\b/i.test(instruction);
    const isHeaderInstruction = /\b(?:logo|brand|icon|favicon|header|nav(?:bar)?)\b/i.test(instruction);

    let sectionCtx: SectionSlice | null = null;
    if (isRegenIntent) {
      sectionCtx = (isHeaderInstruction ? extractHeaderBlock(html) : null) ?? extractBestSection(html, instruction);
    }

    // ── Section regeneration helper (explicit regen intent only) ─────────────
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
    // ─────────────────────────────────────────────────────────────────────────

    // Build a human-readable section list so the LLM can reference sections by name
    const allSecs = extractAllTopLevelSections(html);
    const sectionList = allSecs.map((s, i) => {
      const snippet = html.slice(s.start, Math.min(s.start + 300, s.end));
      return snippet.match(/\bid="([^"]+)"/)?.[1]
        ?? snippet.match(/\bdata-section="([^"]+)"/)?.[1]
        ?? snippet.match(/\bclass="([^"\s]+)/)?.[1]
        ?? snippet.match(/<h[1-3][^>]*>([^<]{1,40})<\/h[1-3]>/i)?.[1]?.trim()
        ?? `section-${i + 1}`;
    }).join(', ');

    // ── Structured-operation prompt ───────────────────────────────────────────
    // The LLM always receives the FULL HTML (so it sees every section) but
    // responds with a small typed JSON object — never the whole page back.
    // This works for any HTML size and handles every edit type in one pass.
    type MicrositeOp =
      | { op: 'patches'; patches: Array<{ find: string; replace: string }>; summary: string }
      | { op: 'section_replace'; anchor: string; html: string; summary: string }
      | { op: 'section_insert'; anchor: string; position: 'before' | 'after'; html: string; summary: string }
      | { op: 'section_delete'; anchor: string; summary: string }
      | { op: 'clarify'; question: string };

    function parseOp(raw: string): MicrositeOp | null {
      const start = raw.indexOf('{');
      if (start === -1) return null;
      let depth = 0, end = -1, inStr = false, esc = false;
      for (let i = start; i < raw.length; i++) {
        const c = raw[i];
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) return null;
      try {
        const slice = raw.slice(start, end + 1)
          .replace(/("(?:[^"\\]|\\.)*")/gs, m => m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
        return JSON.parse(slice) as MicrositeOp;
      } catch { return null; }
    }

    // ── Pre-fetch a real image URL from Pexels when the instruction describes an
    // image without providing a URL. This prevents the LLM from hallucinating
    // Unsplash photo IDs and ensures the placed image actually matches the request.
    let augmentedInstruction = instruction;
    // Tracks a resolved URL (video embed ID, or Pexels image URL) that we told the
    // LLM to use exactly, so the post-edit verification step can confirm it was
    // actually applied instead of trusting a structurally-valid but no-op response.
    let resolvedUrlToVerify: string | null = null;
    let resolvedUrlKind = '';
    if (!isRegenIntent && !/https?:\/\//.test(instruction) &&
        /\b(?:image|photo|picture|pic)\b/i.test(instruction)) {
      try {
        const qPrompt = `Extract a concise 2-5 keyword image search query from this instruction. Return ONLY the keywords, nothing else.\n\nInstruction: ${instruction}`;
        const pexelsQ = (await llmGenerateFn(qPrompt))
          .trim().replace(/^["'`]|["'`]$/g, '').trim().slice(0, 80);
        if (pexelsQ) {
          const pexelsUrl = await fetchPexelsImageUrl(pexelsQ);
          if (pexelsUrl) {
            augmentedInstruction = `${instruction}\n\nIMPORTANT — use this exact image URL (do NOT invent or substitute any other URL): ${pexelsUrl}`;
            resolvedUrlToVerify = pexelsUrl;
            resolvedUrlKind = 'image';
            console.log(`📸 Pexels pre-fetch for global edit: "${pexelsQ}" → ${pexelsUrl}`);
          }
        }
      } catch { /* fall through — LLM will handle without a real URL */ }
    }

    // ── Video URL normalization — a pure format transform, not an intent guess.
    // Fires whenever the instruction contains a recognizable youtube/vimeo URL,
    // regardless of surrounding words (add, remove, background, compound
    // sentences, etc.) — it never decides placement or add-vs-remove itself,
    // it only hands the LLM a ready-made embed URL instead of letting it invent
    // embed syntax. Placement/removal decisions are entirely the LLM's, made
    // from the full instruction + full document below.
    const videoUrlMatch = instruction.match(/https?:\/\/\S*(?:youtube\.com|youtu\.be|vimeo\.com)\S*/i);
    if (videoUrlMatch) {
      const embedUrl = toEmbedUrl(videoUrlMatch[0]);
      augmentedInstruction = `${augmentedInstruction}\n\nIMPORTANT — if the instruction asks to add/embed a video, use this exact embed URL in an <iframe> (do NOT alter it or invent a different one): ${embedUrl}`;
      resolvedUrlToVerify = embedUrl;
      resolvedUrlKind = 'video';
      console.log(`🎬 Video URL pre-normalized for global edit: ${embedUrl.slice(0, 80)}`);
    }

    const opPrompt = isRegenIntent ? '' : `You are editing an HTML microsite. Pick the ONE operation that best fits the instruction and respond with a single JSON object — nothing else.

OPERATION TYPES:

OP patches — targeted changes to existing content (text, values, colors, images, styles).
Works across ALL sections in one pass. Use multiple patches for values repeated in different sections.
{ "op": "patches", "patches": [{ "find": "exact substring", "replace": "new value" }], "summary": "..." }
Rules:
- Copy each "find" string EXACTLY from the HTML — character-for-character, no paraphrasing
- Include 15–40 chars of surrounding context so each "find" is unique in the document
- NEVER put newlines inside "find" or "replace" — single-line strings only
- Up to 12 patches

OP section_replace — redesign or restructure an existing section completely:
{ "op": "section_replace", "anchor": "section-id-or-keyword", "html": "<section>...</section>", "summary": "..." }

OP section_insert — add a brand-new section before or after an existing one:
{ "op": "section_insert", "anchor": "section-id-or-keyword", "position": "before|after", "html": "<section>...</section>", "summary": "..." }

OP section_delete — remove an existing section entirely:
{ "op": "section_delete", "anchor": "section-id-or-keyword", "summary": "..." }

OP clarify — the instruction does not say which section/element to target, AND
nothing in it (no section name, no distinctive quoted text, no ordinal like
"first"/"last") narrows it down to one clear match among this document's
${sectionList.split(',').length} sections. Use this instead of guessing:
{ "op": "clarify", "question": "Which section should this apply to? (e.g. ${sectionList.split(',').slice(0,3).join(', ')}...)" }
Only use "clarify" when you are genuinely unsure which section is meant — if
the instruction names a section, quotes/describes distinctive content, uses an
ordinal, or there is only one section where this change makes sense, proceed
with the appropriate op instead of asking.

VIDEO EMBEDS: to ADD a video, use "section_replace" (e.g. wrap it as a full-bleed
background layer with style="position:absolute;inset:0;width:100%;height:100%;
pointer-events:none;z-index:0" plus position:relative;overflow:hidden on the
section itself, when the instruction says "background"; otherwise embed it inline
in the content flow) or "patches" (inserting a self-contained
<div style="position:relative;padding-top:56.25%"><iframe .../></div> block right
after a specific line is enough). To REMOVE a video, use "patches" with "find"
matching the existing <iframe ...>...</iframe> block (or its opening tag) and
"replace": "". If the instruction has BOTH a remove-X and an add-Y request (e.g.
"remove the background image and add this video..."), apply both in the SAME
response — as two entries in "patches", or as one "section_replace" whose "html"
both drops the old element and adds the new one. Never silently drop half of a
compound instruction.

KNOWN SECTIONS: ${sectionList}
${cssVarsBlock ? `\nCSS DESIGN TOKENS:\n${cssVarsBlock}\n` : ''}
INSTRUCTION: ${augmentedInstruction}

FULL HTML:
${html}`;

    console.log(`\n┌─ GLOBAL EDIT ── regenIntent=${isRegenIntent} sections=[${sectionList}] ──`);
    console.log(`│ instruction: ${instruction.slice(0, 120)}`);

    const raw = opPrompt ? await llmGenerateFn(opPrompt) : '';

    if (raw) console.log(`│ LLM raw (first 500): ${raw.slice(0, 500)}`);
    console.log(`└──────────────────────────────────────────────────────────────`);

    let updatedHtml = html;
    let summary = 'Applied edit';
    let changedTexts: string[] = [];

    if (isRegenIntent && sectionCtx) {
      try {
        updatedHtml = await regenSection(sectionCtx);
        summary = 'Section regenerated';
      } catch {
        return reply.code(502).send({ error: 'Could not regenerate section — try providing more detail in your instruction' });
      }
    } else {
      const op = parseOp(raw);
      if (!op) return reply.code(502).send({ error: 'LLM returned no recognisable format — try rephrasing' });

      if (op.op === 'patches') {
        const { html: patched, applied, missed } = applyPatches(html, op.patches);
        if (applied === 0) return reply.code(502).send({ error: 'Edit could not be applied — the target text was not found. Try being more specific.' });
        updatedHtml = patched;
        summary = op.summary;
        changedTexts = op.patches.filter(p => p.replace !== undefined).map(p => p.replace);
        if (missed > 0) summary += ` (${missed} patch${missed > 1 ? 'es' : ''} skipped — text not found)`;

      } else if (op.op === 'section_replace') {
        const ctx = extractBestSection(html, op.anchor);
        if (!ctx) return reply.code(502).send({ error: `Section "${op.anchor}" not found` });
        updatedHtml = ctx.before + op.html + ctx.after;
        summary = op.summary;

      } else if (op.op === 'section_insert') {
        const ctx = extractBestSection(html, op.anchor);
        if (!ctx) return reply.code(502).send({ error: `Anchor section "${op.anchor}" not found` });
        updatedHtml = op.position === 'before'
          ? ctx.before + op.html + ctx.section + ctx.after
          : ctx.before + ctx.section + op.html + ctx.after;
        summary = op.summary;

      } else if (op.op === 'section_delete') {
        const ctx = extractBestSection(html, op.anchor);
        if (!ctx) return reply.code(502).send({ error: `Section "${op.anchor}" not found` });
        updatedHtml = ctx.before + ctx.after;
        summary = op.summary;

      } else if (op.op === 'clarify') {
        // Refuse to guess which section an ambiguous instruction meant — a wrong
        // guess silently edits the wrong element and reports success, which is
        // worse than asking. Select the element directly, or name the section.
        return reply.code(422).send({
          error: op.question || 'Which section should this apply to? Select the element directly, or name the section.',
        });

      } else {
        return reply.code(502).send({ error: 'Unknown operation returned by LLM — try rephrasing' });
      }
    }

    // ── Content-specific verification ─────────────────────────────────────────
    // validateHtml() (used inside saveValidatedEdit) only checks structural sanity
    // (truncation, size ratio, section count, CSS tokens) — it can't tell "the LLM
    // applied the change" apart from "the LLM returned the section unchanged."
    // When we told the LLM to use a specific resolved URL (video embed or Pexels
    // image), confirm it actually landed in the result before reporting success.
    // No automatic retry: fail loud with an actionable message rather than
    // silently retrying a stronger prompt, which would just move "patch until it
    // passes" from regex-space into prompt-space.
    if (resolvedUrlToVerify) {
      const idMatch = resolvedUrlToVerify.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)
        ?? resolvedUrlToVerify.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
      const needle = idMatch ? idMatch[1] : resolvedUrlToVerify;
      if (!updatedHtml.includes(needle)) {
        return reply.code(422).send({
          error: `Edit did not apply — the requested ${resolvedUrlKind} was not found in the result. Try rephrasing or naming the section more specifically.`,
        });
      }
    }

    // Removal sanity check — used ONLY as a post-hoc oracle to confirm what the
    // LLM claims it did actually happened, never to decide routing (that
    // distinction matters: a false positive here just asks the user to
    // rephrase; a false positive as a routing gate silently does the wrong
    // thing, which is the bug class this whole redesign removes elsewhere).
    // Catches the LLM (or a stray "find" patch that missed its real target,
    // e.g. duplicate markup elsewhere in the document) reporting a removal
    // that didn't actually happen.
    if (/\b(?:remove|delete|clear|hide)\b/i.test(instruction) &&
        /\b(?:video|iframe|vimeo|youtube)\b/i.test(instruction)) {
      const before = (html.match(/<iframe\b/gi) ?? []).length;
      const after  = (updatedHtml.match(/<iframe\b/gi) ?? []).length;
      if (after >= before) {
        return reply.code(422).send({
          error: 'Edit did not apply — the video/iframe is still present in the result. Try rephrasing or naming the section more specifically.',
        });
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

    const updatedHtml = html.slice(0, target.start) + sanitizeHtmlOutput(sectionMatch[0]) + html.slice(target.end);
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

  // ── Slide routes ─────────────────────────────────────────────────────────────

  // GET /super-clients/:name/slides  — list saved presentations
  app.get('/super-clients/:name/slides', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    try { await readMeta(dir); } catch { return reply.code(404).send({ error: 'Client not found' }); }
    try {
      const raw = await readFile(path.join(dir, 'slides.json'), 'utf-8');
      return reply.send(JSON.parse(raw));
    } catch {
      return reply.send([]);
    }
  });

  // GET /super-clients/:name/slides/:id  — get rendered HTML
  app.get('/super-clients/:name/slides/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });
    const dir = path.join(superClientsRoot, name);
    try { await readMeta(dir); } catch { return reply.code(404).send({ error: 'Client not found' }); }
    try {
      const html = await readFile(path.join(dir, 'slides', `${id}.html`), 'utf-8');
      return reply.header('Cache-Control', 'no-store').type('text/html').send(html);
    } catch {
      return reply.code(404).send({ error: 'Presentation not found' });
    }
  });

  // GET /super-clients/:name/slides/:id/data  — get JSON AST
  app.get('/super-clients/:name/slides/:id/data', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });
    const dir = path.join(superClientsRoot, name);
    try { await readMeta(dir); } catch { return reply.code(404).send({ error: 'Client not found' }); }
    try {
      const raw = await readFile(path.join(dir, 'slides', `${id}.json`), 'utf-8');
      return reply.send(JSON.parse(raw));
    } catch {
      return reply.code(404).send({ error: 'Presentation not found' });
    }
  });

  // DELETE /super-clients/:name/slides/:id
  app.delete('/super-clients/:name/slides/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });
    const dir = path.join(superClientsRoot, name);
    try { await readMeta(dir); } catch { return reply.code(404).send({ error: 'Client not found' }); }
    try {
      await rm(path.join(dir, 'slides', `${id}.json`), { force: true });
      await rm(path.join(dir, 'slides', `${id}.html`), { force: true });
      let index: SavedSlide[] = [];
      try { index = JSON.parse(await readFile(path.join(dir, 'slides.json'), 'utf-8')) as SavedSlide[]; } catch { /* ok */ }
      await writeFile(path.join(dir, 'slides.json'), JSON.stringify(index.filter(s => s.id !== id), null, 2));
      return reply.send({ ok: true });
    } catch {
      return reply.code(500).send({ error: 'Delete failed' });
    }
  });

  // POST /super-clients/:name/slides/:id/edit — LLM patch edit on slide HTML
  app.post('/super-clients/:name/slides/:id/edit', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });

    const body = req.body as { instruction?: string; currentHtml?: string } | undefined;
    const instruction = body?.instruction?.trim();
    if (!instruction) return reply.code(400).send({ error: 'Missing instruction' });

    const dir = path.join(superClientsRoot, name);
    const htmlPath = path.join(dir, 'slides', `${id}.html`);
    const resolved = path.resolve(htmlPath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'slides')))) {
      return reply.code(400).send({ error: 'Invalid id' });
    }

    let diskHtml: string;
    try {
      diskHtml = await readFile(htmlPath, 'utf-8');
    } catch {
      return reply.code(404).send({ error: 'Presentation not found' });
    }

    const html = body?.currentHtml?.trim() || diskHtml;

    // Deterministic patch — no LLM needed for InlineEditPanel operations.
    // If patchHtml handles this instruction, skip the LLM entirely.
    const deterministicResult = patchHtml(html, instruction);
    if (deterministicResult !== null) {
      if ('error' in deterministicResult) {
        return reply.code(deterministicResult.statusCode).send({ error: deterministicResult.error });
      }
      await writeFile(htmlPath, deterministicResult.html);
      console.log(`\n╔══ SLIDE EDIT (DETERMINISTIC) ═══════════════════════════`);
      console.log(`║ Slide  : ${id}`);
      console.log(`║ Summary: ${deterministicResult.summary}`);
      console.log(`╚══════════════════════════════════════════════════════════`);
      return reply.send({ html: deterministicResult.html, summary: deterministicResult.summary });
    }

    // Parse element-targeted instruction prefixes emitted by the smart-edit bridge.
    // __ELEMENT_EDIT__:cssPath||outerHtml||userInstruction  → targeted element edit
    // __REMOVE_BY_PATH__:cssPath                            → remove element by path
    // __REMOVE_ELEMENT__:outerHtml                          → remove element by html
    let resolvedInstruction = instruction;
    let elementContext = '';
    let displaySummary = instruction;

    if (instruction.startsWith('__ELEMENT_EDIT__:')) {
      const payload = instruction.slice('__ELEMENT_EDIT__:'.length);
      const parts = payload.split('||');
      const cssPath = parts[0] ?? '';
      const outerHtml = parts[1] ?? '';
      const userText = parts.slice(2).join('||');
      resolvedInstruction = userText;
      elementContext = `\nTARGET ELEMENT (CSS path: ${cssPath}):\n${outerHtml.slice(0, 4000)}\nEdit only this element unless the instruction requires broader changes.`;
      displaySummary = userText;
    } else if (instruction.startsWith('__REMOVE_BY_PATH__:')) {
      const cssPath = instruction.slice('__REMOVE_BY_PATH__:'.length);
      resolvedInstruction = `Remove the element matching CSS path "${cssPath}" from the document. Keep everything else unchanged.`;
      displaySummary = `Remove element: ${cssPath}`;
    } else if (instruction.startsWith('__REMOVE_ELEMENT__:')) {
      const outerHtml = instruction.slice('__REMOVE_ELEMENT__:'.length);
      resolvedInstruction = `Remove this element from the document:\n${outerHtml.slice(0, 1000)}\nKeep everything else unchanged.`;
      displaySummary = 'Remove element';
    } else if (instruction.startsWith('__REMOVE_BACKGROUND__:')) {
      const cssPath = instruction.slice('__REMOVE_BACKGROUND__:'.length);
      resolvedInstruction = `Remove the background image from the element matching CSS path "${cssPath}". Keep all other styles and content unchanged.`;
      displaySummary = 'Remove background image';
    } else if (instruction.startsWith('__STYLE_PATCH__:')) {
      const parts = instruction.slice('__STYLE_PATCH__:'.length).split('||');
      const cssPath = parts[0] ?? '';
      const prop = parts[1] ?? '';
      const value = parts[2] ?? '';
      const hintHtml = parts[3] ?? '';
      resolvedInstruction = `Set the CSS property "${prop}" to "${value}" on the element matching CSS path "${cssPath}". Keep everything else unchanged.${hintHtml ? `\nElement hint: ${hintHtml.slice(0, 400)}` : ''}`;
      displaySummary = `${prop}: ${value}`;
    } else if (instruction.startsWith('__TEXT_PATCH__:')) {
      const parts = instruction.slice('__TEXT_PATCH__:'.length).split('||');
      const cssPath = parts[0] ?? '';
      const newText = parts[1] ?? '';
      const hintHtml = parts[2] ?? '';
      resolvedInstruction = `Replace the text content of the element matching CSS path "${cssPath}" with: "${newText}". Keep all other content, structure, and styles unchanged.${hintHtml ? `\nElement hint: ${hintHtml.slice(0, 400)}` : ''}`;
      displaySummary = 'Text updated';
    } else if (instruction.startsWith('__IMAGE_INJECT_SCOPED__:')) {
      const parts = instruction.slice('__IMAGE_INJECT_SCOPED__:'.length).split('||');
      const cssPath = parts[0] ?? '';
      const url = parts[1] ?? '';
      const hintHtml = parts[2] ?? '';
      resolvedInstruction = `Replace the image src at CSS path "${cssPath}" with this URL: "${url}". Keep all other attributes and styles unchanged.${hintHtml ? `\nElement hint: ${hintHtml.slice(0, 400)}` : ''}`;
      displaySummary = 'Image replaced';
    } else if (instruction.startsWith('__BG_IMAGE_PATCH__:')) {
      const parts = instruction.slice('__BG_IMAGE_PATCH__:'.length).split('||');
      const cssPath = parts[0] ?? '';
      const url = parts[1] ?? '';
      resolvedInstruction = `Set the background image of the element matching CSS path "${cssPath}" to url("${url}"). Update the inline style or CSS rule — keep all other styles unchanged.`;
      displaySummary = 'Background image updated';
    } else if (instruction.startsWith('__VIDEO_INJECT__:')) {
      const parts = instruction.slice('__VIDEO_INJECT__:'.length).split('||');
      const cssPath = parts[0] ?? '';
      const url = parts[1] ?? '';
      resolvedInstruction = `Replace the video or iframe at CSS path "${cssPath}" with a new iframe or video element pointing to: "${url}". Keep all surrounding styles and structure unchanged.`;
      displaySummary = 'Video updated';
    } else if (instruction.startsWith('__ICON_REPLACE__:') || instruction.startsWith('__SVG_REPLACE__:')) {
      const isIcon = instruction.startsWith('__ICON_REPLACE__:');
      const payload = instruction.slice((isIcon ? '__ICON_REPLACE__:' : '__SVG_REPLACE__:').length);
      const parts = payload.split('||');
      const cssPath = parts[0] ?? '';
      const content = parts[1] ?? '';
      resolvedInstruction = `Replace the ${isIcon ? 'icon image' : 'SVG element'} at CSS path "${cssPath}" with: ${content.slice(0, 1000)}. Keep all surrounding styles and structure unchanged.`;
      displaySummary = 'Icon replaced';
    }

    console.log(`\n╔══ SLIDE EDIT ════════════════════════════════════════════`);
    console.log(`║ Slide      : ${id}`);
    console.log(`║ Instruction: ${resolvedInstruction.slice(0, 120)}`);
    console.log(`║ HTML source: ${body?.currentHtml ? 'client (in-memory)' : 'disk'} — ${html.length} chars`);
    console.log(`╚══════════════════════════════════════════════════════════`);

    // ── Structured-operation edit — mirrors the microsite op-picker ──────────
    // The LLM sees the FULL document (no truncation — the old full-rewrite path
    // sliced at 50k chars and silently dropped the tail of larger decks) and
    // responds with a small typed JSON op, never the whole page back. This
    // handles any free-text instruction at any document size in one pass.

    // Locate each top-level slide container (div whose class list contains the
    // exact token "slide"). Nested divs are skipped via depth scanning.
    function extractSlideBounds(src: string): Array<{ start: number; end: number }> {
      const out: Array<{ start: number; end: number }> = [];
      const openRe = /<div\b[^>]*\bclass="([^"]*)"[^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = openRe.exec(src)) !== null) {
        if (!m[1].split(/\s+/).includes('slide')) continue;
        let depth = 1, j = m.index + m[0].length;
        while (j < src.length && depth > 0) {
          const nO = src.indexOf('<div', j);
          const nC = src.indexOf('</div>', j);
          if (nC === -1) { j = src.length; break; }
          if (nO !== -1 && nO < nC) { depth++; j = nO + 4; }
          else { depth--; j = nC + 6; }
        }
        out.push({ start: m.index, end: j });
        openRe.lastIndex = j; // skip past this slide — never match nested .slide divs
      }
      return out;
    }

    const slideBounds = extractSlideBounds(html);
    const slideList = slideBounds.map((b, i) => {
      const text = html.slice(b.start, b.end);
      const heading = /<h[1-6][^>]*>\s*([^<]{1,60})/i.exec(text)?.[1]?.trim()
        ?? />\s*([A-Za-z][^<]{2,60})</.exec(text)?.[1]?.trim()
        ?? '';
      return `slide ${i + 1}${heading ? ` — "${heading}"` : ''}`;
    }).join('\n');

    // ── Pre-resolve real asset URLs so the LLM never invents them ────────────
    let augmentedInstruction = resolvedInstruction;
    let resolvedUrlToVerify: string | null = null;
    let resolvedUrlKind = '';

    // Descriptive image request (no URL given) → fetch a real Pexels URL
    if (!/https?:\/\//.test(resolvedInstruction) &&
        /\b(?:image|photo|picture|pic)\b/i.test(resolvedInstruction)) {
      try {
        const qPrompt = `Extract a concise 2-5 keyword image search query from this instruction. Return ONLY the keywords, nothing else.\n\nInstruction: ${resolvedInstruction}`;
        const pexelsQ = (await llmGenerateFn(qPrompt)).trim().replace(/^["'`]|["'`]$/g, '').trim().slice(0, 80);
        if (pexelsQ) {
          const pexelsUrl = await fetchPexelsImageUrl(pexelsQ);
          if (pexelsUrl) {
            augmentedInstruction = `${resolvedInstruction}\n\nIMPORTANT — use this exact image URL (do NOT invent or substitute any other URL): ${pexelsUrl}`;
            resolvedUrlToVerify = pexelsUrl;
            resolvedUrlKind = 'image';
            console.log(`📸 Pexels pre-fetch for slide edit: "${pexelsQ}" → ${pexelsUrl}`);
          }
        }
      } catch { /* fall through — LLM will handle without a real URL */ }
    }

    // Video URL → hand the LLM a ready-made embed URL (watch-page URLs are
    // blocked from iframes by X-Frame-Options)
    const slideVideoUrlMatch = resolvedInstruction.match(/https?:\/\/\S*(?:youtube\.com|youtu\.be|vimeo\.com)\S*/i);
    if (slideVideoUrlMatch) {
      const embedUrl = toVideoEmbedUrl(slideVideoUrlMatch[0].replace(/['"<>)\],.]+$/, ''));
      augmentedInstruction = `${augmentedInstruction}\n\nIMPORTANT — if the instruction asks to add/embed a video, use this exact embed URL in an <iframe> (do NOT alter it or invent a different one): ${embedUrl}`;
      resolvedUrlToVerify = embedUrl;
      resolvedUrlKind = 'video';
      console.log(`🎬 Video URL pre-normalized for slide edit: ${embedUrl.slice(0, 80)}`);
    }

    type SlideOp =
      | { op: 'patches'; patches: Array<{ find: string; replace: string }>; summary: string }
      | { op: 'slide_replace'; slide: number; html: string; summary: string }
      | { op: 'slide_insert'; slide: number; position: 'before' | 'after'; html: string; summary: string }
      | { op: 'slide_delete'; slide: number; summary: string }
      | { op: 'clarify'; question: string };

    function parseSlideOp(rawText: string): SlideOp | null {
      const start = rawText.indexOf('{');
      if (start === -1) return null;
      let depth = 0, end = -1, inStr = false, esc = false;
      for (let i = start; i < rawText.length; i++) {
        const c = rawText[i];
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) return null;
      try {
        const slice = rawText.slice(start, end + 1)
          .replace(/("(?:[^"\\]|\\.)*")/gs, s => s.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
        return JSON.parse(slice) as SlideOp;
      } catch { return null; }
    }

    function applySlidePatches(base: string, patches: Array<{ find: string; replace: string }>): { html: string; applied: number; missed: number } {
      let result = base;
      let applied = 0, missed = 0;
      for (const p of patches) {
        if (!p.find || p.replace === undefined) continue;
        if (!result.includes(p.find)) {
          console.warn(`⚠️  Slide patch MISS: find="${p.find.slice(0, 80)}"`);
          missed++;
          continue;
        }
        result = result.split(p.find).join(p.replace);
        applied++;
      }
      return { html: result, applied, missed };
    }

    const opPrompt = `You are editing an HTML slide presentation — a single scrollable page where each slide is a <div class="slide">. Pick the ONE operation that best fits the instruction and respond with a single JSON object — nothing else.

OPERATION TYPES:

OP patches — targeted changes to existing content (text, values, colors, images, styles, adding or removing an element inside a slide).
{ "op": "patches", "patches": [{ "find": "exact substring", "replace": "new value" }], "summary": "..." }
Rules:
- Copy each "find" string EXACTLY from the HTML — character-for-character, no paraphrasing
- Include 15–40 chars of surrounding context so each "find" is unique in the document
- NEVER put newlines inside "find" or "replace" — single-line strings only
- Up to 12 patches

OP slide_replace — redesign or restructure one slide completely:
{ "op": "slide_replace", "slide": <1-based slide number>, "html": "<div class=\\"slide\\" ...>...</div>", "summary": "..." }

OP slide_insert — add a brand-new slide before or after an existing one:
{ "op": "slide_insert", "slide": <anchor slide number>, "position": "before|after", "html": "<div class=\\"slide\\" ...>...</div>", "summary": "..." }

OP slide_delete — remove one slide entirely:
{ "op": "slide_delete", "slide": <slide number>, "summary": "..." }

OP clarify — a TARGET ELEMENT context section below means the instruction is
already scoped — never use "clarify" when one is present. Otherwise, if the
instruction names no slide, quotes no distinctive content, and gives no
ordinal ("first"/"last"), and more than one slide could plausibly be meant,
use this instead of guessing which slide to touch:
{ "op": "clarify", "question": "Which slide should this apply to?" }

VIDEO EMBEDS: to ADD a video, place a self-contained block
<div style="position:relative;padding-top:56.25%;width:100%"><iframe src="..." style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; fullscreen" allowfullscreen></iframe></div>
at the position inside the slide that the instruction asks for (or the most natural spot if it says to choose) — via "patches" (insert right after an existing line) or "slide_replace". For a full-bleed background video, give the slide position:relative;overflow:hidden and add the iframe as its first child with style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border:0;z-index:0". To REMOVE a video, use "patches" with "find" matching the existing <iframe ...> block and "replace": "". If the instruction has BOTH a remove-X and an add-Y request, apply both in the SAME response. Never silently drop half of a compound instruction.

SLIDES IN THIS DECK (1-based):
${slideList || '(no <div class="slide"> containers detected — use "patches" only)'}

INSTRUCTION: ${augmentedInstruction}${elementContext}

FULL HTML:
${html}`;

    const raw = await llmGenerateFn(opPrompt);
    console.log(`┌─ SLIDE EDIT LLM raw (first 500): ${(raw ?? '').slice(0, 500)}`);

    const op = parseSlideOp(raw ?? '');
    if (!op) return reply.code(502).send({ error: 'LLM returned no recognisable format — try rephrasing' });

    let updatedHtml = html;
    let summary = displaySummary;

    if (op.op === 'patches') {
      const { html: patched, applied, missed } = applySlidePatches(html, op.patches);
      if (applied === 0) return reply.code(502).send({ error: 'Edit could not be applied — the target text was not found. Try being more specific.' });
      updatedHtml = patched;
      summary = op.summary || summary;
      if (missed > 0) summary += ` (${missed} patch${missed > 1 ? 'es' : ''} skipped — text not found)`;
    } else if (op.op === 'slide_replace' || op.op === 'slide_insert' || op.op === 'slide_delete') {
      const idx = Math.trunc(op.slide) - 1;
      if (idx < 0 || idx >= slideBounds.length) {
        return reply.code(422).send({ error: `Slide ${op.slide} not found — this deck has ${slideBounds.length} slide${slideBounds.length === 1 ? '' : 's'}` });
      }
      const b = slideBounds[idx];
      if (op.op === 'slide_replace') {
        updatedHtml = html.slice(0, b.start) + op.html + html.slice(b.end);
      } else if (op.op === 'slide_insert') {
        updatedHtml = op.position === 'before'
          ? html.slice(0, b.start) + op.html + '\n' + html.slice(b.start)
          : html.slice(0, b.end) + '\n' + op.html + html.slice(b.end);
      } else {
        updatedHtml = html.slice(0, b.start) + html.slice(b.end);
      }
      summary = op.summary || summary;
    } else if (op.op === 'clarify') {
      return reply.code(422).send({
        error: op.question || 'Which slide should this apply to? Select the element directly, or name the slide.',
      });
    } else {
      return reply.code(502).send({ error: 'Unknown operation returned by LLM — try rephrasing' });
    }

    // Guard: closing tags must survive (patches can't remove them; slide html splices could)
    if (!/(<\/body>|<\/html>)/i.test(updatedHtml)) {
      return reply.code(502).send({ error: 'Edit produced incomplete HTML — missing closing tags. Try rephrasing.' });
    }

    // Content verification: when we told the LLM to use a specific resolved URL,
    // confirm it actually landed instead of trusting a no-op response.
    if (resolvedUrlToVerify) {
      const idMatch = resolvedUrlToVerify.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)
        ?? resolvedUrlToVerify.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
      const needle = idMatch ? idMatch[1] : resolvedUrlToVerify;
      if (!updatedHtml.includes(needle)) {
        return reply.code(422).send({
          error: `Edit did not apply — the requested ${resolvedUrlKind} was not found in the result. Try rephrasing or naming the slide more specifically.`,
        });
      }
    }

    if (updatedHtml === html) {
      return reply.code(422).send({ error: 'Edit produced no change — try being more specific' });
    }

    await writeFile(htmlPath, updatedHtml);
    const finalSummary = summary.length > 80 ? summary.slice(0, 77) + '…' : summary;
    return reply.send({ html: updatedHtml, summary: finalSummary });
  });

  // PATCH /super-clients/:name/slides/:id/html — direct HTML overwrite (undo/redo sync)
  app.patch('/super-clients/:name/slides/:id/html', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });

    const body = req.body as { html?: string } | undefined;
    const html = body?.html?.trim();
    if (!html) return reply.code(400).send({ error: 'Missing html' });

    const dir = path.join(superClientsRoot, name);
    const htmlPath = path.join(dir, 'slides', `${id}.html`);
    const resolved = path.resolve(htmlPath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'slides')))) {
      return reply.code(400).send({ error: 'Invalid id' });
    }

    try {
      await writeFile(htmlPath, html);
      return reply.send({ ok: true });
    } catch {
      return reply.code(500).send({ error: 'Save failed' });
    }
  });

  // GET /super-clients/:name/slides/:id/export?format=pdf|pptx
  // PDF  → Chrome CLI --print-to-pdf (real text layer, fully selectable/editable, no Puppeteer lib)
  // PPTX → python-pptx with HTML text extraction (editable text boxes in PowerPoint)
  app.get('/super-clients/:name/slides/:id/export', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    const { format = 'pdf' } = req.query as { format?: string };

    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });
    if (!['pdf', 'pptx'].includes(format)) return reply.code(400).send({ error: 'Format must be pdf or pptx' });

    const dir = path.join(superClientsRoot, name);
    try { await readMeta(dir); } catch { return reply.code(404).send({ error: 'Client not found' }); }

    let html: string;
    try {
      html = await readFile(path.join(dir, 'slides', `${id}.html`), 'utf-8');
    } catch {
      return reply.code(404).send({ error: 'Presentation not found' });
    }

    let title = 'Presentation';
    let orientation: 'landscape' | 'portrait' = 'landscape';
    try {
      const idx = JSON.parse(await readFile(path.join(dir, 'slides.json'), 'utf-8')) as { id: string; title: string; orientation?: 'landscape' | 'portrait' }[];
      const rec = idx.find(s => s.id === id);
      title = rec?.title ?? title;
      orientation = rec?.orientation === 'portrait' ? 'portrait' : 'landscape';
    } catch { /* ok */ }
    const isPortrait = orientation === 'portrait';

    const safeTitle = title.replace(/[^\w\s\-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
    const fileName = `${safeTitle || 'presentation'}-${id.slice(0, 8)}`;

    const { spawn } = await import('node:child_process');
    const { tmpdir } = await import('node:os');
    const { rm: rmTmp } = await import('node:fs/promises');

    if (format === 'pdf') {
      // ── Chrome CLI print-to-PDF ──────────────────────────────────────────
      // Uses the Chrome binary that Puppeteer already downloaded to ~/.cache/puppeteer.
      // Chrome's native PDF renderer produces real text (selectable, editable) — not images.
      const chromeBin = await findChromeBinary();
      if (!chromeBin) return reply.code(503).send({ error: 'Chrome binary not found — run `npm install` to let Puppeteer download it' });

      // Inject print CSS that forces one PDF page per .slide element.
      // Landscape = 13.333in × 7.5in (16:9); portrait = 7.5in × 13.333in (9:16).
      const pageW = isPortrait ? '7.5in' : '13.333in';
      const pageH = isPortrait ? '13.333in' : '7.5in';
      const PRINT_CSS = `<style id="prodeck-print">
@page { size: ${pageW} ${pageH}; margin: 0; }
html, body { margin: 0 !important; padding: 0 !important; }
.deck,.slides,.slide-container,.presentation-container,.slideshow {
  display: block !important; flex-direction: unset !important; gap: 0 !important;
  padding: 0 !important; margin: 0 !important; overflow: visible !important;
  height: auto !important; min-height: unset !important; position: static !important;
}
.slide,.page,.slide-page,section {
  display: block !important; position: relative !important;
  width: ${pageW} !important; height: ${pageH} !important; max-height: ${pageH} !important;
  aspect-ratio: unset !important; box-shadow: none !important;
  margin: 0 !important; padding: 0 !important; overflow: hidden !important;
  flex-shrink: 0 !important; break-after: page !important; page-break-after: always !important;
}
/* Never break a word across two lines — wrap only at spaces */
.slide *,.page *,.slide-page *,section * { word-break: normal !important; overflow-wrap: normal !important; hyphens: none !important; }
/* Cancel trailing page break on the last slide to avoid a blank final page */
.slide:last-child,.page:last-child,.slide-page:last-child,section:last-child {
  break-after: auto !important; page-break-after: auto !important;
}
.nav-prev,.nav-next,.nav-zone,.keyboard-hint { display: none !important; }
</style>`;

      // Strip the browser-only scroll enforcer before printing
      const STRIP = [
        /<style[^>]*\bid="prodeck-scroll-enforcer"[^>]*>[\s\S]*?<\/style>/g,
        /<script[^>]*\bid="prodeck-theme-apply"[^>]*>[\s\S]*?<\/script>/g,
      ];
      let printHtml = html;
      for (const re of STRIP) printHtml = printHtml.replace(re, '');
      const headClose = printHtml.indexOf('</head>');
      printHtml = headClose !== -1
        ? printHtml.slice(0, headClose) + PRINT_CSS + printHtml.slice(headClose)
        : PRINT_CSS + printHtml;

      const tmpId = `slide-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tmpHtml = path.join(tmpdir(), `${tmpId}.html`);
      const tmpPdf  = path.join(tmpdir(), `${tmpId}.pdf`);

      try {
        await writeFile(tmpHtml, printHtml, 'utf-8');

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(chromeBin, [
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            `--print-to-pdf=${tmpPdf}`,
            '--no-pdf-header-footer',
            `file://${tmpHtml}`,
          ], { stdio: 'ignore' });
          proc.on('error', reject);
          proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Chrome exited ${code}`)));
        });

        const pdfBytes = await readFile(tmpPdf);
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
        return reply.send(pdfBytes);
      } finally {
        await rmTmp(tmpHtml, { force: true });
        await rmTmp(tmpPdf, { force: true });
      }
    } else {
      // ── python-pptx text extraction ──────────────────────────────────────
      const venvRoot  = path.resolve(import.meta.dirname ?? '', '../../../../.venv');
      const pythonBin = path.join(venvRoot, 'bin', 'python3');
      const script    = path.resolve(import.meta.dirname ?? '', 'slide-to-pptx.py');

      const pptxBytes = await new Promise<Buffer>((resolve, reject) => {
        const proc = spawn(pythonBin, [script, orientation], { stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        proc.stdout.on('data', (d: Buffer) => chunks.push(d));
        proc.stderr.on('data', (d: Buffer) => errChunks.push(d));
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`slide-to-pptx.py exited ${code}: ${Buffer.concat(errChunks).toString('utf-8').slice(0, 400)}`));
          } else {
            resolve(Buffer.concat(chunks));
          }
        });
        proc.stdin.write(html, 'utf-8');
        proc.stdin.end();
      });

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      reply.header('Content-Disposition', `attachment; filename="${fileName}.pptx"`);
      return reply.send(pptxBytes);
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
