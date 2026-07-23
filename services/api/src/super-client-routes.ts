import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';
import { llmGenerateFn, withLlmTemperature } from './agent-routes.js';
import { fetchPexelsImageUrl } from './image-routes.js';
import { ClientMemoryService } from './memory/client-memory.service.js';
import type { ClientKnowledgeEntry } from './memory/client-memory.types.js';
import { DocumentMemoryService } from './memory/document-memory.service.js';
import { convertUploadToMemoryDoc } from './memory/document-converter.js';
import { maybeQueryCsvs } from './memory/csv-query.js';
import { syncChatMemory } from './memory/chat-memory-sync.js';
import { syncClientKnowledge } from './memory/client-knowledge-sync.js';
import { selectRelevantMemory, getMemoryDocsByIds, type RelevanceDecision } from './memory/memory-relevance.js';
import {
  readOrgContextSettings,
  resolveVoiceBlock,
  resolveDesignKit,
  superClientWorkdir,
  getMimeType,
} from '@ai-engine/runtime';
import { findBestDocumentSkill, loadSkill, formatSkillForSlides, listSkills } from './skills/skill.service.js';
import { saveDocumentDirect, getDocumentContent, getDocumentMeta } from './documents/document-generator.js';
import { parseRequestedFormat, detectPresentationIntent, detectSlideOrientation } from './documents/format-detector.js';
import { validateSlideHtml, countSlides, extractTitle, resolveSlideOrientation } from './slides/slide-generator.js';
import type { SavedSlide } from './slides/slide-generator.js';
import { patchHtml, toVideoEmbedUrl, findByPath, locateElement, hideCoveringImage } from './html-patch.js';
import { classifyChatIntent, type IntentDecision, type PendingClarification } from './super-client/intent-gate.js';
import { extractSlidesTag, stripSlidesTag, hasRawArtifactMarkup, resolveSlideCount } from './super-client/slide-parsing.js';
import { isBareGenerationRequest } from './chat/vocabulary.js';
import { extractSiteFacts } from './site-facts/pipeline.js';
import { generateSummaryDoc } from './site-facts/summary-doc.service.js';
import { readFacts, readManifest } from './site-facts/store.js';
import { extractDesignSystem } from './site-facts/design/pipeline.js';
import { extractImageContext } from './site-facts/image-context/pipeline.js';

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
    out = out.replace(new RegExp(`<(?:style|script)[^>]*\\bid="${id}"[\\s\\S]*?</(?:style|script)>\\s*`, 'g'), '');
  }
  return out;
}

// Strip constructs that would render source code as visible text in the microsite.
// Called on every LLM response before it is written into customHtml.
function sanitizeHtmlOutput(html: string): string {
  return (
    html
      // Embedded markdown code fence blocks inside HTML body → remove entirely
      .replace(/```(?:html|css|js|javascript|typescript|text|xml)?\s*\r?\n([\s\S]*?)\r?\n```/g, '')
      // <pre> blocks containing HTML entities (escaped HTML/CSS/JS code) → remove
      .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (match) => (/&lt;|&gt;|&amp;lt;/.test(match) ? '' : match))
  );
}

// Strip markdown fences and leading/trailing prose from an LLM HTML response.
// Used in multiple handler scopes — defined at module level so all can share it.
function extractHtmlFromResponseGlobal(raw: string): string {
  const s = raw.trim();
  const fenceMatch = s.match(/```(?:html)?\r?\n?([\s\S]+?)\r?\n?```/);
  if (fenceMatch) return sanitizeHtmlOutput(fenceMatch[1].trim());
  const firstTag = s.indexOf('<');
  if (firstTag === -1) return s;
  let result = s.slice(firstTag);
  const lastTag = result.lastIndexOf('>');
  if (lastTag !== -1) result = result.slice(0, lastTag + 1);
  return sanitizeHtmlOutput(result.trim());
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
      path.join(
        cacheDir,
        v,
        'chrome-mac-x64',
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing',
      ),
      path.join(
        cacheDir,
        v,
        'chrome-mac-arm64',
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing',
      ),
      // Linux
      path.join(cacheDir, v, 'chrome-linux64', 'chrome'),
      path.join(cacheDir, v, 'chrome-linux', 'chrome'),
    ];
    for (const candidate of candidates) {
      try {
        await stat(candidate);
        return candidate;
      } catch {
        /* try next */
      }
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

// A settled step from the background-job narration timeline (title -> processing
// -> response). Persisted verbatim so a page reload can re-render the exact same
// dot/connector-line timeline instead of falling back to plain markdown text.
interface NarrationStepRecord {
  title: string;
  doneResponse: string;
  failedResponse: string;
  status: 'done' | 'failed';
  error?: string;
}

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  editContext?: 'microsite' | 'proposal' | 'document';
  // Set on an assistant turn when it asked a clarifying question, so the next
  // turn can resolve the deferred intent instead of re-classifying from scratch.
  pendingClarification?: PendingClarification;
  narrationSteps?: NarrationStepRecord[];
  // Set on a synthetic entry representing a file upload, so it takes its real
  // chronological place in the timeline (createdAt = raw-file-write time) —
  // uploads otherwise had no persisted representation at all and vanished on
  // reload. `content` still carries a plain-text fallback (e.g. "Attached
  // file: X.pdf") so every existing consumer that just reads role/content
  // (LLM prompt/history builders) keeps working unchanged.
  upload?: {
    fileName: string;
    originalName?: string;
    status: ScFile['status'];
    error?: string;
    duplicateOfFileName?: string;
  };
}

