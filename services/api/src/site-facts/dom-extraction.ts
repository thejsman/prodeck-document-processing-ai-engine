// services/api/src/site-facts/dom-extraction.ts
//
// Deterministic, DOM-based per-page extraction (spec step 3) — no LLM
// involvement. `runBrowserExtraction` executes inside the rendered page via
// Puppeteer's page.evaluate and must be a self-contained function (no
// closures over outer scope). Everything else here is a pure Node-side
// helper operating on its output, so it's unit-testable without a browser.

import type {
  ContactInfo,
  ExtractedForm,
  ExtractedHeading,
  ExtractedImage,
  ExtractedLink,
} from './types.js';

/** Raw shape returned by runBrowserExtraction, before Node-side link resolution. */
export interface BrowserExtractionResult {
  canonical_url: string | null;
  title: string;
  meta_description: string | null;
  lang: string | null;
  headings: ExtractedHeading[];
  body_text: string;
  json_ld: unknown[];
  raw_links: { href: string; text: string }[];
  forms: ExtractedForm[];
  images: ExtractedImage[];
}

const BOILERPLATE_SELECTOR = [
  'nav',
  'header',
  'footer',
  'aside',
  'script',
  'style',
  'noscript',
  '[role="banner"]',
  '[role="navigation"]',
  '[aria-hidden="true"]',
].join(',');

const BOILERPLATE_KEYWORD = /cookie|consent|banner|advert|popup|modal|newsletter/i;

/**
 * Runs inside the browser via page.evaluate — must have zero references to
 * outer-scope variables. Kept as a plain function (not arrow) so Puppeteer
 * can serialize it directly.
 */
export function runBrowserExtraction(): BrowserExtractionResult {
  const doc = document;

  const clone = doc.body ? (doc.body.cloneNode(true) as HTMLElement) : doc.createElement('body');
  clone.querySelectorAll('nav, header, footer, aside, script, style, noscript, [role="banner"], [role="navigation"], [aria-hidden="true"]').forEach((el) => el.remove());
  clone.querySelectorAll('*').forEach((el) => {
    const idClass = `${el.id} ${el.className}`;
    if (/cookie|consent|banner|advert|popup|modal|newsletter/i.test(idClass)) el.remove();
  });

  const main = clone.querySelector('main, article, [role="main"]') as HTMLElement | null;
  const bodyText = (main ?? clone).innerText.replace(/\s+/g, ' ').trim();

  const headings: { level: number; text: string }[] = [];
  clone.querySelectorAll('h1, h2, h3').forEach((el) => {
    const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (text) headings.push({ level: Number(el.tagName[1]), text });
  });

  const jsonLd: unknown[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      jsonLd.push(JSON.parse(el.textContent ?? ''));
    } catch {
      /* skip malformed JSON-LD block */
    }
  });

  const rawLinks: { href: string; text: string }[] = [];
  doc.querySelectorAll('a[href]').forEach((el) => {
    const href = el.getAttribute('href');
    if (!href) return;
    rawLinks.push({ href, text: el.textContent?.replace(/\s+/g, ' ').trim() ?? '' });
  });

  const forms: { action: string | null; method: string | null; fields: { name: string; type: string }[] }[] = [];
  doc.querySelectorAll('form').forEach((form) => {
    const fields: { name: string; type: string }[] = [];
    form.querySelectorAll('input, select, textarea').forEach((field) => {
      const name = field.getAttribute('name') ?? field.getAttribute('id') ?? '';
      const type = field.getAttribute('type') ?? field.tagName.toLowerCase();
      if (name) fields.push({ name, type });
    });
    forms.push({ action: form.getAttribute('action'), method: form.getAttribute('method'), fields });
  });

  const images: { src: string; alt: string }[] = [];
  doc.querySelectorAll('img[src]').forEach((el) => {
    const src = el.getAttribute('src');
    if (!src) return;
    images.push({ src, alt: el.getAttribute('alt') ?? '' });
  });

  const canonicalEl = doc.querySelector('link[rel="canonical"]');
  const metaDescEl = doc.querySelector('meta[name="description"]');

  return {
    canonical_url: canonicalEl?.getAttribute('href') ?? null,
    title: doc.title ?? '',
    meta_description: metaDescEl?.getAttribute('content') ?? null,
    lang: doc.documentElement.getAttribute('lang'),
    headings: headings as ExtractedHeading[],
    body_text: bodyText,
    json_ld: jsonLd,
    raw_links: rawLinks,
    forms,
    images,
  };
}

/** Resolve relative hrefs against the page URL and classify same-domain vs external. */
export function resolveLinks(pageUrl: string, rawLinks: { href: string; text: string }[]): ExtractedLink[] {
  const origin = new URL(pageUrl).hostname;
  const resolved: ExtractedLink[] = [];
  for (const { href, text } of rawLinks) {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    try {
      const abs = new URL(href, pageUrl);
      resolved.push({ href: abs.toString(), text, internal: abs.hostname === origin });
    } catch {
      /* unparseable href — skip */
    }
  }
  return resolved;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;
const ADDRESS_KEYWORD_REGEX = /\b\d{1,6}\s+[A-Za-z0-9.'\s]{3,60}\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|suite|floor|block)\b[^.\n]{0,60}/gi;

/** Deterministic contact-info extraction via regex — never LLM inference. */
export function extractContactInfo(text: string): ContactInfo {
  const emails = [...new Set((text.match(EMAIL_REGEX) ?? []).map((e) => e.toLowerCase()))];

  const phones = [...new Set(
    (text.match(PHONE_REGEX) ?? [])
      .map((p) => p.trim())
      .filter((p) => p.replace(/\D/g, '').length >= 7),
  )];

  const addresses = [...new Set((text.match(ADDRESS_KEYWORD_REGEX) ?? []).map((a) => a.trim()))];

  return { emails, phones, addresses };
}

/** Pull emails/phones hidden in mailto:/tel: hrefs — visible text alone often misses these. */
export function extractContactFromHrefs(rawLinks: { href: string }[]): Pick<ContactInfo, 'emails' | 'phones'> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const { href } of rawLinks) {
    if (/^mailto:/i.test(href)) {
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
      if (email) emails.add(email);
    } else if (/^tel:/i.test(href)) {
      const phone = href.replace(/^tel:/i, '').trim();
      if (phone) phones.add(phone);
    }
  }
  return { emails: [...emails], phones: [...phones] };
}
