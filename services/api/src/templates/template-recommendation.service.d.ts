/**
 * Template Recommendation Engine — intelligent template selection.
 *
 * Scores available templates against RFP context using a multi-signal
 * algorithm:
 *   1. Tag match     — keyword overlap between requirements and template tags
 *   2. Industry match — detected industry vs. template industries
 *   3. Capability overlap — needed capabilities vs. template capabilities
 *
 * When no template scores above the confidence threshold, the engine
 * sets `fallbackGenerate = true` so the workflow can generate a custom
 * section structure from scratch.
 *
 * Placement: services/templates (adapter layer) because it reads from
 * the vector store via @ai-engine/runtime and uses the template registry.
 */
import type { RecommendationContext, TemplateRecommendation } from './template-types.js';
/**
 * Recommend the best proposal template for the given RFP context.
 *
 * @param context   - RFP requirements, detected industry, capabilities
 * @param workdir   - server working directory (for vector store + template registry)
 * @returns recommendation with template, confidence, and reasoning
 */
export declare function recommendTemplate(context: RecommendationContext, workdir: string): Promise<TemplateRecommendation>;
//# sourceMappingURL=template-recommendation.service.d.ts.map