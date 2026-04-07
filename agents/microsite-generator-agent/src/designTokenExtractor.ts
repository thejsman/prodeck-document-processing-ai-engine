export interface ExtractedDesignTokens {
  colors: { backgrounds: string[]; accents: string[] }
  typography: {
    fonts: string[]
    headingStyle: 'bold' | 'playful' | 'editorial' | 'minimal' | 'strong'
    bodySize: 'compact' | 'normal' | 'large'
    fontWeight: 'light' | 'regular' | 'medium' | 'bold' | 'black'
  }
  spacing: {
    density: 'tight' | 'comfortable' | 'generous' | 'airy'
    cardPadding: 'compact' | 'normal' | 'generous'
    rhythm: 'tight' | 'normal' | 'relaxed'
  }
  components: {
    borderRadius: 'sharp' | 'subtle' | 'rounded' | 'pill'
    shadows: 'none' | 'subtle' | 'soft' | 'deep'
    gradients: boolean
    decorativeElements: boolean
    animationStyle: 'none' | 'minimal' | 'smooth' | 'playful' | 'bounce'
  }
  cssVariables: Record<string, string>
  googleFontsUrl: string | null
  fontFaceDeclarations: string
  themeClass: string
}

function lighten(hex: string, amount: number): string {
  try {
    const h = hex.replace('#', '')
    if (h.length !== 3 && h.length !== 6) return hex
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    return '#' + [r, g, b]
      .map(v => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0'))
      .join('')
  } catch { return hex }
}

// BG keywords sorted longest-first to avoid partial matches
const BG_ENTRIES: Array<[string, string]> = [
  ['soft sky blue', '#e0f2fe'],
  ['sky blue',      '#bae6fd'],
  ['pastel yellow', '#fef9c3'],
  ['soft yellow',   '#fef3c7'],
  ['light pink',    '#fce7f3'],
  ['pastel pink',   '#fbcfe8'],
  ['mint green',    '#d1fae5'],
  ['soft lavender', '#ede9fe'],
  ['light purple',  '#f3e8ff'],
  ['soft purple',   '#f3e8ff'],
  ['light blue',    '#dbeafe'],
  ['soft blue',     '#dbeafe'],
  ['soft peach',    '#ffedd5'],
  ['pale green',    '#dcfce7'],
  ['warm white',    '#fafaf8'],
  ['off-white',     '#f8f7f4'],
  ['ice blue',      '#e0f7fa'],
  ['lavender',      '#ede9fe'],
  ['peach',         '#ffedd5'],
  ['cream',         '#fdf6e3'],
  ['lemon',         '#fefce8'],
  ['blush',         '#fde8f0'],
  ['mint',          '#d1fae5'],
  ['sand',          '#fef3c7'],
]

// Accent keywords sorted longest-first
const ACCENT_ENTRIES: Array<[string, string]> = [
  ['vibrant orange', '#f97316'],
  ['bright orange',  '#fb923c'],
  ['vibrant purple', '#7c3aed'],
  ['bright purple',  '#a855f7'],
  ['vibrant teal',   '#0d9488'],
  ['bright teal',    '#2dd4bf'],
  ['vibrant blue',   '#2563eb'],
  ['bright blue',    '#3b82f6'],
  ['bright green',   '#16a34a'],
  ['coral red',      '#f43f5e'],
  ['hot pink',       '#f43f5e'],
  ['orange',         '#f97316'],
  ['purple',         '#8b5cf6'],
  ['indigo',         '#6366f1'],
  ['teal',           '#14b8a6'],
  ['blue',           '#3b82f6'],
  ['green',          '#22c55e'],
  ['pink',           '#ec4899'],
  ['amber',          '#f59e0b'],
  ['golden',         '#f59e0b'],
  ['yellow',         '#eab308'],
  ['coral',          '#f43f5e'],
  ['cyan',           '#06b6d4'],
  ['aqua',           '#22d3ee'],
  ['lime',           '#84cc16'],
  ['rose',           '#f43f5e'],
  ['magenta',        '#d946ef'],
  ['red',            '#ef4444'],
]

const FONT_MAP: Record<string, { family: string; url: string }> = {
  'Nunito':            { family: 'Nunito',            url: 'Nunito:wght@400;600;700;800' },
  'Poppins':           { family: 'Poppins',           url: 'Poppins:wght@400;500;600;700' },
  'Baloo 2':           { family: 'Baloo 2',           url: 'Baloo+2:wght@400;600;700;800' },
  'Baloo':             { family: 'Baloo 2',           url: 'Baloo+2:wght@400;600;700;800' },
  'Fredoka One':       { family: 'Fredoka One',       url: 'Fredoka+One' },
  'Fredoka':           { family: 'Fredoka One',       url: 'Fredoka+One' },
  'Lilita One':        { family: 'Lilita One',        url: 'Lilita+One' },
  'Bubblegum Sans':    { family: 'Bubblegum Sans',    url: 'Bubblegum+Sans' },
  'Quicksand':         { family: 'Quicksand',         url: 'Quicksand:wght@400;500;600;700' },
  'Comfortaa':         { family: 'Comfortaa',         url: 'Comfortaa:wght@400;600;700' },
  'Inter':             { family: 'Inter',             url: 'Inter:wght@400;500;600;700' },
  'Raleway':           { family: 'Raleway',           url: 'Raleway:wght@400;500;600;700' },
  'DM Sans':           { family: 'DM Sans',           url: 'DM+Sans:wght@400;500;600;700' },
  'Plus Jakarta Sans': { family: 'Plus Jakarta Sans', url: 'Plus+Jakarta+Sans:wght@400;500;600;700' },
  'Source Sans Pro':   { family: 'Source Sans 3',     url: 'Source+Sans+3:wght@400;600;700' },
  'Source Sans':       { family: 'Source Sans 3',     url: 'Source+Sans+3:wght@400;600;700' },
}

export function extractColorsFromPrompt(prompt: string): { backgrounds: string[]; accents: string[] } {
  const lower = prompt.toLowerCase()
  const backgrounds: string[] = []
  const accents: string[] = []

  for (const [key, hex] of BG_ENTRIES) {
    if (lower.includes(key) && !backgrounds.includes(hex)) {
      backgrounds.push(hex)
    }
  }

  for (const [key, hex] of ACCENT_ENTRIES) {
    if (lower.includes(key) && !accents.includes(hex)) {
      accents.push(hex)
    }
  }

  // Also pick up raw hex codes from prompt
  const hexMatches = prompt.match(/#[0-9a-fA-F]{6}\b/g) ?? []
  for (const hex of hexMatches) {
    if (!backgrounds.includes(hex) && !accents.includes(hex)) {
      accents.push(hex)
    }
  }

  // Always return at least one value
  if (backgrounds.length === 0) backgrounds.push('#f8f7f4')
  if (accents.length === 0)     accents.push('#6366f1')

  return { backgrounds, accents }
}

function extractQuotedFonts(text: string): string[] {
  const matches = [...text.matchAll(/["']([A-Za-z0-9 ]+)["']/g)]
  return matches.map(m => m[1].trim()).filter(Boolean)
}

function extractTypographyFromPrompt(prompt: string): ExtractedDesignTokens['typography'] {
  // Split prompt into heading-font section and body-font section
  const headingSection = prompt.match(
    /(?:heading|primary|display|title)\s*font[\s\S]*?(?=\n\s*(?:body|paragraph|text)\s*font|\n##|$)/i
  )?.[0] ?? ''
  const bodySection = prompt.match(
    /(?:body|paragraph|text)\s*font[\s\S]*/i
  )?.[0] ?? ''

  const headingFonts = headingSection ? extractQuotedFonts(headingSection) : []
  const bodyFonts    = bodySection    ? extractQuotedFonts(bodySection)    : []

  const fonts: string[] = []
  if (headingFonts[0]) fonts.push(headingFonts[0])
  if (bodyFonts[0] && bodyFonts[0] !== fonts[0]) fonts.push(bodyFonts[0])

  // Fallback: all quoted fonts in the full prompt
  if (fonts.length === 0) {
    const allQuoted = extractQuotedFonts(prompt)
    fonts.push(...allQuoted.slice(0, 2))
  }

  // Fallback: legacy FONT_MAP keyword scan for unquoted prompts
  if (fonts.length === 0) {
    const fontKeys = Object.keys(FONT_MAP).sort((a, b) => b.length - a.length)
    for (const name of fontKeys) {
      if (new RegExp(`\\b${name.replace(/[+]/g, '\\+')}\\b`, 'i').test(prompt) && !fonts.includes(name)) {
        fonts.push(name)
        if (fonts.length >= 2) break
      }
    }
  }

  let headingStyle: ExtractedDesignTokens['typography']['headingStyle'] = 'bold'
  if (/bold and playful|playful heading|expressive header/i.test(prompt)) headingStyle = 'playful'
  else if (/editorial|literary/i.test(prompt)) headingStyle = 'editorial'
  else if (/minimal|clean heading|restrained/i.test(prompt)) headingStyle = 'minimal'
  else if (/large confident|confident heading|strong heading/i.test(prompt)) headingStyle = 'strong'

  let bodySize: ExtractedDesignTokens['typography']['bodySize'] = 'normal'
  if (/slightly larger body|larger body text|young audiences|readability/i.test(prompt)) bodySize = 'large'
  else if (/compact body|concise body/i.test(prompt)) bodySize = 'compact'

  let fontWeight: ExtractedDesignTokens['typography']['fontWeight'] = 'bold'
  if (/\blight weight\b|\bthin\b/i.test(prompt)) fontWeight = 'light'
  else if (/medium weight/i.test(prompt)) fontWeight = 'medium'

  return { fonts, headingStyle, bodySize, fontWeight }
}

function extractSpacingFromPrompt(prompt: string): ExtractedDesignTokens['spacing'] {
  let density: ExtractedDesignTokens['spacing']['density'] = 'comfortable'
  if (/generous padding|comfortable spacing|breathable|fun layout rhythm/i.test(prompt)) density = 'generous'
  else if (/\btight\b|\bcompact layout\b|\bdense\b/i.test(prompt)) density = 'tight'
  else if (/premium whitespace|wide spacing|\bairy\b/i.test(prompt)) density = 'airy'

  const cardPadding: ExtractedDesignTokens['spacing']['cardPadding'] =
    /generous padding inside cards/i.test(prompt) ? 'generous'
    : /compact card/i.test(prompt) ? 'compact'
    : 'normal'

  const rhythm: ExtractedDesignTokens['spacing']['rhythm'] =
    /fun layout rhythm|playful grouping/i.test(prompt) ? 'relaxed'
    : 'normal'

  return { density, cardPadding, rhythm }
}

function extractComponentStyleFromPrompt(prompt: string): ExtractedDesignTokens['components'] {
  let borderRadius: ExtractedDesignTokens['components']['borderRadius'] = 'subtle'
  if (/rounded UI components|rounded cards|\brounded\b/i.test(prompt)) borderRadius = 'rounded'
  else if (/\bpill\b/i.test(prompt)) borderRadius = 'pill'
  else if (/\bsharp corners\b|\bno radius\b/i.test(prompt)) borderRadius = 'sharp'

  let shadows: ExtractedDesignTokens['components']['shadows'] = 'subtle'
  if (/subtle shadow/i.test(prompt)) shadows = 'subtle'
  else if (/soft shadow/i.test(prompt)) shadows = 'soft'
  else if (/deep shadow|card elevation/i.test(prompt)) shadows = 'deep'
  else if (/no shadow|avoid shadow/i.test(prompt)) shadows = 'none'

  const gradients = /soft gradients encouraged|gradients|colorful gradient/i.test(prompt)
    && !/avoid gradient|no gradient|flat design/i.test(prompt)

  const decorativeElements = /playful shapes|floating shapes|decorative elements|illustrations/i.test(prompt)

  let animationStyle: ExtractedDesignTokens['components']['animationStyle'] = 'smooth'
  if (/bounce or pop|\bbounce\b|\bpop micro/i.test(prompt)) animationStyle = 'bounce'
  else if (/smooth playful|playful animation/i.test(prompt)) animationStyle = 'playful'
  else if (/minimal micro|minimal animation/i.test(prompt)) animationStyle = 'minimal'
  else if (/no animation/i.test(prompt)) animationStyle = 'none'

  return { borderRadius, shadows, gradients, decorativeElements, animationStyle }
}

function buildCssVariables(
  colors: { backgrounds: string[]; accents: string[] },
  typography: ExtractedDesignTokens['typography'],
  spacing: ExtractedDesignTokens['spacing'],
  components: ExtractedDesignTokens['components']
): Record<string, string> {
  const bg1 = colors.backgrounds[0] ?? '#f8f7f4'
  const bg2 = colors.backgrounds[1] ?? lighten(bg1, 0.03)
  const bg3 = colors.backgrounds[2] ?? lighten(bg1, 0.06)
  const bg4 = colors.backgrounds[3] ?? bg2
  const bg5 = colors.backgrounds[4] ?? bg3
  const a1  = colors.accents[0] ?? '#6366f1'
  const a2  = colors.accents[1] ?? a1
  const a3  = colors.accents[2] ?? a2
  const a4  = colors.accents[3] ?? a3
  const a5  = colors.accents[4] ?? a1

  const headingEntry = typography.fonts[0] ? FONT_MAP[typography.fonts[0]] : null
  const headingFontFamily = headingEntry
    ? `'${headingEntry.family}', -apple-system, BlinkMacSystemFont, sans-serif`
    : typography.fonts[0]
      ? `'${typography.fonts[0]}', -apple-system, BlinkMacSystemFont, sans-serif`
      : '-apple-system, BlinkMacSystemFont, sans-serif'

  const bodyEntry = typography.fonts[1] ? FONT_MAP[typography.fonts[1]] : null
  const bodyFontFamily = bodyEntry
    ? `'${bodyEntry.family}', -apple-system, BlinkMacSystemFont, sans-serif`
    : typography.fonts[1]
      ? `'${typography.fonts[1]}', -apple-system, BlinkMacSystemFont, sans-serif`
      : headingFontFamily

  const hSizes: Record<string, { h1: string; h2: string; weight: string }> = {
    playful:   { h1: 'clamp(38px,6vw,72px)',   h2: 'clamp(30px,4.5vw,52px)', weight: '800' },
    strong:    { h1: 'clamp(36px,5vw,64px)',   h2: 'clamp(28px,4vw,48px)',   weight: '700' },
    editorial: { h1: 'clamp(32px,4.5vw,58px)', h2: 'clamp(26px,3.5vw,44px)',weight: '600' },
    minimal:   { h1: 'clamp(28px,4vw,52px)',   h2: 'clamp(22px,3vw,40px)',   weight: '500' },
    bold:      { h1: 'clamp(34px,5vw,60px)',   h2: 'clamp(26px,4vw,44px)',   weight: '700' },
  }
  const hSize = hSizes[typography.headingStyle] ?? hSizes.bold

  const bodySizeMap  = { large: '17px', normal: '15px', compact: '14px' }
  const bodyLhMap    = { large: '1.8',  normal: '1.7',  compact: '1.6'  }
  const sectionPadMap = { generous: 'clamp(80px,10vw,120px)', comfortable: 'clamp(60px,8vw,100px)', airy: 'clamp(80px,10vw,140px)', tight: 'clamp(40px,6vw,72px)' }
  const cardPadMap   = { generous: '32px', normal: '24px', comfortable: '24px', compact: '16px', airy: '40px', tight: '16px' }
  const radMap: Record<string, { card: string; btn: string; base: string }> = {
    pill:    { card: '24px',  btn: '100px', base: '16px' },
    rounded: { card: '20px',  btn: '14px',  base: '16px' },
    subtle:  { card: '12px',  btn: '9px',   base: '8px'  },
    sharp:   { card: '6px',   btn: '6px',   base: '4px'  },
  }
  const shadMap = {
    none:   { s: 'none', sh: 'none' },
    subtle: { s: '0 1px 3px rgba(0,0,0,0.06)', sh: '0 4px 12px rgba(0,0,0,0.10)' },
    soft:   { s: '0 2px 8px rgba(0,0,0,0.08)', sh: '0 8px 24px rgba(0,0,0,0.12)' },
    deep:   { s: '0 4px 16px rgba(0,0,0,0.12)', sh: '0 12px 40px rgba(0,0,0,0.18)' },
  }
  const transMap = {
    bounce:  'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
    playful: 'all 0.28s cubic-bezier(0.22,1,0.36,1)',
    smooth:  'all 0.22s cubic-bezier(0.4,0,0.2,1)',
    minimal: 'all 0.15s ease',
    none:    'none',
  }

  const r   = radMap[components.borderRadius] ?? radMap.subtle
  const sh  = shadMap[components.shadows] ?? shadMap.subtle

  return {
    '--ms-bg':            bg1,
    '--ms-bg2':           bg2,
    '--ms-bg3':           bg3,
    '--ms-surface':       '#ffffff',
    '--ms-text':          '#1a1a1a',
    '--ms-text2':         '#4a4a4a',
    '--ms-text3':         '#8a8a8a',
    '--ms-border':        'rgba(0,0,0,0.10)',
    '--ms-accent':        a1,
    '--ms-accent2':       a2,
    '--ms-accent3':       a3,
    '--ms-accent4':       a4,
    '--ms-accent5':       a5,
    // Section BGs cycle through extracted background colors
    '--ms-hero-bg':           bg1,
    '--ms-stats-bg':          bg2,
    '--ms-challenge-bg':      bg3,
    '--ms-approach-bg':       bg4,
    '--ms-timeline-bg':       bg5,
    '--ms-pricing-bg':        bg1,
    '--ms-whyus-bg':          bg2,
    '--ms-benefits-bg':       bg3,
    '--ms-problem-bg':        bg4,
    '--ms-nextsteps-bg':      bg5,
    '--ms-showcase-bg':       bg1,
    '--ms-deliverables-bg':   bg2,
    '--ms-generic-bg':        bg3,
    '--ms-metrics-bg':        bg4,
    // Section accents cycle through extracted accent colors
    '--ms-hero-accent':           a1,
    '--ms-stats-accent':          a2,
    '--ms-challenge-accent':      a3,
    '--ms-approach-accent':       a1,
    '--ms-timeline-accent':       a4,
    '--ms-pricing-accent':        a2,
    '--ms-whyus-accent':          a3,
    '--ms-benefits-accent':       a5,
    '--ms-problem-accent':        a4,
    '--ms-nextsteps-accent':      a1,
    '--ms-showcase-accent':       a3,
    '--ms-deliverables-accent':   a4,
    '--ms-generic-accent':        a1,
    '--ms-metrics-accent':        a5,
    // Typography
    '--ms-font-heading':        headingFontFamily,
    '--ms-font-body':           bodyFontFamily,
    '--ms-h1':                  hSize.h1,
    '--ms-h2':                  hSize.h2,
    '--ms-h1-weight':           hSize.weight,
    '--ms-body':                bodySizeMap[typography.bodySize] ?? '15px',
    '--ms-body-line-height':    bodyLhMap[typography.bodySize] ?? '1.7',
    // Spacing
    '--ms-section-pad':   sectionPadMap[spacing.density] ?? sectionPadMap.comfortable,
    '--ms-container-pad': 'clamp(20px,5vw,80px)',
    '--ms-card-pad':      (cardPadMap as Record<string, string>)[spacing.cardPadding] ?? '24px',
    // Components
    '--ms-r':             r.base,
    '--ms-r-card':        r.card,
    '--ms-r-btn':         r.btn,
    '--ms-shadow':        sh.s,
    '--ms-shadow-hover':  sh.sh,
    '--ms-transition':    transMap[components.animationStyle] ?? transMap.smooth,
    '--ms-gradients-enabled':   components.gradients ? '1' : '0',
    '--ms-decorative-enabled':  components.decorativeElements ? '1' : '0',
  }
}

function buildGoogleFontsUrl(typography: ExtractedDesignTokens['typography']): string | null {
  if (!typography.fonts.length) return null
  const families = typography.fonts
    .map(f => FONT_MAP[f]?.url ?? `${f.replace(/\s+/g, '+')}:wght@400;600;700;800`)
    .join('&family=')
  return `https://fonts.googleapis.com/css2?family=${families}&display=swap`
}

function buildFontFaceDeclarations(typography: ExtractedDesignTokens['typography']): string {
  if (!typography.fonts.length) return ''
  const headingFamily = FONT_MAP[typography.fonts[0]]?.family ?? typography.fonts[0]
  const bodyFamily    = FONT_MAP[typography.fonts[1] ?? '']?.family ?? typography.fonts[1] ?? headingFamily
  const headingFf = `'${headingFamily}', -apple-system, sans-serif`
  const bodyFf    = `'${bodyFamily}', -apple-system, sans-serif`
  return `:root { --ms-font-heading: ${headingFf}; --ms-font-body: ${bodyFf}; }`
}

// Primary export — colors come ONLY from the prompt text
export function extractDesignTokens(fullDesignPrompt: string): ExtractedDesignTokens {
  try {
    const colors     = extractColorsFromPrompt(fullDesignPrompt)   // prompt-only, no brand
    const typography = extractTypographyFromPrompt(fullDesignPrompt)
    const spacing    = extractSpacingFromPrompt(fullDesignPrompt)
    const components = extractComponentStyleFromPrompt(fullDesignPrompt)
    const cssVariables      = buildCssVariables(colors, typography, spacing, components)
    const googleFontsUrl    = buildGoogleFontsUrl(typography)
    const fontFaceDeclarations = buildFontFaceDeclarations(typography)
    const themeClass        = `theme-custom-prompt theme-br-${components.borderRadius} anim-${components.animationStyle}`

    console.log('[DesignTokenExtractor] backgrounds:', colors.backgrounds)
    console.log('[DesignTokenExtractor] accents:', colors.accents)
    console.log('[DesignTokenExtractor] fonts:', typography.fonts)
    console.log('[DesignTokenExtractor] borderRadius:', components.borderRadius)
    console.log('[DesignTokenExtractor] animationStyle:', components.animationStyle)
    console.log('[DesignTokenExtractor] gradients:', components.gradients)
    console.log('[DesignTokenExtractor] googleFontsUrl:', googleFontsUrl)

    return { colors, typography, spacing, components, cssVariables, googleFontsUrl, fontFaceDeclarations, themeClass }
  } catch {
    return {
      colors: { backgrounds: ['#f8f7f4'], accents: ['#6366f1'] },
      typography: { fonts: [], headingStyle: 'bold', bodySize: 'normal', fontWeight: 'bold' },
      spacing: { density: 'comfortable', cardPadding: 'normal', rhythm: 'normal' },
      components: { borderRadius: 'subtle', shadows: 'subtle', gradients: false, decorativeElements: false, animationStyle: 'smooth' },
      cssVariables: {},
      googleFontsUrl: null,
      fontFaceDeclarations: '',
      themeClass: 'theme-custom-prompt',
    }
  }
}
