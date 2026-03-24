/**
 * Proposal generation workflow — state handlers.
 *
 * Each handler corresponds to one workflow state and is responsible for:
 *   - executing the business logic for that state
 *   - emitting streaming phase and content events via callbacks
 *   - returning a stateSignal to drive the transition in the orchestrator
 *   - updating instance.context in place (orchestrator checkpoints afterwards)
 *
 * Handlers are pure async functions that receive all dependencies via
 * HandlerContext — no global state, no direct filesystem access outside
 * the injected workdir path.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowInstance } from './workflow-instance.service.js';
import { loadFilesIndex } from '../ingestion/ingestion-service.js';
import { llmGenerateFn } from '../agent-routes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandlerResult {
  /** Human-readable chat message to return to the user. */
  message: string;
  /** Workflow signal that drives the next state transition (e.g. READY, DONE). */
  stateSignal?: string;
  /** Optional action metadata to surface in the final response (links, etc.). */
  actions?: Record<string, string>;
}

export interface HandlerContext {
  workdir: string;
  namespace: string;
  /** The live instance object — handlers may mutate instance.context directly. */
  instance: WorkflowInstance;
  /** The user's incoming message text. */
  incomingMessage: string;
  /** Emit a phase label (e.g. "Analyzing RFP") to the client. */
  onPhase: (phase: string) => void;
  /** Emit a token chunk to the client for streaming display. */
  onChunk: (chunk: string) => void;
}

// ---------------------------------------------------------------------------
// collecting_rfp handler
// ---------------------------------------------------------------------------

/**
 * Wait for a usable RFP document to be present in the namespace uploads.
 *
 * Flow:
 *   1. If rfpUri already in context → signal READY immediately.
 *   2. Check the namespace files index for uploaded/indexed files.
 *   3. If none found → ask user to upload the RFP and return without signalling.
 *   4. If found → set context.rfpUri to the most recently uploaded file → signal READY.
 *
 * This handler is called on every user message while state = collecting_rfp,
 * so a second message after the user has uploaded will automatically proceed.
 */
export async function handleCollectingRfp(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance } = ctx;

  if (instance.context.rfpUri) {
    // Already have an RFP — transition immediately
    return { message: '', stateSignal: 'READY' };
  }

  const files = await loadFilesIndex(workdir, namespace);
  const available = files
    .filter((f) => f.status === 'indexed' || f.status === 'uploaded')
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  if (available.length === 0) {
    return {
      message: 'Please upload the RFP document to begin proposal generation.',
    };
  }

  // Use the most recently uploaded file as the RFP source
  const rfpFile = available[0];
  instance.context.rfpUri = `uploads/${rfpFile.fileName}`;

  return {
    message: `Found RFP document: "${rfpFile.fileName}". Proceeding to generate the proposal outline.`,
    stateSignal: 'READY',
  };
}

// ---------------------------------------------------------------------------
// generating_outline handler
// ---------------------------------------------------------------------------

/**
 * Generate a structured proposal outline from the RFP document.
 *
 * Flow:
 *   1. Emit phase "Analyzing RFP".
 *   2. Read RFP content from the namespace uploads directory.
 *   3. Emit phase "Generating proposal structure".
 *   4. Call LLM to produce a markdown outline.
 *   5. Emit the outline as content chunks.
 *   6. Store outline in instance.context.outline.
 *   7. Signal DONE.
 */
export async function handleGeneratingOutline(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk } = ctx;

  onPhase('Analyzing RFP');

  // Read RFP document content
  let rfpContent = '';
  if (instance.context.rfpUri) {
    const rfpPath = path.join(workdir, 'namespaces', namespace, instance.context.rfpUri);
    rfpContent = await readFile(rfpPath, 'utf-8').catch(() => '');
  }

  onPhase('Generating proposal structure');

  const prompt = [
    'You are a professional proposal writer. Create a concise, structured proposal outline based on the RFP below.',
    '',
    'The outline must include these sections:',
    '1. Executive Summary',
    '2. Problem Statement',
    '3. Proposed Solution',
    '4. Technical Approach',
    '5. Timeline & Milestones',
    '6. Team & Credentials',
    '7. Budget Estimate',
    '8. Next Steps',
    '',
    rfpContent
      ? `RFP Document:\n${rfpContent}`
      : '(No RFP content available — produce a generic cloud migration proposal outline)',
    '',
    'Respond with a clean markdown outline only. Be concise and professional.',
  ].join('\n');

  const outline = await llmGenerateFn(prompt);

  // Emit outline as streaming chunks (STEP 6 — stream phase events)
  const CHUNK_SIZE = 80;
  for (let i = 0; i < outline.length; i += CHUNK_SIZE) {
    onChunk(outline.slice(i, i + CHUNK_SIZE));
  }

  instance.context.outline = outline;

  return {
    message: outline,
    stateSignal: 'DONE',
  };
}

// ---------------------------------------------------------------------------
// generating_sections handler
// ---------------------------------------------------------------------------

/**
 * Expand the outline into a full proposal draft and persist the artifact.
 *
 * Flow:
 *   1. Emit phase "Writing proposal draft".
 *   2. Call LLM to expand the stored outline into a complete proposal.
 *   3. Emit draft as content chunks.
 *   4. Save draft as {namespace}/proposals/chat-draft-{timestamp}.md.
 *   5. Set context.proposalArtifactId to the saved file name.
 *   6. Signal DONE.
 */
export async function handleGeneratingSections(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk } = ctx;

  onPhase('Writing proposal draft');

  const prompt = [
    'You are a professional proposal writer. Using the outline below, write a complete, detailed proposal document.',
    '',
    'Requirements:',
    '- Write every section in full — no placeholders or "[TBD]"',
    '- Use clear, professional language',
    '- Format as clean markdown with headings',
    '- Be specific, actionable, and persuasive',
    '',
    `Outline:\n${instance.context.outline ?? '(no outline provided)'}`,
  ].join('\n');

  const proposalMarkdown = await llmGenerateFn(prompt);

  // Emit draft as streaming chunks (STEP 6)
  const CHUNK_SIZE = 80;
  for (let i = 0; i < proposalMarkdown.length; i += CHUNK_SIZE) {
    onChunk(proposalMarkdown.slice(i, i + CHUNK_SIZE));
  }

  // Persist the artifact — STEP 8 (tool completion checkpoint)
  const timestamp = Date.now();
  const fileName = `chat-draft-${timestamp}.md`;
  const proposalsDir = path.join(workdir, 'namespaces', namespace, 'proposals');
  await mkdir(proposalsDir, { recursive: true });
  await writeFile(path.join(proposalsDir, fileName), proposalMarkdown, 'utf-8');

  instance.context.proposalArtifactId = fileName;

  return {
    message: proposalMarkdown,
    stateSignal: 'DONE',
    actions: {
      openProposalUrl: `/proposals/${namespace}/${fileName}`,
    },
  };
}
