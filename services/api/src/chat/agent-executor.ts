/**
 * AgentExecutor — LLM + tool-calling loop for chat workflow states.
 *
 * Wraps the LLM bridge with a structured tool-request protocol.  The LLM is
 * prompted with available tool descriptions and may embed tool calls in its
 * response using an XML marker convention:
 *
 *   <tool_call>{"tool": "search-documents", "input": {"query": "..."}}</tool_call>
 *
 * The executor yields AgentStreamEvents as an async generator.  When a
 * tool_request event is yielded, execution is paused until the caller calls
 * resumeWithToolResult() with the tool output.
 *
 * Safety limits:
 *   MAX_TOOL_ITERATIONS (5)  — aborts if the LLM requests more than 5 tools
 *   TOOL_TIMEOUT_MS   (30s)  — per-tool execution timeout enforced by caller
 *
 * Event contract:
 *   { type: 'token';        text: string }                — streamed LLM chunk
 *   { type: 'phase';        name: string }                — phase label update
 *   { type: 'tool_request'; tool: string; input: unknown }— pause, run tool
 *   { type: 'final';        result: AgentResult }         — terminal event
 */

import type { ToolOutput } from '@ai-engine/core';
import type { GenerateFn } from '@ai-engine/planner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_TOOL_ITERATIONS = 5;
export const TOOL_TIMEOUT_MS = 30_000;
const CHUNK_SIZE = 80;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AgentStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'phase'; name: string }
  | { type: 'tool_request'; tool: string; input: unknown }
  | { type: 'final'; result: AgentResult };

export interface AgentResult {
  /** Full text output produced by the LLM (after all tool iterations). */
  text: string;
  /** Structured tool calls made during this execution. */
  toolResults: ToolResultRecord[];
  /** Set when the loop terminated due to max iterations. */
  maxIterationsReached?: boolean;
}

export interface ToolResultRecord {
  tool: string;
  input: unknown;
  output: ToolOutput;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  /** JSON-serialisable schema hint shown to the LLM — optional. */
  inputSchema?: string;
}

export interface AgentExecutorInput {
  /** The main user task / prompt. */
  prompt: string;
  /** Namespace for tool calls that need it (e.g. search-documents). */
  namespace: string;
  /** Tools the LLM may call during this execution. */
  tools: ToolDescriptor[];
  /**
   * Optional system-level instructions prepended before all other content.
   * Use this to inject the workflow-aware system prompt from the context builder.
   */
  systemPrompt?: string;
  /**
   * Optional prior context (e.g. earlier tool results or conversation history)
   * to seed the conversation. Each entry is a raw string segment appended
   * before the task prompt.
   */
  priorContext?: string[];
}

// ---------------------------------------------------------------------------
// Deferred — internal promise that supports external resolution
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Tool-call parsing
// ---------------------------------------------------------------------------

interface ParsedToolCall {
  tool: string;
  input: unknown;
  /** Full matched tag including delimiters — used to split response. */
  raw: string;
}

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/;

/**
 * Extract the first tool call from an LLM response.
 * Returns null if none found.
 */
function parseToolCall(text: string): ParsedToolCall | null {
  const match = TOOL_CALL_RE.exec(text);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as { tool?: string; input?: unknown };
    if (!parsed.tool || typeof parsed.tool !== 'string') return null;
    return { tool: parsed.tool, input: parsed.input ?? {}, raw: match[0] };
  } catch {
    return null;
  }
}

