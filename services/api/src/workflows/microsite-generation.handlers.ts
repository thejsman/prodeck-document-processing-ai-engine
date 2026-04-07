/**
 * Microsite Generation Workflow — state handlers.
 *
 * Converts an existing proposal document into a presentation microsite using
 * the microsite-generator-agent.
 *
 * States driven by this file:
 *   checking_proposal    — locate the target proposal in the namespace
 *   generating_microsite — run microsite-generator-agent on the proposal
 */

import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { MicrositeGeneratorAgent } from '@ai-engine/agent-microsite-generator';
import { toolRegistry } from '@ai-engine/core';
import type { HandlerContext, HandlerResult } from './proposal-generation.handlers.js';

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
          message: `Using **${proposals[idx].fileName}**. Converting to microsite now…`,
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
        message: `Using **${matched.fileName}**. Converting to microsite now…`,
        stateSignal: 'READY',
      };
    }

    // Treat any affirmative short reply as "use the first one"
    const isYes = /^(yes|y|ok|okay|sure|go|proceed|use (this|it|that)|confirm)$/i.test(lower);
    if (isYes) {
      instance.context.proposalArtifactId = proposals[0].fileName;
      instance.context.awaitingMicrositeProposalSelection = undefined;
      return {
        message: `Using **${proposals[0].fileName}**. Converting to microsite now…`,
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
// generating_microsite handler
// ---------------------------------------------------------------------------

/**
 * Convert the selected proposal into a microsite using the microsite-generator-agent.
 *
 * Flow:
 *   1. Emit phase "Loading proposal".
 *   2. Read the proposal markdown from the namespace proposals directory.
 *   3. Emit phase "Generating microsite".
 *   4. Invoke MicrositeGeneratorAgent.run() with the proposal content.
 *   5. Emit phase "Microsite ready".
 *   6. Store micrositeArtifactId in context.
 *   7. Signal DONE.
 */
export async function handleGeneratingMicrosite(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk } = ctx;

  const artifactId = instance.context.proposalArtifactId as string;
  const proposalPath = path.join(workdir, 'namespaces', namespace, 'proposals', artifactId);

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

  let agentOutput: { markdown?: string; json?: unknown; assets?: string[] };
  try {
    agentOutput = await agent.run({
      namespace,
      metadata: {
        proposalMarkdown,
        customInstructions: [
          'Generate a comprehensive microsite using all content from the proposal.',
          'Include as many sections as the content supports — aim for 10 or more.',
          'Map all source headings to the most specific section type available.',
          'Use diagrams in approach, timeline, security, techstack, and testing sections.',
        ].join(' '),
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

  // Emit a brief summary chunk for the chat
  const assetCount = agentOutput.assets?.length ?? 0;
  const summary = [
    '## Microsite Generated',
    '',
    `Your proposal has been converted into a presentation microsite.`,
    assetCount > 0 ? `\n${assetCount} asset(s) saved to your namespace.` : '',
    '',
    'The microsite is now available in your workspace. You can view and edit it from the UI.',
  ].filter((l) => l !== '').join('\n');

  onChunk(summary);

  return {
    message: summary,
    stateSignal: 'DONE',
    actions: {
      micrositeArtifactId,
      sourceProposal: artifactId,
    },
  };
}
