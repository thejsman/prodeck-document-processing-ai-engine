export type {
  VoiceFormality,
  VoiceStyleProfile,
  WeightedItem,
  AuthorVoice,
  ComputedAuthorVoice,
} from './voice-types.js';
export {
  mergeVoiceProfiles,
  renderVoicePromptBlock,
  recencyWeight,
  AUTHOR_VOICE_HEADING,
} from './voice-merge.js';
export type { ExtractedStyle } from './style-extraction.js';
export {
  buildStylePrompt,
  parseStyleResponse,
  looksLikeFact,
  STYLE_EXCERPT_MAX_CHARS,
} from './style-extraction.js';