/** Strip the tool_call block and any surrounding whitespace. */
function stripToolCall(text: string, raw: string): string {
  return text.replace(raw, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildToolsSection(tools: ToolDescriptor[]): string {
  if (tools.length === 0) return '';

  const lines: string[] = [
    '## Available Tools',
    '',
    'You may call one tool per response by including this block **before or after** your text:',
    '',
    '<tool_call>{"tool": "tool-name", "input": {/* tool-specific fields */}}</tool_call>',
    '',
    'After a tool call you will receive the tool result and may call another tool or write your final answer.',
    '',
    'Tools:',
  ];

  for (const t of tools) {
    lines.push(`- **${t.name}**: ${t.description}${t.inputSchema ? `  Input: ${t.inputSchema}` : ''}`);
  }

  return lines.join('\n');
}

function buildFullPrompt(
  input: AgentExecutorInput,
  conversationHistory: string[],
): string {
  const parts: string[] = [];

  if (input.systemPrompt) {
    parts.push(input.systemPrompt);
    parts.push('');
  }

  if (input.tools.length > 0) {
    parts.push(buildToolsSection(input.tools));
    parts.push('');
  }

  if (input.priorContext && input.priorContext.length > 0) {
    parts.push('## Prior Context');
    parts.push('');
    parts.push(input.priorContext.join('\n\n'));
    parts.push('');
  }

  if (conversationHistory.length > 0) {
    parts.push('## Conversation');
    parts.push('');
    parts.push(conversationHistory.join('\n\n'));
    parts.push('');
  }

  parts.push('## Task');
  parts.push('');
  parts.push(input.prompt);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// AgentExecutor
// ---------------------------------------------------------------------------

export class AgentExecutor {
  private _toolResultDeferred: Deferred<ToolOutput> | null = null;

  constructor(private readonly llmGenerateFn: GenerateFn) {}

  /**
   * Resume execution after a tool_request event by injecting the tool output.
   * Must be called exactly once after each tool_request yield.
   */
  resumeWithToolResult(result: ToolOutput): void {
    if (!this._toolResultDeferred) {
      process.stderr.write('[AgentExecutor] resumeWithToolResult called with no pending request\n');
      return;
    }
    const deferred = this._toolResultDeferred;
    this._toolResultDeferred = null;
    deferred.resolve(result);
  }

  /**
   * Cancel a pending tool_request (e.g. on timeout or hard stop).
   * The generator will receive an error and terminate with a final event.
   */
  cancelPendingToolRequest(reason: string): void {
    if (!this._toolResultDeferred) return;
    const deferred = this._toolResultDeferred;
    this._toolResultDeferred = null;
    deferred.reject(new Error(reason));
  }

  /**
   * Run the executor as an async generator.
   *
   * Iteration protocol:
   *   1. Build prompt from input + conversation history.
   *   2. Call LLM.
   *   3. If response contains <tool_call>: yield tool_request, await result.
   *   4. Append tool result to conversation history, increment iteration.
   *   5. Repeat from (1) unless iteration limit hit.
   *   6. Stream final response as token chunks, then yield final.
   */
  async *runStreaming(input: AgentExecutorInput): AsyncGenerator<AgentStreamEvent> {
    const conversationHistory: string[] = [];
    const toolResults: ToolResultRecord[] = [];
    let iteration = 0;

    while (iteration <= MAX_TOOL_ITERATIONS) {
      const prompt = buildFullPrompt(input, conversationHistory);

      let llmResponse: string;
      try {
        llmResponse = await this.llmGenerateFn(prompt);
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        yield {
          type: 'final',
          result: {
            text: `LLM call failed: ${errorText}`,
            toolResults,
          },
        };
        return;
      }

      const toolCall = parseToolCall(llmResponse);

      if (!toolCall || iteration >= MAX_TOOL_ITERATIONS) {
        // No tool call (or safety limit reached) — this is the final response.
        const finalText = toolCall
          ? stripToolCall(llmResponse, toolCall.raw) +
            '\n\n*(Tool call limit reached — some information may be incomplete.)*'
          : llmResponse;

        // Emit as token chunks for progressive rendering
        for (let i = 0; i < finalText.length; i += CHUNK_SIZE) {
          yield { type: 'token', text: finalText.slice(i, i + CHUNK_SIZE) };
        }

        yield {
          type: 'final',
          result: {
            text: finalText,
            toolResults,
            maxIterationsReached: iteration >= MAX_TOOL_ITERATIONS && !!toolCall,
          },
        };
        return;
      }

      // Found a tool call — emit tool_request and pause until result arrives.
      const textBeforeToolCall = stripToolCall(llmResponse, toolCall.raw);
      if (textBeforeToolCall) {
        for (let i = 0; i < textBeforeToolCall.length; i += CHUNK_SIZE) {
          yield { type: 'token', text: textBeforeToolCall.slice(i, i + CHUNK_SIZE) };
        }
      }

      yield { type: 'tool_request', tool: toolCall.tool, input: toolCall.input };

      // Pause here — caller must call resumeWithToolResult() to continue.
      this._toolResultDeferred = createDeferred<ToolOutput>();
      let toolOutput: ToolOutput;
      try {
        toolOutput = await this._toolResultDeferred.promise;
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        yield {
          type: 'final',
          result: {
            text: `Tool execution aborted: ${errorText}`,
            toolResults,
          },
        };
        return;
      }

      // Record the result and add to conversation history for next LLM call.
      const record: ToolResultRecord = { tool: toolCall.tool, input: toolCall.input, output: toolOutput };
      toolResults.push(record);

      const toolResultText = toolOutput.text ?? JSON.stringify(toolOutput.json ?? {});
      conversationHistory.push(
        `[Tool call: ${toolCall.tool}]\nInput: ${JSON.stringify(toolCall.input)}\nResult: ${toolResultText}`,
      );

      iteration++;
    }

    // Should not be reachable — safety net
    yield {
      type: 'final',
      result: { text: '', toolResults, maxIterationsReached: true },
    };
  }
}
