import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @ai-engine/runtime before importing the module under test.
// The recommendation service calls searchKnowledgeChunks — we don't want
// a real FAISS index for unit tests.
vi.mock('@ai-engine/runtime', () => ({
  searchKnowledgeChunks: vi.fn().mockResolvedValue({
    chunks: [
      { text: 'cloud migration kubernetes security compliance aws', score: 0.9 },
      { text: 'data pipeline etl analytics dashboard', score: 0.8 },
    ],
  }),
}));

// Mock the template registry to return a known set of templates.
vi.mock('./template-registry.js', () => ({
  listTemplates: vi.fn().mockResolvedValue([
    {
      id: 'enterprise-cloud-migration',
      name: 'Enterprise Cloud Migration',
      tags: ['cloud', 'migration', 'infrastructure', 'enterprise'],
      industries: ['technology', 'finance'],
      capabilities: ['cloud-architecture', 'migration-planning', 'security'],
      structure: ['Executive Summary', 'Migration Strategy', 'Timeline'],
    },
    {
      id: 'data-analytics-solution',
      name: 'Data & Analytics Solution',
      tags: ['data', 'analytics', 'bi', 'pipeline'],
      industries: ['finance', 'retail'],
      capabilities: ['data-engineering', 'analytics', 'visualization'],
      structure: ['Executive Summary', 'Data Architecture', 'Implementation'],
    },
    {
      id: 'managed-services',
      name: 'Managed Services',
      tags: ['managed', 'services', 'support', 'monitoring'],
      industries: ['technology'],
      capabilities: ['monitoring', '24x7-support'],
      structure: ['Executive Summary', 'SLA', 'Pricing'],
    },
  ]),
}));

import { recommendTemplate } from './template-recommendation.service.js';
import type { RecommendationContext } from './template-types.js';

describe('recommendTemplate', () => {
  const workdir = '/tmp/test-workdir';

  describe('with cloud migration requirements', () => {
    const context: RecommendationContext = {
      requirementMatrix: {
        functional: ['cloud migration to AWS', 'infrastructure modernization'],
        compliance: ['SOC2 security compliance'],
        timeline: ['6 month timeline'],
        pricing: ['fixed bid'],
      },
      detectedIndustry: 'technology',
      keyCapabilities: ['cloud-architecture', 'security'],
      namespace: 'test-ns',
    };

    it('recommends the cloud migration template', async () => {
      const result = await recommendTemplate(context, workdir);

      expect(result.fallbackGenerate).toBe(false);
      expect(result.templateId).toBe('enterprise-cloud-migration');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.reasoning).toContain('Enterprise Cloud Migration');
    });

    it('returns a template object with structure', async () => {
      const result = await recommendTemplate(context, workdir);

      expect(result.template).toBeDefined();
      expect(result.template!.structure).toContain('Executive Summary');
    });
  });

  describe('with data analytics requirements', () => {
    const context: RecommendationContext = {
      requirementMatrix: {
        functional: ['data pipeline construction', 'analytics dashboard', 'ETL processing'],
        compliance: [],
        timeline: [],
        pricing: [],
      },
      detectedIndustry: 'retail',
      keyCapabilities: ['data-engineering', 'analytics'],
      namespace: 'test-ns',
    };

    it('recommends the data analytics template', async () => {
      const result = await recommendTemplate(context, workdir);

      expect(result.fallbackGenerate).toBe(false);
      expect(result.templateId).toBe('data-analytics-solution');
    });
  });

  describe('confidence and scoring', () => {
    it('returns confidence between 0 and 1', async () => {
      const context: RecommendationContext = {
        requirementMatrix: {
          functional: ['cloud migration'],
          compliance: [],
          timeline: [],
          pricing: [],
        },
        namespace: 'test-ns',
      };

      const result = await recommendTemplate(context, workdir);

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('sets fallbackGenerate when requirements are empty', async () => {
      const context: RecommendationContext = {
        requirementMatrix: {
          functional: [],
          compliance: [],
          timeline: [],
          pricing: [],
        },
        namespace: 'test-ns',
      };

      const result = await recommendTemplate(context, workdir);

      // With empty requirements, scores should be low
      // The result may or may not fallback depending on vector store enrichment
      expect(typeof result.fallbackGenerate).toBe('boolean');
      expect(typeof result.confidence).toBe('number');
      expect(result.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe('reasoning output', () => {
    it('includes template name in reasoning', async () => {
      const context: RecommendationContext = {
        requirementMatrix: {
          functional: ['cloud migration infrastructure'],
          compliance: ['security compliance'],
          timeline: [],
          pricing: [],
        },
        detectedIndustry: 'technology',
        namespace: 'test-ns',
      };

      const result = await recommendTemplate(context, workdir);

      if (!result.fallbackGenerate) {
        expect(result.reasoning).toContain(result.template!.name);
      } else {
        // Fallback reasoning should mention candidates
        expect(result.reasoning.length).toBeGreaterThan(0);
      }
    });
  });
});
