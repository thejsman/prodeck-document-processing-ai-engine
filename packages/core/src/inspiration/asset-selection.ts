/**
 * LLM-ranked asset selection.
 *
 * When multiple logos or heroes are available and none is manually flagged
 * primary, asks the LLM to pick the most contextually relevant one for the
 * current client and industry.
 *
 * Pure: no I/O. Caller injects generateFn.
 * Skip conditions (handled here, not by caller):
 *   - 0 or 1 candidate of a type → pick deterministically, no LLM
 *   - user already set isPrimary → honour it, no LLM
 */

import type { AssetMetadata } from './asset-types.js';

export interface AssetSelectionContext {
  clientName?: string;
  clientIndustry?: string;
}

export interface AssetSelection {
  logoId: string | null;
  heroId: string | null;
}

function pickPrimary(candidates: AssetMetadata[]): AssetMetadata | null {
  return candidates.find((a) => a.isPrimary) ?? candidates[0] ?? null;
}

function buildPrompt(
  logos: AssetMetadata[],
  heroes: AssetMetadata[],
  context: AssetSelectionContext,
): string {
  const clientLine = context.clientName ? `Client: ${context.clientName}` : '';
  const industryLine = context.clientIndustry ? `Industry: ${context.clientIndustry}` : '';
  const contextBlock = [clientLine, industryLine].filter(Boolean).join('\n');

  const formatCandidates = (assets: AssetMetadata[]): string =>
    assets
      .map(
        (a) =>
          `  - id: "${a.id}"  description: "${a.description || '(none)'}"  tags: [${a.tags.map((t) => `"${t}"`).join(', ')}]`,
      )
      .join('\n');

  return (
    `You are selecting brand assets for a microsite presentation.\n` +
    (contextBlock ? `${contextBlock}\n\n` : '') +
    (logos.length > 1
      ? `Logo candidates (pick the best match for this client):\n${formatCandidates(logos)}\n\n`
      : '') +
    (heroes.length > 1
      ? `Hero image candidates (pick the best match for this client):\n${formatCandidates(heroes)}\n\n`
      : '') +
    `Return ONLY valid JSON with exactly these fields — no markdown, no explanation:\n` +
    `{ "logoId": "<selected id or null>", "heroId": "<selected id or null>" }`
  );
}

export async function selectBestAssets(
  assets: AssetMetadata[],
  context: AssetSelectionContext,
  generateFn: (prompt: string) => Promise<string>,
): Promise<AssetSelection> {
  const tagged = assets.filter((a) => a.status === 'tagged');

  const logos = tagged.filter((a) => a.assetType === 'logo');
  const heroes = tagged.filter(
    (a) => a.assetType === 'hero' || a.assetType === 'background',
  );

  // If user manually set primary on either type, honour it (no LLM)
  const hasPrimaryLogo = logos.some((a) => a.isPrimary);
  const hasPrimaryHero = heroes.some((a) => a.isPrimary);

  // If both types have ≤1 candidate or a user-set primary, skip LLM entirely
  const needsLogoRank = !hasPrimaryLogo && logos.length > 1;
  const needsHeroRank = !hasPrimaryHero && heroes.length > 1;

  if (!needsLogoRank && !needsHeroRank) {
    return {
      logoId: pickPrimary(logos)?.id ?? null,
      heroId: pickPrimary(heroes)?.id ?? null,
    };
  }

  // Only pass candidates that actually need ranking to keep the prompt short
  const logosCandidates = needsLogoRank ? logos : [];
  const heroesCandidates = needsHeroRank ? heroes : [];

  const prompt = buildPrompt(logosCandidates, heroesCandidates, context);

  let logoId: string | null = pickPrimary(logos)?.id ?? null;
  let heroId: string | null = pickPrimary(heroes)?.id ?? null;

  try {
    const raw = await generateFn(prompt);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const parsed = JSON.parse(start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw) as {
      logoId?: unknown;
      heroId?: unknown;
    };

    const logoIds = new Set(logos.map((a) => a.id));
    const heroIds = new Set(heroes.map((a) => a.id));

    if (needsLogoRank && typeof parsed.logoId === 'string' && logoIds.has(parsed.logoId)) {
      logoId = parsed.logoId;
    }
    if (needsHeroRank && typeof parsed.heroId === 'string' && heroIds.has(parsed.heroId)) {
      heroId = parsed.heroId;
    }
  } catch {
    // LLM failed or returned non-JSON — fall back to deterministic pick (already set above)
  }

  return { logoId, heroId };
}

/**
 * Project a DesignKit with specific logo/hero overrides.
 * Assets matching the override IDs are treated as isPrimary for this projection
 * without mutating the input array.
 */
export { projectDesignKit } from './design-kit-project.js';

import { projectDesignKit as _project } from './design-kit-project.js';
import type { ComputedDesignKit } from './asset-types.js';

export function projectDesignKitWithSelection(
  assets: AssetMetadata[],
  selection: AssetSelection,
): ComputedDesignKit {
  const patched = assets.map((a) => ({
    ...a,
    isPrimary:
      (selection.logoId !== null && a.id === selection.logoId) ||
      (selection.heroId !== null && a.id === selection.heroId) ||
      a.isPrimary,
  }));
  return _project(patched);
}
