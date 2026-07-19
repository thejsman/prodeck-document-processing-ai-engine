// services/api/src/site-facts/types.ts
//
// Shared types for the site-facts pipeline: crawl a site with a headless
// browser, extract deterministic per-page data, then derive an atomic,
// sourced fact base intended as LLM grounding (not a narrative summary).

export type FactCategory =
  | 'company_info'
  | 'product'
  | 'pricing'
  | 'audience'
  | 'feature'
  | 'contact'
  | 'policy'
  | 'team'
  | 'other';

export type FactConfidence = 'high' | 'medium' | 'low';

export interface Fact {
  fact_id: string;
  site_url: string;
  source_url: string;
  source_section: string;
  category: FactCategory;
  statement: string;
  confidence: FactConfidence;
  extracted_at: string;
  verbatim_support: string;
}

export interface ExtractedHeading {
  level: 1 | 2 | 3;
  text: string;
}

export interface ExtractedLink {
  href: string;
  text: string;
  internal: boolean;
}

export interface ExtractedFormField {
  name: string;
  type: string;
}

export interface ExtractedForm {
  action: string | null;
  method: string | null;
  fields: ExtractedFormField[];
}

export interface ExtractedImage {
  src: string;
  alt: string;
}

export interface ContactInfo {
  emails: string[];
  phones: string[];
  addresses: string[];
}

export interface RawPageExtraction {
  url: string;
  canonical_url: string | null;
  title: string;
  meta_description: string | null;
  lang: string | null;
  headings: ExtractedHeading[];
  body_text: string;
  json_ld: unknown[];
  links: ExtractedLink[];
  forms: ExtractedForm[];
  images: ExtractedImage[];
  contact: ContactInfo;
  http_status: number;
  redirect_chain: string[];
  render_timestamp: string;
}

export type SiteCategory =
  | 'e-commerce'
  | 'saas'
  | 'blog'
  | 'corporate'
  | 'portfolio'
  | 'docs'
  | 'nonprofit'
  | 'other';

export interface SiteManifest {
  site_url: string;
  crawl_date: string;
  pages_crawled: number;
  page_urls: string[];
  site_category: SiteCategory;
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
}

/** Minimal logger shape accepted by this pipeline — avoids depending on pino's LogFn overloads. */
export interface SiteFactsLogger {
  warn: (obj: unknown, msg?: string) => void;
}

export const DEFAULT_MAX_PAGES = 40;
export const DEFAULT_MAX_DEPTH = 3;
