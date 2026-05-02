import { detectSectionLimitRequest } from './sectionLimitDetector.js'

const childrenDesignPrompt = `You are a senior UX designer specializing in playful design.

## LAYOUT STRUCTURE

1. Hero Section
* concise proposal title

2. Introduction / Story Section
* narrative blocks

3. Solution Overview Section
* grid layout

4. Timeline Section
* horizontal timeline

5. Benefits Section
* feature grid

6. Pricing Section
* clean table

7. Call To Action Footer
* closing message`

describe('detectSectionLimitRequest', () => {
  test('returns no limit for empty string', () => {
    const r = detectSectionLimitRequest('')
    expect(r.hasLimit).toBe(false)
    expect(r.limitType).toBe('none')
  })

  test('returns no limit for design prompt with colors and fonts', () => {
    const r = detectSectionLimitRequest('use colorful backgrounds, Nunito font, rounded cards, soft gradients')
    expect(r.hasLimit).toBe(false)
  })

  test('returns no limit for prompt mentioning section types without count', () => {
    const r = detectSectionLimitRequest('make the hero section bold and the timeline section horizontal')
    expect(r.hasLimit).toBe(false)
  })

  test('detects count: only 5 sections', () => {
    const r = detectSectionLimitRequest('only 5 sections')
    expect(r.hasLimit).toBe(true)
    expect(r.limitType).toBe('count')
    expect(r.requestedCount).toBe(5)
  })

  test('detects count: generate 7 sections', () => {
    const r = detectSectionLimitRequest('generate 7 sections for this proposal')
    expect(r.hasLimit).toBe(true)
    expect(r.limitType).toBe('count')
    expect(r.requestedCount).toBe(7)
  })

  test('detects count: limit to 4 sections', () => {
    const r = detectSectionLimitRequest('limit to 4 sections please')
    expect(r.hasLimit).toBe(true)
    expect(r.limitType).toBe('count')
    expect(r.requestedCount).toBe(4)
  })

  test('detects count: 3-section microsite', () => {
    const r = detectSectionLimitRequest('create a 3-section microsite')
    expect(r.hasLimit).toBe(true)
    expect(r.limitType).toBe('count')
    expect(r.requestedCount).toBe(3)
  })

  test('detects explicit list: include only hero, timeline, pricing', () => {
    const r = detectSectionLimitRequest('include only hero, timeline, and pricing')
    expect(r.hasLimit).toBe(true)
    expect(r.limitType).toBe('explicit-list')
  })

  test('detects exclude list: no timeline, skip pricing', () => {
    const r = detectSectionLimitRequest('no timeline, skip pricing section')
    expect(r.hasLimit).toBe(true)
    expect(r.limitType).toBe('exclude-list')
  })

  test('does NOT trigger on section reveal / section layout phrases', () => {
    const r = detectSectionLimitRequest('use section reveal animations, clean section layout for each section')
    expect(r.hasLimit).toBe(false)
  })

  test('CRITICAL: children design prompt does NOT trigger limit', () => {
    const r = detectSectionLimitRequest(childrenDesignPrompt)
    expect(r.hasLimit).toBe(false)
    expect(r.limitType).toBe('none')
  })
})
