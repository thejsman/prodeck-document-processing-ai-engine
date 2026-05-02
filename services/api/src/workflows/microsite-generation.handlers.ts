/**
 * Microsite Generation Workflow — state handlers.
 *
 * Converts an existing proposal document into a presentation microsite using
 * the microsite-generator-agent.
 *
 * States driven by this file:
 *   checking_proposal        — locate the target proposal in the namespace
 *   collecting_design_inputs — gather brand/design preferences from the user
 *   generating_microsite     — run microsite-generator-agent on the proposal
 */

import path from 'node:path';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { MicrositeGeneratorAgent } from '@ai-engine/agent-microsite-generator';
import { toolRegistry } from '@ai-engine/core';
import { llmGenerateFn } from '../agent-routes.js';
import type { HandlerContext, HandlerResult } from './proposal-generation.handlers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_INSTRUCTIONS = [
  'Generate a comprehensive microsite using all content from the proposal.',
  'Include as many sections as the content supports — aim for 10 or more.',
  'Map all source headings to the most specific section type available.',
  'Use diagrams in approach, timeline, security, techstack, and testing sections.',
].join(' ');

const SKIP_PATTERN = /^(generate|go|skip|use defaults?|proceed|yes|y|ok|okay|sure)$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MicrositeDesignInputs {
  companyName?: string;
  primaryColor?: string;
  designStyle?: string;
  pdfFriendly?: boolean;
  customInstructions?: string;
}

// ---------------------------------------------------------------------------
// Proposal discovery
// ---------------------------------------------------------------------------

interface ProposalEntry {
  fileName: string;
  filePath: string;
  createdAt: Date;
}