interface ScFile {
  fileName: string;
  originalName?: string;
  size: number;
  uploadedAt: string;
  status: 'processing' | 'extracted' | 'failed' | 'duplicate';
  error?: string;
  // SHA-256 of the raw file content — lets a re-upload of the exact same
  // file (even under a different name) be detected and skipped instead of
  // silently creating a second copy in memory.
  contentHash?: string;
  // Set only when status === 'duplicate' — a synthetic response entry (never
  // written to files.json) referencing the fileName of the pre-existing
  // upload this content matches, so the composer can tell the user what's
  // already there instead of uploading it again.
  duplicateOfFileName?: string;
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

// A generation that is still 'generating' this long after it started is dead —
// the browser that owned it errored, aborted, or was closed before the card
// could be resolved. Generations finish in well under ~2 min, so 5 min never
// drops a legitimately in-progress one.
export const STALE_GENERATION_MS = 5 * 60 * 1000;

// Drop dead 'generating' entries (stale or missing timestamp). Terminal
// (complete/error) entries are always kept. Pure + exported for unit testing.
export function pruneStaleGenerations(
  gens: GenerationEntry[],
  now: number = Date.now(),
): GenerationEntry[] {
  return gens.filter((g) => {
    if (g.phase !== 'generating') return true;
    if (!g.createdAt) return false;
    const started = Date.parse(g.createdAt);
    if (Number.isNaN(started)) return false;
    return now - started < STALE_GENERATION_MS;
  });
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

/**
 * User-facing label for a memory-relevance entry shown in the confirmation
 * question. Only 'upload' entries have a fileName the user actually
 * recognizes (they named/chose the file) — 'chat' and 'site-crawl' entries
 * are internal artifact names (e.g. "chat.md", "client-knowledge.md") that
 * don't correspond to anything the user created, so they get a plain
 * description instead of a fake-looking filename.
 */
function memoryEntryLabel(entry: { fileName: string; type: string }): string {
  switch (entry.type) {
    case 'chat':
      return 'Conversation history';
    case 'site-crawl':
      return 'Website research';
    default:
      return entry.fileName;
  }
}

/**
 * Determines whether the user's message ALREADY explicitly says which stored
 * files to use — e.g. "use only the yacht proposal, the RFP was uploaded by
 * mistake" — so the memory-selection checklist can be skipped instead of
 * asking again for something the user just told us. Deliberately narrow: not
 * the broad "judge whether each document is relevant" call that was removed
 * earlier (that open-ended judgment is exactly what produced a wrong verdict
 * on unrelated stored content). This is a constrained extraction — does the
 * message name specific files, and which — with a safe failure mode: an
 * empty or low-confidence result just falls back to showing the checklist,
 * it never silently guesses a selection the user didn't actually state.
 */
async function resolveExplicitFileSelection(
  entries: RelevanceDecision[],
  userMessage: string,
  generateFn: (prompt: string) => Promise<string>,
): Promise<string[]> {
  if (entries.length === 0) return [];

  const listBlock = entries
    .map((e) => `- id: ${e.id} | file: ${memoryEntryLabel(e)} | description: ${e.reason}`)
    .join('\n');
  const prompt = `A user is chatting about a client and has stored files available. Determine whether their message EXPLICITLY and UNAMBIGUOUSLY specifies which of these files to use for what they're asking right now.

USER MESSAGE: ${userMessage}

FILES:
${listBlock}

If the message clearly names, or unambiguously refers to, one or more specific files (e.g. "use only the yacht proposal", "the RFP was uploaded by mistake, don't use it", "just the transcript") — return the ids of exactly the files the user wants used. If the message does not reference any specific file, or a reference is too vague to confidently match one file over another, return an empty array — never guess.

Return ONLY a JSON array of ids, e.g. ["id1"] or [].`;

  try {
    const raw = await generateFn(prompt);
    const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const parsed = JSON.parse(stripped) as unknown;
    if (!Array.isArray(parsed)) return [];
    const validIds = new Set(entries.map((e) => e.id));
    return parsed.filter((id): id is string => typeof id === 'string' && validIds.has(id));
  } catch {
    return [];
  }
}

const MaterialCheckSchema = z.object({ note: z.string().nullable() });

/**
 * Small, fast pre-flight check — separate from (and purely informational
 * alongside) the MATERIAL_CHECK_RULE baked into the main generation prompt.
 * Runs BEFORE the ack text / generation card so a heads-up about missing
 * material (if any) reaches the user first, not buried in the model's own
 * trailing commentary after the whole generation is already done. Never
 * blocks generation — a parse/validation failure or any error just means no
 * note, same as "material looks sufficient".
 */
async function assessGenerationMaterial(
  clientName: string,
  artifactLabel: string,
  userMessage: string,
  memoryCatalog: string,
  generateFn: (prompt: string) => Promise<string>,
): Promise<string | null> {
  const prompt = `You are doing a quick pre-flight check before generating a ${artifactLabel} for "${clientName}". Look at the user's request and the material available below, and judge whether it's enough to produce a complete, specific ${artifactLabel} — or whether real gaps (e.g. no scope of work, no pricing/fee data, no deliverables list, no team/staffing names) will force placeholder sections.

USER'S REQUEST:
"""${userMessage}"""

AVAILABLE STORED MATERIAL:
${memoryCatalog || '(none)'}

If the material is sufficient for a complete, specific ${artifactLabel}, respond with exactly: {"note": null}

If there are real gaps that will force placeholder/generic sections, respond with a SHORT (1-2 sentence), specific, friendly heads-up naming what's missing, e.g. {"note": "I don't see the actual scope of work or fee figures here, just an email thread — I'll build a proposal framework with placeholder sections your team can fill in."}

Do not decline or refuse — proceeding with placeholders is expected and fine. Just flag it honestly upfront if that's what will happen.

Respond with ONLY JSON, no prose or markdown fences: {"note": "<string>"} or {"note": null}`;

  try {
    const raw = await generateFn(prompt);
    const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const result = MaterialCheckSchema.safeParse(JSON.parse(stripped));
    return result.success ? result.data.note : null;
  } catch {
    return null;
  }
}

/** Remove em/en dashes from chat-visible text — replace with a spaced hyphen. */
function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ' - ');
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

async function appendUploadHistoryEntry(dir: string, entry: HistoryEntry): Promise<void> {
  const history = await readHistory(dir);
  history.push(entry);
  await writeFile(path.join(dir, 'history.json'), JSON.stringify(history, null, 2));
}

async function updateUploadHistoryStatus(
  dir: string,
  fileName: string,
  status: ScFile['status'],
  error?: string,
): Promise<void> {
  const history = await readHistory(dir);
  const idx = history.findIndex((h) => h.upload?.fileName === fileName);
  if (idx !== -1) {
    history[idx] = { ...history[idx], upload: { ...history[idx].upload!, status, ...(error ? { error } : {}) } };
    await writeFile(path.join(dir, 'history.json'), JSON.stringify(history, null, 2));
  }
}

// client-knowledge.md / design-system.md / image-context.md are all
// generated by background jobs, not uploaded by the user — they never live
// in files.json. This set lets the documents routes special-case them (read
// from the client root instead of uploads/, skip memory-knowledge cleanup
// on delete) without maintaining any extra bookkeeping file.
export const VIRTUAL_DOC_NAMES = new Set(['client-knowledge.md', 'design-system.md', 'image-context.md']);

interface FactsStatusFile {
  status: 'running' | 'generating_summary' | 'complete' | 'failed';
  error?: string;
}

/** Shared shape for the two independent, on-demand job status files. */
export interface OnDemandStatusFile {
  status: 'running' | 'complete' | 'failed';
  error?: string;
  startedAt: string;
  finishedAt?: string;
  [key: string]: unknown;
}

async function readJsonStatus<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/**
 * Real file existence always wins over what a status file claims — if the
 * user already deleted the generated file, this must not resurrect it as
 * "processing" or "failed", it should just disappear from the list.
 */
async function virtualDocEntry(
  dir: string,
  fileName: string,
  originalName: string,
  reachedStage: boolean,
  failed: boolean,
  errorMessage: string | undefined,
): Promise<ScFile | null> {
  try {
    const st = await stat(path.join(dir, fileName));
    return { fileName, originalName, size: st.size, uploadedAt: st.mtime.toISOString(), status: 'extracted' };
  } catch {
    if (failed) return { fileName, originalName, size: 0, uploadedAt: new Date().toISOString(), status: 'failed', error: errorMessage };
    if (reachedStage) return null; // status file says done but the file is gone — user deleted it
    return { fileName, originalName, size: 0, uploadedAt: new Date().toISOString(), status: 'processing' };
  }
}

/**
 * Computed fresh on every call from 3 independent status files + real file
 * existence — never persisted. Facts/design-tokens/image-context are
 * unrelated jobs now, each gated on its own status file; a virtual doc is
 * omitted entirely (no row at all) if its job has never been triggered.
 */
async function buildVirtualDocs(dir: string): Promise<ScFile[]> {
  const docs: ScFile[] = [];
  const siteFactsDir = path.join(dir, 'site-facts');

  const facts = await readJsonStatus<FactsStatusFile>(path.join(siteFactsDir, 'status.json'));
  if (facts) {
    const reached = facts.status === 'complete';
    const failed = facts.status === 'failed';
    const knowledge = await virtualDocEntry(dir, 'client-knowledge.md', 'Client Knowledge', reached, failed, facts.error);
    if (knowledge) docs.push(knowledge);
  }

  const design = await readJsonStatus<OnDemandStatusFile>(path.join(siteFactsDir, 'design-status.json'));
  if (design) {
    const entry = await virtualDocEntry(dir, 'design-system.md', 'Design System', design.status === 'complete', design.status === 'failed', design.error);
    if (entry) docs.push(entry);
  }

  const imageContext = await readJsonStatus<OnDemandStatusFile>(path.join(siteFactsDir, 'image-context-status.json'));
  if (imageContext) {
    const entry = await virtualDocEntry(dir, 'image-context.md', 'Image Context', imageContext.status === 'complete', imageContext.status === 'failed', imageContext.error);
    if (entry) docs.push(entry);
  }

  return docs;
}

interface OnDemandTriggerResult {
  code: number;
  body: Record<string, unknown>;
}

/**
 * Shared guard/status-write plumbing for the two independent, on-demand
 * extraction jobs (design-system, image-context): both require the site to
 * have been crawled already (facts status must carry an outputDir), both
 * are idempotent unless `force`, both write a small status file the
 * Documents panel reads via buildVirtualDocs.
 */
async function triggerOnDemandJob(opts: {
  dir: string;
  name: string;
  statusFileName: string;
  jobLabel: string;
  force: boolean;
  log: FastifyBaseLogger;
  run: (siteFactsOutputDir: string) => Promise<Record<string, unknown>>;
}): Promise<OnDemandTriggerResult> {
  const siteFactsDir = path.join(opts.dir, 'site-facts');
  const factsStatus = await readJsonStatus<{ status: string; outputDir?: string }>(path.join(siteFactsDir, 'status.json'));
  if (!factsStatus?.outputDir) {
    return {
      code: 425,
      body: { error: 'Site has not been crawled yet — create the client with a URL and wait for fact extraction to finish first.' },
    };
  }

  const statusPath = path.join(siteFactsDir, opts.statusFileName);
  const existing = await readJsonStatus<OnDemandStatusFile>(statusPath);
  if (existing && (existing.status === 'running' || (existing.status === 'complete' && !opts.force))) {
    return { code: 200, body: existing };
  }

  const writeStatus = (status: OnDemandStatusFile) =>
    writeFile(statusPath, JSON.stringify(status, null, 2)).catch((err) => {
      opts.log.warn({ err, name: opts.name }, `[SuperClient] failed to write ${opts.jobLabel} status`);
    });

  const startedAt = new Date().toISOString();
  await writeStatus({ status: 'running', startedAt });

  void opts
    .run(factsStatus.outputDir)
    .then(async (result) => {
      opts.log.info({ name: opts.name, ...result }, `[SuperClient] ${opts.jobLabel} extraction complete`);
      await writeStatus({ status: 'complete', startedAt, finishedAt: new Date().toISOString(), ...result });
    })
    .catch(async (err) => {
      opts.log.warn({ err, name: opts.name }, `[SuperClient] ${opts.jobLabel} extraction failed`);
      await writeStatus({
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return { code: 202, body: { status: 'running', startedAt } };
}

async function readProposals(dir: string): Promise<ScProposal[]> {
  try {
    const raw = await readFile(path.join(dir, 'proposals.json'), 'utf-8');
    return JSON.parse(raw) as ScProposal[];
  } catch {
    return [];
  }
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
  } catch {
    /* index update is best-effort */
  }
  return updatedMeta;
}

async function updateProposal(dir: string, fileName: string, title: string, content: string): Promise<ScProposal> {
  const proposalsDir = path.join(dir, 'proposals');
  await mkdir(proposalsDir, { recursive: true });
  await writeFile(path.join(proposalsDir, fileName), content, 'utf-8');

  const updatedAt = new Date().toISOString();
  const entry: ScProposal = { fileName, title, savedAt: updatedAt };
  const existing = await readProposals(dir);
  const idx = existing.findIndex((p) => p.fileName === fileName);
  if (idx !== -1) existing[idx] = entry;
  else existing.unshift(entry);
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

function extractDocumentTag(text: string): { title: string; type: string; format: string; content: string } | null {
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
  } catch {
    /* first slide */
  }
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
  'casual',
  'informal',
  'friendly',
  'warm',
  'conversational',
  'relaxed',
  'formal',
  'professional',
  'corporate',
  'serious',
  'authoritative',
  'assertive',
  'confident',
  'direct',
  'concise',
  'aggressive',
  'bold',
  'consultative',
  'empathetic',
  'collaborative',
  'inclusive',
  'enthusiastic',
  'energetic',
  'passionate',
  'neutral',
  'objective',
  'technical',
  'simple',
  'plain',
  'persuasive',
  'compelling',
  'playful',
]);

/**
 * Scan the current message and recent user messages for an explicit tone/style
 * override request. Returns the matched phrase if found, null otherwise.
 * Checks the current message first (highest recency), then walks back through
 * the last 5 user turns so a tone set earlier in the conversation still wins.
 */
function detectToneOverride(currentMessage: string, history: Array<{ role: string; content: string }>): string | null {
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

function patchProposalSections(original: string, updates: Array<{ heading: string; content: string }>): string {
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
    updates.map((u) => [
      u.heading
        .replace(/^#+\s*/, '')
        .toLowerCase()
        .trim(),
      u,
    ]),
  );

  const patched = sections.map((s) => {
    const key = s.heading
      .replace(/^#+\s*/, '')
      .toLowerCase()
      .trim();
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
      if (confidence < MEMORY_MIN_CONFIDENCE || HEDGE_PATTERN.test(content) || knownNorm.has(content.toLowerCase())) {
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

    log.info({ clientSlug, knowledgeAdded, stakeholdersAdded, skipped }, '[SuperClient] Memory distillation complete');

    if (knowledgeAdded > 0) {
      const updated = await memService.get(clientSlug);
      if (updated) {
        await syncChatMemory(workdir, clientSlug, updated, log).catch((err) => {
          log.warn({ err }, '[SuperClient] chat memory sync failed — memory.json unaffected');
        });
      }
    }

    return { knowledgeAdded, stakeholdersAdded, skipped };
  } catch (err) {
    log.warn({ err }, '[SuperClient] Memory distillation failed — chat unaffected');
    return null;
  }
}

async function seedClientMemory(
  name: string,
  displayName: string,
  sourceMd: string,
  workdir: string,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!sourceMd.trim()) return;
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
${sourceMd.slice(0, 12000)}

Return ONLY valid JSON (null for fields not found):
{
  "stableFields": {
    "clientIndustry": "string or null",
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
      stableFields?: { clientIndustry?: string | null; contactName?: string | null };
      knowledge?: { content: string; category: string; confidence: number }[];
      stakeholders?: { name: string; role: string; email?: string; notes?: string }[];
    };
    const sf = extracted.stableFields ?? {};
    if (sf.clientIndustry?.trim()) await memService.updateField(name, 'clientIndustry', sf.clientIndustry.trim());
    if (sf.contactName?.trim()) await memService.updateField(name, 'contactName', sf.contactName.trim());
    for (const k of extracted.knowledge ?? []) {
      if (k.content?.trim()) {
        await memService.addKnowledge(
          name,
          k.content,
          k.category as ClientKnowledgeEntry['category'],
          k.confidence ?? 0.8,
        );
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
    log.warn({ err }, '[SuperClient] Failed to seed memory from source text');
  }
}

/**
 * Turns team-supplied creation notes into a client-knowledge.md document —
 * no external research, no invented facts, just the notes formatted into
 * clean markdown. Used both when there's no site crawl to merge with, and
 * as the fallback when a crawl runs but yields nothing usable. Falls back to
 * the raw notes verbatim if the LLM call fails, so notes are never lost.
 */
async function generateClientKnowledgeFromNotes(
  displayName: string,
  notes: string,
  generateFn: (prompt: string) => Promise<string>,
): Promise<string> {
  const prompt = `You are writing a client knowledge reference document from a team's own notes about a client. Work ONLY from the notes below — no external research, no invented facts.

Client: ${displayName}

Notes:
${notes}

Write a clean, well-structured markdown document using ## section headers appropriate to the content (e.g. Overview, Key Facts, Goals, Stakeholders) — only include sections the notes actually support. Return ONLY the markdown, no preamble, no code fences.`;

  try {
    const raw = await generateFn(prompt);
    return raw.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  } catch {
    return `# ${displayName} — Client Knowledge\n\n${notes}`;
  }
}

/**
 * Fallback when a real crawl can't be performed (the site blocked automated
 * access, or the crawl produced no usable facts) and there are no notes to
 * fall back on either. Asks the model directly what it knows about the URL —
 * this is NOT a live fetch of the page, so it can only surface whatever the
 * model already knows from training data, and it may know nothing about a
 * small/unindexed business or be stale. The disclaimer at the top of the
 * returned doc is deliberate: unlike the crawl-based summary (fact-cited,
 * verified against the live page), this content is unverified and should be
 * treated as a starting point to confirm with the client, not ground truth.
 */
async function generateClientKnowledgeFromModelKnowledge(
  url: string,
  displayName: string,
  generateFn: (prompt: string) => Promise<string>,
): Promise<string | null> {
  const prompt = `You are a client intelligence researcher. The site at the URL below could not be crawled directly (it may block automated access). Based ONLY on what you already know about this company from your training data, write what you can about it. If you do not have any real knowledge of this specific company, say so plainly instead of guessing or inventing details.

Focus on (only where you have real knowledge): what the company does, industry and target market, notable services/products, tone and positioning, location.

Website URL: ${url}
Company name: ${displayName}

Output clean, well-structured markdown without preamble.`;

  try {
    const raw = await generateFn(prompt);
    const cleaned = raw.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    if (!cleaned) return null;
    return `> ⚠️ This site could not be crawled directly. The information below comes from the model's general knowledge, not a live fetch of the page — verify it with the client before relying on it.\n\n${cleaned}`;
  } catch {
    return null;
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
    } catch {
      /* not found — proceed */
    }

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

    if (notes) {
      await seedClientMemory(name, displayName, notes, workdir, app.log);
    }

    if (url || notes) {
      // Fire-and-forget: a multi-page headless-browser crawl (or even just an
      // LLM call for notes-only clients) can take longer than client creation
      // should block for. status.json makes the background job observable —
      // without it, "still working" and "silently failed" are indistinguishable
      // from the UI and the filesystem.
      const siteFactsDir = path.join(dir, 'site-facts');
      const statusPath = path.join(siteFactsDir, 'status.json');
      const writeStatus = (status: Record<string, unknown>) =>
        writeFile(statusPath, JSON.stringify(status, null, 2)).catch((err) => {
          app.log.warn({ err, name }, '[SuperClient] failed to write site-facts status');
        });

      await mkdir(siteFactsDir, { recursive: true });
      await writeStatus({ status: 'running', ...(url ? { url } : {}), startedAt: new Date().toISOString() });

      const saveClientKnowledge = async (doc: string) => {
        const summaryPath = path.join(dir, 'client-knowledge.md');
        await writeFile(summaryPath, doc);
        await syncClientKnowledge(workdir, name, doc).catch((err) => {
          app.log.warn({ err, name }, '[SuperClient] client-knowledge memory sync failed');
        });
        return summaryPath;
      };

      if (url) {
        void extractSiteFacts(url, { workdir: siteFactsDir, generateFn: llmGenerateFn, log: app.log })
          .then(async (result) => {
            app.log.info({ name, url, ...result }, '[SuperClient] site-facts extraction complete');

            // Generate the narrative summary doc FROM the fact base (never the
            // other way around), then append creation notes as a distinct
            // section — the crawl-derived body keeps its [F#] citations intact,
            // notes are first-party input and don't need citing. Nothing else
            // consumes client-knowledge.md automatically — structured client
            // memory (chatmemory.json) is deliberately left untouched.
            let summaryPath: string | undefined;
            if (result.factsCount > 0) {
              await writeStatus({ status: 'generating_summary', url, startedAt: new Date().toISOString() });
              const [manifest, facts] = await Promise.all([readManifest(result.outputDir), readFacts(result.outputDir)]);
              let doc = await generateSummaryDoc({ siteName: displayName, manifest, facts, generateFn: llmGenerateFn });
              if (notes) doc = `${doc}\n\n## Client-Provided Notes\n\n${notes}\n`;
              summaryPath = await saveClientKnowledge(doc);
            } else if (notes) {
              // Crawl found nothing usable — notes still produce a doc rather
              // than being silently dropped.
              const doc = await generateClientKnowledgeFromNotes(displayName, notes, llmGenerateFn);
              summaryPath = await saveClientKnowledge(doc);
            } else {
              // Crawl finished but produced nothing usable (0 facts) and there
              // are no notes to fall back on — most commonly the site blocked
              // the crawler (bot-detection challenge page, robots.txt disallow,
              // or a JS-only shell that never rendered real content). Fall back
              // to asking the model directly what it already knows about the
              // company (clearly disclaimed as unverified, see
              // generateClientKnowledgeFromModelKnowledge) rather than leaving
              // client-knowledge.md unwritten — without ANY doc, virtualDocEntry
              // reads a 'complete' status with a missing file as "the user
              // deleted it" and omits the doc entirely, leaving the UI's
              // narration stuck showing "Crawling..." forever with no
              // terminal state to settle on.
              app.log.warn(
                { name, url, pagesCrawled: result.pagesCrawled },
                '[SuperClient] site-facts crawl produced no usable facts — falling back to model knowledge',
              );
              const doc = await generateClientKnowledgeFromModelKnowledge(url, displayName, llmGenerateFn);
              if (doc) {
                summaryPath = await saveClientKnowledge(doc);
              } else {
                await writeStatus({
                  status: 'failed',
                  url,
                  pagesCrawled: result.pagesCrawled,
                  factsCount: result.factsCount,
                  outputDir: result.outputDir,
                  error:
                    result.pagesCrawled <= 1
                      ? 'The site could not be crawled — it may be blocking automated access (bot-detection challenge) or the page never rendered real content.'
                      : 'The site was crawled but no usable facts could be extracted from its pages.',
                  finishedAt: new Date().toISOString(),
                });
                return;
              }
            }

            const factsFields = {
              url,
              pagesCrawled: result.pagesCrawled,
              factsCount: result.factsCount,
              outputDir: result.outputDir,
              ...(summaryPath ? { summaryPath } : {}),
            };

            // Facts + summary are the only things this chain ever does now.
            // Design-tokens and image-context are independent, on-demand
            // modules (see POST .../design-system and .../image-context below)
            // — triggered only when a user actually wants a microsite inspired
            // by this client, not unconditionally for every URL.
            await writeStatus({ status: 'complete', ...factsFields, finishedAt: new Date().toISOString() });
          })
          .catch(async (err) => {
            app.log.warn({ err, name, url }, '[SuperClient] site-facts extraction failed');
            let summaryPath: string | undefined;
            if (notes) {
              // The crawl itself failed outright — notes still produce a doc.
              const doc = await generateClientKnowledgeFromNotes(displayName, notes, llmGenerateFn);
              summaryPath = await saveClientKnowledge(doc);
            } else {
              // No notes either — fall back to the model's own (disclaimed,
              // unverified) knowledge of the company rather than leaving
              // client-knowledge.md unwritten. Status still records 'failed'
              // (the crawl itself really did error out), but virtualDocEntry
              // checks real file existence before consulting that status, so
              // a successfully produced fallback doc still surfaces as a
              // normal, usable document in the UI.
              const doc = await generateClientKnowledgeFromModelKnowledge(url, displayName, llmGenerateFn);
              if (doc) summaryPath = await saveClientKnowledge(doc);
            }
            await writeStatus({
              status: 'failed',
              url,
              ...(summaryPath ? { summaryPath } : {}),
              error: err instanceof Error ? err.message : String(err),
              finishedAt: new Date().toISOString(),
            });
          });
      } else {
        // No URL — client-knowledge.md is generated straight from notes.
        void (async () => {
          try {
            await writeStatus({ status: 'generating_summary', startedAt: new Date().toISOString() });
            const doc = await generateClientKnowledgeFromNotes(displayName, notes!, llmGenerateFn);
            const summaryPath = await saveClientKnowledge(doc);
            await writeStatus({ status: 'complete', summaryPath, finishedAt: new Date().toISOString() });
          } catch (err) {
            app.log.warn({ err, name }, '[SuperClient] notes-only client-knowledge generation failed');
            await writeStatus({
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
              finishedAt: new Date().toISOString(),
            });
          }
        })();
      }
    }

    return reply.code(201).send({ name, displayName });
  });

  // POST /super-clients/:name/design-system  — on-demand, independent of client creation
  app.post('/super-clients/:name/design-system', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    let meta: SuperClientMeta;
    try {
      meta = await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
    const force = !!(req.body as { force?: boolean } | undefined)?.force;

    const result = await triggerOnDemandJob({
      dir,
      name,
      statusFileName: 'design-status.json',
      jobLabel: 'design-system',
      force,
      log: app.log,
      run: async (siteFactsOutputDir) => {
        const outputFilePath = path.join(dir, 'design-system.md');
        const dr = await extractDesignSystem({
          siteFactsOutputDir,
          siteName: meta.displayName,
          outputFilePath,
          generateFn: llmGenerateFn,
          log: app.log,
        });
        return {
          pagesAnalyzed: dr.pagesAnalyzed,
          tokenCount: dr.tokenCount,
          screenshotCount: dr.screenshotCount,
          visionSucceeded: dr.visionSucceeded,
        };
      },
    });
    return reply.code(result.code).send(result.body);
  });

  // POST /super-clients/:name/image-context  — on-demand, fully disjoint from design-system
  app.post('/super-clients/:name/image-context', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
    const force = !!(req.body as { force?: boolean } | undefined)?.force;

    const result = await triggerOnDemandJob({
      dir,
      name,
      statusFileName: 'image-context-status.json',
      jobLabel: 'image-context',
      force,
      log: app.log,
      run: async (siteFactsOutputDir) => {
        const outputFilePath = path.join(dir, 'image-context.md');
        const ic = await extractImageContext({ siteFactsOutputDir, outputFilePath, generateFn: llmGenerateFn, log: app.log });
        return { imageCount: ic.imageCount };
      },
    });
    return reply.code(result.code).send(result.body);
  });

  // GET /super-clients/:name
  app.get('/super-clients/:name', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);

    try {
      const [meta, history] = await Promise.all([readMeta(dir), readHistory(dir)]);
      return reply.send({ meta, history });
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
  });

  // GET /super-clients/:name/enrichment-status
  // Polled by the create-client UI so it can show real background-job
  // progress (crawl -> client-knowledge -> design-system) instead of guessing.
  app.get('/super-clients/:name/enrichment-status', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const statusPath = path.join(superClientsRoot, name, 'site-facts', 'status.json');

    try {
      const raw = await readFile(statusPath, 'utf-8');
      return reply.send(JSON.parse(raw));
    } catch {
      // No status.json means either the client was created without a URL
      // (nothing to enrich) or the file hasn't been written yet.
      return reply.send({ status: 'none' });
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
    const body = req.body as
      | {
          message?: string;
          activeProposalId?: string;
          activeDocumentId?: string;
          confirmedMemoryIds?: unknown;
          attachedFileNames?: unknown;
        }
      | undefined;

    const message = body?.message?.trim();
    const activeProposalId = body?.activeProposalId?.trim() || undefined;
    const activeDocumentId = body?.activeDocumentId?.trim() || undefined;
    // Explicit, structured confirmation from the memory checklist card's
    // Generate button — bypasses the short-reply-text heuristic entirely,
    // since the exact set the user checked is unambiguous here regardless
    // of message wording/length.
    const confirmedMemoryIds = Array.isArray(body?.confirmedMemoryIds)
      ? body.confirmedMemoryIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    // Server-assigned filename(s) of any file(s) the composer uploaded in
    // this same send action, synchronously, right before this request.
    const attachedFileNames = Array.isArray(body?.attachedFileNames)
      ? body.attachedFileNames.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
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
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: unknown) => {
      // No em/en dashes in any chat-visible text (Golden UX rule for this surface).
      if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        if (typeof d.text === 'string') d.text = stripDashes(d.text);
        if (typeof d.message === 'string') d.message = stripDashes(d.message);
      }
      try {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* client gone */
      }
    };

    try {
      const [history, memResult, scFiles, authorVoiceBlock, designKit, orgSettings, relevantMemorySelection, memoryIndex] =
        await Promise.all([
          readHistory(dir),
          new ClientMemoryService(workdir).prepopulate(name),
          readScFiles(dir),
          resolveVoiceBlock(workdir, superClientWorkdir(workdir, name)),
          resolveDesignKit(workdir, superClientWorkdir(workdir, name)),
          readOrgContextSettings(workdir),
          selectRelevantMemory(workdir, name),
          new DocumentMemoryService(workdir).readIndex(name),
        ]);

      // Captured once, right after history is available, so both the memory
      // override below and the intent gate's own resume logic read the same
      // pending marker without re-scanning history twice.
      const priorPendingClarification = lastAssistantPending(history);

      // A pending marker merely existing does NOT mean this message answers
      // it — the user may have ignored the question entirely and pasted a
      // brand-new, full request instead (which reads as "confirmed, with
      // detail" to the intent classifier just as readily as an actual "yes"
      // would). An explicit confirmedMemoryIds (the checklist's Generate
      // button) always counts as answered, unambiguously; otherwise require
      // the reply to also look like a short, direct answer ("yes", "go
      // ahead", …) — a resend of the original request must still trigger a
      // fresh question, not silently reuse a stale one.
      const isDirectReply = message.length <= 50;
      const isConfirmedMemoryReply =
        !!priorPendingClarification?.includedMemoryIds && (confirmedMemoryIds.length > 0 || isDirectReply);
      // A short reply answering the earlier ambiguity-clarify question (e.g.
      // clicking "Create a proposal") carries none of the user's real content
      // either — same problem as the memory-checklist confirm above, one hop
      // earlier in the flow. Scoped to priorPendingClarification actually
      // existing (we asked a clarifying question last turn), so an unrelated
      // short message on a fresh turn is never mistaken for a resume.
      const isResumedAmbiguityClarify =
        !!priorPendingClarification && !priorPendingClarification.includedMemoryIds && isDirectReply;

      // On a resumed/confirmed turn (the memory checklist's Generate button,
      // OR a button click answering the earlier ambiguity question),
      // `message` is a short fixed label — it carries none of the user's
      // actual instruction or any pasted material (transcript, RFP text,
      // etc.). Substitute the original triggering message for every
      // downstream read of message CONTENT. Never substitute it for history
      // persistence, isDirectReply, or the intent-gate call — those are keyed
      // to what the user actually typed/clicked this turn, and
      // classifyChatIntent already resolves resumes correctly via the
      // pending marker's skillSlug/proposedIntent without needing the raw
      // text.
      // First pass — naive, length-only heuristic. Used below only for the
      // matchedDocumentSkill hint and the classifyChatIntent call itself
      // (both soft signals); corrected once `decision` is known, see the
      // isGenuineResume check right after the classifyChatIntent call.
      let effectiveMessage =
        (isConfirmedMemoryReply || isResumedAmbiguityClarify) && priorPendingClarification?.originalMessage
          ? priorPendingClarification.originalMessage
          : message;
      let detectedFormat = parseRequestedFormat(effectiveMessage);
      // Same substitution, for the file(s) attached alongside the original
      // triggering message — a resumed turn's own request carries no fresh
      // attachments of its own.
      let effectiveAttachedFileNames =
        (isConfirmedMemoryReply || isResumedAmbiguityClarify) && priorPendingClarification?.attachedFileNames?.length
          ? priorPendingClarification.attachedFileNames
          : attachedFileNames;

      // A confirmed reply carries no topical content of its own, so reuse
      // exactly what the user selected/approved on the checklist instead of
      // whatever the fresh (unfiltered) list would otherwise return.
      // confirmedMemoryIds (explicit, from the Generate button) wins over
      // the pending marker's default set when both are present. Mutable —
      // the explicit-file-selection check below (right before the checklist
      // would otherwise fire) can also override this on a FRESH turn when
      // the user's own message already names which files to use.
      let relevantMemoryDocs = isConfirmedMemoryReply
        ? await getMemoryDocsByIds(
            workdir,
            name,
            confirmedMemoryIds.length > 0 ? confirmedMemoryIds : priorPendingClarification!.includedMemoryIds!,
          )
        : relevantMemorySelection.included;
      const memoryRelevanceDecisions = relevantMemorySelection.decisions;

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
            content: stripDashes(assistantText),
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
        matchedDocumentSkill = await findBestDocumentSkill(workdir, effectiveMessage);
        if (matchedDocumentSkill) {
          const loaded = await loadSkill(workdir, matchedDocumentSkill.slug);
          matchedSkillInstructionsMd = loaded?.instructionsMd;
          matchedSkillSections = loaded?.sections;
        }
      } catch {
        // Non-critical — skill matching failure should not block generation
      }

      const msgLower = message.toLowerCase();
      // Whether a proposal/document happens to be open in the artifact viewer.
      // This must NOT by itself mean "this turn is an edit" — see isEdit below.
      const artifactOpen = !!(activeProposalId || activeDocumentId);

      // ── Intent gate ────────────────────────────────────────────────────────
      // Runs on EVERY turn, including when a proposal/document is open. An open
      // artifact used to force every message down the edit path unconditionally
      // (isEdit = !!(activeProposalId || activeDocumentId)) — so "write a new
      // blog post" sent while an old document happened to be open silently
      // patched that old document instead of creating a new one (no generation
      // card, no planning/progress events, since the whole intent gate and
      // generation-turn machinery were skipped). Now the classifier is told an
      // artifact is open and decides whether this message continues editing it
      // (-> "answer", isEdit stays true below) or asks for something new (-> a
      // generate_* intent, isEdit becomes false and this runs as a fresh
      // generation even though something is open).
      let decision: IntentDecision;
      {
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
          pendingClarification: priorPendingClarification,
          attachedFileNames: effectiveAttachedFileNames,
          activeArtifact: artifactOpen ? { type: activeProposalId ? 'proposal' : 'document' } : undefined,
          generateFn: llmGenerateFn,
        });

        // The naive isConfirmedMemoryReply/isResumedAmbiguityClarify check
        // above (short-message-length only) cannot distinguish a genuine
        // resume from a short but entirely new, unrelated request — e.g.
        // "create a blog post" is short and satisfies isResumedAmbiguityClarify
        // just as readily whether or not a stale, unrelated clarify question
        // from a completely different earlier request (e.g. a prior
        // proposal's file conflict) is still sitting unanswered. Now that
        // the classifier's own independent (raw-message) decision is known,
        // tighten the substitution: trust it as a genuine resume only if the
        // decision actually continues the SAME proposed intent as the
        // pending marker (an explicit confirmedMemoryIds click is always
        // genuine regardless, per the comment above). Otherwise this is a
        // fresh request and the stale originalMessage/attachedFileNames must
        // not leak into it — this exact collision once generated
        // proposal-shaped content for a "create a blog post" request, from a
        // stale unrelated pending clarification two turns back.
        const isGenuineResume =
          (isConfirmedMemoryReply &&
            (confirmedMemoryIds.length > 0 || decision.intent === priorPendingClarification?.proposedIntent)) ||
          (isResumedAmbiguityClarify && decision.intent === priorPendingClarification?.proposedIntent);
        if (!isGenuineResume && priorPendingClarification) {
          effectiveMessage = message;
          detectedFormat = parseRequestedFormat(effectiveMessage);
          effectiveAttachedFileNames = attachedFileNames;
        }

        // Terminal intents — respond and stop before any generation.
        if (decision.intent === 'off_topic') {
          const text = `I'm focused on ${meta.displayName} — I can help you create proposals, documents, presentations, or microsites for them, or answer questions about their business. What would you like to do for ${meta.displayName}?`;
          await streamAssistant(text);
          await persistTurn(text);
          send({ type: 'done', text });
          return;
        }
        if (decision.intent === 'clarify') {
          const text =
            decision.clarifyingQuestion ?? `Just to confirm, what would you like me to do for ${meta.displayName}?`;
          const options = decision.clarifyOptions ?? [];
          // Carry ONLY a deterministically-matched skill into the pending marker
          // (never the LLM's guess) so a confirmed resume can't re-apply a skill
          // the request never actually matched.
          const pendingSkillSlug = matchedDocumentSkill?.slug;
          const pending: PendingClarification | undefined = decision.proposedIntent
            ? {
                proposedIntent: decision.proposedIntent,
                ...(pendingSkillSlug ? { skillSlug: pendingSkillSlug } : {}),
                ...(decision.format ? { format: decision.format } : {}),
                // Preserve the actual triggering text (which may be pasted
                // material — notes, a transcript, an RFP) so a later resume
                // (button click, or the memory checklist after it) doesn't
                // lose it in favor of a short "Create a proposal" label.
                originalMessage: message,
                ...(attachedFileNames.length ? { attachedFileNames } : {}),
              }
            : undefined;
          // A question renders as a distinct card, not streamed text — emit it as a
          // single `done` so the UI shows it cleanly (isClarify) with any options.
          await persistTurn(text, pending);
          send({
            type: 'done',
            text,
            isClarify: true,
            ...(options.length ? { clarifyOptions: options } : {}),
          });
          return;
        }
        if (decision.intent === 'generate_microsite') {
          const text =
            proposalsList.length > 0
              ? 'Pick a proposal below to generate its microsite.'
              : `You'll need a proposal first, ask me to generate one for ${meta.displayName}, then I can turn it into a microsite.`;
          // Microsites are built by selecting a proposal in the composer (backend
          // can't generate them). Signal the UI to open the proposal selector
          // instead of leaving a dangling "pick a proposal below" text with no picker.
          await persistTurn(text);
          send({ type: 'done', text, isMicrosite: true, hasProposals: proposalsList.length > 0 });
          return;
        }

        // ── Context-readiness gate ─────────────────────────────────────────
        // A generation request against a client with NO stored context
        // (ingested docs, client knowledge, memory) would leave the LLM with
        // only the display name — it hallucinates a generic artifact. Decline
        // bare requests with guidance (mirrors the microsite "need a proposal
        // first" gate). A request that carries its own project details
        // bypasses the gate: the message itself is the context.
        const GATED_INTENTS: ReadonlySet<string> = new Set([
          'generate_proposal',
          'generate_document',
          'generate_presentation',
        ]);
        if (GATED_INTENTS.has(decision.intent)) {
          // Checks the memory-folder INDEX (every doc that exists), not
          // relevantMemoryDocs (which is relevance-filtered against this
          // specific message and could legitimately come back empty for a
          // generic bare request even when real content exists).
          //
          // Also checks the conversation itself: a prior turn may have
          // pasted substantial material (working notes, a transcript) that
          // was never uploaded as a file or distilled into memory — it only
          // exists as chat history. That happens whenever a clarify/answer
          // exchange sits between the paste and the eventual short "create
          // X" — effectiveMessage only recovers ONE prior turn (the one
          // immediately behind a clarify pending marker), so a longer
          // back-and-forth would otherwise still read as context-free here
          // even though the actual generation prompt below already includes
          // the last 20 turns of history regardless.
          const hasSubstantiveHistoryContent = history.some(
            (h) => h.role === 'user' && h.content.trim().length > 200,
          );
          const hasStoredContext =
            extractedFiles.length > 0 ||
            memoryIndex.length > 0 ||
            hasSubstantiveHistoryContent ||
            (memResult.found &&
              (Object.keys(memResult.stableFields).length > 0 ||
                memResult.knowledge.length > 0 ||
                memResult.stakeholders.length > 0));
          if (!hasStoredContext && isBareGenerationRequest(effectiveMessage, matchedDocumentSkill?.triggers)) {
            const artifactLabel =
              decision.intent === 'generate_proposal'
                ? 'proposal'
                : decision.intent === 'generate_presentation'
                  ? 'presentation'
                  : 'document';
            const text = `I don't have any context for ${meta.displayName} yet, so anything I draft would be generic. Add notes in the Context tab, upload documents (briefs, transcripts, emails), or describe the project in your message — e.g. "create a ${artifactLabel} for their website redesign, 3 phases, $50k budget" — and I'll draft from that.`;
            await streamAssistant(text);
            await persistTurn(text);
            send({ type: 'done', text });
            return;
          }
        }
      }

      // Resolved AFTER classification: an open artifact only makes this an
      // "edit" turn when the classifier actually read the message as
      // continuing to work on that open item (intent 'answer') rather than a
      // fresh request for a new proposal/document/presentation. This drives
      // the "Currently Open Proposal/Document" prompt injection + editing-tier
      // rules below, and the save-vs-update branching further down — both used
      // to key off raw activeProposalId/activeDocumentId presence instead.
      const isEdit =
        artifactOpen &&
        decision.intent !== 'generate_proposal' &&
        decision.intent !== 'generate_document' &&
        decision.intent !== 'generate_presentation';

      // The document skill is determined deterministically by findBestDocumentSkill
      // on the message (matchedDocumentSkill) — the LLM never gets to pick it, or it
      // hallucinates skills (e.g. "catalogue" -> "Marketing Brief"). The ONLY skill
      // reload allowed is for a rule-sourced decision: a resumed clarification ("yes
      // go ahead"), whose reply text matches no skill but whose pending marker
      // carries the skill that WAS deterministically matched on the original request.
      if (
        !isEdit &&
        decision?.source === 'rule' &&
        decision?.skillSlug &&
        matchedDocumentSkill?.slug !== decision.skillSlug
      ) {
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
        ? matchedDocumentSkill?.slug === 'presentation' || detectPresentationIntent(message)
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
      const portraitDesignNote = `- PORTRAIT FORMAT (9:16): every slide is tall and narrow like a phone screen / story frame. Stack content vertically with generous spacing; prefer justify-content:space-between or flex-start over always centering. Keep one focused idea per slide, oversized headlines, and design for a vertical mobile reading experience.`;

      // Fresh microsite generation only (never edits — those must stay precise and
      // reproducible). Drives both the per-generation art direction and the raised
      // sampling temperature below.
      const isMicrositeGeneration = !isEdit && decision?.intent === 'generate_presentation';

      // Per-generation art direction — the deck framing is otherwise identical every
      // run, which (at temperature 0) made every microsite converge on the same
      // default aesthetic. Picking a distinct creative lens each time forces variety
      // ACROSS decks. It is a starting lens, not a content constraint — the model
      // still adapts it to the client's industry and brand.
      const ART_DIRECTIONS: string[] = [
        `ART DIRECTION FOR THIS DECK — EDITORIAL / MAGAZINE: treat each slide like a spread in a high-end print magazine. Strong typographic hierarchy, a real grid, pull-quotes, generous margins, refined serif or serif+grotesque pairing, restrained accent colour.`,
        `ART DIRECTION FOR THIS DECK — SWISS / INTERNATIONAL MINIMAL: rigorous grid, a single confident sans-serif, lots of white space, precise alignment, one accent colour used sparingly, information-first with quiet elegance.`,
        `ART DIRECTION FOR THIS DECK — BOLD BRUTALIST: raw, high-contrast, oversized type, hard edges, visible structure, unexpected asymmetry, mono or grotesque type, deliberate tension. Confident and loud, never messy.`,
        `ART DIRECTION FOR THIS DECK — DARK CINEMATIC / PREMIUM: deep dark backgrounds, dramatic lighting and depth, luminous accents, spacious composition, elegant contrast, a premium high-trust mood.`,
        `ART DIRECTION FOR THIS DECK — GEOMETRIC / BAUHAUS: primary shapes, bold geometry, blocky colour fields, strong diagonals, playful-yet-structured composition, functional clarity.`,
        `ART DIRECTION FOR THIS DECK — WARM ORGANIC / SOFT: rounded forms, soft shadows, warm approachable palette, friendly humanist type, gentle gradients, generous curves — inviting and human.`,
        `ART DIRECTION FOR THIS DECK — DATA-DRIVEN / DASHBOARD: crisp, structured, metric-forward. Confident numbers, clean charts/stat blocks, tight modular cards, technical-but-refined type — reads as authoritative and precise.`,
        `ART DIRECTION FOR THIS DECK — LUXURY / REFINED: understated opulence, elegant serif display type, fine hairline rules, muted sophisticated palette with a metallic or jewel accent, lots of breathing room.`,
      ];
      const artDirection = isMicrositeGeneration
        ? ART_DIRECTIONS[Math.floor(Math.random() * ART_DIRECTIONS.length)]
        : null;

      // Slide count is resolved once here (from the raw user message) so both
      // the prompt and the planning/ack text downstream agree on the actual,
      // capped number — a single-shot presentation call must fit the whole
      // deck's HTML inside the provider's output-token ceiling, so an
      // unclamped large count is a leading cause of truncated generation.
      const { requested: requestedSlideCount, resolved: resolvedSlideCount, wasCapped: slideCountWasCapped } =
        resolveSlideCount(effectiveMessage);

      // Applied in BOTH prompt branches below (see the "NEVER ask the user to
      // re-upload..." anchor line in each) — makes "the chosen material
      // doesn't hold up → decline and ask" an explicit, encouraged outcome
      // rather than an implicit side effect of "no tag found in the reply."
      // The mechanism for a decline to render as a plain conversational
      // reply already exists (no <proposal>/<document>/<slides> tag in the
      // response falls through to a normal answer) — this only tells the
      // model that choosing it here is correct, not a failure.
      const MATERIAL_CHECK_RULE =
        `MATERIAL CHECK RULE — apply this before anything else below: Weigh the selected files (Relevant Memory), client memory, and the user's request against each other. If they do not hold up together — the material is about a different, unrelated business or engagement; it is missing what the request actually needs; or it contradicts the request — do NOT force an artifact out of it. Respond in plain conversational text instead (no <proposal>, <document>, or <slides> tag), name the specific problem, and ask how to proceed. This is a correct, encouraged outcome, not a failure — a clear decline beats a confident artifact built on the wrong material. Example: a selected file is a proposal for an unrelated company — flag the mismatch and ask whether to exclude it rather than weaving it into this client's proposal. If instead you decide TO proceed despite gaps (using placeholders for missing specifics) — the user has already been told upfront by a separate pre-flight check, so do NOT re-explain what's missing in prose outside the tag; mark gaps inline within the artifact itself (e.g. "[Insert fee schedule]") and keep any surrounding text to a short one-line confirmation.`;

      // Build combined prompt — llmGenerateFn takes a single string and routes through
      // the Python LLM bridge which respects LLM_PROVIDER / provider-specific model config.
      const promptParts: string[] = isPresentationRequest
        ? [
            // ── PRESENTATION MODE — no proposal/document rules ──────────────────
            // Deliberately minimal: the ONLY fixed rules are the technical frame that
            // lets the deck render/save (scroll layout, slide box, aspect ratio, 8px
            // gap, self-contained-enough HTML) plus quality guardrails (no broken
            // words, diverse slides). EVERYTHING visual — background, colour,
            // typography, layout, shadows — is the designer's invention. Do not
            // reintroduce prescriptive design rules or an example deck here; that is
            // what made every deck look the same.
            `You are a world-class senior UI, brand, and product designer creating a bespoke slide presentation for a team that manages the client "${meta.displayName}".`,
            ``,
            `Read the client context, ingested documents, and memory below and infer this client's industry, brand, and audience. Then design a visual language that genuinely fits THEM — a fintech or consulting client wants refined, restrained, high-trust design; a consumer or creative brand wants bold, expressive, unexpected design. Every deck you make should look custom-designed for this specific client, not like a template. Aim for award-winning, magazine-grade craft: intentional typography, confident use of colour and space, and real visual hierarchy.`,
            ...(artDirection
              ? [
                  ``,
                  artDirection,
                  `Commit to this art direction across the whole deck, but bend it to fit the client — if it clashes with their industry or brand, adapt it rather than abandon coherence.`,
                ]
              : []),
            ``,
            `NEVER ask the user to re-upload previously uploaded files — their content, once processed, appears in the Relevant Memory section below.`,
            ``,
            MATERIAL_CHECK_RULE,
            ``,
            `SLIDES GENERATION RULE — this is the ONLY output format for this request:`,
            `Output ONE complete standalone HTML document wrapped in <slides>...</slides>. Do NOT use <proposal> or <document> tags. Do NOT output markdown.`,
            ``,
            `You have FULL creative freedom over the visual design. The following are the ONLY hard rules — everything else is yours to invent:`,
            `- Full HTML document: <!DOCTYPE html> … </html>, with a <title> = the presentation title.`,
            `- VERTICAL SCROLL DECK: every slide stacks top-to-bottom in one scrollable page and is always visible. No JS navigation, visibility toggling, click zones, keyboard nav, or slide transitions — scrolling is the only navigation.`,
            `- Give every slide element the class "slide", each width:100% and aspect-ratio:${slideAspect} (${slideHeightNote}). Wrap all slides in a single container div with class "deck" (display:flex; flex-direction:column).`,
            `- Gap between slides: exactly 8px.`,
            `- Each slide is a self-contained box. Keep every slide's content inside its own slide — nothing may overflow into or overlap the slide before or after it. Within a single slide you MAY use position:absolute to layer and compose freely (the slide clips its own overflow).`,
            `- Inline the deck's own CSS and JS. You MAY load external web fonts (e.g. Google Fonts via <link>) and remote images / icons / CDNs for polish — always include a system-font fallback in every font-family stack so the deck still looks intentional if a font fails to load.`,
            `- NEVER break a single word across two lines. Do NOT use word-break:break-all, overflow-wrap:break-word/anywhere, or hyphens. Text wraps only at spaces; if a word would overflow, reduce its font-size or widen the column — never split or clip it.`,
            `- Make every slide visually distinct. No two slides should share the same layout.`,
            ...(isPortrait ? [portraitDesignNote] : []),
            ``,
            `CONTENT:`,
            `- Draw ALL facts from client context, ingested documents, and conversation. Never invent facts.`,
            `- Slide titles are insights, not labels — "Revenue grew 3× in 12 months" beats "Revenue Growth".`,
            resolvedSlideCount
              ? `- Create exactly ${resolvedSlideCount} slides.`
              : `- Create AT LEAST 10 slides (aim for 10–12, more if the content genuinely needs it). Every slide must still be substantive — expand the story with deeper sections, data, and examples rather than padding with thin filler slides.`,
            ``,
            `Output: ONLY the <slides>...</slides> tag with the full HTML document inside. After the tag, write ONE plain sentence (MAX 25 words) describing only WHAT the deck covers — the subject and message — as if telling a colleague over the phone. It must contain NO visual or design detail. BANNED words: slide, deck, 16:9, cover, hero, headline, panel, grid, card, column, CTA, footer, bar, layout, SVG, palette, and every colour name. Example: "A quick overview of your services and why clients trust you, ending with an invitation to book a consultation."`,
          ]
        : [
            // ── STANDARD MODE — proposal + document rules ────────────────────────
            `You are a senior business development consultant and proposal strategist with 20+ years of experience crafting winning proposals across diverse industries. You are working on behalf of a team that manages the client "${meta.displayName}".`,
            ``,
            `For general questions: respond concisely with strategic insight. Stay focused on this client's world — their business, goals, audience, and brand.`,
            ``,
            `PARAGRAPH RULE: Do not split a short answer into multiple paragraphs just for the sake of it. A quick answer, greeting, or acknowledgement should be ONE paragraph. Only start a new paragraph when you are genuinely moving to a distinct point, section, or list — never as a stylistic habit.`,
            ``,
            `For proposals and formal documents: Write at a professional C-suite level. Use strong opening statements, evidence-based arguments, and compelling calls to action. Structure content with clear headings and purposeful body text — no filler, no generic statements. Draw exclusively from the client memory and ingested documents below; never invent facts not present in the context.`,
            ``,
            `NEVER ask the user to re-upload previously uploaded files — their content, once processed, appears in the Relevant Memory section below.`,
            ``,
            MATERIAL_CHECK_RULE,
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
            `3. Outside the tag, write ONE short, plain-language sentence telling the user what the document covers — its topic and main takeaway. Do not describe formatting or structure. Keep it simple and friendly.`,
            `Do NOT put any explanation or preamble inside the tag — only the markdown document body.`,
            `IMPORTANT: Use <document> for text-based documents (blogs, strategy docs, reports, briefs).`,
            ``,
            `PROPOSAL GENERATION RULE: When the user asks you to write, create, generate, or draft a proposal (and no proposal is currently open for editing), you MUST:`,
            `1. Act as a professional proposal writer. Decide the structure, sections, and length yourself, based on what this specific engagement and client actually need — do not force a fixed template or a predetermined set of sections.`,
            `2. Ground every claim strictly in the client memory, relevant memory, ingested documents, and conversation below — including anything the user pasted directly into this message (e.g. a meeting transcript). Never invent a fact that is not supported by that material; if something needed isn't present, note that plainly rather than guessing.`,
            `3. Write the full proposal in rich markdown — headings, **bold** for key terms — at a professional C-suite level, with strong opening statements, evidence-based arguments, and compelling calls to action.`,
            `4. Wrap the ENTIRE proposal markdown inside a single XML tag like this:`,
            `<proposal title="Descriptive Proposal Title">`,
            `[full markdown content here]`,
            `</proposal>`,
            `5. Outside the tag, write ONE short, plain-language sentence describing what the proposal covers — its focus and value, not its formatting.`,
            `Do NOT put any explanation or preamble inside the tag — only the markdown proposal body.`,
          ];

      // If the user has a proposal open AND this turn is actually continuing to
      // edit it (isEdit, resolved above from the classifier's decision — not
      // just raw activeProposalId presence), load it and inject the editing rule.
      let activeProposalContent: string | undefined;
      if (isEdit && activeProposalId) {
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

      // Same as above, for a document (isEdit, not raw activeDocumentId presence).
      let activeDocumentContent: string | undefined;
      if (isEdit && activeDocumentId) {
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

      // Org-level Author Voice — STYLE ONLY (no client facts). Injected when the
      // org has learned a voice from past proposals and the toggle is on.
      if (orgSettings.applyAuthorVoice && authorVoiceBlock) {
        promptParts.push(`\n${authorVoiceBlock}`);

        const toneOverride = detectToneOverride(effectiveMessage, history);
        if (toneOverride) {
          promptParts.push(
            `\n⚡ USER TONE OVERRIDE ACTIVE: The user has requested "${toneOverride}". This takes absolute priority over every tone, voice, and style directive in the Author Voice block above. Ignore those style directives entirely and apply the user's requested style instead. You may still use structural patterns (section order, headings) from the Author Voice if they don't conflict with the user's request.`,
          );
        }
      }

      // Org-level Design Kit — VISUAL guidance only, presentation mode only.
      // Injected as a soft brand anchor (NOT a mandate) so it nudges palette /
      // typography toward the org's house style while preserving the designer's
      // freedom to adapt to THIS client. Gated by the applyDesignKit toggle.
      if (isMicrositeGeneration && orgSettings.applyDesignKit && designKit) {
        const kitLines: string[] = [];
        if (designKit.primaryColor) {
          kitLines.push(
            `- Preferred brand accent: ${designKit.primaryColor}. Use it as the primary accent unless this client's own brand clearly calls for something else.`,
          );
        }
        if (designKit.palette?.length) {
          kitLines.push(`- House palette to draw from: ${designKit.palette.join(', ')}.`);
        }
        if (designKit.fontHints?.length) {
          kitLines.push(`- Typography leanings: ${designKit.fontHints.join(', ')}.`);
        }
        if (designKit.designBrief?.trim()) {
          kitLines.push(`- Design brief: ${designKit.designBrief.trim()}`);
        }
        if (kitLines.length) {
          promptParts.push(
            `\n## Org Brand Design Kit (visual anchor — not a mandate)`,
            `This org has a learned house style from past brand assets. Treat it as the starting point for the deck's visual language, then adapt it so the result still feels custom-designed for ${meta.displayName} and their industry. It informs color, palette, and typography only — never invent facts from it.`,
            ...kitLines,
          );
        }
      }

      if (
        memResult.found &&
        (Object.keys(memResult.stableFields).length > 0 ||
          memResult.knowledge.length > 0 ||
          memResult.stakeholders.length > 0)
      ) {
        const memParts: string[] = [
          '\n## Accumulated Client Memory\nExtracted from ingested documents and prior conversations. Treat this as authoritative source material.',
        ];

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
            memParts.push(
              `- **${s.name}** (${s.role})${s.email ? ` — ${s.email}` : ''}${s.notes ? `: ${s.notes}` : ''}`,
            );
          }
        }
        promptParts.push(memParts.join('\n'));
      }

      if (relevantMemoryDocs.length > 0) {
        const memoryBlock = relevantMemoryDocs
          .map((d) => `### ${d.entry.fileName} (${d.entry.type})\n${d.markdown.trim()}`)
          .join('\n\n');
        promptParts.push(
          `\n## Relevant Memory\nSelected as relevant to the current message, from ingested documents, prior chat knowledge, and site knowledge:\n\n${memoryBlock}`,
        );
      }

      // Flags which of the items above were attached directly alongside the
      // current instruction (vs. older stored context) — a signal for the
      // MATERIAL CHECK RULE, not a gate: attached files still go through the
      // same checklist as everything else and can still be deselected.
      if (effectiveAttachedFileNames.length > 0) {
        const attachedSet = new Set(effectiveAttachedFileNames);
        const attachedLabels = relevantMemoryDocs
          .filter((d) => d.entry.sourceId && attachedSet.has(d.entry.sourceId))
          .map((d) => d.entry.fileName);
        if (attachedLabels.length > 0) {
          promptParts.push(
            `\n## Files Attached With This Message\nThe user attached the following file(s) directly alongside their current message/instruction (see "Relevant Memory" above for full content) — weigh them as the primary subject of this request, not incidental background, when applying the MATERIAL CHECK RULE:\n${attachedLabels.map((f) => `- ${f}`).join('\n')}`,
          );
        }
      }

      // CSV data is never dumped into the prompt in bulk (see convertCsvToMemoryDoc —
      // its memory doc is just a schema + small sample) — instead, when a CSV is
      // relevant to this turn, a small purpose-built LLM call decides whether the
      // message needs precise data from it and, if so, emits a filter/aggregate spec
      // that's executed deterministically against the real rows. Runs for both chat
      // answers and generation turns, since both share this same prompt build.
      const csvDocs = relevantMemoryDocs.filter(
        (d) => d.entry.type === 'upload' && d.entry.sourceId && path.extname(d.entry.fileName).toLowerCase() === '.csv',
      );
      if (csvDocs.length > 0) {
        const queryBlock = await maybeQueryCsvs(
          effectiveMessage,
          csvDocs.map((d) => ({ fileName: d.entry.fileName, filePath: path.join(dir, 'uploads', d.entry.sourceId!) })),
          llmGenerateFn,
        );
        if (queryBlock) promptParts.push(queryBlock);
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
        const block = formatSkillForSlides(
          matchedDocumentSkill,
          matchedSkillInstructionsMd,
          matchedSkillSections ?? [],
        );
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
        notion:
          'FORMAT DIRECTIVE: The user wants Notion-compatible output. Use > blockquotes for callout blocks, --- horizontal dividers between major sections, and standard heading hierarchy (# ## ###).',
        pdf: 'FORMAT DIRECTIVE: The user wants a PDF. Use rich markdown — headings, bullets, **bold** key terms, blockquotes for callouts — it will be rendered and typeset to PDF.',
      };
      if (!isPresentationRequest && detectedFormat && detectedFormat !== 'md') {
        const directive = FORMAT_DIRECTIVES[detectedFormat];
        if (directive) promptParts.push(`\n${directive}`);
      }

      if (isAnswerIntent) {
        promptParts.push(
          `\nThe user is asking a question or making conversation — respond helpfully and concisely about ${meta.displayName}. Do NOT generate a proposal, document, or slides in this reply; just answer. Keep it to ONE paragraph unless the answer genuinely has multiple distinct points.${
            effectiveAttachedFileNames.length
              ? ' A file was just attached — it is already saved to memory automatically, so if the user is asking you to save/remember/add it, confirm that warmly by name (not "I\'m focused on X") and give a one-line gist of what it actually contains, using the content under "Relevant Memory" / "Files Attached With This Message" above.'
              : ''
          }`,
        );
      }

      promptParts.push(`\nUser: ${effectiveMessage}`);

      const combinedPrompt = promptParts.join('\n');

      // ── Generation-turn resolution ────────────────────────────────────────
      // The intent gate's decision (not raw regex) determines whether this turn
      // produces an artifact, what type it is, and which skill shapes it. Edits
      // and conversational answers keep the legacy streaming behavior.
      const isGenerationTurn =
        !isEdit &&
        (decision?.intent === 'generate_proposal' ||
          decision?.intent === 'generate_document' ||
          decision?.intent === 'generate_presentation');
      const artifactType: 'slide' | 'proposal' | 'document' | undefined = !isGenerationTurn
        ? undefined
        : decision!.intent === 'generate_presentation'
          ? 'slide'
          : decision!.intent === 'generate_proposal'
            ? 'proposal'
            : 'document';
      // The skill is only "used" when its guidance is actually injected into the
      // prompt — mirror the injection gates above (presentation: pptx-capable;
      // document: standard-mode instructions present; proposal: none).
      const ackSkill =
        artifactType === 'slide' &&
        matchedDocumentSkill &&
        matchedSkillInstructionsMd &&
        matchedDocumentSkill.outputFormats?.includes('pptx')
          ? matchedDocumentSkill
          : artifactType === 'document' && matchedDocumentSkill && matchedSkillInstructionsMd
            ? matchedDocumentSkill
            : null;
      const artifactLabel =
        artifactType === 'slide'
          ? 'presentation'
          : artifactType === 'proposal'
            ? 'proposal'
            : (ackSkill?.displayName ?? matchedDocumentSkill?.displayName ?? 'document').toLowerCase();

      // ── Memory selection checklist ────────────────────────────────────────
      // Before generating, show every stored item as a plain, pre-checked
      // checklist and let the user pick what actually goes in — no automatic
      // relevant/not-relevant judgment. That layer used to run one LLM call
      // ranking every entry, but a single bad distilled fact (e.g. a
      // chat-derived note wrongly linking this client to an unrelated one)
      // could poison the verdict and silently pull irrelevant content into a
      // generation with no way to catch it beforehand. Skipped when this
      // message actually IS a reply to our own checklist
      // (isConfirmedMemoryReply) — a stale, unanswered question followed by
      // a brand-new full request must still ask, not silently reuse it — OR
      // when the message ITSELF already explicitly says which files to use
      // (resolveExplicitFileSelection below), so a clear instruction like
      // "use only the yacht proposal, the RFP was uploaded by mistake"
      // (e.g. following a MATERIAL CHECK RULE decline, which never sets a
      // pending marker) doesn't get met with the same question again.
      if (isGenerationTurn && memoryRelevanceDecisions.length > 0 && !isConfirmedMemoryReply) {
        const explicitIds = await resolveExplicitFileSelection(memoryRelevanceDecisions, message, llmGenerateFn);
        if (explicitIds.length > 0) {
          relevantMemoryDocs = await getMemoryDocsByIds(workdir, name, explicitIds);
        } else {
          // A single stored item has nothing to actually choose between —
          // phrase it as a yes/no confirmation instead of a selection
          // prompt, even though the UI card stays the same (one pre-checked
          // row, Cancel / Generate).
          const introLine =
            memoryRelevanceDecisions.length === 1
              ? `Use ${memoryEntryLabel(memoryRelevanceDecisions[0])} to create this ${artifactLabel} for ${meta.displayName}?`
              : `Select what to include when creating this ${artifactLabel} for ${meta.displayName}:`;
          // Plain-text fallback for history / non-overlay rendering — the SSE
          // event also carries the same data structured (clarifyDetails) so
          // the live card can render it as an actual checklist.
          const questionText = [
            introLine,
            ...memoryRelevanceDecisions.map((d) => `${memoryEntryLabel(d)} — ${d.reason}`),
          ].join('\n');
          // Carry ONLY a deterministically-matched skill into the pending
          // marker (never the LLM's guess), matching the ambiguity-clarify
          // path above.
          const pendingSkillSlug = matchedDocumentSkill?.slug;
          const pending: PendingClarification = {
            proposedIntent: decision!.intent,
            ...(pendingSkillSlug ? { skillSlug: pendingSkillSlug } : {}),
            ...(decision!.format ? { format: decision!.format } : {}),
            includedMemoryIds: memoryRelevanceDecisions.map((d) => d.id),
            // Carry effectiveMessage, not raw message — if this checklist is
            // itself being shown after the user answered an earlier
            // ambiguity-clarify question, `message` here is that short
            // button-click reply, not the real triggering text.
            originalMessage: effectiveMessage,
            ...(effectiveAttachedFileNames.length ? { attachedFileNames: effectiveAttachedFileNames } : {}),
          };
          await persistTurn(questionText, pending);
          send({
            type: 'done',
            text: questionText,
            isClarify: true,
            clarifyDetails: {
              mode: 'select',
              intro: introLine,
              items: memoryRelevanceDecisions.map((d) => ({
                id: d.id,
                fileName: memoryEntryLabel(d),
                reason: d.reason,
                preChecked: true,
              })),
            },
          });
          return;
        }
      }

      // ── Pre-flight material check ─────────────────────────────────────────
      // Separate, small, fast LLM call that runs BEFORE the ack/card so a
      // heads-up about missing material (if any) reaches the user first —
      // not buried in the model's own trailing commentary only after the
      // whole generation is already done. Purely informational: it never
      // blocks generation, the MATERIAL_CHECK_RULE inside the main prompt
      // below remains the sole authority on whether to decline outright.
      let materialNote: string | null = null;
      if (isGenerationTurn) {
        const memoryCatalog = relevantMemoryDocs
          .map((d) => `- ${d.entry.fileName}: ${d.entry.description}`)
          .join('\n');
        materialNote = await assessGenerationMaterial(
          meta.displayName,
          artifactLabel,
          effectiveMessage,
          memoryCatalog,
          llmGenerateFn,
        );
        if (materialNote) {
          await streamAssistant(materialNote.trim() + '\n\n');
          // Deliberate pause so the note is actually readable as its own
          // moment before the card appears — the note+ack text alone only
          // takes ~500-600ms to stream (a handful of short sentences at the
          // per-word streaming rate below), which is too fast for a human to
          // register as "note, then card" rather than "everything at once",
          // even though the two are already genuinely sequenced on the wire.
          await new Promise((resolve) => setTimeout(resolve, 1400));
        }
      }

      // ── Acknowledgment + planning announcement ───────────────────────────
      // Acknowledge in chat BEFORE generating — naming the skill in use — so the
      // turn reads as interactive rather than an abrupt jump into generation.
      let ackText = '';
      if (isGenerationTurn) {
        ackText = ackSkill
          ? `Using the **${ackSkill.displayName}** skill to create this ${artifactLabel} for ${meta.displayName}, give me a moment…`
          : `Creating a ${artifactLabel} for ${meta.displayName}, give me a moment…`;
        await streamAssistant(ackText);

        const planText =
          artifactType === 'slide'
            ? resolvedSlideCount
              ? slideCountWasCapped
                ? `Building a ${resolvedSlideCount}-slide presentation for ${meta.displayName} (capped from ${requestedSlideCount} for reliable generation)…`
                : `Building a ${resolvedSlideCount}-slide presentation for ${meta.displayName}…`
              : `Building a presentation for ${meta.displayName}…`
            : artifactType === 'proposal'
              ? `Drafting a proposal for ${meta.displayName}…`
              : `Writing a ${artifactLabel} for ${meta.displayName}…`;
        send({
          type: 'planning',
          text: planText,
          artifactType,
          ...(ackSkill ? { skillSlug: ackSkill.slug, skillName: ackSkill.displayName } : {}),
          genTitle:
            ackSkill?.displayName ??
            (artifactType === 'slide' ? 'Presentation' : artifactType === 'proposal' ? 'Proposal' : 'Document'),
        });
      }

      // ── LLM call with heartbeat progress ─────────────────────────────────
      // The generation is one opaque blocking call, so — exactly like the
      // microsite generate-v2-stream route — a heartbeat cycles progress steps
      // to keep the UI's generation card alive while the model works.
      const HEARTBEAT_STEPS: Record<'slide' | 'proposal' | 'document', string[]> = {
        slide: [
          'Reading client context…',
          'Analyzing presentation requirements…',
          'Structuring slides…',
          'Writing slide content…',
          'Applying design and layout…',
          'Finalizing presentation…',
        ],
        proposal: [
          'Reading client context…',
          'Analyzing requirements…',
          'Drafting proposal sections…',
          'Refining content…',
          'Finalizing proposal…',
        ],
        document: [
          'Reading client context…',
          'Researching topic…',
          'Structuring document…',
          'Writing sections…',
          'Reviewing and refining…',
          'Preparing document…',
        ],
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

      // Call provider-agnostic LLM bridge — respects LLM_PROVIDER + model config.
      // Fresh microsite generation runs at a raised temperature so decks vary
      // between generations instead of collapsing onto one deterministic look
      // (extraction/memory/edit calls keep the default temperature 0). All other
      // turns are unchanged.
      let fullResponse: string;
      try {
        fullResponse = isMicrositeGeneration
          ? await withLlmTemperature(0.7, () => llmGenerateFn(combinedPrompt))
          : await llmGenerateFn(combinedPrompt);
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
      // Defensive: on a free-form conversational reply (no tag to bound it —
      // e.g. a MATERIAL CHECK RULE decline), the model can occasionally run
      // past its own turn and hallucinate a fake continuation mimicking the
      // prompt's own "User: ..." convention. Strip from the first such line
      // onward. Safe even when a tag IS found below — every tag branch
      // recomputes displayResponse fresh from fullResponse, overwriting this.
      const hallucinatedContinuation = displayResponse.match(/\n+User:\s/);
      if (hallucinatedContinuation?.index !== undefined) {
        displayResponse = displayResponse.slice(0, hallucinatedContinuation.index).trimEnd();
      }
      // Set when a Tier-3 save/update throws so the generation-turn guard below
      // can surface a retry message instead of a fake confirmation.
      let artifactSaveFailed = false;

      // isEdit-gated (not raw activeProposalId/activeDocumentId) — see isEdit above.
      const activeEditId = isEdit ? (activeProposalId ?? activeDocumentId) : undefined;
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
              const fileName = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${slugify(proposalMatch.title) || 'proposal'}.md`;
              proposalSaved = await updateProposal(dir, fileName, proposalMatch.title, proposalMatch.content);
            }
          } catch (err) {
            artifactSaveFailed = true;
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
            artifactSaveFailed = true;
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
            artifactSaveFailed = true;
            app.log.warn({ err }, '[SuperClient] Failed to save slides');
          }
          displayResponse = stripSlidesTag(fullResponse);
        }
      }

      // Safety guard: a generation turn that produced no artifact must never
      // stream or persist raw markup. This fires when the model's response was
      // truncated/malformed (extraction failed, raw <slides>/<!DOCTYPE… still
      // present) or a save threw — in both cases the user gets a deterministic
      // retry message instead of a wall of leaked HTML or a fake confirmation.
      // A legitimate plain-text reply (no markup, no failed save) is left alone.
      const artifactProduced = !!(
        slideSaved ||
        proposalSaved ||
        documentSaved ||
        proposalUpdated ||
        documentUpdated
      );
      if (
        isGenerationTurn &&
        !artifactProduced &&
        (artifactSaveFailed || hasRawArtifactMarkup(fullResponse))
      ) {
        app.log.warn(
          { name, artifactType, artifactSaveFailed },
          '[SuperClient] Generation turn produced no artifact — suppressing raw output',
        );
        displayResponse = `I ran into a problem finishing this ${artifactLabel} — the generation may have been too large and got cut off. Please try again, or ask for a shorter version (e.g. fewer slides).`;
      }

      // Generation turns: the raw response was never fake-streamed (only the ack
      // was). Stream the stripped confirmation now, then keep the ack at the top
      // of the persisted/final text so the turn reads as one coherent message —
      // but ONLY when an artifact actually came out of this turn. The intent
      // gate's classification is a prediction, not a guarantee: the model can
      // still look at the full context (e.g. a message with no real project
      // content) and decide to answer conversationally instead of generating.
      // In that case the "Creating a proposal…" ack would be a lie stitched
      // onto a decline, so it must not survive into the persisted/final text.
      if (isGenerationTurn) {
        // Defensive: the model can see its own prior "Creating a ... give me
        // a moment…" ack lines in recent conversation history and sometimes
        // echoes the same opener back as its own outer sentence — which would
        // otherwise duplicate the ack we already prepend below.
        if (artifactProduced && ackText && displayResponse.trim().startsWith(ackText.trim())) {
          displayResponse = displayResponse.trim().slice(ackText.trim().length).trim();
        }
        if (displayResponse.trim()) {
          await streamAssistant(displayResponse.trim());
        }
        displayResponse = artifactProduced
          ? [materialNote, ackText, displayResponse.trim()].filter(Boolean).join('\n\n')
          : displayResponse.trim();
      }

      // Persist turn to history.
      const userTs = new Date().toISOString();
      const assistantTs = new Date(Date.now() + 1).toISOString();
      const editCtx = activeProposalId
        ? ({ editContext: 'proposal' } as const)
        : activeDocumentId
          ? ({ editContext: 'document' } as const)
          : {};
      const updatedHistory: HistoryEntry[] = [
        ...history,
        { role: 'user', content: message, createdAt: userTs, ...editCtx },
        { role: 'assistant', content: stripDashes(displayResponse), createdAt: assistantTs, ...editCtx },
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
    const body = req.body as
      | {
          messages?: Array<{
            role: string;
            content: string;
            createdAt?: string;
            editContext?: string;
            narrationSteps?: NarrationStepRecord[];
          }>;
        }
      | undefined;
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
      ...(m.editContext === 'microsite' || m.editContext === 'proposal' || m.editContext === 'document'
        ? { editContext: m.editContext }
        : {}),
      ...(Array.isArray(m.narrationSteps) && m.narrationSteps.length > 0 ? { narrationSteps: m.narrationSteps } : {}),
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
      const files = [...(await readScFiles(dir)), ...(await buildVirtualDocs(dir))];
      return reply.send({ files });
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
  });

  // POST /super-clients/:name/documents/upload  — multipart, .pdf/.txt/.md, max 50 MB
  app.post('/super-clients/:name/documents/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    // Composer "attach and send" sets this and awaits the response before
    // firing the chat request, so the just-attached file is actually
    // indexed by the time the memory checklist runs (see sendMessage in
    // page.tsx). The Context-tab uploader never sets it and keeps today's
    // fast fire-and-forget behavior.
    const isSync = (req.query as { sync?: string }).sync === '1';

    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }

    const uploadsDir = path.join(dir, 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    const ALLOWED = ['.pdf', '.txt', '.md', '.csv'];
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

      const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const buffer = await part.toBuffer();

      if (buffer.length > MAX_SIZE) {
        return reply.code(400).send({ error: `File "${rawName}" exceeds the 50 MB limit` });
      }

      // Byte-identical re-upload (even under a different filename) is a
      // no-op: skip writing it, skip indexing it, and tell the caller which
      // existing upload it matches instead of silently creating a duplicate
      // memory entry (exactly the kind of duplicate that once polluted a
      // relevance checklist with two copies of the same RFP).
      const contentHash = createHash('sha256').update(buffer).digest('hex');
      const existingFiles = await readScFiles(dir);
      const duplicate = existingFiles.find((f) => f.contentHash === contentHash);
      if (duplicate) {
        const duplicateUploadedAt = new Date().toISOString();
        added.push({
          fileName: duplicate.fileName,
          originalName: rawName,
          size: buffer.length,
          uploadedAt: duplicateUploadedAt,
          status: 'duplicate',
          duplicateOfFileName: duplicate.fileName,
        });
        // Take its real chronological place in the chat timeline too — see
        // the `upload` field on HistoryEntry.
        await appendUploadHistoryEntry(dir, {
          role: 'user',
          content: `Attached file: ${rawName}`,
          createdAt: duplicateUploadedAt,
          upload: {
            fileName: duplicate.fileName,
            originalName: rawName,
            status: 'duplicate',
            duplicateOfFileName: duplicate.fileName,
          },
        });
        continue;
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

      const entry: ScFile = {
        fileName: safeName,
        originalName: rawName,
        size: buffer.length,
        uploadedAt: new Date().toISOString(),
        status: 'processing',
        contentHash,
      };
      const existing = await readScFiles(dir);
      const idx = existing.findIndex((f) => f.fileName === safeName);
      if (idx !== -1) existing[idx] = entry;
      else existing.push(entry);
      await writeScFiles(dir, existing);
      added.push(entry);

      // Take its real chronological place in the chat timeline — createdAt
      // is this raw-file-write timestamp, which happens before the
      // composer's accompanying chat request is even sent, so sorting by
      // createdAt naturally places the upload before that turn's text.
      await appendUploadHistoryEntry(dir, {
        role: 'user',
        content: `Attached file: ${rawName}`,
        createdAt: entry.uploadedAt,
        upload: { fileName: safeName, originalName: rawName, status: 'processing' },
      });

      // Converts the raw upload into a relevance-scannable memory note (see
      // services/api/src/memory/document-converter.ts). Fire-and-forget by
      // default, mirroring the site-facts / distillChatTurn background-job
      // pattern — the upload response must not block on an LLM round-trip.
      // `isSync` opts into awaiting it instead (see the query-flag comment
      // above); `entry` is already pushed into `added` by reference, so
      // mutating `entry.status` before the response serializes reflects the
      // true final state without a second read.
      const memoryId = `doc-${safeName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const indexUpload = async (): Promise<ScFile['status']> => {
        try {
          const { description, markdown } = await convertUploadToMemoryDoc(rawName, destPath, llmGenerateFn);
          await new DocumentMemoryService(workdir).upsertFile(name, {
            id: memoryId,
            type: 'upload',
            fileName: rawName,
            description,
            markdown,
            sourceId: safeName,
          });
          await updateScFile(dir, safeName, 'extracted');
          await updateUploadHistoryStatus(dir, safeName, 'extracted');
          return 'extracted';
        } catch (err) {
          app.log.warn({ err, name, fileName: safeName }, '[SuperClient] upload memory conversion failed');
          const errMsg = err instanceof Error ? err.message : String(err);
          await updateScFile(dir, safeName, 'failed', errMsg);
          await updateUploadHistoryStatus(dir, safeName, 'failed', errMsg);
          return 'failed';
        }
      };
      if (isSync) entry.status = await indexUpload();
      else void indexUpload();
    }

    if (added.length === 0) {
      return reply.code(400).send({ error: 'No valid files provided. Allowed: .pdf, .txt, .md, .csv' });
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

    if (VIRTUAL_DOC_NAMES.has(fileName)) {
      // Generated file, never in files.json or ClientMemory — just remove it.
      // buildVirtualDocs() won't resurrect it once the file is gone.
      await rm(path.join(dir, fileName), { force: true });
      return reply.send({ ok: true });
    }

    const filePath = path.join(dir, 'uploads', fileName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'uploads')))) {
      return reply.code(400).send({ error: 'Invalid file name' });
    }

    await rm(filePath, { force: true });
    const files = (await readScFiles(dir)).filter((f) => f.fileName !== fileName);
    await writeScFiles(dir, files);
    await new DocumentMemoryService(workdir).removeBySourceId(name, fileName).catch((err) => {
      app.log.warn({ err, name, fileName }, '[SuperClient] failed to remove memory doc for deleted upload');
    });

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

    const baseDir = VIRTUAL_DOC_NAMES.has(fileName) ? dir : path.join(dir, 'uploads');
    const filePath = path.join(baseDir, fileName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(baseDir))) {
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
    try {
      meta = await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }

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
    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: `Super client "${name}" not found` });
    }
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
      const gens = await readGenerations(dir);
      const pruned = pruneStaleGenerations(gens);
      // Self-heal: persist the cleaned list so dead 'generating' cards (from a
      // browser that errored/closed mid-stream) stop rehydrating as stuck spinners.
      if (pruned.length !== gens.length) {
        await writeGenerations(dir, pruned);
      }
      return reply.send(pruned);
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
      await writeGenerations(
        dir,
        existing.filter((g) => g.id !== id),
      );
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
      const isLLM = instruction.startsWith('__ELEMENT_EDIT__:');
      const userText = instruction.includes('||')
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
        const id = vimeoM[1];
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
      const rawUrl = videoInjectMatch[2].trim();

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
          return saveValidatedEdit(html.slice(0, bounds.start) + patched + html.slice(bounds.end), 'Video updated');
        }
        // Element located but holds no player yet — insert a responsive embed as
        // its last child instead of patching some OTHER element's iframe (which
        // would silently edit the wrong section) or erroring out.
        const closeM = elementHtml.match(/<\/(\w+)>\s*$/);
        if (closeM) {
          const closeIdx = elementHtml.lastIndexOf(closeM[0]);
          const embed = `<div style="position:relative;padding-top:56.25%;width:100%"><iframe src="${newSrc}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
          return saveValidatedEdit(
            html.slice(0, bounds.start) +
              elementHtml.slice(0, closeIdx) +
              embed +
              elementHtml.slice(closeIdx) +
              html.slice(bounds.end),
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
      let replaced = false;

      // Helper: replace src in a matched <img> tag regardless of attribute order
      const swapSrc = (tag: string) => {
        replaced = true;
        return tag.replace(/(\bsrc=["'])[^"']+(['"])/i, `$1${newSrc}$2`).replace(/(\bsrc=)[^\s>]+/i, `$1"${newSrc}"`);
      };

      // 1. <img alt="...logo..."> — most reliable signal
      if (!replaced) {
        updatedHtml = html.replace(/<img\b[^>]*\balt="[^"]*logo[^"]*"[^>]*/gi, (tag) => swapSrc(tag));
      }

      // 2. <img class="...logo...">
      if (!replaced) {
        updatedHtml = html.replace(/<img\b[^>]*\bclass="[^"]*logo[^"]*"[^>]*/gi, (tag) => swapSrc(tag));
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
        updatedHtml = html.replace(/<img\b[^>]*\bsrc="[^"]*logo[^"]*"[^>]*/gi, (tag) => swapSrc(tag));
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
      const newSrc = logoSwapMatch[2].trim();
      const imgTag = `<img src="${newSrc}" alt="logo" style="height:44px;width:auto;max-width:180px;object-fit:contain;display:block;flex-shrink:0;">`;

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
        const closeTagM = elHtml.match(/<\/(\w+)>\s*$/);
        if (openTagEnd !== -1 && closeTagM) {
          const openTag = elHtml.slice(0, openTagEnd + 1);
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
        updatedHtml = html.replace(/\bdata-bg=["'](https?:\/\/[^'"]+)["']/gi, () => `data-bg="${newUrl}"`);
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
    const scopedImageMatch = instruction.match(
      /^__IMAGE_INJECT_SCOPED__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|([\s\S]*))?$/s,
    );
    if (scopedImageMatch) {
      const cssPath = scopedImageMatch[1].trim();
      const newUrl = scopedImageMatch[2].trim();
      const hintHtml = (scopedImageMatch[3] ?? '').trim();

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
        out = target.replace(
          /(<img\b[^>]*?\bdata-src=["'])([^'"]+)(["'])/i,
          (_m, pre, _old, post) => `${pre}${newUrl}${post}`,
        );
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
        return target.replace(/(\bsrc=["'])([^'"]+)(["'])/i, (_m, pre, _old, post) => `${pre}${newUrl}${post}`);
      }

      const bounds = findByPath(html, cssPath);
      if (bounds) {
        const elementHtml = html.slice(bounds.start, bounds.end);
        const elTag = elementHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
        const VOID_TAGS = new Set(['img', 'source', 'input', 'video', 'audio']);

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
          const re = new RegExp(`((?:\\.|#)${escaped}\\b[^{]*\\{[^}]*)background-image\\s*:\\s*url\\([^)]+\\)`, 'gi');
          return src.replace(re, `$1background-image: url('${newUrl}')`);
        };

        // Try each class name of the selected element, then its id
        const classAttr = elementHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
        const idAttr = elementHtml.match(/\bid="([^"]+)"/i)?.[1] ?? '';
        const candidates = [...classAttr.trim().split(/\s+/).filter(Boolean), ...(idAttr ? [idAttr] : [])];
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
            const anchorId = sectionM[2];
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
          const rest = elementHtml.slice(tagEnd);
          const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
          const sm = styleRx.exec(openTag);
          const bgVal = `background-image:url('${newUrl}') !important;background-size:cover !important;background-position:center !important`;
          let patchedTag: string;
          if (sm) {
            const existing = sm[1]
              .replace(/\bbackground-image\s*:\s*(?:url\([^)]*\)|[^;]*)\s*;?\s*/gi, '')
              .replace(/\bbackground-size\s*:[^;]+;?\s*/gi, '')
              .replace(/\bbackground-position\s*:[^;]+;?\s*/gi, '')
              .trim()
              .replace(/;$/, '');
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

      return reply.code(422).send({
        error: 'Could not locate the selected image in the document — try clicking the image again to re-select it',
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Position-based element removal (preferred — uses CSS path) ───────────
    // Format: __REMOVE_BY_PATH__:[cssPath]||[hintHtml?]
    // hintHtml is optional — used as content-based fallback when findByPath fails.
    const removeByPathMatch = instruction.match(/^__REMOVE_BY_PATH__:([\s\S]+?)(?:\|\|([\s\S]*))?$/);
    if (removeByPathMatch) {
      const cssPath = removeByPathMatch[1].trim();
      const hintHtml = (removeByPathMatch[2] ?? '').trim();
      let bounds = findByPath(html, cssPath);

      // Fallback: content-based element location when path doesn't match
      // (happens after LLM edits restructure the surrounding DOM)
      if (!bounds && hintHtml) {
        const hintStart = locateElement(html, hintHtml);
        if (hintStart !== -1) {
          const tagName = hintHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
          const VOID_TAGS_R = new Set([
            'area',
            'base',
            'br',
            'col',
            'embed',
            'hr',
            'img',
            'input',
            'link',
            'meta',
            'param',
            'source',
            'track',
            'wbr',
          ]);
          let end: number;
          if (VOID_TAGS_R.has(tagName) || hintHtml.trimEnd().endsWith('/>')) {
            end = html.indexOf('>', hintStart) + 1;
          } else {
            const close = `</${tagName}>`;
            let depth = 1,
              j = html.indexOf('>', hintStart) + 1;
            while (j < html.length && depth > 0) {
              const nO = html.indexOf(`<${tagName}`, j);
              const nC = html.indexOf(close, j);
              if (nC === -1) break;
              if (nO !== -1 && nO < nC) {
                depth++;
                j = nO + tagName.length + 1;
              } else {
                depth--;
                j = nC + close.length;
              }
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
      const VOID_TAGS = new Set([
        'area',
        'base',
        'br',
        'col',
        'embed',
        'hr',
        'img',
        'input',
        'link',
        'meta',
        'param',
        'source',
        'track',
        'wbr',
      ]);

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
          let depth = 1,
            i = tagEnd + 1;
          while (i < html.length && depth > 0) {
            const nextOpen = html.indexOf(`<${openTag}`, i);
            const nextClose = html.indexOf(closeTag, i);
            if (nextClose === -1) break;
            if (nextOpen !== -1 && nextOpen < nextClose) {
              depth++;
              i = nextOpen + openTag.length + 1;
            } else {
              depth--;
              i = nextClose + closeTag.length;
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
      // 1. Must have closing HTML tags — catches truncated LLM responses.
      // Only enforce when the original was well-formed; if the stored HTML is
      // already truncated, deterministic patches (TEXT_PATCH, STYLE_PATCH, etc.)
      // should not be blocked for a problem they did not cause.
      const originalWellFormed = html.includes('</body>') || html.includes('</html>');
      if (originalWellFormed && !updated.includes('</body>') && !updated.includes('</html>')) {
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
      const newSections = (updated.match(/<section[\s>]/gi) ?? []).length;
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
      const scriptOpens = (updated.match(/<script\b/gi) ?? []).length;
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
          ...(sections ?? []).slice(1),
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
      const bounds = findByPath(html, cssPath);
      if (!bounds) return reply.code(422).send({ error: 'Element not found — click it again to re-select' });

      let updated = html;

      // Helper: clear background from an element at given bounds in `src`
      function clearBgFromElement(src: string, b: { start: number; end: number }): string {
        const elHtml = src.slice(b.start, b.end);
        const tagEnd = elHtml.indexOf('>');
        if (tagEnd === -1) return src;

        const openTag = elHtml.slice(0, tagEnd);
        const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
        const sm = styleRx.exec(openTag);
        let patchedOpen: string;
        if (sm) {
          // Remove all background-* declarations from existing inline style
          const stripped = sm[1]
            .replace(
              /\bbackground(?:-image|-color|-position|-size|-repeat|-attachment|-clip|-origin|-blend-mode)?\s*:[^;]+;?\s*/gi,
              '',
            )
            .trim()
            .replace(/;$/, '');
          patchedOpen = openTag.replace(
            styleRx,
            `style="${stripped ? stripped + ';' : ''}background:none;background-image:none"`,
          );
        } else {
          patchedOpen = `${openTag} style="background:none;background-image:none"`;
        }

        // Remove background rules from <style> block for this element's class
        const classMatch = elHtml.match(/\bclass="([^"]+)"/i);
        let result = src.slice(0, b.start) + patchedOpen + elHtml.slice(tagEnd) + src.slice(b.end);
        if (classMatch) {
          const firstCls = classMatch[1]
            .trim()
            .split(/\s+/)
            .find((c) => c.length > 1);
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
      const parentPath = cssPath
        .split(/\s*>\s*/)
        .slice(0, -1)
        .join(' > ');
      if (parentPath) {
        // Re-find parent bounds in the (possibly already modified) `updated` HTML
        const parentBounds = findByPath(updated, parentPath);
        if (parentBounds) {
          updated = clearBgFromElement(updated, parentBounds);
        }
      }

      // Deep-strip: clear background-image:url() from EVERY inline style within the
      // element's full HTML subtree. clearBgFromElement only patches the element's
      // own opening tag — child divs (e.g. .slide-bg, .hero-bg) that hold the
      // actual photo as an inline background-image are not touched, so the visual
      // background persists even though the outer element's style was cleared.
      {
        // Re-find bounds in `updated` (may have shifted after parent patch)
        const freshBounds = findByPath(updated, cssPath) ?? bounds;
        const elSpan = updated.slice(freshBounds.start, freshBounds.end);
        const deepCleaned = elSpan.replace(
          /\bbackground(?:-image)?\s*:\s*url\([^)]*\)/gi,
          'background-image:none',
        );
        if (deepCleaned !== elSpan) {
          updated = updated.slice(0, freshBounds.start) + deepCleaned + updated.slice(freshBounds.end);
        }
      }

      // Strip background-image:url() from <style>-block CSS rules whose selector
      // references the section's ID — covers patterns like #slide-1 .bg { background-image: ... }
      const sectionId = cssPath.match(/#([\w-]+)/)?.[1];
      if (sectionId) {
        const esc = sectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        updated = updated.replace(
          /([^{}]+)\{([^}]*\bbackground(?:-image)?\s*:\s*url\([^)]*\)[^}]*)\}/gi,
          (match, selector, body) => {
            if (!new RegExp(`\\b${esc}\\b`, 'i').test(selector)) return match;
            return `${selector}{${body.replace(/\bbackground(?:-image)?\s*:\s*url\([^)]*\)/gi, 'background-image:none')}}`;
          },
        );
      }

      // Strip background-image:url() from CSS rules that target ANY class found
      // within the element's subtree. The background is typically a positioned child
      // div (.s1-bg, .hero-bg, etc.) whose background comes from a CSS class rule,
      // not an inline style — so the deep-strip above and the ID-based scan above
      // both miss it. This catch-all covers that pattern.
      {
        const freshBounds3 = findByPath(updated, cssPath) ?? bounds;
        const elSpanForClasses = updated.slice(freshBounds3.start, freshBounds3.end);
        const classNames = new Set<string>();
        const classRe = /\bclass="([^"]+)"/gi;
        let cm: RegExpExecArray | null;
        while ((cm = classRe.exec(elSpanForClasses)) !== null) {
          cm[1].trim().split(/\s+/).forEach((c) => { if (c.length > 1) classNames.add(c); });
        }
        if (classNames.size > 0) {
          updated = updated.replace(
            /([^{}]+)\{([^}]*\bbackground(?:-image)?\s*:\s*url\([^)]*\)[^}]*)\}/gi,
            (match, selector, body) => {
              const matchesChildClass = [...classNames].some((c) => {
                const ce = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp(`\\.${ce}\\b`).test(selector);
              });
              if (!matchesChildClass) return match;
              return `${selector}{${body.replace(/\bbackground(?:-image)?\s*:\s*url\([^)]*\)/gi, 'background-image:none')}}`;
            },
          );
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
    const stylePatchMatch = instruction.match(
      /^__STYLE_PATCH__:([\s\S]+?)\|\|([\w-]+)\|\|([\s\S]+?)(?:\|\|([\s\S]*))?$/s,
    );
    if (stylePatchMatch) {
      const cssPath = stylePatchMatch[1].trim();
      const prop = stylePatchMatch[2].trim().toLowerCase();
      const rawValue = stylePatchMatch[3].trim();
      const hintHtml = (stylePatchMatch[4] ?? '').trim();

      const ALLOWED_STYLE_PROPS = new Set([
        'color',
        'background-color',
        'background-image',
        'background',
        'font-size',
        'font-family',
        'font-weight',
        'font-style',
        'opacity',
        'border-radius',
        'text-align',
        'letter-spacing',
        'line-height',
      ]);
      if (!ALLOWED_STYLE_PROPS.has(prop))
        return reply.code(400).send({ error: `Property "${prop}" is not patchable via __STYLE_PATCH__` });

      const value = rawValue
        .replace(/[;'"<>]/g, '')
        .trim()
        .slice(0, 120);
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
      const rest = elementHtml.slice(tagEnd);
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
          .trim()
          .replace(/;$/, '');
        if (clearBgImage) {
          existing = existing
            .replace(/background-image\s*:[^;]+;?\s*/gi, '')
            .trim()
            .replace(/;$/, '');
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

    // ── Gradient text patch (from InlineEditPanel gradient editor) ───────────
    // Format: __GRADIENT_TEXT_PATCH__:[cssPath]||[gradientCss]||[hintHtml?]
    // Deterministic — no LLM. Atomically sets all gradient-text CSS properties.
    const gradientTextPatchMatch = instruction.match(
      /^__GRADIENT_TEXT_PATCH__:([\s\S]+?)\|\|([\s\S]+?)(?:\|\|([\s\S]*))?$/s,
    );
    if (gradientTextPatchMatch) {
      const cssPath = gradientTextPatchMatch[1].trim();
      const rawGradient = gradientTextPatchMatch[2].trim();
      const hintHtml = (gradientTextPatchMatch[3] ?? '').trim();

      if (!/^(?:linear|radial|conic)-gradient\(/i.test(rawGradient)) {
        return reply.code(400).send({ error: 'Invalid gradient CSS' });
      }
      const safeGradient = rawGradient.replace(/['"<>]/g, '').trim().slice(0, 500);

      let gBounds = findByPath(html, cssPath);
      if (!gBounds && hintHtml) {
        const hs = locateElement(html, hintHtml);
        if (hs !== -1) {
          const ht = html.indexOf('>', hs);
          if (ht !== -1) gBounds = { start: hs, end: ht + 1 };
        }
      }
      if (!gBounds) return reply.code(422).send({ error: 'Target element not found — click it again to re-select' });

      const gElementHtml = html.slice(gBounds.start, gBounds.end);
      const gTagEnd = gElementHtml.indexOf('>');
      if (gTagEnd === -1) return reply.code(422).send({ error: 'Malformed element' });

      const gOpenTag = gElementHtml.slice(0, gTagEnd);
      const gRest = gElementHtml.slice(gTagEnd);
      const gStyleRx = /\bstyle\s*=\s*"([^"]*)"/i;
      const gSm = gStyleRx.exec(gOpenTag);

      const GRADIENT_STRIP_PROPS = new Set([
        'background', 'background-image', '-webkit-background-clip',
        'background-clip', '-webkit-text-fill-color', 'color',
      ]);
      const gradientProps =
        `background-image:${safeGradient};` +
        `-webkit-background-clip:text;background-clip:text;` +
        `-webkit-text-fill-color:transparent;color:transparent`;

      let gPatchedTag: string;
      if (gSm) {
        const cleaned = gSm[1]
          .split(';')
          .map((s) => s.trim())
          .filter((s) => {
            if (!s) return false;
            const propName = s.split(':')[0]?.trim().toLowerCase() ?? '';
            return !GRADIENT_STRIP_PROPS.has(propName);
          })
          .join('; ');
        gPatchedTag = gOpenTag.replace(gStyleRx, `style="${cleaned ? cleaned + '; ' : ''}${gradientProps}"`);
      } else {
        gPatchedTag = `${gOpenTag} style="${gradientProps}"`;
      }

      const gUpdatedHtml = html.slice(0, gBounds.start) + gPatchedTag + gRest + html.slice(gBounds.end);
      return saveValidatedEdit(gUpdatedHtml, 'Gradient text updated');
    }

    // ── Inline text content patch (from InlineEditPanel) ────────────────────
    // Format: __TEXT_PATCH__:[cssPath]||[newText]
    // Deterministic — no LLM. Replaces text nodes, preserves child elements.
    // Format: __TEXT_PATCH__:[cssPath]||[newText](||[hint — ignored])
    // Non-greedy group 2 stops before the trailing ||hint so the hint's outerHTML
    // is never concatenated into the visible text content.
    const textPatchMatch = instruction.match(/^__TEXT_PATCH__:([\s\S]+?)\|\|([\s\S]+?)(?:\|\|([\s\S]*))?$/s);
    if (textPatchMatch) {
      const cssPath = textPatchMatch[1].trim();
      const newText = textPatchMatch[2].trim().slice(0, 2000);
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
              let depth = 1,
                j = tagEnd + 1;
              while (j < html.length && depth > 0) {
                const nO = html.indexOf(`<${tagName}`, j);
                const nC = html.indexOf(close, j);
                if (nC === -1) break;
                if (nO !== -1 && nO < nC) {
                  depth++;
                  j = nO + tagName.length + 1;
                } else {
                  depth--;
                  j = nC + close.length;
                }
              }
              bounds = { start: hintStart, end: j };
            }
          }
        }
      }
      if (!bounds) return reply.code(422).send({ error: 'Target element not found — click it again to re-select' });

      const elementHtml = html.slice(bounds.start, bounds.end);
      const openTagMatch = elementHtml.match(/^(<[^>]+>)/);
      const closeTagMatch = elementHtml.match(/<\/(\w+)>\s*$/);
      if (!openTagMatch || !closeTagMatch) return reply.code(422).send({ error: 'Element is not a paired tag' });

      const openTag = openTagMatch[1];
      const closeTag = `</${closeTagMatch[1]}>`;

      // Always replace the full innerHTML — selected.text is derived from
      // el.innerText (the complete flattened text), so newText represents
      // what the user intends to be the entire content of the element.
      const updatedHtml = html.slice(0, bounds.start) + openTag + newText + closeTag + html.slice(bounds.end);
      return saveValidatedEdit(updatedHtml, 'Text updated');
    }

    // ── Background-image patch (from InlineEditPanel "BG Image" input) ─────────
    // Format: __BG_IMAGE_PATCH__:[cssPath]||[imageUrl](||[hint — ignored])
    // [^\|]+ stops at the next || so a trailing hint doesn't corrupt data: URLs.
    const bgImagePatchMatch = instruction.match(
      /^__BG_IMAGE_PATCH__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|[\s\S]*)?$/s,
    );
    if (bgImagePatchMatch) {
      const cssPath = bgImagePatchMatch[1].trim();
      // Strip HTML-dangerous chars from https URLs; data: URLs are base64 and never contain them.
      const imgUrl = bgImagePatchMatch[2]
        .trim()
        .replace(/['"<>]/g, (c) => (bgImagePatchMatch[2].startsWith('data:') ? c : ''));

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
        const fullPatched = elementHtml.replace(bgReplaceRe, `background-image:url('${imgUrl}')`);
        return saveValidatedEdit(
          html.slice(0, bounds.start) + fullPatched + html.slice(bounds.end),
          'Background image updated',
        );
      }

      // Strategy 3: no existing background-image anywhere — add inline style to opening tag
      const tagEnd = elementHtml.indexOf('>');
      if (tagEnd === -1) return reply.code(422).send({ error: 'Malformed element' });

      const openTag = elementHtml.slice(0, tagEnd);
      const rest = elementHtml.slice(tagEnd);
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
          .trim()
          .replace(/;$/, '');
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
      const cssPath = svgReplaceMatch[1].trim();
      let svgMarkup = svgReplaceMatch[2].trim();

      if (!svgMarkup.startsWith('<svg')) return reply.code(400).send({ error: 'Payload must be an SVG element' });

      let bounds = findByPath(html, cssPath);
      // SVG-specific fallback — browsers normalize SVG attribute order so exact
      // path match can fail; locate the first <svg> inside the named section instead.
      if (!bounds) {
        const sectionIdMatch = cssPath.match(/section#([\w-]+)/);
        if (sectionIdMatch) {
          const secBounds = findByPath(html, `section#${sectionIdMatch[1]}`);
          if (secBounds) {
            const svgIdx = html.indexOf('<svg', secBounds.start);
            if (svgIdx !== -1 && svgIdx < secBounds.end) {
              const svgTagEnd = html.indexOf('>', svgIdx);
              if (svgTagEnd !== -1) {
                const svgClose = '</svg>';
                let depth = 1,
                  j = svgTagEnd + 1;
                while (j < secBounds.end && depth > 0) {
                  const nO = html.indexOf('<svg', j);
                  const nC = html.indexOf(svgClose, j);
                  if (nC === -1) break;
                  if (nO !== -1 && nO < nC) {
                    depth++;
                    j = nO + 4;
                  } else {
                    depth--;
                    j = nC + svgClose.length;
                  }
                }
                bounds = { start: svgIdx, end: j };
              }
            }
          }
        }
      }
      if (!bounds) return reply.code(422).send({ error: 'Target element not found — click it again to re-select' });

      const originalHtml = html.slice(bounds.start, bounds.end);
      // Preserve class and inline style from the original element
      const cls = originalHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
      const style = originalHtml.match(/\bstyle="([^"]+)"/i)?.[1] ?? '';
      // Inject class/style into the incoming SVG opening tag
      svgMarkup = svgMarkup.replace(
        /^<svg\b/,
        `<svg${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}`,
      );
      // Remove duplicate class/style injected above if original SVG already had them
      svgMarkup = svgMarkup.replace(/(<svg[^>]*)\bclass="[^"]*"\s*class="[^"]*"/, '$1');

      const updatedHtml = html.slice(0, bounds.start) + svgMarkup + html.slice(bounds.end);
      return saveValidatedEdit(updatedHtml, 'Icon replaced');
    }

    // ── Icon / SVG replacement (from InlineEditPanel "Replace Icon" input) ─────
    // Format: __ICON_REPLACE__:[cssPath]||[imageUrl]
    // Replaces the selected SVG/icon element with an <img> pointing at the new URL.
    const iconReplaceMatch = instruction.match(
      /^__ICON_REPLACE__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|([\s\S]*))?$/s,
    );
    if (iconReplaceMatch) {
      const cssPath = iconReplaceMatch[1].trim();
      const imgUrl = iconReplaceMatch[2].trim().replace(/['"<>]/g, '');
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
                let depth = 1,
                  j = tagEnd + 1;
                while (j < html.length && depth > 0) {
                  const nO = html.indexOf(`<${tagName}`, j);
                  const nC = html.indexOf(close, j);
                  if (nC === -1) break;
                  if (nO !== -1 && nO < nC) {
                    depth++;
                    j = nO + tagName.length + 1;
                  } else {
                    depth--;
                    j = nC + close.length;
                  }
                }
                bounds = { start: hintStart, end: j };
              }
            }
          }
        }
      }
      // SVG-specific fallback: browsers normalize SVG attribute order in outerHTML,
      // so locateElement's substring/attribute match fails. When the cssPath names a
      // section id, find the first <svg> inside that section directly.
      if (!bounds && /^<svg\b/i.test(hintHtml)) {
        const sectionIdMatch = cssPath.match(/section#([\w-]+)/);
        if (sectionIdMatch) {
          const secBounds = findByPath(html, `section#${sectionIdMatch[1]}`);
          if (secBounds) {
            const svgIdx = html.indexOf('<svg', secBounds.start);
            if (svgIdx !== -1 && svgIdx < secBounds.end) {
              const svgTagEnd = html.indexOf('>', svgIdx);
              if (svgTagEnd !== -1) {
                const svgClose = '</svg>';
                let depth = 1,
                  j = svgTagEnd + 1;
                while (j < secBounds.end && depth > 0) {
                  const nO = html.indexOf('<svg', j);
                  const nC = html.indexOf(svgClose, j);
                  if (nC === -1) break;
                  if (nO !== -1 && nO < nC) {
                    depth++;
                    j = nO + 4;
                  } else {
                    depth--;
                    j = nC + svgClose.length;
                  }
                }
                bounds = { start: svgIdx, end: j };
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
      const cls = elementHtml.match(/\bclass="([^"]+)"/i)?.[1] ?? '';
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
      const cssPath = elementEditMatch[1].trim();
      const hintHtml = elementEditMatch[2];
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
          const VOID = new Set([
            'area',
            'base',
            'br',
            'col',
            'embed',
            'hr',
            'img',
            'input',
            'link',
            'meta',
            'param',
            'source',
            'track',
            'wbr',
          ]);
          const fbTagEnd = html.indexOf('>', fbStart);
          if (fbTagEnd !== -1) {
            const opening = html.slice(fbStart, fbTagEnd + 1);
            let fbEnd: number;
            if (VOID.has(fbTag) || opening.trimEnd().endsWith('/>')) {
              fbEnd = fbTagEnd + 1;
            } else {
              const close = `</${fbTag}>`;
              let depth = 1,
                j = fbTagEnd + 1;
              while (j < html.length && depth > 0) {
                const nO = html.indexOf(`<${fbTag}`, j);
                const nC = html.indexOf(close, j);
                if (nC === -1) break;
                if (nO !== -1 && nO < nC) {
                  depth++;
                  j = nO + fbTag.length + 1;
                } else {
                  depth--;
                  j = nC + close.length;
                }
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
      const parentSecIdx = sectionBounds.findIndex((s) => s.start <= bounds!.start && bounds!.end <= s.end);
      const breadcrumb =
        parentSecIdx !== -1
          ? `Located in section ${parentSecIdx + 1} of ${sectionBounds.length}`
          : 'Located outside named sections';

      // ── Detect section-regeneration intent early — must happen before the
      // deterministic BG shortcuts below so a prompt that mentions "background"
      // or a hex colour (e.g. "Background: #020509") doesn't get intercepted
      // by the colour-patch shortcut instead of reaching the redesign flow.
      // Also covers structural fix requests ("fix overlapping strip", "repair broken layout")
      // which need a full section rewrite, not a targeted element patch.
      const isStructuralFix =
        /\b(?:fix|repair|correct|resolve)\b/i.test(editInstruction) &&
        /\b(?:overlap|overlapping|bleed(?:ing)?|overflow(?:ing)?|strip|stripe|z.?index|misalign|broken|cut.?off|clip(?:ped)?|spacing|layout|position|visual|design|gap|layer)\b/i.test(
          editInstruction,
        );
      const isRedesignIntent =
        isStructuralFix ||
        /\b(regenerat|redesign|completely new|redo|rebuild|restyle|overhaul|rewrite|remake|recreate)\b/i.test(
          editInstruction,
        );

      // ── Deterministic background-image injection for element edits ──────────
      // When the instruction contains an image URL AND "background" intent,
      // patch the CSS directly instead of sending to LLM (LLM adds <img> tags
      // instead of setting background-image, which looks like a logo overlay).
      // Skip when the user is doing a full section redesign — let that flow handle it.
      // Skip video URLs too: CSS background-image cannot render a YouTube/Vimeo
      // page or a video file — "add this video as the background" must reach the
      // LLM flow below, which embeds it as an absolutely-positioned <iframe>.
      const bgUrlMatch = editInstruction.match(/(https?:\/\/\S+)/);
      const isVideoUrlInstruction =
        !!bgUrlMatch && /youtube\.com|youtu\.be|vimeo\.com|\.(?:mp4|webm|ogv)(?:[?#]|$)/i.test(bgUrlMatch[1]);
      const isBgImageIntent =
        /\b(?:background|bg)\b/i.test(editInstruction) &&
        /\b(?:add|set|use|change|put|apply|inject)\b/i.test(editInstruction);
      if (!isRedesignIntent && bgUrlMatch && !isVideoUrlInstruction && isBgImageIntent) {
        const rawUrl = bgUrlMatch[1].replace(/['"]/g, '').replace(/[,)]+$/, '');
        // Apply background-image to the first matching element (section, div, header, etc.)
        const tagEnd = storedElementHtml.indexOf('>');
        if (tagEnd !== -1) {
          const openTag = storedElementHtml.slice(0, tagEnd);
          const rest = storedElementHtml.slice(tagEnd);
          const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
          const sm = styleRx.exec(openTag);
          let patchedTag: string;
          if (sm) {
            const existing = sm[1]
              .replace(/\bbackground-image\s*:\s*(?:url\([^)]*\)|[^;]*)\s*;?\s*/g, '')
              .replace(/\bbackground-size\s*:[^;]+;?\s*/g, '')
              .replace(/\bbackground-position\s*:[^;]+;?\s*/g, '')
              .replace(/\bbackground-repeat\s*:[^;]+;?\s*/g, '')
              .trim()
              .replace(/;$/, '');
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
      const isBgColorIntent =
        /\b(?:background[\s-]?color|bg[\s-]?color|background)\b/i.test(editInstruction) &&
        !/https?:\/\//.test(editInstruction);
      const colorValueMatch = editInstruction.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/i);
      if (!isRedesignIntent && isBgColorIntent && colorValueMatch) {
        const colorValue = colorValueMatch[1];
        const tagEnd = storedElementHtml.indexOf('>');
        if (tagEnd !== -1) {
          const openTag = storedElementHtml.slice(0, tagEnd);
          const rest = storedElementHtml.slice(tagEnd);
          const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
          const sm = styleRx.exec(openTag);
          let patchedTag: string;
          if (sm) {
            const existing = sm[1]
              .replace(/\bbackground-color\s*:[^;]+;?\s*/g, '')
              .replace(/\bbackground-image\s*:[^;]+;?\s*/g, '')
              .trim()
              .replace(/;$/, '');
            patchedTag = openTag.replace(
              styleRx,
              `style="${existing ? existing + ';' : ''}background-color:${colorValue};background-image:none !important"`,
            );
          } else {
            patchedTag = `${openTag} style="background-color:${colorValue};background-image:none !important"`;
          }
          const patched = patchedTag + rest;
          let updatedHtml = html.slice(0, bounds.start) + patched + html.slice(bounds.end);
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
      let targetHtml = storedElementHtml;

      if (isRedesignIntent) {
        // Find the enclosing <section> for the selected element.
        const allSections = extractAllTopLevelSections(html);
        const enclosing = allSections.find((s) => s.start <= bounds.start && bounds.end <= s.end);

        // Also check if any section id/class matches a keyword in the instruction.
        const mentionedName =
          /\b(hero|about|features?|pricing|contact|footer|header|cta|stats|team|process|next.?step)\b/i
            .exec(editInstruction)?.[1]
            ?.toLowerCase() ?? '';
        const namedSection = allSections.find((s) => {
          const txt = html.slice(s.start, s.start + 200).toLowerCase();
          return mentionedName && txt.includes(mentionedName);
        });

        const section = namedSection ?? enclosing;
        if (section) {
          targetBounds = section;
          targetHtml = html.slice(section.start, section.end);
          console.log(
            `⬆ Section-regeneration intent detected — target elevated to section (${targetHtml.length} chars)`,
          );
        }
      }

      // ── Detect element type for specialised prompt guidance ──────────────
      const elTag = targetHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? '';
      const isImgEl = elTag === 'img';
      const hasImgChild = !isImgEl && /<img\b/i.test(targetHtml);
      const hasImg = isImgEl || hasImgChild;
      // Also detect elements whose background IS an image via CSS (no <img> child needed)
      const hasBgImage = /background-image\s*:\s*url\(/i.test(targetHtml);
      // Pre-strip instruction prefix so we can use it in the shortcut gate below
      const strippedEdit = editInstruction
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/^<[^>]+>:\s*/, '')
        .trim();
      const isBgImgDescIntent =
        /\b(?:background|bg)\b/i.test(strippedEdit) && /\b(?:image|photo|picture|pic|img)\b/i.test(strippedEdit);
      const currentSrc = hasImg ? (targetHtml.match(/\bsrc="([^"]+)"/)?.[1] ?? '') : '';
      const currentAlt = hasImg ? (targetHtml.match(/\balt="([^"]*)"/)?.[1] ?? '') : '';

      // ── Pexels shortcut — descriptive image replacement (no URL) ─────────
      // When the user describes the desired image without providing a URL,
      // search Pexels for a contextually matching photo and inject it directly.
      // This avoids asking the LLM to recall a valid Unsplash photo ID from
      // training memory, which reliably produces wrong or stale URLs.
      // Fire for: existing <img>, CSS background-image, OR explicit "background image" desc intent
      //
      // Skip when the instruction is about a CSS layout property (height, width, fit, etc.)
      // even if it incidentally mentions "image". E.g. "the height of the image should match
      // the slide" is a CSS change on the existing element, not a request to swap content.
      const hasCssPropWord =
        /\b(?:height|width|margin|padding|position|size|fit|fill|cover|contain|aspect[\s-]ratio|max-?(?:width|height)|min-?(?:width|height)|object-fit|overflow|z-index|flex|grid|display|font-size|border|radius|opacity|justify|vertical[\s-]align|horizontal)\b/i.test(
          strippedEdit,
        );
      const hasImgReplaceVerb =
        /\b(?:show(?:ing)?|replace|swap|use\s+(?:a|an|the)\s+(?:image|photo|picture)|change\s+(?:the\s+)?(?:image|photo|picture)\s+(?:to|with)|find\s+(?:a|an|me)\s+(?:image|photo|picture)|add\s+(?:a|an)\s+(?:image|photo|picture))\b/i.test(
          strippedEdit,
        );
      // True when the instruction describes a CSS/layout property of the existing element
      // rather than the visual content of a replacement image.
      const isImageCssChangeOnly = hasCssPropWord && !hasImgReplaceVerb;

      if (!isRedesignIntent && !isImageCssChangeOnly && (hasImg || hasBgImage || isBgImgDescIntent) && !/https?:\/\//.test(editInstruction)) {
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
          } catch {
            /* fall through to LLM edit */
          }

          if (pexelsQuery) {
            const pexelsUrl = await fetchPexelsImageUrl(pexelsQuery);
            console.log(
              `📸 Pexels result for "${pexelsQuery}": ${pexelsUrl ?? '(no result — using Unsplash Source fallback)'}`,
            );
            const imageUrl =
              pexelsUrl ?? `https://source.unsplash.com/featured/1200x800/?${encodeURIComponent(pexelsQuery)}`;
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
                  const rest = target.slice(tagEndIdx);
                  const styleRx = /\bstyle\s*=\s*"([^"]*)"/i;
                  const sm = styleRx.exec(openTag);
                  const bgStyle = `background-image:url('${url}');background-size:cover;background-position:center;background-repeat:no-repeat`;
                  if (sm) {
                    const existing = sm[1]
                      .replace(/background-image[^;]+;?\s*/g, '')
                      .trim()
                      .replace(/;$/, '');
                    return openTag.replace(styleRx, `style="${existing ? existing + ';' : ''}${bgStyle}"`) + rest;
                  }
                  return `${openTag} style="${bgStyle}"` + rest;
                }
              }
              return out;
            };
            const patched = injectUrl(targetHtml, imageUrl);
            if (patched !== targetHtml) {
              console.log(
                `⚡ Image shortcut (${pexelsUrl ? 'pexels' : 'unsplash-source'}): "${pexelsQuery}" → ${imageUrl}`,
              );
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
      // Replace the watch URL with the embed URL inside the instruction so the LLM only
      // ever sees ONE URL — having both watch + embed in the same prompt causes two iframes.
      const elVideoRawUrl = elVideoUrlMatch ? elVideoUrlMatch[0].replace(/['"<>)\],.]+$/, '') : '';
      const elVideoEmbedUrl = elVideoRawUrl ? toEmbedUrl(elVideoRawUrl) : '';
      const editInstructionForPrompt = elVideoRawUrl
        ? editInstruction.replace(elVideoRawUrl, elVideoEmbedUrl)
        : editInstruction;
      const videoGuidance = elVideoEmbedUrl
        ? `
VIDEO-SPECIFIC RULES (the instruction contains a video URL):
- Use this exact embed URL as the iframe src (do NOT alter it or invent another): ${elVideoEmbedUrl}
- Background/full-bleed placement: add position:relative;overflow:hidden to this element's inline style and insert as its FIRST child:
  <iframe src="[embed URL]" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border:0;z-index:0" allow="autoplay; fullscreen" frameborder="0"></iframe>
  (then make sure the element's direct content children have position:relative and a higher z-index so they stay visible above the video)
- Inline/content placement: insert where it reads naturally:
  <div style="position:relative;padding-top:56.25%"><iframe src="[embed URL]" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>
- If the instruction asks to replace an existing video, change the existing iframe's src instead of adding a second iframe`
        : '';

      const imageGuidance = hasImg
        ? `
IMAGE-SPECIFIC RULES (this element contains an image):
- Current src: ${currentSrc}
- Current alt: ${currentAlt || '(none)'}
- If the instruction asks to change/replace/update the image without specifying a URL:
  • Choose a high-quality Unsplash image that fits the alt text and current URL context
  • Use format: https://images.unsplash.com/photo-XXXXXXXXXXXXXXX?w=1200&auto=format&fit=crop&q=80
  • Replace ONLY the src attribute value — keep all other attributes unchanged
- If the instruction provides a specific URL, use that URL exactly`
        : '';

      const regenRootTag = targetHtml.match(/^<(\w+)/)?.[1]?.toLowerCase() ?? 'section';
      const regenModeNote = isStructuralFix
        ? `\nFIX MODE: Correct the described layout/design problem only. Do NOT change any colors, text content, branding, or visual style — only fix the structural issue described.`
        : '';
      const elementPrompt = isRedesignIntent
        ? `You are regenerating a complete HTML section/slide. Return ONLY the root element — nothing before or after it.

SECTION TO REGENERATE:
${targetHtml}

INSTRUCTION: ${editInstructionForPrompt}
${regenModeNote}
Output rules (strictly enforced):
- Start your output with the opening tag (<${regenRootTag}...) and end with </${regenRootTag}>
- Do NOT output <!DOCTYPE>, <html>, <head>, or <body>
- All CSS MUST be inside a single <style> tag placed as the LAST child, before </${regenRootTag}>
- All CSS selectors MUST be scoped with a unique prefix (e.g. .regen-${Date.now().toString(36)}-) — zero style leakage to other sections
- All JS MUST be inside a single <script> tag placed as the LAST child, just before </${regenRootTag}>
- All JS MUST be wrapped in an IIFE: (function(){ ... })(); — no global variable declarations
- Keep ALL existing text content exactly as-is unless the instruction explicitly changes it
- No external libraries except Google Fonts (loaded via @import inside the <style> tag)`
        : `You are making a precise edit to one HTML element. Return ONLY the modified element — same root tag, same nesting. Do not return any surrounding HTML, parent elements, or the full section.

ELEMENT PATH: ${cssPath || hintHtml.slice(0, 80)}
CONTEXT: ${breadcrumb}

ELEMENT TO EDIT:
${targetHtml}

INSTRUCTION: ${editInstructionForPrompt}
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

      const raw = await llmGenerateFn(elementPrompt);
      const modified = extractHtmlFromResponse(raw);

      console.log('\n┌─ LLM RESPONSE (raw) ─────────────────────────────────────────');
      console.log(raw?.slice(0, 2000) ?? '(empty)');
      console.log('├─ EXTRACTED HTML ──────────────────────────────────────────────');
      console.log(modified?.slice(0, 1000) ?? '(none — extraction failed)');
      console.log(`└─ Status: ${modified ? '✓ HTML extracted successfully' : '✗ No HTML extracted'}`);

      if (!modified) {
        return reply.code(502).send({ error: 'LLM returned empty response — try rephrasing' });
      }

      // ── Guard: reject non-HTML — prose or JSON text would be spliced in as content ──
      if (!modified.trimStart().startsWith('<')) {
        return reply.code(502).send({ error: 'LLM returned non-HTML content — try rephrasing or selecting the element directly' });
      }

      // ── Guard: reject full-page HTML — these would corrupt the document ──
      if (/<!doctype|<html[\s>]/i.test(modified) || /<\/?(head|body)\b/i.test(modified)) {
        console.log('✗ LLM returned full-page HTML — rejecting');
        return reply.code(422).send({
          error:
            'LLM returned a full HTML page instead of just the section. Try selecting the specific section element and rephrasing.',
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
      const hoistedStyles: string[] = [];
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
        console.log(
          `⬆ Hoisting ${hoistedStyles.length} <style> block(s) and ${hoistedScripts.length} <script> block(s)`,
        );
      }

      // ── Exact positional splice — no string matching needed ───────────────
      let updatedHtml = html.slice(0, targetBounds.start) + splicedSection + html.slice(targetBounds.end);

      // Inject hoisted styles before </head> and scripts before </body>
      if (hoistedStyles.length) {
        const headClose = updatedHtml.indexOf('</head>');
        const styleBlock = hoistedStyles.join('\n');
        updatedHtml =
          headClose !== -1
            ? updatedHtml.slice(0, headClose) + styleBlock + '\n' + updatedHtml.slice(headClose)
            : styleBlock + '\n' + updatedHtml;
      }
      if (hoistedScripts.length) {
        const bodyClose = updatedHtml.lastIndexOf('</body>');
        const scriptBlock = hoistedScripts.join('\n');
        updatedHtml =
          bodyClose !== -1
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

    // All three current orientations (web, 16:9 PDF, 9:16 PDF) generate a
    // <section> per top-level block — only the id-naming convention differs
    // (semantic names like "hero" vs numbered "slide-1", both handled equally
    // by every downstream consumer here). A future format (e.g. a pptx-style
    // import, mirroring the separate slide-deck editor's own <div class="slide">
    // convention) might not use <section> at all — fall back to scanning for
    // that shape so section-list/regen/breadcrumb logic degrades gracefully
    // instead of silently seeing zero sections.
    function extractTopLevelBlocks(
      src: string,
      tag: string,
      classFilter?: string,
    ): Array<{ start: number; end: number }> {
      const out: Array<{ start: number; end: number }> = [];
      const openTagLen = tag.length + 1; // "<" + tag
      const closeTag = `</${tag}>`;
      let pos = 0;
      while (pos < src.length) {
        const openIdx = src.indexOf(`<${tag}`, pos);
        if (openIdx === -1) break;
        const tagEnd = src.indexOf('>', openIdx);
        if (tagEnd === -1) break;
        if (classFilter) {
          const opening = src.slice(openIdx, tagEnd + 1);
          const classes = (opening.match(/\bclass="([^"]+)"/i)?.[1] ?? '').split(/\s+/);
          if (!classes.includes(classFilter)) {
            pos = tagEnd + 1;
            continue;
          }
        }
        let depth = 1,
          i = tagEnd + 1,
          blockEnd = -1;
        while (i < src.length && depth > 0) {
          const nextOpen = src.indexOf(`<${tag}`, i);
          const nextClose = src.indexOf(closeTag, i);
          if (nextClose === -1) break;
          if (nextOpen !== -1 && nextOpen < nextClose) {
            depth++;
            i = nextOpen + openTagLen;
          } else {
            depth--;
            i = nextClose + closeTag.length;
            if (depth === 0) blockEnd = i;
          }
        }
        if (blockEnd !== -1) {
          out.push({ start: openIdx, end: blockEnd });
          pos = blockEnd;
        } else {
          pos = tagEnd + 1;
        }
      }
      return out;
    }

    function extractAllTopLevelSections(src: string): Array<{ start: number; end: number }> {
      const sections = extractTopLevelBlocks(src, 'section');
      if (sections.length > 0) return sections;
      // Fallback for a section-less format — matches the slide-deck editor's
      // own <div class="slide"> convention.
      return extractTopLevelBlocks(src, 'div', 'slide');
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

      // Numbered ordinal: "slide 2", "section 3", "slide #2", "2nd slide"
      const numMatch =
        hintLower.match(/\b(?:slide|section)\s+#?(\d+)\b/) ??
        hintLower.match(/\b(\d+)(?:st|nd|rd|th)\s+(?:slide|section)\b/);
      if (numMatch) {
        const idx = parseInt(numMatch[1] ?? '0', 10) - 1;
        if (idx >= 0 && idx < secs.length) {
          const s = secs[idx];
          return {
            before: src.slice(0, s.start),
            section: src.slice(s.start, s.end),
            after: src.slice(s.end),
            tag: 'section',
          };
        }
      }

      const words = hintLower.split(/\W+/).filter((w) => w.length > 2);

      let best = secs[0],
        bestScore = -1;
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
          if (attrs.includes(w)) score += 4; // id/class match is the strongest signal
          if (headingText.includes(w)) score += 3; // heading text is second strongest
          if (textLower.includes(w)) score += 1; // general content match
        }

        // Positional aliases: "hero" or "first" → first section; "footer"/"last" → last
        if (i === 0 && /\b(?:hero|banner|intro|first|top)\b/.test(hintLower)) score += 6;
        if (i === secs.length - 1 && /\b(?:footer|last|bottom|end)\b/.test(hintLower)) score += 6;

        if (score > bestScore) {
          bestScore = score;
          best = secs[i];
        }
      }
      return {
        before: src.slice(0, best.start),
        section: src.slice(best.start, best.end),
        after: src.slice(best.end),
        tag: 'section',
      };
    }

    function extractHeaderBlock(src: string): SectionSlice | null {
      const rx = /<(header|nav)\b[^>]*>[\s\S]*?<\/\1>/i;
      const m = rx.exec(src);
      if (!m) return null;
      return {
        before: src.slice(0, m.index),
        section: m[0],
        after: src.slice(m.index + m[0].length),
        tag: m[1].toLowerCase(),
      };
    }
    // ──────────────────────────────────────────────────────────────────────────

    function applyPatches(
      base: string,
      patches: Array<{ find: string; replace: string }>,
    ): { html: string; applied: number; missed: number } {
      let result = base;
      let applied = 0,
        missed = 0;
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

    // Rescue extractor: pull out complete find/replace pairs from malformed/truncated patches JSON
    function rescuePatchesFromMicrositeText(rawText: string): Array<{ find: string; replace: string }> | null {
      const patches: Array<{ find: string; replace: string }> = [];
      const re = /"find"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"replace"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = re.exec(rawText)) !== null) {
        try {
          const find = JSON.parse(`"${m[1]}"`);
          const replace = JSON.parse(`"${m[2]}"`);
          if (find) patches.push({ find, replace });
        } catch { /* skip malformed pair */ }
      }
      return patches.length > 0 ? patches : null;
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

    // Explicit regen/redesign intent → single-section rewrite path
    const isPureRegenIntent = /\b(?:regenerate|rewrite|rebuild|redesign|redo|remake|recreate)\b/i.test(instruction);
    // Structural fix intent — "fix overlapping strip", "repair broken layout", etc.
    // These need a full section rewrite rather than a targeted text patch.
    const isStructuralFixIntent =
      !isPureRegenIntent &&
      /\b(?:fix|repair|correct|resolve)\b/i.test(instruction) &&
      /\b(?:overlap|overlapping|bleed(?:ing)?|overflow(?:ing)?|strip|stripe|z.?index|misalign|broken|cut.?off|clip(?:ped)?|spacing|layout|position|visual|design|gap|layer)\b/i.test(
        instruction,
      );
    const isRegenIntent = isPureRegenIntent || isStructuralFixIntent;
    const isHeaderInstruction = /\b(?:logo|brand|icon|favicon|header|nav(?:bar)?)\b/i.test(instruction);

    let sectionCtx: SectionSlice | null = null;
    if (isRegenIntent) {
      sectionCtx = (isHeaderInstruction ? extractHeaderBlock(html) : null) ?? extractBestSection(html, instruction);
    }

    // ── Section regeneration helper (regen intent + structural fix) ──────────
    async function regenSection(ctx: SectionSlice): Promise<string> {
      // For pure regeneration with no design-change words, lock down all visual aspects.
      const designChangeWords =
        /\b(?:dark|light|color|colour|font|size|background|theme|style|palette|weight|spacing|layout|gradient|border|shadow)\b/i;
      const isDesignChangeInstruction = designChangeWords.test(instruction ?? '');

      // Extract inline color values from the section so we can explicitly list them
      const inlineColors = [...new Set(ctx.section.match(/#[0-9a-fA-F]{3,8}\b|rgb\([^)]+\)|rgba\([^)]+\)/g) ?? [])]
        .slice(0, 12)
        .join(', ');

      const modeNote = isStructuralFixIntent
        ? `\nFIX MODE: Fix the described design issue only. Do NOT change any colors, text content, branding, or visual style — only correct the structural/layout problem described.`
        : isPureRegenIntent && !isDesignChangeInstruction
          ? `\nREGENERATION MODE: Refresh the content but preserve ALL visual design exactly — same colors${inlineColors ? ` (${inlineColors})` : ''}, fonts, font sizes, spacing, layout, and visual hierarchy. Do not change any design characteristics.`
          : '';

      const regenPrompt = `You are rewriting one section of an HTML microsite.

Apply the instruction exactly. You may change: text content, headings, body copy, colors, backgrounds, fonts, font sizes, font weights, spacing, layout, images, icons, buttons, links — whatever the instruction requires.
Preserve: overall section structure unless told otherwise, CSS class names, responsive/grid patterns, and references to CSS design tokens below.
${modeNote}
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
    const sectionList = allSecs
      .map((s, i) => {
        const snippet = html.slice(s.start, Math.min(s.start + 300, s.end));
        return (
          snippet.match(/\bid="([^"]+)"/)?.[1] ??
          snippet.match(/\bdata-section="([^"]+)"/)?.[1] ??
          snippet.match(/\bclass="([^"\s]+)/)?.[1] ??
          snippet.match(/<h[1-3][^>]*>([^<]{1,40})<\/h[1-3]>/i)?.[1]?.trim() ??
          `section-${i + 1}`
        );
      })
      .join(', ');

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
      let depth = 0,
        end = -1,
        inStr = false,
        esc = false;
      for (let i = start; i < raw.length; i++) {
        const c = raw[i];
        if (esc) {
          esc = false;
          continue;
        }
        if (c === '\\' && inStr) {
          esc = true;
          continue;
        }
        if (c === '"') {
          inStr = !inStr;
          continue;
        }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) return null;
      try {
        const slice = raw
          .slice(start, end + 1)
          .replace(/("(?:[^"\\]|\\.)*")/gs, (m) => m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
        return JSON.parse(slice) as MicrositeOp;
      } catch {
        return null;
      }
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
    if (!isRegenIntent && !/https?:\/\//.test(instruction) && /\b(?:image|photo|picture|pic)\b/i.test(instruction)) {
      try {
        const qPrompt = `Does this instruction require adding or replacing an image with a new one fetched from the web? Answer "no" if the instruction is about removing, hiding, or deleting an image, or if no new image is needed. Otherwise answer with a concise 2-5 keyword image search query (keywords only, nothing else).\n\nInstruction: ${instruction}`;
        const pexelsQ = (await llmGenerateFn(qPrompt))
          .trim()
          .replace(/^["'`]|["'`]$/g, '')
          .trim()
          .slice(0, 80);
        if (pexelsQ && !/^no\b/i.test(pexelsQ)) {
          const pexelsUrl = await fetchPexelsImageUrl(pexelsQ);
          if (pexelsUrl) {
            augmentedInstruction = `${instruction}\n\nIMPORTANT — use this exact image URL (do NOT invent or substitute any other URL): ${pexelsUrl}`;
            resolvedUrlToVerify = pexelsUrl;
            resolvedUrlKind = 'image';
            console.log(`📸 Pexels pre-fetch for global edit: "${pexelsQ}" → ${pexelsUrl}`);
          }
        }
      } catch {
        /* fall through — LLM will handle without a real URL */
      }
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
      const rawVideoUrl = videoUrlMatch[0].replace(/['"<>)\],.]+$/, '');
      const embedUrl = toEmbedUrl(rawVideoUrl);
      // Replace the watch URL with the embed URL in-place so the LLM sees only ONE URL.
      // Appending a second URL causes two iframes to be added.
      augmentedInstruction = augmentedInstruction.replace(rawVideoUrl, embedUrl);
      resolvedUrlToVerify = embedUrl;
      resolvedUrlKind = 'video';
      console.log(`🎬 Video URL pre-normalized for global edit: ${embedUrl.slice(0, 80)}`);
    }

    const opPrompt = isRegenIntent
      ? ''
      : `You are editing an HTML microsite. Pick the ONE operation that best fits the instruction and respond with a single JSON object — nothing else.

OPERATION TYPES:

OP patches — targeted changes to existing content (text, values, colors, images, styles).
Works across ALL sections in one pass. Use multiple patches for values repeated in different sections.
{ "op": "patches", "patches": [{ "find": "exact substring", "replace": "new value" }], "summary": "..." }
Rules:
- Copy each "find" string EXACTLY from the HTML — character-for-character, no paraphrasing
- For style/color changes, prefer SHORT "find" strings targeting just the CSS value (e.g. "#C8A96E" or "color:#C8A96E;") rather than wrapping HTML — this avoids escaping issues and matches every occurrence
- Include 15–40 chars of surrounding context only when needed to make "find" unique
- NEVER put newlines inside "find" or "replace" — single-line strings only
- CRITICAL: if "find" or "replace" must include HTML with attribute values, you MUST escape every inner double-quote with a backslash (e.g. style=\"color:red\" NOT style="color:red") — unescaped quotes break JSON parsing
- Include EVERY patch needed to fully and consistently apply the instruction.
  If the change affects many repeated values (e.g. recalculating percentages
  and dollar amounts across an entire pricing/breakdown table when the total
  changes), include one patch per value — ALL of them, not a representative
  sample. There is no fixed cap: dropping some patches to stay under an
  arbitrary count leaves the document internally inconsistent (e.g. a headline
  total that no longer matches the line items or footer beneath it), which is
  worse than a longer response. Typically well under 40 for a normal edit, but
  size the count to what the instruction actually requires.

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
{ "op": "clarify", "question": "Which section should this apply to? (e.g. ${sectionList.split(',').slice(0, 3).join(', ')}...)" }
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
        summary = isStructuralFixIntent ? 'Section fixed' : 'Section regenerated';
      } catch {
        return reply
          .code(502)
          .send({ error: 'Could not regenerate section — try providing more detail in your instruction' });
      }
    } else {
      const op = parseOp(raw);
      if (!op) {
        // If the response looks like a patches op that failed to parse (malformed or truncated
        // JSON), rescue whatever complete patches are present via regex — the HTML fallback
        // would otherwise inject raw JSON text as microsite content.
        if (/"op"\s*:\s*"patches"/.test(raw ?? '')) {
          const rescued = rescuePatchesFromMicrositeText(raw ?? '');
          if (rescued && rescued.length > 0) {
            const { html: patched, applied, missed } = applyPatches(html, rescued);
            if (applied > 0) {
              updatedHtml = patched;
              summary = `Updated (${applied} change${applied !== 1 ? 's' : ''}${missed > 0 ? `, ${missed} skipped` : ''})`;
              console.log(`↩️  Rescued ${applied} patches via regex from malformed/truncated JSON`);
            } else {
              return reply.code(502).send({ error: 'Edit could not be applied — the target text was not found. Try being more specific.' });
            }
          } else {
            return reply.code(502).send({ error: 'Edit could not be applied — try rephrasing' });
          }
        } else {
        // LLM returned raw HTML instead of JSON (common for section rewrites) — treat as section_replace.
        const fallbackBlock = extractBlockFromResponse(raw);
        if (fallbackBlock) {
          const ctx = extractBestSection(html, instruction);
          if (ctx) {
            updatedHtml = ctx.before + fallbackBlock.block + ctx.after;
            summary = 'Section updated';
            console.log('↩️  parseOp null — used raw HTML block fallback');
          } else {
            return reply.code(502).send({ error: 'LLM returned no recognisable format — try rephrasing' });
          }
        } else {
          // Last resort: if it looks like a fix/regen ask, rewrite the section directly.
          const ctx = extractBestSection(html, instruction);
          if (ctx && /\b(?:fix|repair|regenerate|redesign|rewrite|rebuild|redo|correct)\b/i.test(instruction)) {
            try {
              updatedHtml = await regenSection(ctx);
              summary = 'Section updated';
              console.log('↩️  parseOp null — fell through to regenSection');
            } catch {
              return reply.code(502).send({ error: 'LLM returned no recognisable format — try rephrasing' });
            }
          } else {
            return reply.code(502).send({ error: 'LLM returned no recognisable format — try rephrasing' });
          }
        }
        } // close: else (not patches format — HTML fallback)
      } else {
        if (op.op === 'patches') {
          const { html: patched, applied, missed } = applyPatches(html, op.patches);
          if (applied === 0) {
            // Patches couldn't find their target — LLM-generated find string doesn't
            // match the stored HTML (common after a section_replace restructured the DOM,
            // e.g. the user tries to edit/remove an element the LLM just added).
            // Fall back to a direct section rewrite so the instruction still applies.
            const fbCtx = extractBestSection(html, instruction);
            if (fbCtx) {
              try {
                updatedHtml = await regenSection(fbCtx);
                summary = op.summary || 'Section updated';
                console.log('↩️  patches applied=0 — fell through to regenSection');
              } catch {
                return reply.code(502).send({ error: 'Edit could not be applied — the target text was not found. Try being more specific.' });
              }
            } else {
              return reply.code(502).send({ error: 'Edit could not be applied — the target text was not found. Try being more specific.' });
            }
          } else {
            updatedHtml = patched;
            summary = op.summary;
            changedTexts = op.patches.filter((p) => p.replace !== undefined).map((p) => p.replace);
            if (missed > 0) summary += ` (${missed} patch${missed > 1 ? 'es' : ''} skipped — text not found)`;
          }
        } else if (op.op === 'section_replace') {
          const ctx = extractBestSection(html, op.anchor);
          if (!ctx) return reply.code(502).send({ error: `Section "${op.anchor}" not found` });
          updatedHtml = ctx.before + op.html + ctx.after;
          summary = op.summary;
        } else if (op.op === 'section_insert') {
          const ctx = extractBestSection(html, op.anchor);
          if (!ctx) return reply.code(502).send({ error: `Anchor section "${op.anchor}" not found` });
          updatedHtml =
            op.position === 'before'
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
            error:
              op.question || 'Which section should this apply to? Select the element directly, or name the section.',
          });
        } else {
          return reply.code(502).send({ error: 'Unknown operation returned by LLM — try rephrasing' });
        }
      } // close: else (op !== null)
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
      const idMatch =
        resolvedUrlToVerify.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i) ??
        resolvedUrlToVerify.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
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
    if (
      /\b(?:remove|delete|clear|hide)\b/i.test(instruction) &&
      /\b(?:video|iframe|vimeo|youtube)\b/i.test(instruction)
    ) {
      const before = (html.match(/<iframe\b/gi) ?? []).length;
      const after = (updatedHtml.match(/<iframe\b/gi) ?? []).length;
      if (after >= before) {
        return reply.code(422).send({
          error:
            'Edit did not apply — the video/iframe is still present in the result. Try rephrasing or naming the section more specifically.',
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
    } catch {
      return reply.code(404).send({ error: 'Microsite not found' });
    }

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
      let depth = 1,
        i = tagEnd + 1,
        sectionEnd = -1;
      while (i < html.length && depth > 0) {
        const nOpen = html.indexOf('<section', i);
        const nClose = html.indexOf('</section>', i);
        if (nClose === -1) break;
        if (nOpen !== -1 && nOpen < nClose) {
          depth++;
          i = nOpen + 8;
        } else {
          depth--;
          i = nClose + 10;
          if (depth === 0) sectionEnd = i;
        }
      }
      if (sectionEnd !== -1) {
        sectionBounds.push({ start: openIdx, end: sectionEnd });
        pos = sectionEnd;
      } else {
        pos = tagEnd + 1;
      }
    }

    const sections = sectionBounds.map((s, i) => {
      const text = html.slice(s.start, s.end);
      const headingMatch = /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i.exec(text);
      const idMatch = /\bid="([^"]+)"/.exec(text);
      const classMatch = /\bclass="([^"]+)"/.exec(text);
      const label =
        headingMatch?.[1]?.trim() ?? idMatch?.[1]?.trim() ?? classMatch?.[1]?.split(/\s+/)[0] ?? `Section ${i + 1}`;
      return { index: i, label, length: text.length, preview: text.slice(0, 200) };
    });

    return reply.send({ sections, total: sections.length });
  });

  // POST /super-clients/:name/microsites/:id/sections/regenerate  — rewrite one section with LLM
  app.post(
    '/super-clients/:name/microsites/:id/sections/regenerate',
    async (req: FastifyRequest, reply: FastifyReply) => {
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
      } catch {
        return reply.code(404).send({ error: 'Microsite not found' });
      }

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
        let depth = 1,
          ci = te + 1,
          se = -1;
        while (ci < html.length && depth > 0) {
          const no = html.indexOf('<section', ci);
          const nc = html.indexOf('</section>', ci);
          if (nc === -1) break;
          if (no !== -1 && no < nc) {
            depth++;
            ci = no + 8;
          } else {
            depth--;
            ci = nc + 10;
            if (depth === 0) se = ci;
          }
        }
        if (se !== -1) {
          bounds.push({ start: oi, end: se });
          p = se;
        } else {
          p = te + 1;
        }
      }

      if (bounds.length === 0) return reply.code(400).send({ error: 'No sections found in microsite HTML' });

      let target = bounds[0];
      const idx = body?.sectionIndex ?? -1;
      if (idx >= 0 && idx < bounds.length) {
        target = bounds[idx];
      } else {
        // Score by id/class/heading match (same logic as edit endpoint)
        const hintLower = instruction.toLowerCase();
        const words = hintLower.split(/\W+/).filter((w) => w.length > 2);
        let best = bounds[0],
          bestScore = -1;
        for (let i = 0; i < bounds.length; i++) {
          const text = html.slice(bounds[i].start, bounds[i].end);
          const textLower = text.toLowerCase();
          let score = 0;
          const attrs = [/\bid="([^"]+)"/.exec(text)?.[1] ?? '', /\bclass="([^"]+)"/.exec(text)?.[1] ?? '']
            .join(' ')
            .toLowerCase();
          const heading = (/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/i.exec(text)?.[1] ?? '').toLowerCase();
          for (const w of words) {
            if (attrs.includes(w)) score += 4;
            if (heading.includes(w)) score += 3;
            if (textLower.includes(w)) score += 1;
          }
          if (i === 0 && /\b(?:hero|banner|intro|first|top)\b/.test(hintLower)) score += 6;
          if (i === bounds.length - 1 && /\b(?:footer|last|bottom|end)\b/.test(hintLower)) score += 6;
          if (score > bestScore) {
            bestScore = score;
            best = bounds[i];
          }
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
      const updatedAst = {
        ...ast,
        sections: [
          { ...astSections![0], customHtml: updatedHtml, previousHtml: html },
          ...(astSections ?? []).slice(1),
        ],
      };
      await writeFile(filePath, JSON.stringify(updatedAst, null, 2));

      return reply.send({
        html: updatedHtml,
        sectionHtml: sectionMatch[0],
        sectionIndex: idx >= 0 ? idx : null,
        summary: 'Section regenerated',
      });
    },
  );

  // POST /super-clients/:name/microsites/:id/revert  — undo last edit
  app.post('/super-clients/:name/microsites/:id/revert', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.status(400).send({ error: 'Invalid id' });

    const dir = path.join(superClientsRoot, name);
    const filePath = path.join(dir, 'microsites', `${id}.json`);
    try {
      await readMeta(dir);
    } catch {
      return reply.status(404).send({ error: 'Client not found' });
    }

    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      return reply.status(404).send({ error: 'Microsite not found' });
    }

    const sections = ast.sections as Array<Record<string, unknown>> | undefined;
    const currentHtml = (sections?.[0]?.customHtml as string | undefined) ?? '';
    const previousHtml = sections?.[0]?.previousHtml as string | undefined;

    if (!previousHtml) return reply.status(409).send({ error: 'No previous version to revert to' });

    const revertedAst = {
      ...ast,
      sections: [
        { ...sections![0], customHtml: previousHtml, previousHtml: currentHtml },
        ...(sections ?? []).slice(1),
      ],
    };
    await writeFile(filePath, JSON.stringify(revertedAst, null, 2));

    return reply.send({ html: previousHtml });
  });

  // PATCH /super-clients/:name/microsites/:id/html  — directly overwrite customHtml (no LLM)
  app.patch('/super-clients/:name/microsites/:id/html', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, id } = req.params as { name: string; id: string };
    if (!/^[\w\-:.]+$/.test(id)) return reply.code(400).send({ error: 'Invalid id' });

    const { customHtml: rawCustomHtml } = (req.body ?? {}) as { customHtml?: string };
    if (typeof rawCustomHtml !== 'string' || !rawCustomHtml.trim())
      return reply.code(400).send({ error: 'Missing customHtml' });
    const customHtml = stripPreviewInjections(rawCustomHtml);

    const dir = path.join(superClientsRoot, name);
    const filePath = path.join(dir, 'microsites', `${id}.json`);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(path.join(dir, 'microsites'))))
      return reply.code(400).send({ error: 'Invalid id' });

    let ast: Record<string, unknown>;
    try {
      ast = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>;
    } catch {
      return reply.code(404).send({ error: 'Microsite not found' });
    }

    const sections = ast.sections as Array<Record<string, unknown>> | undefined;
    const prevHtml = (sections?.[0]?.customHtml as string | undefined) ?? '';
    const updatedAst = {
      ...ast,
      sections: [{ ...(sections?.[0] ?? {}), customHtml, previousHtml: prevHtml }, ...(sections ?? []).slice(1)],
    };
    await writeFile(filePath, JSON.stringify(updatedAst, null, 2));
    return reply.send({ ok: true });
  });

  // ── Slide routes ─────────────────────────────────────────────────────────────

  // GET /super-clients/:name/slides  — list saved presentations
  app.get('/super-clients/:name/slides', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const dir = path.join(superClientsRoot, name);
    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: 'Client not found' });
    }
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
    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: 'Client not found' });
    }
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
    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: 'Client not found' });
    }
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
    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: 'Client not found' });
    }
    try {
      await rm(path.join(dir, 'slides', `${id}.json`), { force: true });
      await rm(path.join(dir, 'slides', `${id}.html`), { force: true });
      let index: SavedSlide[] = [];
      try {
        index = JSON.parse(await readFile(path.join(dir, 'slides.json'), 'utf-8')) as SavedSlide[];
      } catch {
        /* ok */
      }
      await writeFile(
        path.join(dir, 'slides.json'),
        JSON.stringify(
          index.filter((s) => s.id !== id),
          null,
          2,
        ),
      );
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
    let selectedElementCssPath = ''; // captured from __ELEMENT_EDIT__ for slide targeting

    if (instruction.startsWith('__ELEMENT_EDIT__:')) {
      const payload = instruction.slice('__ELEMENT_EDIT__:'.length);
      const parts = payload.split('||');
      const cssPath = parts[0] ?? '';
      const outerHtml = parts[1] ?? '';
      const userText = parts.slice(2).join('||');
      resolvedInstruction = userText;
      selectedElementCssPath = cssPath;
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
    } else if (instruction.startsWith('__GRADIENT_TEXT_PATCH__:')) {
      const parts = instruction.slice('__GRADIENT_TEXT_PATCH__:'.length).split('||');
      const cssPath = parts[0] ?? '';
      const gradientCss = parts[1] ?? '';
      const hintHtml = parts[2] ?? '';
      resolvedInstruction = `Apply gradient text effect to the element at CSS path "${cssPath}": set background-image to "${gradientCss}", -webkit-background-clip to text, background-clip to text, -webkit-text-fill-color to transparent, and color to transparent. Keep all other styles and content unchanged.${hintHtml ? `\nElement hint: ${hintHtml.slice(0, 400)}` : ''}`;
      displaySummary = 'Gradient text updated';
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
        let depth = 1,
          j = m.index + m[0].length;
        while (j < src.length && depth > 0) {
          const nO = src.indexOf('<div', j);
          const nC = src.indexOf('</div>', j);
          if (nC === -1) {
            j = src.length;
            break;
          }
          if (nO !== -1 && nO < nC) {
            depth++;
            j = nO + 4;
          } else {
            depth--;
            j = nC + 6;
          }
        }
        out.push({ start: m.index, end: j });
        openRe.lastIndex = j; // skip past this slide — never match nested .slide divs
      }
      return out;
    }

    const slideBounds = extractSlideBounds(html);
    const slideList = slideBounds
      .map((b, i) => {
        const text = html.slice(b.start, b.end);
        const heading =
          /<h[1-6][^>]*>\s*([^<]{1,60})/i.exec(text)?.[1]?.trim() ??
          />\s*([A-Za-z][^<]{2,60})</.exec(text)?.[1]?.trim() ??
          '';
        return `slide ${i + 1}${heading ? ` — "${heading}"` : ''}`;
      })
      .join('\n');

    // CSS :root token block (for design-preserving regen)
    const slideCssVarsBlock = /:root\s*\{[^}]+\}/i.exec(html)?.[0] ?? '';

    // Detect regen/fix intent from the resolved (user-typed) instruction.
    // Works for both free-text and element-selected cases — resolvedInstruction
    // is always the user's actual text (stripped of __ELEMENT_EDIT__ prefix).
    const isSlideRegenIntent =
      /\b(?:regenerate|rewrite|rebuild|redesign|redo|remake|recreate)\b/i.test(resolvedInstruction) ||
      (/\b(?:fix|repair|correct|resolve)\b/i.test(resolvedInstruction) &&
        /\b(?:overlap|overlapping|bleed(?:ing)?|overflow(?:ing)?|strip|stripe|z.?index|misalign|broken|cut.?off|clip(?:ped)?|spacing|layout|position|visual|design|gap|layer)\b/i.test(
          resolvedInstruction,
        ));
    const isSlideStructuralFix = isSlideRegenIntent && /\b(?:fix|repair|correct|resolve)\b/i.test(resolvedInstruction);
    const isPureSlideRegen = isSlideRegenIntent && !isSlideStructuralFix;

    // Determine which slide to target for regen.
    // Priority: (1) enclosing slide of the selected element, (2) "slide N" in text, (3) first slide.
    function targetSlideIdx(instr: string): number {
      // When an element was selected, find its enclosing slide by CSS path bounds
      if (selectedElementCssPath && slideBounds.length > 0) {
        const elBounds = findByPath(html, selectedElementCssPath);
        if (elBounds) {
          const idx = slideBounds.findIndex((b) => b.start <= elBounds.start && elBounds.end <= b.end);
          if (idx !== -1) return idx;
        }
      }
      // Fall back to ordinal in text: "slide 2", "2nd slide"
      const m =
        instr.toLowerCase().match(/\bslide\s+#?(\d+)\b/) ??
        instr.toLowerCase().match(/\b(\d+)(?:st|nd|rd|th)\s+slide\b/);
      if (m) {
        const idx = parseInt(m[1] ?? '0', 10) - 1;
        if (idx >= 0 && idx < slideBounds.length) return idx;
      }
      return 0;
    }

    // Slide regeneration helper — rewrites one slide, optionally locking design
    async function regenSlide(idx: number): Promise<string> {
      const b = slideBounds[idx];
      const slideHtml = html.slice(b.start, b.end);
      const designChangeWords =
        /\b(?:dark|light|color|colour|font|size|background|theme|style|palette|weight|spacing|layout|gradient|border|shadow)\b/i;
      const inlineColors = [...new Set(slideHtml.match(/#[0-9a-fA-F]{3,8}\b|rgb\([^)]+\)|rgba\([^)]+\)/g) ?? [])]
        .slice(0, 12)
        .join(', ');
      const modeNote = isSlideStructuralFix
        ? '\nFIX MODE: Fix the described design issue only. Do NOT change colors, text content, branding, or visual style — only correct the structural/layout problem.'
        : isPureSlideRegen && !designChangeWords.test(resolvedInstruction)
          ? `\nREGENERATION MODE: Preserve ALL visual design — same colors${inlineColors ? ` (${inlineColors})` : ''}, fonts, sizes, spacing, and layout. Only refresh content.`
          : '';
      const prompt = `You are rewriting one slide of an HTML slide presentation.

Apply the instruction exactly. You may change: text content, headings, colors, backgrounds, fonts, spacing, layout, images, icons, buttons — whatever the instruction requires.
Preserve: the outer <div class="slide"> wrapper and its id/data attributes, CSS class names, responsive patterns, and design token references.
${modeNote}
Output ONLY the replacement slide HTML — starting with <div class="slide"..., ending with </div>. No preamble, no markdown fences.
${slideCssVarsBlock ? `\nCSS DESIGN TOKENS:\n${slideCssVarsBlock}\n` : ''}
INSTRUCTION: ${resolvedInstruction}

CURRENT SLIDE (slide ${idx + 1}):
${slideHtml}`;
      const raw = await llmGenerateFn(prompt);
      const stripped = extractHtmlFromResponseGlobal(raw);
      const startIdx = stripped.search(/<div\b/i);
      const endIdx = stripped.lastIndexOf('</div>');
      if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx)
        throw new Error('LLM did not return a valid slide block');
      const newSlide = stripped.slice(startIdx, endIdx + 6);
      return html.slice(0, b.start) + newSlide + html.slice(b.end);
    }

    // ── Pre-resolve real asset URLs so the LLM never invents them ────────────
    let augmentedInstruction = resolvedInstruction;
    let resolvedUrlToVerify: string | null = null;
    let resolvedUrlKind = '';

    // Descriptive image request (no URL given) → fetch a real Pexels URL
    if (!/https?:\/\//.test(resolvedInstruction) && /\b(?:image|photo|picture|pic)\b/i.test(resolvedInstruction)) {
      try {
        const qPrompt = `Does this instruction require adding or replacing an image with a new one fetched from the web? Answer "no" if the instruction is about removing, hiding, or deleting an image, or if no new image is needed. Otherwise answer with a concise 2-5 keyword image search query (keywords only, nothing else).\n\nInstruction: ${resolvedInstruction}`;
        const pexelsQ = (await llmGenerateFn(qPrompt))
          .trim()
          .replace(/^["'`]|["'`]$/g, '')
          .trim()
          .slice(0, 80);
        if (pexelsQ && !/^no\b/i.test(pexelsQ)) {
          const pexelsUrl = await fetchPexelsImageUrl(pexelsQ);
          if (pexelsUrl) {
            augmentedInstruction = `${resolvedInstruction}\n\nIMPORTANT — use this exact image URL (do NOT invent or substitute any other URL): ${pexelsUrl}`;
            resolvedUrlToVerify = pexelsUrl;
            resolvedUrlKind = 'image';
            console.log(`📸 Pexels pre-fetch for slide edit: "${pexelsQ}" → ${pexelsUrl}`);
          }
        }
      } catch {
        /* fall through — LLM will handle without a real URL */
      }
    }

    // Video URL → hand the LLM a ready-made embed URL (watch-page URLs are
    // blocked from iframes by X-Frame-Options)
    const slideVideoUrlMatch = resolvedInstruction.match(/https?:\/\/\S*(?:youtube\.com|youtu\.be|vimeo\.com)\S*/i);
    if (slideVideoUrlMatch) {
      const rawSlideVideoUrl = slideVideoUrlMatch[0].replace(/['"<>)\],.]+$/, '');
      const embedUrl = toVideoEmbedUrl(rawSlideVideoUrl);
      // Replace watch URL with embed URL in-place — two URLs in one prompt → two iframes.
      augmentedInstruction = augmentedInstruction.replace(rawSlideVideoUrl, embedUrl);
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
      let depth = 0,
        end = -1,
        inStr = false,
        esc = false;
      for (let i = start; i < rawText.length; i++) {
        const c = rawText[i];
        if (esc) {
          esc = false;
          continue;
        }
        if (c === '\\' && inStr) {
          esc = true;
          continue;
        }
        if (c === '"') {
          inStr = !inStr;
          continue;
        }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) return null;
      try {
        const slice = rawText
          .slice(start, end + 1)
          .replace(/("(?:[^"\\]|\\.)*")/gs, (s) => s.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
        return JSON.parse(slice) as SlideOp;
      } catch {
        return null;
      }
    }

    function applySlidePatches(
      base: string,
      patches: Array<{ find: string; replace: string }>,
    ): { html: string; applied: number; missed: number } {
      let result = base;
      let applied = 0,
        missed = 0;
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

    // Rescue extractor: when the full JSON fails to parse (malformed or truncated),
    // pull out whatever complete find/replace pairs are present using regex.
    function rescuePatchesFromText(rawText: string): Array<{ find: string; replace: string }> | null {
      const patches: Array<{ find: string; replace: string }> = [];
      // Match well-formed JSON string pairs — stops at any unescaped quote
      const re = /"find"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"replace"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = re.exec(rawText)) !== null) {
        try {
          const find = JSON.parse(`"${m[1]}"`);
          const replace = JSON.parse(`"${m[2]}"`);
          if (find) patches.push({ find, replace });
        } catch {
          // skip malformed pair
        }
      }
      return patches.length > 0 ? patches : null;
    }

    const opPrompt = `You are editing an HTML slide presentation — a single scrollable page where each slide is a <div class="slide">. Pick the ONE operation that best fits the instruction and respond with a single JSON object — nothing else.

OPERATION TYPES:

OP patches — targeted changes to existing content (text, values, colors, images, styles, adding or removing an element inside a slide).
{ "op": "patches", "patches": [{ "find": "exact substring", "replace": "new value" }], "summary": "..." }
Rules:
- Copy each "find" string EXACTLY from the HTML — character-for-character, no paraphrasing
- For style/color changes, prefer SHORT "find" strings targeting just the CSS value (e.g. "#C8A96E" or "color:#C8A96E;") rather than wrapping HTML — this avoids escaping issues and matches every occurrence
- Include 15–40 chars of surrounding context only when needed to make "find" unique
- NEVER put newlines inside "find" or "replace" — single-line strings only
- CRITICAL: if "find" or "replace" must include HTML with attribute values, you MUST escape every inner double-quote with a backslash (e.g. style=\"color:red\" NOT style="color:red") — unescaped quotes break JSON parsing
- Include EVERY patch needed to fully and consistently apply the instruction.
  If the change affects many repeated values (e.g. recalculating percentages
  and dollar amounts across an entire pricing/breakdown table when the total
  changes), include one patch per value — ALL of them, not a representative
  sample. There is no fixed cap: dropping some patches to stay under an
  arbitrary count leaves the document internally inconsistent (e.g. a headline
  total that no longer matches the line items or footer beneath it), which is
  worse than a longer response. Typically well under 40 for a normal edit, but
  size the count to what the instruction actually requires.

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

    // For regen/fix intents, skip the JSON op path entirely and go straight to slide rewrite.
    let updatedHtml = html;
    let summary = displaySummary;

    if (isSlideRegenIntent && slideBounds.length > 0) {
      const idx = targetSlideIdx(resolvedInstruction);
      try {
        updatedHtml = await regenSlide(idx);
        summary = isSlideStructuralFix ? `Slide ${idx + 1} fixed` : `Slide ${idx + 1} regenerated`;
        console.log(`↩️  isSlideRegenIntent — rewrote slide ${idx + 1} directly`);
      } catch {
        return reply.code(502).send({ error: 'Could not regenerate slide — try providing more detail' });
      }
    } else {
      const raw = await llmGenerateFn(opPrompt);
      console.log(`┌─ SLIDE EDIT LLM raw (first 500): ${(raw ?? '').slice(0, 500)}`);

      const op = parseSlideOp(raw ?? '');
      if (!op) {
        // Guard: if the response looks like a patches op that failed to parse (malformed or
        // truncated JSON), try to rescue whatever complete patches are present via regex before
        // falling through — the HTML fallback would inject raw JSON text as slide content.
        if (/"op"\s*:\s*"patches"/.test(raw ?? '')) {
          const rescued = rescuePatchesFromText(raw ?? '');
          if (rescued && rescued.length > 0) {
            const { html: patched, applied, missed } = applySlidePatches(html, rescued);
            if (applied > 0) {
              updatedHtml = patched;
              summary = `Updated (${applied} change${applied !== 1 ? 's' : ''}${missed > 0 ? `, ${missed} skipped` : ''})`;
              console.log(`↩️  Rescued ${applied} patches via regex from malformed/truncated JSON`);
            } else {
              return reply.code(502).send({ error: 'Edit could not be applied — the target text was not found. Try being more specific.' });
            }
          } else {
            console.warn('⚠️  parseSlideOp null on patches response — no rescuable patches found');
            return reply.code(502).send({ error: 'Edit could not be applied — try rephrasing' });
          }
        } else {
        // Fallback: LLM returned raw HTML instead of JSON
        const stripped = extractHtmlFromResponseGlobal(raw ?? '');
        const startIdx = stripped.search(/<div\b/i);
        const endIdx = stripped.lastIndexOf('</div>');
        if (startIdx !== -1 && endIdx > startIdx && slideBounds.length > 0) {
          const idx = targetSlideIdx(resolvedInstruction);
          const b = slideBounds[idx];
          updatedHtml = html.slice(0, b.start) + stripped.slice(startIdx, endIdx + 6) + html.slice(b.end);
          summary = displaySummary;
          console.log('↩️  parseSlideOp null — used raw HTML block fallback');
        } else if (
          /\b(?:fix|repair|regenerate|redesign|rewrite|rebuild|redo|correct)\b/i.test(resolvedInstruction) &&
          slideBounds.length > 0
        ) {
          const idx = targetSlideIdx(resolvedInstruction);
          try {
            updatedHtml = await regenSlide(idx);
            summary = `Slide ${idx + 1} updated`;
            console.log('↩️  parseSlideOp null — fell through to regenSlide');
          } catch {
            return reply.code(502).send({ error: 'LLM returned no recognisable format — try rephrasing' });
          }
        } else {
          return reply.code(502).send({ error: 'LLM returned no recognisable format — try rephrasing' });
        }
        } // close: else (not patches format — HTML fallback)
      } else {
        if (op.op === 'patches') {
          const { html: patched, applied, missed } = applySlidePatches(html, op.patches);
          if (applied === 0) {
            // Patches couldn't find their target — fall back to direct slide rewrite.
            const idx = targetSlideIdx(resolvedInstruction);
            try {
              updatedHtml = await regenSlide(idx);
              summary = `Slide ${idx + 1} updated`;
              console.log('↩️  patches applied=0 — fell through to regenSlide');
            } catch {
              return reply.code(502).send({ error: 'Edit could not be applied — the target text was not found. Try being more specific.' });
            }
          } else {
            updatedHtml = patched;
            summary = op.summary || summary;
            if (missed > 0) summary += ` (${missed} patch${missed > 1 ? 'es' : ''} skipped — text not found)`;
          }
        } else if (op.op === 'slide_replace' || op.op === 'slide_insert' || op.op === 'slide_delete') {
          const idx = Math.trunc(op.slide) - 1;
          if (idx < 0 || idx >= slideBounds.length) {
            return reply.code(422).send({
              error: `Slide ${op.slide} not found — this deck has ${slideBounds.length} slide${slideBounds.length === 1 ? '' : 's'}`,
            });
          }
          const b = slideBounds[idx];
          if (op.op === 'slide_replace') {
            updatedHtml = html.slice(0, b.start) + op.html + html.slice(b.end);
          } else if (op.op === 'slide_insert') {
            updatedHtml =
              op.position === 'before'
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
      } // close: else (op !== null)
    } // close: outer else (not isSlideRegenIntent)

    // Guard: closing tags must survive (patches can't remove them; slide html splices could)
    if (!/(<\/body>|<\/html>)/i.test(updatedHtml)) {
      return reply.code(502).send({ error: 'Edit produced incomplete HTML — missing closing tags. Try rephrasing.' });
    }

    // Content verification: when we told the LLM to use a specific resolved URL,
    // confirm it actually landed instead of trusting a no-op response.
    if (resolvedUrlToVerify) {
      const idMatch =
        resolvedUrlToVerify.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i) ??
        resolvedUrlToVerify.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
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
    try {
      await readMeta(dir);
    } catch {
      return reply.code(404).send({ error: 'Client not found' });
    }

    let html: string;
    try {
      html = await readFile(path.join(dir, 'slides', `${id}.html`), 'utf-8');
    } catch {
      return reply.code(404).send({ error: 'Presentation not found' });
    }

    let title = 'Presentation';
    let orientation: 'landscape' | 'portrait' = 'landscape';
    try {
      const idx = JSON.parse(await readFile(path.join(dir, 'slides.json'), 'utf-8')) as {
        id: string;
        title: string;
        orientation?: 'landscape' | 'portrait';
      }[];
      const rec = idx.find((s) => s.id === id);
      title = rec?.title ?? title;
      orientation = rec?.orientation === 'portrait' ? 'portrait' : 'landscape';
    } catch {
      /* ok */
    }
    const isPortrait = orientation === 'portrait';

    const safeTitle = title
      .replace(/[^\w\s\-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60);
    const fileName = `${safeTitle || 'presentation'}-${id.slice(0, 8)}`;

    const { spawn } = await import('node:child_process');
    const { tmpdir } = await import('node:os');
    const { rm: rmTmp } = await import('node:fs/promises');

    if (format === 'pdf') {
      // ── Chrome CLI print-to-PDF ──────────────────────────────────────────
      // Uses the Chrome binary that Puppeteer already downloaded to ~/.cache/puppeteer.
      // Chrome's native PDF renderer produces real text (selectable, editable) — not images.
      const chromeBin = await findChromeBinary();
      if (!chromeBin)
        return reply
          .code(503)
          .send({ error: 'Chrome binary not found — run `npm install` to let Puppeteer download it' });

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
      printHtml =
        headClose !== -1
          ? printHtml.slice(0, headClose) + PRINT_CSS + printHtml.slice(headClose)
          : PRINT_CSS + printHtml;

      const tmpId = `slide-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tmpHtml = path.join(tmpdir(), `${tmpId}.html`);
      const tmpPdf = path.join(tmpdir(), `${tmpId}.pdf`);

      try {
        await writeFile(tmpHtml, printHtml, 'utf-8');

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(
            chromeBin,
            [
              '--headless=new',
              '--disable-gpu',
              '--no-sandbox',
              '--disable-dev-shm-usage',
              `--print-to-pdf=${tmpPdf}`,
              '--no-pdf-header-footer',
              `file://${tmpHtml}`,
            ],
            { stdio: 'ignore' },
          );
          proc.on('error', reject);
          proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Chrome exited ${code}`))));
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
      const venvRoot = path.resolve(import.meta.dirname ?? '', '../../../../.venv');
      const pythonBin = path.join(venvRoot, 'bin', 'python3');
      const script = path.resolve(import.meta.dirname ?? '', 'slide-to-pptx.py');

      const pptxBytes = await new Promise<Buffer>((resolve, reject) => {
        const proc = spawn(pythonBin, [script, orientation], { stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        proc.stdout.on('data', (d: Buffer) => chunks.push(d));
        proc.stderr.on('data', (d: Buffer) => errChunks.push(d));
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code !== 0) {
            reject(
              new Error(`slide-to-pptx.py exited ${code}: ${Buffer.concat(errChunks).toString('utf-8').slice(0, 400)}`),
            );
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

  // POST /super-clients/:name/enrich-url  — (re)generate client-knowledge.md from a website URL
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

    let clientKnowledgeMd: string;
    try {
      clientKnowledgeMd = await llmGenerateFn(parts.join('\n'));
    } catch (err) {
      app.log.warn({ err }, '[SuperClient] URL enrichment failed');
      return reply.code(500).send({ error: 'Client knowledge generation failed' });
    }

    await writeFile(path.join(dir, 'client-knowledge.md'), clientKnowledgeMd);
    await syncClientKnowledge(workdir, name, clientKnowledgeMd).catch((err) => {
      app.log.warn({ err, name }, '[SuperClient] client-knowledge memory sync failed');
    });
    await seedClientMemory(name, meta.displayName, clientKnowledgeMd, workdir, app.log);

    // buildVirtualDocs only surfaces client-knowledge.md in the Documents list
    // when site-facts/status.json exists — ensure it does, without clobbering
    // an in-flight crawl's own status if one happens to be running.
    const siteFactsDir = path.join(dir, 'site-facts');
    const statusPath = path.join(siteFactsDir, 'status.json');
    await mkdir(siteFactsDir, { recursive: true });
    const existingStatus = await readJsonStatus<{ status?: string } & Record<string, unknown>>(statusPath);
    if (!existingStatus || (existingStatus.status !== 'running' && existingStatus.status !== 'generating_summary')) {
      await writeFile(
        statusPath,
        JSON.stringify({ ...existingStatus, status: 'complete', finishedAt: new Date().toISOString() }, null, 2),
      ).catch((err) => {
        app.log.warn({ err, name }, '[SuperClient] failed to write site-facts status after URL enrichment');
      });
    }

    return reply.send({ meta, clientKnowledgeMd });
  });
}
