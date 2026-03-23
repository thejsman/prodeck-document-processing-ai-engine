/**
 * design-editor-agent
 *
 * Applies AI-driven edits to a LayoutAST microsite.
 *
 * Two modes, auto-detected from the instruction:
 *
 *   DESIGN mode  — "make it darker", "warmer palette", "bolder headlines"
 *     → synthesises new customTokens + customFonts via the design system prompt
 *     → patches ast.customTokens / ast.customFonts / ast.customCharacter
 *
 *   CONTENT mode — "make the hero more urgent", "rewrite the approach section"
 *     → rewrites the content of a single targeted section
 *     → patches ast.sections[targetSectionId].content
 *
 * Input metadata:
 *   currentAst      (LayoutAST)  — the full site AST to edit
 *   instruction     (string)     — natural language edit instruction
 *   targetSectionId (string?)    — id of section to edit (content mode)
 *
 * Output:
 *   json: { ast: LayoutAST, mode: 'design' | 'content', changed: string[] }
 *   markdown: human-readable diff summary
 */

import type { Agent, AgentInput, AgentOutput } from '@ai-engine/core';
import { buildDesignSystemPrompt, buildFontUrls } from '@ai-engine/agent-microsite-generator';

// ── Intent classification ─────────────────────────────────────────────────

const DESIGN_KEYWORDS = /\b(darker|lighter|brighter|warmer|cooler|bolder|thinner|editorial|minimal|modern|clean|elegant|vibrant|muted|contrast|palette|color|colour|font|typography|spacing|dense|spacious|rounded|sharp|shadow|glow|gradient|dark mode|light mode|theme|style|layout|grid)\b/i;
const CONTENT_KEYWORDS = /\b(rewrite|rephrase|make|change|update|improve|strengthen|shorten|expand|more urgent|more compelling|more professional|headline|body|copy|text|message|tone|voice)\b/i;

function classifyIntent(instruction: string): 'design' | 'content' {
  const designScore = (instruction.match(DESIGN_KEYWORDS) ?? []).length;
  const contentScore = (instruction.match(CONTENT_KEYWORDS) ?? []).length;
  return designScore >= contentScore ? 'design' : 'content';
}

// ── Agent ─────────────────────────────────────────────────────────────────

export class DesignEditorAgent implements Agent {
  readonly name = 'design-editor-agent';
  readonly description =
    'Apply AI-driven design or content edits to a presentation microsite AST.';

  async run(input: AgentInput): Promise<AgentOutput> {
    const meta = input.metadata ?? {};
    const ast = meta['currentAst'] as Record<string, unknown> | undefined;
    const instruction = (meta['instruction'] as string | undefined)?.trim() ?? '';
    const targetSectionId = meta['targetSectionId'] as string | undefined;

    if (!ast || !instruction) {
      return {
        markdown: 'Missing currentAst or instruction.',
        json: { ast: ast ?? null, mode: null, changed: [] },
      };
    }

    const generateFn = meta['generateFn'] as
      | ((prompt: string) => Promise<string>)
      | undefined;

    if (!generateFn) {
      return {
        markdown: 'No generateFn provided — cannot call LLM.',
        json: { ast, mode: null, changed: [] },
      };
    }

    const mode = classifyIntent(instruction);

    if (mode === 'design') {
      return this.applyDesignEdit(ast, instruction, generateFn);
    } else {
      return this.applyContentEdit(ast, instruction, targetSectionId, generateFn);
    }
  }

  // ── Design mode ─────────────────────────────────────────────────────────

