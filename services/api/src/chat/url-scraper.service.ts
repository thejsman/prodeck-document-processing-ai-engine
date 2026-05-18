// services/api/src/chat/url-scraper.service.ts
//
// URL scraping service for client data and branding extraction.
//
// Given a URL, this service:
//   1. Fetches the page HTML
//   2. Extracts meta tags, about content, services, team info
//   3. Extracts CSS design tokens (colors, fonts, spacing)
//   4. Returns structured client data + branding kit
//
// Uses the existing LLM generateFn for content interpretation.
// No new dependencies — uses built-in fetch + regex parsing.

import type { RequirementField, RequirementKey } from './context.types.js';
import type { BrandingKit, BrandColor, BrandTypography } from './branding.types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScrapeResult {
  /** Extracted requirement fields (same format as document extraction) */
  fields: Partial<Record<RequirementKey, RequirementField<unknown>>>;
  /** Custom fields extracted (industry-specific) */
  customFields: Record<string, RequirementField<string>>;
  /** Branding kit extracted from CSS/design */
  brandingKit: BrandingKit | null;
  /** Raw text content for further LLM processing */
  rawContent: string;
  /** Pages that were scraped */
  pagesScraped: string[];
  /** Warnings during scrape */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// HTML parsing helpers (no external deps — regex-based)
// ---------------------------------------------------------------------------

function extractMetaTags(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const metaRegex = /<meta\s+(?:[^>]*?\s+)?(?:name|property)=["']([^"']+)["']\s+content=["']([^"']+)["']/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    meta[match[1]!.toLowerCase()] = match[2]!;
  }
  // Also try reversed order (content before name)
  const metaRegex2 = /<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["']([^"']+)["']/gi;
  while ((match = metaRegex2.exec(html)) !== null) {
    meta[match[2]!.toLowerCase()] = match[1]!;
  }
  return meta;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() ?? '';
}

function extractTextContent(html: string): string {
  // Remove scripts, styles, and HTML tags
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000); // Cap to avoid huge payloads
}

