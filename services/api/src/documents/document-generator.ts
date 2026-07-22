// services/api/src/documents/document-generator.ts
//
// Single-pass document generation using client context + RAG + skill persona.
// No state machine — one LLM call produces the complete document.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { GenerateFn } from '@ai-engine/planner';
import type { VectorStoreConfig } from '@ai-engine/runtime';
import { searchKnowledgeChunks } from '@ai-engine/runtime';
import type { LoadedSkill, OutputFormat } from '../skills/skill.types.js';
import type { ClientKnowledgeEntry } from '../memory/client-memory.types.js';
import type { GeneratedDocumentMeta } from '../skills/skill.types.js';
import { exportDocument } from './document-exporter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateDocumentInput {
  clientName: string
  clientSlug: string
  userMessage: string
  clientProfile: string               // client-knowledge.md content
  knowledgeEntries: ClientKnowledgeEntry[]
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  skill?: LoadedSkill
  inlineStructure?: string            // user-pasted headings/outline
  inlineContent?: string              // large text pasted into chat
  preferredFormat?: OutputFormat
  generateFn: GenerateFn
  /** Optional FAISS RAG pre-pass — requires both storageDir and namespace */
  storageDir?: string
  namespace?: string
  vectorStoreConfig?: VectorStoreConfig
  workdir: string
}

export interface GenerateDocumentResult {
  id: string
  title: string
  content: string
  meta: GeneratedDocumentMeta
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function documentsDir(workdir: string, clientSlug: string): string {
  return path.join(workdir, 'super-clients', clientSlug, 'documents');
}

function documentIndexPath(workdir: string, clientSlug: string): string {
  return path.join(workdir, 'super-clients', clientSlug, 'documents.json');
}

function generateId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${ts}-${rand}`
}

interface DocumentIndexEntry {
  id: string
  title: string
  documentType: string
  skillSlug?: string
  preferredFormat: OutputFormat
  status: 'draft' | 'complete'
  createdAt: string
  updatedAt: string
}

async function readIndex(workdir: string, clientSlug: string): Promise<DocumentIndexEntry[]> {
  try {
    const raw = await readFile(documentIndexPath(workdir, clientSlug), 'utf-8')
    return JSON.parse(raw) as DocumentIndexEntry[]
  } catch {
    return []
  }
}

async function appendToIndex(
  workdir: string,
  clientSlug: string,
  entry: DocumentIndexEntry,
): Promise<void> {
  const existing = await readIndex(workdir, clientSlug)
  existing.unshift(entry)
  await writeFile(documentIndexPath(workdir, clientSlug), JSON.stringify(existing, null, 2))
}

// ---------------------------------------------------------------------------
// RAG pre-pass: retrieve relevant passages from the client's FAISS index
// ---------------------------------------------------------------------------

async function retrieveRelevantContext(
  userMessage: string,
  skill: LoadedSkill | undefined,
  storageDir: string | undefined,
  namespace: string | undefined,
  vectorStoreConfig: VectorStoreConfig | undefined,
): Promise<string> {
  if (!storageDir || !namespace) return ''

  const triggerTerms = skill?.skill.triggers?.slice(0, 5).join(' ') ?? ''
  const question = `${userMessage} ${triggerTerms}`.trim().slice(0, 300)

  try {
    const result = await searchKnowledgeChunks({
      question,
      storageDir,
      namespace,
      topK: 5,
      ...(vectorStoreConfig ? { vectorStoreConfig } : {}),
    })
    if (!result?.chunks?.length) return ''
    return result.chunks
      .map((c) => c.text)
      .filter(Boolean)
      .join('\n\n---\n\n')
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(skill: LoadedSkill | undefined): string {
  if (skill?.instructionsMd) {
    return skill.instructionsMd.trim()
  }
  return `You are an expert document writer. Produce a well-structured, professional document.
Design the structure to best serve the content — do not use a generic template.
Write clearly, avoid filler, and deliver real value in every section.`
}

function buildUserPrompt(input: {
  userMessage: string
  clientProfile: string
  knowledgeEntries: ClientKnowledgeEntry[]
  ragContext: string
  inlineContent?: string
  inlineStructure?: string
  skill?: LoadedSkill
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}): string {
  const parts: string[] = []

  // Client context
  if (input.clientProfile?.trim()) {
    parts.push(`## Client Context\n${input.clientProfile.trim()}`)
  }

  // Knowledge entries from ingested documents
  const activeKnowledge = input.knowledgeEntries
    .filter((k) => !k.supersededBy && k.confidence >= 0.5)
    .slice(0, 40)

  if (activeKnowledge.length > 0) {
    const knowledgeBlock = activeKnowledge
      .map((k) => `- [${k.category}] ${k.content}`)
      .join('\n')
    parts.push(`## Knowledge from Client Documents\n${knowledgeBlock}`)
  }

  // RAG-retrieved passages
  if (input.ragContext?.trim()) {
    parts.push(`## Relevant Passages from Uploaded Documents\n${input.ragContext.trim()}`)
  }

  // Inline pasted content
  if (input.inlineContent?.trim()) {
    parts.push(`## Content Provided by User\n${input.inlineContent.trim()}`)
  }

  // Structure mode
  const structureMode = input.skill?.skill.structureMode ?? 'free'

  if (input.inlineStructure?.trim()) {
    // User-pasted structure always wins
    parts.push(
      `## Document Structure\nFollow this structure exactly — fill each section with comprehensive content:\n\n${input.inlineStructure.trim()}`,
    )
  } else if (
    structureMode === 'guided' &&
    input.skill?.sections?.length
  ) {
    const sectionList = input.skill.sections
      .sort((a, b) => a.order - b.order)
      .map((s) => `- ${s.title}`)
      .join('\n')
    parts.push(
      `## Suggested Structure\nUse this as a starting point, adapting as needed:\n${sectionList}`,
    )
  } else {
    parts.push(
      `## Structure\nDesign the most effective structure for this document based on the content. Do not use a generic template — let the content and purpose drive the shape.`,
    )
  }

  // Recent chat history for context
  if (input.chatHistory?.length) {
    const recent = input.chatHistory.slice(-6)
    const historyBlock = recent
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n')
    parts.push(`## Recent Conversation\n${historyBlock}`)
  }

  // The actual request
  parts.push(`## Request\n${input.userMessage}`)

  parts.push(
    `\nGenerate the complete document now. Use markdown formatting with proper headings. The first line should be a # Title heading.`,
  )

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Title extractor — pulls the first # heading from generated markdown
// ---------------------------------------------------------------------------