  private async applyDesignEdit(
    ast: Record<string, unknown>,
    instruction: string,
    generateFn: (prompt: string) => Promise<string>,
  ): Promise<AgentOutput> {
    const plugin = (ast['plugin'] as string | undefined) ?? 'obsidian';
    const brand = ast['brand'] as Record<string, unknown> | undefined;
    const primaryColor = brand?.['primaryColor'] as string | undefined;

    const prompt = buildDesignSystemPrompt(instruction, plugin, primaryColor);

    let rawJson: string;
    try {
      rawJson = await generateFn(prompt);
    } catch (err) {
      return {
        markdown: `LLM call failed: ${String(err)}`,
        json: { ast, mode: 'design', changed: [] },
      };
    }

    let designSystem: Record<string, unknown>;
    try {
      const cleaned = rawJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      designSystem = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return {
        markdown: `Failed to parse design system response.`,
        json: { ast, mode: 'design', changed: [] },
      };
    }

    // Extract token overrides from design system
    const tokenFields = ['bg', 'text', 'accent', 'heroFont', 'bodyFont', 'heroWeight', 'heroStyle', 'labelTracking', 'dark', 'noiseOpacity', 'borderRadius', 'buttonStyle', 'density'];
    const newTokens: Record<string, unknown> = {};
    for (const field of tokenFields) {
      if (designSystem[field] !== undefined) {
        newTokens[field] = designSystem[field];
      }
    }

    // Build custom fonts from new hero/body fonts
    const newFonts = buildFontUrls(designSystem);

    const changed: string[] = [];
    if (Object.keys(newTokens).length > 0) changed.push('customTokens');
    if (newFonts.length > 0) changed.push('customFonts');
    if (designSystem['customCharacter']) changed.push('customCharacter');
    if (designSystem['behavior']) changed.push('behavior');

    const patchedAst = {
      ...ast,
      customTokens: { ...(ast['customTokens'] as Record<string, unknown> | undefined ?? {}), ...newTokens },
      ...(newFonts.length > 0 ? { customFonts: newFonts } : {}),
      ...(designSystem['customCharacter'] ? { customCharacter: designSystem['customCharacter'] } : {}),
      ...(designSystem['behavior'] ? { behavior: designSystem['behavior'] } : {}),
    };

    const summary = changed.length > 0
      ? `Design updated: ${changed.join(', ')}. New style: "${String(designSystem['visualStyle'] ?? 'updated')}".`
      : 'No design changes detected.';

    return {
      markdown: summary,
      json: { ast: patchedAst, mode: 'design', changed },
    };
  }

  // ── Content mode ─────────────────────────────────────────────────────────

  private async applyContentEdit(
    ast: Record<string, unknown>,
    instruction: string,
    targetSectionId: string | undefined,
    generateFn: (prompt: string) => Promise<string>,
  ): Promise<AgentOutput> {
    const sections = ast['sections'] as Array<Record<string, unknown>> | undefined;
    if (!sections?.length) {
      return { markdown: 'No sections in AST.', json: { ast, mode: 'content', changed: [] } };
    }

    // Find target section
    const targetSection = targetSectionId
      ? sections.find((s) => s['id'] === targetSectionId)
      : sections[0]; // default to hero

    if (!targetSection) {
      return {
        markdown: `Section "${targetSectionId}" not found.`,
        json: { ast, mode: 'content', changed: [] },
      };
    }

    const sectionType = targetSection['sectionType'] as string ?? 'generic';
    const currentContent = JSON.stringify(targetSection['content'] ?? {}, null, 2);

    const prompt = `You are an expert copywriter editing a microsite section.

SECTION TYPE: ${sectionType}
CURRENT CONTENT (JSON):
${currentContent}

EDIT INSTRUCTION: ${instruction}

Return ONLY the updated content as valid JSON matching exactly the same field structure as the current content.
Do not add or remove fields. Only update the text values.
No markdown, no explanation, no code fences.`;

    let rawJson: string;
    try {
      rawJson = await generateFn(prompt);
    } catch (err) {
      return {
        markdown: `LLM call failed: ${String(err)}`,
        json: { ast, mode: 'content', changed: [] },
      };
    }

    let newContent: Record<string, unknown>;
    try {
      const cleaned = rawJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      newContent = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return {
        markdown: 'Failed to parse content response.',
        json: { ast, mode: 'content', changed: [] },
      };
    }

    const patchedSections = sections.map((s) =>
      s['id'] === targetSection['id']
        ? { ...s, content: newContent }
        : s,
    );

    const patchedAst = { ...ast, sections: patchedSections };
    const sectionLabel = (targetSection['heading'] as string | undefined) ?? sectionType;

    return {
      markdown: `Section "${sectionLabel}" content updated per instruction: "${instruction}".`,
      json: {
        ast: patchedAst,
        mode: 'content',
        changed: [targetSection['id'] as string ?? sectionType],
      },
    };
  }
}

export default new DesignEditorAgent();
