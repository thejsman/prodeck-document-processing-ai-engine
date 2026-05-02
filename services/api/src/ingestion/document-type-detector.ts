import type { DocumentType } from '../chat/context.types.js';

export interface DetectionResult {
  type: DocumentType;
  confidence: number;
  signals: string[];
}

export function detectDocumentType(fileName: string, content: string): DetectionResult {
  const name = fileName.toLowerCase();
  const contentLower = content.toLowerCase().slice(0, 2000);
  const signals: string[] = [];

  // --- Filename-based rules (high confidence, first match wins) ---

  if (/rfp|request.for.proposal|solicitation/i.test(name)) {
    signals.push('filename match: rfp');
    return { type: 'rfp', confidence: 0.95, signals };
  }

  if (/meeting|minutes|call.notes|transcript|standup|sync/i.test(name)) {
    signals.push('filename match: meeting');
    return { type: 'meeting_transcript', confidence: 0.90, signals };
  }

  if (/tech.spec|architecture|technical|system.design|spec/i.test(name)) {
    signals.push('filename match: technical');
    return { type: 'technical_spec', confidence: 0.90, signals };
  }

  if (/proposal|draft/i.test(name)) {
    signals.push('filename match: proposal');
    return { type: 'proposal_draft', confidence: 0.85, signals };
  }

  // --- Content-based rules ---

  // Transcript indicators: Otter.ai footer
  if (contentLower.includes('transcribed by') || contentLower.includes('otter.ai')) {
    signals.push('content: otter.ai transcript marker');
    return { type: 'meeting_transcript', confidence: 0.95, signals };
  }

  // High density of conversational filler words = likely transcript
  const fillerCount = (content.match(/\b(like|yeah|um|uh|okay|so|right|you know|I mean|basically)\b/gi) ?? []).length;
  const wordCount = content.split(/\s+/).length;
  const fillerRatio = fillerCount / wordCount;
  if (fillerRatio > 0.04) {
    signals.push(`content: filler ratio ${(fillerRatio * 100).toFixed(1)}%`);
    return { type: 'meeting_transcript', confidence: 0.85, signals };
  }

  // Email indicators
  if (/^(from|to|subject|date|cc|bcc)\s*:/im.test(content.slice(0, 500))) {
    signals.push('content: email header pattern');
    return { type: 'email', confidence: 0.90, signals };
  }

  // RFP indicators in content
  if (/\b(scope of work|evaluation criteria|submission deadline|proposal requirements|statement of work)\b/i.test(contentLower)) {
    signals.push('content: RFP terminology');
    return { type: 'rfp', confidence: 0.80, signals };
  }

  // Technical spec indicators
  const techTermCount = (contentLower.match(/\b(api|endpoint|database|schema|deployment|infrastructure|microservice|container|kubernetes|docker)\b/gi) ?? []).length;
  if (techTermCount > 5) {
    signals.push(`content: ${techTermCount} technical terms`);
    return { type: 'technical_spec', confidence: 0.75, signals };
  }

  signals.push('no strong signal — falling back to generic');
  return { type: 'generic', confidence: 0.50, signals };
}
