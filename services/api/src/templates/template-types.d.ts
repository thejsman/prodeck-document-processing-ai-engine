/**
 * Template Recommendation Intelligence — type definitions.
 *
 * Defines the shape of proposal templates (both system-predefined and
 * derived from past proposals) and the recommendation result returned
 * by the recommendation engine.
 */
export interface ProposalTemplate {
    /** Unique template identifier (e.g. "enterprise-cloud", "saas-migration"). */
    id: string;
    /** Human-readable display name. */
    name: string;
    /** Keyword tags for semantic matching (e.g. ["cloud", "migration", "enterprise"]). */
    tags: string[];
    /** Industries this template is suited for (e.g. ["finance", "healthcare"]). */
    industries?: string[];
    /** Technical or business capabilities addressed (e.g. ["kubernetes", "ci-cd"]). */
    capabilities?: string[];
    /** Ordered section structure for the proposal. */
    structure: string[];
}
export interface TemplateRecommendation {
    /** Matched template ID, or undefined when fallback generation is needed. */
    templateId?: string;
    /** Matched template object (convenience — avoids a second lookup). */
    template?: ProposalTemplate;
    /** Confidence score 0–1 indicating match quality. */
    confidence: number;
    /** Human-readable explanation of why this template was selected. */
    reasoning: string;
    /** When true, no existing template is a good fit — generate one from scratch. */
    fallbackGenerate: boolean;
}
export interface RecommendationContext {
    /** Structured requirements extracted from the RFP. */
    requirementMatrix: {
        functional: string[];
        compliance: string[];
        timeline: string[];
        pricing: string[];
    };
    /** Detected industry vertical (if known). */
    detectedIndustry?: string;
    /** Key capabilities needed based on RFP analysis. */
    keyCapabilities?: string[];
    /** Namespace to search for product docs and past proposals. */
    namespace: string;
}
//# sourceMappingURL=template-types.d.ts.map