function extractTitle(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : fallback
}

// ---------------------------------------------------------------------------
// Document type detector
// ---------------------------------------------------------------------------

function detectDocumentType(skill: LoadedSkill | undefined, userMessage: string): string {
  if (skill) return skill.skill.slug
  const msg = userMessage.toLowerCase()
  if (msg.includes('blog') || msg.includes('article')) return 'blog-post'
  if (msg.includes('strategy') || msg.includes('gtm')) return 'strategy-document'
  if (msg.includes('report')) return 'executive-report'
  if (msg.includes('brief') || msg.includes('one-pager')) return 'marketing-brief'
  if (msg.includes('deck') || msg.includes('presentation') || msg.includes('ppt')) return 'presentation-deck'
  return 'document'
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateDocument(
  input: GenerateDocumentInput,
): Promise<GenerateDocumentResult> {
  // Step 1: RAG pre-pass — retrieve relevant passages from ingested documents
  const ragContext = await retrieveRelevantContext(
    input.userMessage,
    input.skill,
    input.storageDir,
    input.namespace,
    input.vectorStoreConfig,
  )

  // Step 2: Build prompts — embed system instructions into the single prompt
  const systemPrompt = buildSystemPrompt(input.skill)
  const userPrompt = buildUserPrompt({
    userMessage: input.userMessage,
    clientProfile: input.clientProfile,
    knowledgeEntries: input.knowledgeEntries,
    ragContext,
    inlineContent: input.inlineContent,
    inlineStructure: input.inlineStructure,
    skill: input.skill,
    chatHistory: input.chatHistory,
  })
  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`

  // Step 3: Single LLM call (GenerateFn takes a single string)
  const content = await input.generateFn(fullPrompt)

  // Step 4: Extract metadata from generated content
  const fallbackTitle = input.skill?.skill.displayName
    ? `${input.skill.skill.displayName} — ${input.clientName}`
    : `Document — ${input.clientName}`

  const title = extractTitle(content, fallbackTitle)
  const documentType = detectDocumentType(input.skill, input.userMessage)
  const preferredFormat = input.preferredFormat ?? input.skill?.skill.outputFormats?.[0] ?? 'md'
  const id = generateId()
  const now = new Date().toISOString()

  // Step 5: Persist to disk
  const docsDir = documentsDir(input.workdir, input.clientSlug)
  await mkdir(docsDir, { recursive: true })
  await writeFile(path.join(docsDir, `${id}.md`), content, 'utf-8')

  const meta: GeneratedDocumentMeta = {
    id,
    title,
    documentType,
    skillSlug: input.skill?.skill.slug,
    preferredFormat,
    status: 'complete',
    createdAt: now,
    updatedAt: now,
  }
  await writeFile(path.join(docsDir, `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf-8')

  await appendToIndex(input.workdir, input.clientSlug, {
    id,
    title,
    documentType,
    skillSlug: input.skill?.skill.slug,
    preferredFormat,
    status: 'complete',
    createdAt: now,
    updatedAt: now,
  })

  return { id, title, content, meta }
}

// ---------------------------------------------------------------------------
// Read helpers (used by routes)
// ---------------------------------------------------------------------------

export async function listDocuments(
  workdir: string,
  clientSlug: string,
): Promise<DocumentIndexEntry[]> {
  return readIndex(workdir, clientSlug)
}

export async function getDocumentContent(
  workdir: string,
  clientSlug: string,
  id: string,
): Promise<string> {
  const p = path.join(documentsDir(workdir, clientSlug), `${id}.md`)
  return readFile(p, 'utf-8')
}

export async function getDocumentMeta(
  workdir: string,
  clientSlug: string,
  id: string,
): Promise<GeneratedDocumentMeta> {
  const p = path.join(documentsDir(workdir, clientSlug), `${id}.meta.json`)
  const raw = await readFile(p, 'utf-8')
  return JSON.parse(raw) as GeneratedDocumentMeta
}

export async function saveDocumentDirect(
  workdir: string,
  clientSlug: string,
  title: string,
  documentType: string,
  format: OutputFormat,
  content: string,
): Promise<GeneratedDocumentMeta> {
  const id = generateId()
  const now = new Date().toISOString()

  const docsDir = documentsDir(workdir, clientSlug)
  await mkdir(docsDir, { recursive: true })
  await writeFile(path.join(docsDir, `${id}.md`), content, 'utf-8')

  const meta: GeneratedDocumentMeta = {
    id,
    title,
    documentType,
    preferredFormat: format as OutputFormat,
    status: 'complete',
    createdAt: now,
    updatedAt: now,
  }

  // Auto-export for non-md formats so a download URL is immediately available.
  // PDF uses Puppeteer (slow) — fire-and-forget, meta.json updated after it resolves.
  // All other formats are fast enough to await before returning.
  if (format !== 'md') {
    const doExport = async () => {
      try {
        const exported = await exportDocument(content, format, title)
        const ext = exported.filename.split('.').pop() ?? format
        await writeFile(path.join(docsDir, `${id}.${ext}`), exported.buffer)
        const downloadUrl = `/super-clients/${clientSlug}/generated-documents/${id}/export?format=${format}`
        const updatedMeta = { ...meta, downloadUrl }
        await writeFile(path.join(docsDir, `${id}.meta.json`), JSON.stringify(updatedMeta, null, 2), 'utf-8')
        return downloadUrl
      } catch {
        return undefined
      }
    }

    if (format === 'pdf') {
      void doExport()
    } else {
      const url = await doExport()
      if (url) meta.downloadUrl = url
    }
  }

  await writeFile(path.join(docsDir, `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf-8')

  await appendToIndex(workdir, clientSlug, {
    id,
    title,
    documentType,
    preferredFormat: format as OutputFormat,
    status: 'complete',
    createdAt: now,
    updatedAt: now,
  })

  return meta
}

export async function deleteDocument(
  workdir: string,
  clientSlug: string,
  id: string,
): Promise<void> {
  const docsDir = documentsDir(workdir, clientSlug)
  await Promise.all([
    import('node:fs/promises').then((fs) => fs.unlink(path.join(docsDir, `${id}.md`)).catch(() => undefined)),
    import('node:fs/promises').then((fs) => fs.unlink(path.join(docsDir, `${id}.meta.json`)).catch(() => undefined)),
  ])
  // Remove from index
  const existing = await readIndex(workdir, clientSlug)
  const updated = existing.filter((e) => e.id !== id)
  await writeFile(documentIndexPath(workdir, clientSlug), JSON.stringify(updated, null, 2))
}