async function discoverProposals(workdir: string, namespace: string): Promise<ProposalEntry[]> {
  const proposalsDir = path.join(workdir, 'namespaces', namespace, 'proposals');
  try {
    const entries = await readdir(proposalsDir);
    const mdFiles = entries.filter((f) => f.endsWith('.md'));
    return mdFiles
      .map((f) => ({
        fileName: f,
        filePath: path.join(proposalsDir, f),
        // Parse timestamp from filename pattern: chat-draft-<timestamp>.md or <name>-<timestamp>.md
        createdAt: new Date(
          (() => {
            const match = /(\d{10,13})/.exec(f);
            return match ? parseInt(match[1], 10) * (match[1].length === 10 ? 1000 : 1) : 0;
          })(),
        ),
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // newest first
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// checking_proposal handler
// ---------------------------------------------------------------------------

/**
 * Locate the proposal to convert into a microsite.
 *
 * Flow:
 *   1. If proposalArtifactId already in context → signal READY immediately.
 *   2. Scan the namespace proposals directory for .md files.
 *   3. If none found → inform user to generate a proposal first.
 *   4. If one found → ask user to confirm it.
 *   5. If multiple found → list them, ask which one to use.
 *   6. On user confirmation/selection → set context.proposalArtifactId → signal READY.
 */
export async function handleCheckingProposal(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, incomingMessage } = ctx;

  // Already resolved — proceed immediately
  if (instance.context.proposalArtifactId) {
    return { message: '', stateSignal: 'READY' };
  }

  const proposals = await discoverProposals(workdir, namespace);

  if (proposals.length === 0) {
    return {
      message: [
        'No proposals found in this namespace.',
        '',
        'Generate a proposal first using:',
        '> "Create a proposal for [client / project]"',
        '',
        'Then come back and I can convert it into a microsite.',
      ].join('\n'),
    };
  }

  // If user is confirming a previously listed selection
  if (instance.context.awaitingMicrositeProposalSelection) {
    const lower = incomingMessage.toLowerCase().trim();

    // Match by number
    const numMatch = /^\s*(\d+)\s*$/.exec(incomingMessage.trim());
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10) - 1;
      if (idx >= 0 && idx < proposals.length) {
        instance.context.proposalArtifactId = proposals[idx].fileName;
        instance.context.awaitingMicrositeProposalSelection = undefined;
        return {
          message: `Using **${proposals[idx].fileName}**.`,
          stateSignal: 'READY',
        };
      }
    }

    // Match by filename fragment
    const matched = proposals.find((p) => lower.includes(p.fileName.toLowerCase().replace('.md', '')));
    if (matched) {
      instance.context.proposalArtifactId = matched.fileName;
      instance.context.awaitingMicrositeProposalSelection = undefined;
      return {
        message: `Using **${matched.fileName}**.`,
        stateSignal: 'READY',
      };
    }

    // Treat any affirmative short reply as "use the first one"
    const isYes = /^(yes|y|ok|okay|sure|go|proceed|use (this|it|that)|confirm)$/i.test(lower);
    if (isYes) {
      instance.context.proposalArtifactId = proposals[0].fileName;
      instance.context.awaitingMicrositeProposalSelection = undefined;
      return {
        message: `Using **${proposals[0].fileName}**.`,
        stateSignal: 'READY',
      };
    }

    // Unrecognised reply — re-list
  }

  // First entry: list proposals and ask
  instance.context.awaitingMicrositeProposalSelection = true;

  if (proposals.length === 1) {
    const p = proposals[0];
    return {
      message: [
        'I found one proposal in your namespace:',
        '',
        `**${p.fileName}**`,
        '',
        'Reply **yes** to convert it into a microsite, or upload / generate a different proposal first.',
      ].join('\n'),
    };
  }

  const fileList = proposals
    .slice(0, 10) // cap at 10 to keep the message readable
    .map((p, i) => `${i + 1}. **${p.fileName}**`)
    .join('\n');

  return {
    message: [
      'I found the following proposals in your namespace:',
      '',
      fileList,
      '',
      'Which proposal should I convert into a microsite? Reply with the number or file name.',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// collecting_design_inputs handler
// ---------------------------------------------------------------------------

/**
 * Ask the user for brand and design preferences before generation.
 *
 * Flow:
 *   1. First call — show the design questions form.
 *   2. If user says "generate" / "skip" — signal READY with empty inputs.
 *   3. Otherwise — use LLM to parse the reply into structured design inputs,
 *      store in context.micrositeDesignInputs, signal READY.
 */
export async function handleCollectingDesignInputs(ctx: HandlerContext): Promise<HandlerResult> {
  const { instance, incomingMessage } = ctx;

  // Skip shortcut — user wants to proceed with defaults
  if (SKIP_PATTERN.test(incomingMessage.trim())) {
    instance.context.micrositeDesignInputs = {};
    return { message: '', stateSignal: 'READY' };
  }

  // First visit — show the question form
  if (!instance.context.awaitingMicrositeDesignInputs) {
    instance.context.awaitingMicrositeDesignInputs = true;
    return {
      message: [
        'Before I generate the microsite, a few quick questions to tailor the design:',
        '',
        '1. **Brand name** — What company or product name should be featured?',
        '2. **Brand color** — Primary color (hex or name, e.g. `#1a73e8` or `navy`). Skip if unsure.',
        '3. **Style** — `professional` / `bold` / `minimal` / `editorial` (default: professional)',
        '4. **PDF-friendly?** — yes / no (optimises layout for PDF export, default: no)',
        '5. **Custom instructions** — Anything specific to include or emphasise? (or skip)',
        '',
        'You can answer all at once, skip any question, or just say **"generate"** to use defaults.',
      ].join('\n'),
    };
  }

  // User has replied — parse with LLM
  const parsePrompt = [
    'Extract microsite design preferences from the following user message.',
    'Return a JSON object with these optional fields:',
    '  companyName: string',
    '  primaryColor: string (hex or CSS color name, normalise to hex if possible)',
    '  designStyle: "professional" | "bold" | "minimal" | "editorial"',
    '  pdfFriendly: boolean',
    '  customInstructions: string (verbatim instructions for the microsite generator)',
    '',
    'Rules:',
    '- Only include a field if the user clearly provided a value for it.',
    '- If a field is absent or the user said "skip", omit it from the object.',
    '- Return only the raw JSON object, no markdown fences.',
    '',
    `User message: ${incomingMessage}`,
  ].join('\n');

  let designInputs: MicrositeDesignInputs = {};
  try {
    const raw = await llmGenerateFn(parsePrompt);
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, '').trim();
    designInputs = JSON.parse(cleaned) as MicrositeDesignInputs;
  } catch {
    // Parsing failed — use the raw message as custom instructions and proceed
    designInputs = { customInstructions: incomingMessage };
  }

  instance.context.micrositeDesignInputs = designInputs;
  instance.context.awaitingMicrositeDesignInputs = undefined;

  const confirmParts: string[] = ['Got it! Here\'s what I\'ll use:'];
  if (designInputs.companyName) confirmParts.push(`- **Brand name**: ${designInputs.companyName}`);
  if (designInputs.primaryColor) confirmParts.push(`- **Brand color**: ${designInputs.primaryColor}`);
  if (designInputs.designStyle) confirmParts.push(`- **Style**: ${designInputs.designStyle}`);
  if (designInputs.pdfFriendly) confirmParts.push('- **PDF-friendly**: yes');
  if (designInputs.customInstructions) confirmParts.push(`- **Instructions**: ${designInputs.customInstructions}`);
  if (confirmParts.length === 1) confirmParts.push('- Using default settings');

  return {
    message: confirmParts.join('\n'),
    stateSignal: 'READY',
  };
}

// ---------------------------------------------------------------------------
// generating_microsite handler
// ---------------------------------------------------------------------------

/**
 * Convert the selected proposal into a microsite using the microsite-generator-agent.
 *
 * Flow:
 *   1. Emit phase "Loading proposal".
 *   2. Read the proposal markdown from the namespace proposals directory.
 *   3. Emit phase "Generating microsite".
 *   4. Invoke MicrositeGeneratorAgent.run() with proposal + collected design inputs.
 *      Sections are streamed to the client in real-time via onSectionComplete.
 *   5. Emit phase "Microsite ready".
 *   6. Store micrositeArtifactId and layout AST in context.
 *   7. Signal DONE.
 */
export async function handleGeneratingMicrosite(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk, onSection } = ctx;

  const artifactId = instance.context.proposalArtifactId as string;
  const proposalPath = path.join(workdir, 'namespaces', namespace, 'proposals', artifactId);
  const design = (instance.context.micrositeDesignInputs ?? {}) as MicrositeDesignInputs;

  // ── Load proposal markdown ───────────────────────────────────────
  onPhase('Loading proposal');

  let proposalMarkdown: string;
  try {
    proposalMarkdown = await readFile(proposalPath, 'utf-8');
  } catch {
    return {
      message: [
        `Could not read proposal file **${artifactId}**.`,
        '',
        'The file may have been moved or deleted. Please generate a new proposal first.',
      ].join('\n'),
    };
  }

  if (!proposalMarkdown.trim()) {
    return {
      message: `The proposal file **${artifactId}** appears to be empty. Please regenerate the proposal.`,
    };
  }

  // ── Run microsite generator ──────────────────────────────────────
  onPhase('Generating microsite — this may take a minute');

  const agent = new MicrositeGeneratorAgent();

  let sectionIndex = 0;

  let agentOutput: { markdown?: string; json?: unknown; assets?: string[] };
  try {
    agentOutput = await agent.run({
      namespace,
      metadata: {
        proposalMarkdown,
        customInstructions: design.customInstructions ?? DEFAULT_INSTRUCTIONS,
        designBrief: design.designStyle
          ? `Design style: ${design.designStyle}. Make it visually compelling and on-brand.`
          : undefined,
        brand: {
          companyName: design.companyName,
          primaryColor: design.primaryColor,
        },
        pdfFriendly: design.pdfFriendly ?? false,
        onSectionComplete: (section: unknown) => {
          const s = section as Record<string, unknown>;
          const sectionType = (s.sectionType as string | undefined) ?? 'section';
          const artifactSectionId = `microsite-section-${++sectionIndex}-${Date.now()}`;
          if (onSection) {
            onSection(sectionType, JSON.stringify(section), artifactSectionId);
          } else {
            // Fallback: emit a brief chunk so the user sees progress
            onChunk(`\n_Section ready: ${sectionType}_`);
          }
        },
      },
      tools: toolRegistry,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      message: [
        'Microsite generation encountered an error:',
        '',
        `> ${msg}`,
        '',
        'Please try again, or check that the proposal content is valid markdown.',
      ].join('\n'),
    };
  }

  // ── Store result ─────────────────────────────────────────────────
  onPhase('Microsite ready');

  const micrositeArtifactId = `microsite-${Date.now()}.json`;
  instance.context.micrositeArtifactId = micrositeArtifactId;
  instance.context.micrositeLayoutAST = agentOutput.json ?? null;

  // Persist AST to disk so the microsite history endpoint can find it
  if (agentOutput.json) {
    const astPath = path.join(workdir, 'assets', 'presentations', namespace, 'site-ast.json');
    await mkdir(path.dirname(astPath), { recursive: true });
    await writeFile(astPath, JSON.stringify(agentOutput.json, null, 2), 'utf-8').catch(() => { /* non-fatal */ });
  }

  const assetCount = agentOutput.assets?.length ?? 0;
  const summary = [
    '## Microsite Generated',
    '',
    'Your proposal has been converted into a presentation microsite.',
    assetCount > 0 ? `\n${assetCount} asset(s) saved to your namespace.` : '',
    '',
    'The microsite is now available in your workspace. You can view and edit it from the UI.',
  ].filter((l) => l !== '').join('\n');

  onChunk(summary);

  return {
    message: summary,
    stateSignal: 'DONE',
    actions: {
      openMicrositeUrl: '/presentation',
      sourceProposal: artifactId,
    },
  };
}
