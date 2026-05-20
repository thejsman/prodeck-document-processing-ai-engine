/**
 * Chat routes — POST /chat/message
 *
 * Accepts an incoming chat message, runs it through the Chat V2 pipeline
 * (runChatAgent), and returns either a streaming SSE response or a plain
 * JSON response.
 *
 * SSE event stream format (when stream=true):
 *
 *   event: phase
 *   data: {"phase":"Analyzing RFP"}
 *
 *   data: "token chunk text..."     ← content tokens (default event type)
 *
 *   event: done
 *   data: {"message":"Your proposal draft is ready.","actions":{...}}
 *
 *   event: error
 *   data: {"error":"..."}
 *
 * Non-streaming response (when stream=false or absent):
 *   { message: string, actions?: Record<string, string> }
 *
 * Auth: inherits the global authHook applied in server.ts.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { runChatAgent } from './chat/chat-agent.js';
import type { ToolEvent } from './chat/tool-router.js';
import {
  chatSessionBus,
  type ChatSessionEvent,
} from './chat/chat-session-bus.js';
import { loadHistory, clearHistory, appendUploadMessage } from './chat/chat-history.service.js';
import { scanNamespace } from './namespace/namespace-intelligence.service.js';
import { deriveInsightSuggestions, type TemplateInsight } from './namespace/insight-rules.js';
import { recommendTemplate } from './templates/template-recommendation.service.js';
import { extractRfpRequirements } from './ingestion/extract-rfp-requirements.js';
import { llmGenerateFn } from './agent-routes.js';
import {
  listVersions,
  createVersionFromEdit,
} from './proposals/proposal-version.service.js';
import type { ProviderPolicyConfig } from './provider-policy.js';

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerChatRoutes(
  app: FastifyInstance,
  workdir: string,
  policyConfig: ProviderPolicyConfig | null,
): void {

  // POST /chat/message
  app.post('/chat/message', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      message?: unknown;
      namespace?: unknown;
      chatSessionId?: unknown;
      stream?: unknown;
    } | undefined;

    if (!body?.message || typeof body.message !== 'string' || !body.message.trim()) {
      return reply.code(400).send({ error: 'Missing required field: message' });
    }

    if (!body?.namespace || typeof body.namespace !== 'string' || !body.namespace.trim()) {
      return reply.code(400).send({ error: 'Missing required field: namespace' });
    }

    if (
      !body?.chatSessionId ||
      typeof body.chatSessionId !== 'string' ||
      !body.chatSessionId.trim()
    ) {
      return reply.code(400).send({ error: 'Missing required field: chatSessionId' });
    }

    const message = body.message.trim();
    const namespace = body.namespace.trim();
    const chatSessionId = body.chatSessionId.trim();
    const stream = body.stream === true;

    if (stream) {
      // ── Streaming SSE response ──────────────────────────────────
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        await runChatAgent({
          message,
          namespace,
          chatSessionId,
          workdir,
          generateFn: llmGenerateFn,
          policyConfig,
          onPhase: (phase: string) => {
            reply.raw.write(`event: phase\ndata: ${JSON.stringify({ phase })}\n\n`);
          },
          onChunk: (chunk: string) => {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          },
          onDone: (response) => {
            // Convert actionCards array to the actions Record format useSSE expects
            const actions: Record<string, string> = {};
            for (const card of response.actionCards) {
              if (card.type === 'view_proposal') actions.openProposalUrl = card.href;
              if (card.type === 'view_microsite') actions.openMicrositeUrl = card.href;
              if (card.type === 'view_templates') actions.openTemplatesUrl = card.href;
              if (card.type === 'view_template') actions.openTemplateUrl = card.href;
            }
            // Emit structured confirmation request before done so the frontend
            // can render an interactive confirmation block
            if (response.confirmationRequest) {
              reply.raw.write(
                `event: confirmation_request\ndata: ${JSON.stringify(response.confirmationRequest)}\n\n`,
              );
            }
            if (response.questions && response.questions.length > 0) {
              reply.raw.write(
                `event: questions_request\ndata: ${JSON.stringify(response.questions)}\n\n`,
              );
            }
            reply.raw.write(
              `event: done\ndata: ${JSON.stringify({ message: response.text, actions })}\n\n`,
            );
          },
          onToolEvent: (event: ToolEvent) => {
            reply.raw.write(
              `event: tool_progress\ndata: ${JSON.stringify({
                tool: event.tool,
                status: event.phase,
                durationMs: event.durationMs,
                ...(event.phase === 'error' ? { error: event.message } : {}),
              })}\n\n`,
            );
          },
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`,
        );
      } finally {
        reply.raw.end();
      }

      return;
    }

    // ── Non-streaming JSON response ─────────────────────────────
    try {
      const response = await runChatAgent({
        message,
        namespace,
        chatSessionId,
        workdir,
        generateFn: llmGenerateFn,
        policyConfig,
      });
      return reply.send({ message: response.text, actions: {} });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Chat orchestration failed: ${errorMessage}` });
    }
  });

  // ── GET /namespace/:namespace/insights ────────────────────────
  //
  // Returns derived insight suggestions for a namespace based on its current
  // filesystem state (documents indexed, RFP presence, proposal drafts, etc.).
  // Clients call this on mount and after each query to keep suggestions fresh.
  //
  app.get(
    '/namespace/:namespace/insights',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace } = req.params as { namespace: string };

      if (!namespace?.trim()) {
        return reply.code(400).send({ error: 'Missing namespace param' });
      }

      try {
        const ns = namespace.trim();
        const insights = await scanNamespace(workdir, ns);

        // Fetch template recommendation only when an RFP is present — avoids
        // unnecessary vector store queries when the namespace is empty.
        let templateInsight: TemplateInsight | null = null;
        if (insights.hasRfp && insights.ingestionPendingCount === 0) {
          try {
            const requirementMatrix = await extractRfpRequirements(workdir, ns);
            const rec = await recommendTemplate({ requirementMatrix, namespace: ns }, workdir);
            templateInsight = {
              templateName: rec.template?.name,
              confidence: rec.confidence,
              fallbackGenerate: rec.fallbackGenerate,
            };
          } catch {
            // Template recommendation is best-effort — don't fail the whole response
          }
        }

        const suggestions = deriveInsightSuggestions(insights, templateInsight);
        return reply.send({ suggestions, insights, templateInsight });
      } catch {
        return reply.send({ suggestions: [], insights: null, templateInsight: null });
      }
    },
  );

  // ── GET /chat/session/:chatSessionId/history ──────────────────
  //
  // Returns the persisted message history for a session.
  // Query param: namespace (required)
  //
  app.get(
    '/chat/session/:chatSessionId/history',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { chatSessionId } = req.params as { chatSessionId: string };
      const { namespace } = req.query as { namespace?: string };

      if (!chatSessionId?.trim()) {
        return reply.code(400).send({ error: 'Missing chatSessionId param' });
      }
      if (!namespace?.trim()) {
        return reply.code(400).send({ error: 'Missing namespace query param' });
      }

      const history = await loadHistory(workdir, namespace.trim(), chatSessionId.trim());
      return reply.send({ messages: history?.messages ?? [] });
    },
  );

  // ── POST /chat/session/:chatSessionId/upload-message ─────────────
  //
  // Persists an upload card to the session history so it survives page refreshes.
  // Body: { namespace, id, displayName, fileSize, fileNames }
  //
  app.post(
    '/chat/session/:chatSessionId/upload-message',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { chatSessionId } = req.params as { chatSessionId: string };
      const { namespace, id, displayName, fileSize, fileNames } = req.body as {
        namespace: string;
        id: string;
        displayName: string;
        fileSize: number;
        fileNames: string[];
      };

      if (!chatSessionId?.trim()) return reply.code(400).send({ error: 'Missing chatSessionId' });
      if (!namespace?.trim()) return reply.code(400).send({ error: 'Missing namespace' });
      if (!id?.trim()) return reply.code(400).send({ error: 'Missing id' });
      if (!Array.isArray(fileNames)) return reply.code(400).send({ error: 'fileNames must be an array' });

      await appendUploadMessage(workdir, namespace.trim(), chatSessionId.trim(), {
        id,
        displayName: displayName ?? '',
        fileSize: fileSize ?? 0,
        fileNames,
      });
      return reply.code(201).send({ ok: true });
    },
  );

  // ── DELETE /chat/session/:chatSessionId/history ──────────────────
  //
  // Clears the persisted message history for a session.
  // Query param: namespace (required)
  //
  app.delete(
    '/chat/session/:chatSessionId/history',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { chatSessionId } = req.params as { chatSessionId: string };
      const { namespace } = req.query as { namespace?: string };

      if (!chatSessionId?.trim()) {
        return reply.code(400).send({ error: 'Missing chatSessionId param' });
      }
      if (!namespace?.trim()) {
        return reply.code(400).send({ error: 'Missing namespace query param' });
      }

      await clearHistory(workdir, namespace.trim(), chatSessionId.trim());
      return reply.code(204).send();
    },
  );

  // ── GET /chat/session/:chatSessionId/stream ────────────────────
  //
  // Long-lived SSE channel for a single chat session.  The client connects
  // once and receives events pushed by resumeWorkflow() or any other
  // server-initiated action for that session.
  //
  // SSE event format mirrors POST /chat/message stream:
  //   event: phase   → { phase: string }
  //   data: (default) → chunk string
  //   event: done    → { message, actions }
  //   event: error   → { error }
  //   event: system  → { message }   (e.g. "Ingestion failed")
  //
  app.get(
    '/chat/session/:chatSessionId/stream',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { chatSessionId } = req.params as { chatSessionId: string };

      if (!chatSessionId?.trim()) {
        return reply.code(400).send({ error: 'Missing chatSessionId param' });
      }

      const raw = reply.raw;
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no');
      raw.flushHeaders();

      // Heartbeat every 25 s to keep proxies from dropping the connection
      const heartbeat = setInterval(() => {
        raw.write(': heartbeat\n\n');
      }, 25_000);

      const handler = (event: ChatSessionEvent) => {
        switch (event.type) {
          case 'phase':
            raw.write(`event: phase\ndata: ${JSON.stringify({ phase: event.phase })}\n\n`);
            break;
          case 'chunk':
            raw.write(`data: ${JSON.stringify(event.chunk)}\n\n`);
            break;
          case 'done':
            raw.write(
              `event: done\ndata: ${JSON.stringify({
                message: event.message ?? '',
                actions: event.actions ?? {},
              })}\n\n`,
            );
            break;
          case 'system':
            raw.write(
              `event: system\ndata: ${JSON.stringify({ message: event.message ?? '' })}\n\n`,
            );
            break;
          case 'error':
            raw.write(
              `event: error\ndata: ${JSON.stringify({ error: event.error ?? 'Unknown error' })}\n\n`,
            );
            break;
          case 'tool_progress':
            raw.write(
              `event: tool_progress\ndata: ${JSON.stringify(event.toolProgress ?? {})}\n\n`,
            );
            break;
          case 'namespace_insight':
            raw.write(
              `event: namespace_insight\ndata: ${JSON.stringify({ suggestions: event.suggestions ?? [] })}\n\n`,
            );
            break;
          case 'proposal_section':
            raw.write(
              `event: proposal_section\ndata: ${JSON.stringify(event.proposalSection ?? {})}\n\n`,
            );
            break;
        }
      };

      chatSessionBus.on(chatSessionId, handler);

      req.raw.on('close', () => {
        clearInterval(heartbeat);
        chatSessionBus.off(chatSessionId, handler);
      });

      await new Promise<void>((resolve) => {
        req.raw.on('close', resolve);
      });
    },
  );

  // ── POST /chat/proposal/section/edit ─────────────────────────────
  //
  // Edit a single section of a proposal artifact.
  //
  // Body: { namespace, artifactId, section, instruction?, newContent? }
  //   - instruction: rewrite the section using LLM guidance
  //   - newContent:  replace the section content verbatim (direct user edit)
  //
  // Returns: { content, versionLabel }
  //
  app.post(
    '/chat/proposal/section/edit',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as {
        namespace?: unknown;
        artifactId?: unknown;
        section?: unknown;
        instruction?: unknown;
        newContent?: unknown;
      };

      const namespace  = typeof body?.namespace  === 'string' ? body.namespace.trim()  : '';
      const artifactId = typeof body?.artifactId === 'string' ? body.artifactId.trim() : '';
      const section    = typeof body?.section    === 'string' ? body.section.trim()    : '';
      const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
      const newContent  = typeof body?.newContent  === 'string' ? body.newContent.trim()  : '';

      if (!namespace || !artifactId || !section) {
        return reply.code(400).send({ error: 'Missing required fields: namespace, artifactId, section' });
      }
      if (!instruction && !newContent) {
        return reply.code(400).send({ error: 'Provide either instruction or newContent' });
      }

      // ── Read proposal markdown ──────────────────────────────────
      const filePath = path.join(workdir, 'namespaces', namespace, 'proposals', artifactId);
      let markdown: string;
      try {
        markdown = await readFile(filePath, 'utf-8');
      } catch {
        return reply.code(404).send({ error: `Proposal not found: ${artifactId}` });
      }

      // ── Parse into sections ─────────────────────────────────────
      const parsed = parseMarkdownSections(markdown);
      const target = parsed.find(
        (s) => s.heading.toLowerCase() === section.toLowerCase(),
      );

      if (!target) {
        return reply.code(404).send({ error: `Section not found: ${section}` });
      }

      // ── Produce new content ─────────────────────────────────────
      let updatedContent: string;

      if (newContent) {
        updatedContent = newContent;
      } else {
        // LLM rewrite
        const editPrompt = [
          `You are rewriting the **${target.heading}** section of a proposal.`,
          '',
          'Original section content:',
          target.content,
          '',
          'User instruction:',
          instruction,
          '',
          'Rules:',
          '- Apply the instruction precisely to this section only',
          '- Output ONLY the new section body — no heading, no commentary',
          '- Maintain professional, persuasive tone',
        ].join('\n');

        try {
          updatedContent = await llmGenerateFn(editPrompt);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.code(502).send({ error: `LLM rewrite failed: ${msg}` });
        }
      }

      // ── Replace section and persist ─────────────────────────────
      const updatedSections = parsed.map((s) =>
        s.heading === target.heading ? { ...s, content: updatedContent.trim() } : s,
      );
      const updatedMarkdown = assembleSections(updatedSections);
      await writeFile(filePath, updatedMarkdown, 'utf-8');

      // ── Create new version snapshot ─────────────────────────────
      const summary = instruction
        ? `Edited via chat: ${instruction.slice(0, 80)}`
        : `Direct edit: ${section}`;

      const version = await createVersionFromEdit(
        workdir, namespace, artifactId, updatedMarkdown, null, 'user', summary,
      );

      return reply.send({ content: updatedContent.trim(), versionLabel: version.versionLabel });
    },
  );
}

// ---------------------------------------------------------------------------
// Markdown section helpers (shared with proposal-version-control.handlers)
// ---------------------------------------------------------------------------

interface ParsedSection {
  heading: string;
  content: string;
}

function parseMarkdownSections(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n');
  const sections: ParsedSection[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() });
      currentHeading = headingMatch[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() });

  return sections;
}

function assembleSections(sections: ParsedSection[]): string {
  return sections
    .map((s) => (s.heading ? `## ${s.heading}\n\n${s.content}` : s.content))
    .join('\n\n')
    .trim() + '\n';
}
