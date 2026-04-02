import { describe, it, expect } from 'vitest';
import { routeIntent } from './intent-router.js';

describe('routeIntent', () => {
  // -------------------------------------------------------------------
  // RFP analysis triggers
  // -------------------------------------------------------------------
  describe('rfp_analysis', () => {
    const cases = [
      'Analyze this RFP',
      'analyse rfp',
      'Should we bid on this?',
      'Go/no-go decision',
      'evaluate the rfp',
      'review rfp',
    ];

    for (const msg of cases) {
      it(`routes "${msg}" → rfp_analysis`, () => {
        expect(routeIntent(msg)?.workflowId).toBe('rfp_analysis');
      });
    }
  });

  // -------------------------------------------------------------------
  // Version control triggers
  // -------------------------------------------------------------------
  describe('proposal_version_control', () => {
    const cases = [
      'rollback',
      'roll back to the previous version',
      'revert to v1.0',
      'revert',
      'undo changes',
      'show history',
      'show versions',
      'version history',
      'proposal history',
      'list versions',
      'go back to version v1.2',
      'restore version',
    ];

    for (const msg of cases) {
      it(`routes "${msg}" → proposal_version_control`, () => {
        expect(routeIntent(msg)?.workflowId).toBe('proposal_version_control');
      });
    }
  });

  // -------------------------------------------------------------------
  // Proposal generation triggers
  // -------------------------------------------------------------------
  describe('proposal_generation', () => {
    const cases = [
      'Create proposal for cloud migration',
      'generate proposal',
      'draft a proposal about data analytics',
      'new proposal',
    ];

    for (const msg of cases) {
      it(`routes "${msg}" → proposal_generation`, () => {
        expect(routeIntent(msg)?.workflowId).toBe('proposal_generation');
      });
    }

    it('falls back to proposal_generation for messages containing "proposal"', () => {
      expect(routeIntent('I need a proposal')?.workflowId).toBe('proposal_generation');
    });
  });

  // -------------------------------------------------------------------
  // Null — no match
  // -------------------------------------------------------------------
  describe('no match', () => {
    const cases = [
      'What is RAG?',
      'Hello',
      'How does the system work?',
      '',
    ];

    for (const msg of cases) {
      it(`returns null for "${msg}"`, () => {
        expect(routeIntent(msg)).toBeNull();
      });
    }
  });

  // -------------------------------------------------------------------
  // Priority: RFP > version control > proposal
  // -------------------------------------------------------------------
  describe('priority ordering', () => {
    it('routes "review rfp" to rfp_analysis, not version control', () => {
      // "review" could match version control in some systems, but "review rfp" is RFP-specific
      expect(routeIntent('review rfp')?.workflowId).toBe('rfp_analysis');
    });

    it('routes "rollback" to version control, not proposal', () => {
      expect(routeIntent('rollback the proposal')?.workflowId).toBe('proposal_version_control');
    });

    it('routes "show proposal history" to version control', () => {
      // Contains both "proposal" and "history" — version control should win
      expect(routeIntent('show proposal history')?.workflowId).toBe('proposal_version_control');
    });
  });
});