function extractLogoUrl(html: string, baseUrl: string): string | undefined {
  // Look for common logo patterns
  const patterns = [
    /<img[^>]+class=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i,
    /<img[^>]+alt=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*logo[^"']*["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+alt=["'][^"']*logo[^"']*["']/i,
    /<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      try {
        return new URL(match[1], baseUrl).href;
      } catch {
        return match[1];
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// CSS / Branding extraction
// ---------------------------------------------------------------------------

function extractColors(html: string): BrandColor[] {
  const colors: BrandColor[] = [];
  const seen = new Set<string>();

  // Extract from inline styles and style blocks
  const styleContent = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)?.join(' ') ?? '';
  const allContent = styleContent + ' ' + html;

  // CSS custom properties (--primary-color, --brand-color, etc.)
  const varRegex = /--(?:primary|secondary|accent|brand|main|bg|background|text)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/g;
  let match;
  while ((match = varRegex.exec(allContent)) !== null) {
    const hex = normalizeColor(match[1]!);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      const usage = inferColorUsage(match[0], hex);
      colors.push({ hex, usage, confidence: 0.7 });
    }
  }

  // Hex colors in CSS (collect top ones by frequency)
  const hexRegex = /#([0-9a-fA-F]{6})\b/g;
  const hexCounts: Record<string, number> = {};
  while ((match = hexRegex.exec(styleContent)) !== null) {
    const hex = `#${match[1]!.toLowerCase()}`;
    if (!isNeutralColor(hex)) {
      hexCounts[hex] = (hexCounts[hex] ?? 0) + 1;
    }
  }

  // Top 5 most frequent non-neutral colors
  const topColors = Object.entries(hexCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [hex] of topColors) {
    if (!seen.has(hex)) {
      seen.add(hex);
      colors.push({ hex, usage: colors.length === 0 ? 'primary' : 'accent', confidence: 0.5 });
    }
  }

  return colors.slice(0, 8);
}

function extractTypography(html: string): BrandTypography[] {
  const typography: BrandTypography[] = [];
  const seen = new Set<string>();

  const styleContent = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)?.join(' ') ?? '';

  // font-family declarations
  const fontRegex = /font-family\s*:\s*["']?([^"';,}]+)/g;
  let match;
  while ((match = fontRegex.exec(styleContent)) !== null) {
    const font = match[1]!.trim().replace(/["']/g, '');
    if (font && !seen.has(font.toLowerCase()) && !isSystemFont(font)) {
      seen.add(font.toLowerCase());
      typography.push({
        fontFamily: font,
        usage: typography.length === 0 ? 'heading' : 'body',
        confidence: 0.6,
      });
    }
  }

  // Google Fonts links
  const gfRegex = /fonts\.googleapis\.com\/css2?\?family=([^"&]+)/g;
  while ((match = gfRegex.exec(html)) !== null) {
    const families = decodeURIComponent(match[1]!).split('|');
    for (const family of families) {
      const name = family.split(':')[0]!.replace(/\+/g, ' ').trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        typography.push({
          fontFamily: name,
          usage: typography.length === 0 ? 'heading' : 'body',
          confidence: 0.8,
        });
      }
    }
  }

  return typography.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function normalizeColor(color: string): string | null {
  color = color.trim();
  if (color.startsWith('#')) {
    // Expand shorthand
    if (color.length === 4) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toLowerCase();
    }
    return color.slice(0, 7).toLowerCase();
  }
  // Basic rgb() parsing
  const rgbMatch = color.match(/rgb[a]?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]!).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2]!).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3]!).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return null;
}

function isNeutralColor(hex: string): boolean {
  // Grayscale or near-grayscale
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  return maxDiff < 20; // Very close to grayscale
}

function inferColorUsage(declaration: string, _hex: string): BrandColor['usage'] {
  const lower = declaration.toLowerCase();
  if (lower.includes('primary') || lower.includes('brand') || lower.includes('main')) return 'primary';
  if (lower.includes('secondary')) return 'secondary';
  if (lower.includes('accent')) return 'accent';
  if (lower.includes('bg') || lower.includes('background')) return 'background';
  if (lower.includes('text') || lower.includes('font') || lower.includes('foreground')) return 'text';
  return 'primary';
}

function isSystemFont(font: string): boolean {
  const system = ['arial', 'helvetica', 'times', 'times new roman', 'courier', 'verdana',
    'georgia', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui',
    'sans-serif', 'serif', 'monospace', 'cursive', 'inherit', 'initial', 'unset'];
  return system.includes(font.toLowerCase());
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeUrl(
  url: string,
  generateFn?: (prompt: string) => Promise<string>,
): Promise<ScrapeResult> {
  const warnings: string[] = [];
  const pagesScraped: string[] = [];

  // Normalize URL
  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('http')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let html: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ProDeck/1.0; +https://prodeck.ai)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      warnings.push(`HTTP ${response.status} from ${normalizedUrl}`);
      return { fields: {}, customFields: {}, brandingKit: null, rawContent: '', pagesScraped: [], warnings };
    }

    html = await response.text();
    pagesScraped.push(normalizedUrl);
  } catch (err) {
    warnings.push(`Failed to fetch ${normalizedUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return { fields: {}, customFields: {}, brandingKit: null, rawContent: '', pagesScraped: [], warnings };
  }

  // Extract structured data from HTML
  const meta = extractMetaTags(html);
  const title = extractTitle(html);
  const textContent = extractTextContent(html);
  const logoUrl = extractLogoUrl(html, normalizedUrl);
  const colors = extractColors(html);
  const typography = extractTypography(html);

  const now = new Date().toISOString();

  // Build branding kit
  const brandingKit: BrandingKit = {
    logoUrl,
    colors,
    typography,
    source: 'website_scrape',
    extractedAt: now,
  };

  // Build basic fields from meta tags
  const fields: Partial<Record<RequirementKey, RequirementField<unknown>>> = {};

  // Try to extract client name from title or og:site_name
  const siteName = meta['og:site_name'] || meta['application-name'] || title.split(/[|–—-]/)[0]?.trim();
  if (siteName) {
    fields.clientName = {
      value: siteName,
      confidence: 0.6,
      source: 'document',
      updatedAt: now,
      sourceFile: normalizedUrl,
    };
  }

  // Extract description for context
  const description = meta['og:description'] || meta['description'] || '';

  // Use LLM to extract structured fields from the page content if available
  const customFields: Record<string, RequirementField<string>> = {};

  if (generateFn && textContent.length > 50) {
    try {
      const llmResult = await generateFn(`Analyze this website content and extract business information.

Website: ${normalizedUrl}
Title: ${title}
Description: ${description}

Content (first 4000 chars):
${textContent.slice(0, 4000)}

Return ONLY a JSON object with these fields (null if not found):
{
  "clientName": "company name",
  "clientIndustry": "their industry/domain",
  "companySize": "small/medium/large/enterprise if determinable",
  "services": ["what they offer"],
  "targetMarket": "who they serve",
  "keyDifferentiators": ["what makes them unique"],
  "location": "headquarters or primary location",
  "visualTone": "minimal/bold/corporate/playful/luxury based on the site design"
}

JSON only, no explanation:`);

      const parsed = safeParseJSON(llmResult);
      if (parsed) {
        if (parsed.clientName && !fields.clientName) {
          fields.clientName = { value: parsed.clientName, confidence: 0.7, source: 'document', updatedAt: now, sourceFile: normalizedUrl };
        }
        if (parsed.clientIndustry) {
          fields.clientIndustry = { value: parsed.clientIndustry, confidence: 0.65, source: 'document', updatedAt: now, sourceFile: normalizedUrl };
        }
        // Store additional findings as custom fields
        for (const [key, value] of Object.entries(parsed)) {
          if (key === 'clientName' || key === 'clientIndustry' || !value) continue;
          const strValue = Array.isArray(value) ? value.join(', ') : String(value);
          if (strValue && strValue !== 'null') {
            customFields[`scraped_${key}`] = {
              value: strValue,
              confidence: 0.5,
              source: 'document',
              updatedAt: now,
              sourceFile: normalizedUrl,
            };
          }
        }
        // Apply visual tone to branding kit
        if (typeof parsed.visualTone === 'string') {
          brandingKit.visualTone = parsed.visualTone;
        }
      }
    } catch (err) {
      warnings.push(`LLM extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    fields,
    customFields,
    brandingKit,
    rawContent: textContent,
    pagesScraped,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Safe JSON parse
// ---------------------------------------------------------------------------

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const result = JSON.parse(cleaned);
    return typeof result === 'object' && result !== null ? result : null;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const result = JSON.parse(match[0]);
        return typeof result === 'object' && result !== null ? result : null;
      } catch { return null; }
    }
    return null;
  }
}
