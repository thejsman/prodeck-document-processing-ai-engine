import { describe, it, expect } from 'vitest';
import { buildBoundaryResponse, buildUnknownResponse } from './boundary-response.js';

// ---------------------------------------------------------------------------
// buildBoundaryResponse — GENERAL_CHAT pattern matching
// ---------------------------------------------------------------------------

describe('buildBoundaryResponse', () => {
  it('returns a ChatResponse with empty toolsCalled and actionCards', () => {
    const res = buildBoundaryResponse('what is the weather today?');
    expect(res.actionCards).toEqual([]);
    expect(res.toolsCalled).toEqual([]);
    expect(res.requirementsUpdated).toBe(false);
  });

  // --- Weather / forecast ---
  it('matches weather pattern', () => {
    const res = buildBoundaryResponse('What is the weather like today?');
    expect(res.text).toMatch(/scope|weather/i);
    expect(res.text).toMatch(/proposal|project/i);
  });

  it('matches forecast pattern', () => {
    const res = buildBoundaryResponse("What's the forecast for the weekend?");
    expect(res.text).toMatch(/scope|weather/i);
  });

  // --- News / current events / sports ---
  it('matches news pattern', () => {
    const res = buildBoundaryResponse('What is in the news today?');
    expect(res.text).toMatch(/news|current events/i);
    expect(res.text).toMatch(/proposal|project/i);
  });

  it('matches sports/scores pattern', () => {
    const res = buildBoundaryResponse('What was the score of the game last night?');
    expect(res.text).toMatch(/news|current events/i);
  });

  it('matches stocks/market pattern', () => {
    const res = buildBoundaryResponse('How did the stock market do today?');
    expect(res.text).toMatch(/news|current events/i);
  });

  // --- Email / message drafting ---
  it('matches email drafting pattern', () => {
    const res = buildBoundaryResponse('Can you write an email to my client?');
    expect(res.text).toMatch(/email|draft/i);
    expect(res.text).toMatch(/proposal|presentation/i);
  });

  it('matches draft message pattern', () => {
    const res = buildBoundaryResponse('Draft a message for me please');
    expect(res.text).toMatch(/email|draft/i);
  });

  it('matches slack pattern', () => {
    const res = buildBoundaryResponse('Write a slack message to the team');
    expect(res.text).toMatch(/email|draft/i);
  });

  // --- Coding ---
  it('matches coding/programming pattern', () => {
    const res = buildBoundaryResponse('Can you write a Python script for me?');
    expect(res.text).toMatch(/coding|proposal|presentation/i);
    expect(res.text).toMatch(/technical content/i);
  });

  it('matches debug pattern', () => {
    const res = buildBoundaryResponse('Help me debug this JavaScript function');
    expect(res.text).toMatch(/coding|proposal/i);
  });

  // --- Slides / PowerPoint ---
  it('matches PowerPoint pattern', () => {
    const res = buildBoundaryResponse('Create a PowerPoint presentation for me');
    expect(res.text).toMatch(/slide|microsite/i);
    expect(res.text).toMatch(/proposal/i);
  });

  it('matches slides pattern', () => {
    const res = buildBoundaryResponse('Can you make slides for this?');
    expect(res.text).toMatch(/slide|microsite/i);
  });

  it('matches keynote pattern', () => {
    const res = buildBoundaryResponse('I need a Keynote deck');
    expect(res.text).toMatch(/slide|microsite/i);
  });

  // --- Translation ---
  it('matches translation pattern', () => {
    const res = buildBoundaryResponse('Translate this to Spanish please');
    expect(res.text).toMatch(/translation/i);
    expect(res.text).toMatch(/proposal|project/i);
  });

  it('matches French translation pattern', () => {
    const res = buildBoundaryResponse('Can you translate this to French?');
    expect(res.text).toMatch(/translation/i);
  });

  // --- Spreadsheets / math ---
  it('matches spreadsheet pattern', () => {
    const res = buildBoundaryResponse('Can you create an Excel spreadsheet?');
    expect(res.text).toMatch(/spreadsheet|pricing/i);
    expect(res.text).toMatch(/proposal/i);
  });

  it('matches math/calculate pattern', () => {
    const res = buildBoundaryResponse('Calculate the total cost for me');
    expect(res.text).toMatch(/spreadsheet|pricing/i);
  });

  // --- Jokes / entertainment ---
  it('matches joke pattern', () => {
    const res = buildBoundaryResponse('Tell me a joke');
    expect(res.text).toMatch(/specialist|entertainer/i);
    expect(res.text).toMatch(/client project/i);
  });

  it('matches entertainment pattern', () => {
    const res = buildBoundaryResponse('Entertain me');
    expect(res.text).toMatch(/specialist|entertainer/i);
  });

  it('matches poem pattern', () => {
    const res = buildBoundaryResponse('Write me a poem');
    expect(res.text).toMatch(/specialist|entertainer/i);
  });

  // --- Self-identification ---
  it('matches who are you pattern', () => {
    const res = buildBoundaryResponse('Who are you?');
    expect(res.text).toMatch(/ProDeck AI/i);
    expect(res.text).toMatch(/proposals/i);
  });

  it('matches what can you do pattern', () => {
    const res = buildBoundaryResponse('What can you do?');
    expect(res.text).toMatch(/ProDeck AI/i);
    expect(res.text).toMatch(/RFP|documents/i);
  });

  it('matches capabilities pattern', () => {
    const res = buildBoundaryResponse('What are your capabilities?');
    expect(res.text).toMatch(/ProDeck AI/i);
  });

  // --- Thanks ---
  it('matches thanks pattern (short message)', () => {
    const res = buildBoundaryResponse('Thanks');
    expect(res.text).toMatch(/welcome/i);
    expect(res.text).toMatch(/project/i);
  });

  it('matches thank you pattern (short message)', () => {
    const res = buildBoundaryResponse('Thank you!');
    expect(res.text).toMatch(/welcome/i);
  });

  // --- Default (no pattern match) ---
  it('returns default decline + redirect for unmatched content', () => {
    const res = buildBoundaryResponse('asdfzxcv random gibberish that matches no pattern');
    expect(res.text).toMatch(/proposals.*templates|templates.*proposals/i);
    expect(res.text).toMatch(/project/i);
  });

  it('default response always includes pivot to proposals/templates/microsites', () => {
    const res = buildBoundaryResponse('Something completely random like foobar');
    expect(res.text).toMatch(/proposals|templates|microsites/i);
  });
});

// ---------------------------------------------------------------------------
// buildUnknownResponse — UNKNOWN intent
// ---------------------------------------------------------------------------

describe('buildUnknownResponse', () => {
  it('returns a ChatResponse with empty toolsCalled and actionCards', () => {
    const res = buildUnknownResponse();
    expect(res.actionCards).toEqual([]);
    expect(res.toolsCalled).toEqual([]);
    expect(res.requirementsUpdated).toBe(false);
  });

  it('text contains "didn\'t quite understand"', () => {
    const res = buildUnknownResponse();
    expect(res.text).toMatch(/didn't quite understand/i);
  });

  it('text mentions core capabilities as hints', () => {
    const res = buildUnknownResponse();
    expect(res.text).toMatch(/proposals/i);
    expect(res.text).toMatch(/templates/i);
    expect(res.text).toMatch(/microsites/i);
  });
});
