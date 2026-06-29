// services/api/src/documents/document-exporter.ts
//
// Converts a markdown document to various output formats.
// PDF uses puppeteer (already a project dependency).
// DOCX uses the `docx` npm package.
// PPTX parses "## Slide N: Title" format via pptxgenjs.
// Notion returns cleaned markdown with Notion-compatible conventions.

import { createRequire } from 'module';
import puppeteer from 'puppeteer';
import type { OutputFormat } from '../skills/skill.types.js';

const _require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportResult {
  buffer: Buffer
  mimeType: string
  filename: string
}

// ---------------------------------------------------------------------------
// Markdown → plain text
// ---------------------------------------------------------------------------

function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')       // fenced code blocks
    .replace(/^\|[-:| ]+\|$/gm, '')       // table separator rows
    .replace(/^\|(.+)\|$/gm, (_m, inner) =>
      (inner as string).split('|').map((c: string) => c.trim()).filter(Boolean).join('  ')
    )                                     // table data rows → space-separated cells
    .replace(/^#{1,6}\s+/gm, '')         // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')      // bold
    .replace(/\*(.+?)\*/g, '$1')          // italic
    .replace(/`[^`]+`/g, '')             // inline code
    .replace(/!\[.*?\]\(.*?\)/g, '')      // images
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')  // links
    .replace(/^[-*+]\s+/gm, '• ')        // bullets
    .replace(/^\d+\.\s+/gm, '')          // numbered lists
    .replace(/^>\s+/gm, '')              // blockquotes
    .replace(/---+/g, '')                // horizontal rules
    .replace(/\n{3,}/g, '\n\n')          // collapse blank lines
    .trim()
}

// ---------------------------------------------------------------------------
// Markdown → simple HTML (for PDF rendering)
// ---------------------------------------------------------------------------

function markdownToHtml(markdown: string, title: string): string {
  let html = markdown

  // ── 1. Fenced code blocks (must run first to protect content) ──────────────
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const escaped = code.trim()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${escaped}</code></pre>`
  })

  // ── 2. GFM tables ──────────────────────────────────────────────────────────
  // Matches: header row \n separator row (|---|---| etc.) \n body rows
  html = html.replace(
    /^(\|.+\|[ \t]*)\n(\|[ \t]*[-:]+[-| \t:]*\|[ \t]*)\n((?:\|.+\|[ \t]*\n?)*)/gm,
    (_m, headerRow, _sep, bodyRows) => {
      const parseRow = (row: string) =>
        row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const headers = parseRow(headerRow)
      const rows = bodyRows.trim().split('\n').filter(Boolean).map(parseRow)
      const thead = `<thead><tr>${headers.map((h: string) => `<th>${h}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${rows.map((r: string[]) =>
        `<tr>${r.map((c: string) => `<td>${c}</td>`).join('')}</tr>`
      ).join('')}</tbody>`
      return `<table>${thead}${tbody}</table>\n`
    }
  )

  // ── 3. Blockquotes ─────────────────────────────────────────────────────────
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

  // ── 4. Headings ────────────────────────────────────────────────────────────
  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // ── 5. Inline formatting ───────────────────────────────────────────────────
  html = html
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')

  // ── 6. Horizontal rule ─────────────────────────────────────────────────────
  html = html.replace(/^---+$/gm, '<hr>')

  // ── 7. List items ──────────────────────────────────────────────────────────
  html = html
    .replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')

  // ── 8. Paragraphs ──────────────────────────────────────────────────────────
  html = html.replace(/\n\n/g, '</p><p>')

  // ── 9. Wrap consecutive <li> in <ul> ───────────────────────────────────────
  html = html.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 40px 60px; color: #1a1a1a; line-height: 1.7; }
  h1 { font-size: 2em; border-bottom: 2px solid #333; padding-bottom: 0.3em; margin-top: 1em; }
  h2 { font-size: 1.5em; color: #222; margin-top: 1.6em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
  h3 { font-size: 1.2em; color: #333; margin-top: 1.4em; }
  p { margin: 0.8em 0; }
  ul { padding-left: 1.5em; }
  li { margin: 0.3em 0; }
  code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; font-family: monospace; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
  strong { font-weight: 700; }
  table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: 0.95em; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  tr:nth-child(even) td { background: #fafafa; }
  pre { background: #f4f4f4; padding: 12px 16px; border-radius: 4px; overflow-x: auto; font-size: 0.88em; margin: 1em 0; font-family: monospace; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #555; font-style: italic; }
</style>
</head>
<body><p>${html}</p></body>
</html>`
}

// ---------------------------------------------------------------------------
// Markdown → PDF via puppeteer
// ---------------------------------------------------------------------------

async function exportToPdf(markdown: string, title: string): Promise<Buffer> {
  const html = markdownToHtml(markdown, title)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
      printBackground: true,
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

// ---------------------------------------------------------------------------
// Markdown → DOCX via `docx` package
// ---------------------------------------------------------------------------

interface DocxModule {
  Document: new (opts: unknown) => { save(): Promise<Buffer> }
  Packer: { toBuffer(doc: unknown): Promise<Buffer> }
  Paragraph: new (opts: unknown) => unknown
  TextRun: new (opts: unknown) => unknown
  HeadingLevel: Record<string, string>
  Table: new (opts: unknown) => unknown
  TableRow: new (opts: unknown) => unknown
  TableCell: new (opts: unknown) => unknown
  WidthType: Record<string, string>
  BorderStyle: Record<string, string>
}

async function exportToDocx(markdown: string, title: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = _require('docx') as DocxModule

  const parseRow = (row: string) =>
    row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
  const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder }

  const children: unknown[] = []
  const lines = markdown.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // GFM table: header row + separator row + body rows
    if (/^\|.+\|/.test(line) && i + 1 < lines.length && /^\|[-:| ]+\|/.test(lines[i + 1])) {
      const headers = parseRow(line)
      i += 2 // skip separator
      const tableRows: unknown[] = []

      // Header row
      tableRows.push(new TableRow({
        tableHeader: true,
        children: headers.map(h => new TableCell({
          borders: allBorders,
          shading: { fill: 'F5F5F5' },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        })),
      }))

      // Body rows
      while (i < lines.length && /^\|.+\|/.test(lines[i])) {
        const cells = parseRow(lines[i])
        tableRows.push(new TableRow({
          children: cells.map(c => new TableCell({
            borders: allBorders,
            children: [new Paragraph({ children: [new TextRun({ text: c })] })],
          })),
        }))
        i++
      }

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: tableRows,
      }))
      children.push(new Paragraph({ text: '' }))
      continue
    }

    // Skip table separator rows that appear without a preceding header (safety net)
    if (/^\|[-:| ]+\|/.test(line)) { i++; continue }

    const h1 = line.match(/^# (.+)$/)
    const h2 = line.match(/^## (.+)$/)
    const h3 = line.match(/^### (.+)$/)
    const bullet = line.match(/^[-*+] (.+)$/)

    if (h1) {
      children.push(new Paragraph({ text: h1[1], heading: HeadingLevel.HEADING_1 }))
    } else if (h2) {
      children.push(new Paragraph({ text: h2[1], heading: HeadingLevel.HEADING_2 }))
    } else if (h3) {
      children.push(new Paragraph({ text: h3[1], heading: HeadingLevel.HEADING_3 }))
    } else if (bullet) {
      children.push(new Paragraph({ text: `• ${bullet[1]}` }))
    } else if (line.trim() === '' || line.startsWith('---')) {
      children.push(new Paragraph({ text: '' }))
    } else {
      const text = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
      children.push(new Paragraph({ children: [new TextRun({ text })] }))
    }
    i++
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
    title,
  })

  return Packer.toBuffer(doc)
}

// ---------------------------------------------------------------------------
// Markdown → RTF (pure string generation, no dependencies)
// ---------------------------------------------------------------------------

function exportToRtf(markdown: string, title: string): Buffer {
  function escRtf(text: string): string {
    let out = ''
    for (const ch of text) {
      const cp = ch.codePointAt(0)!
      if (ch === '\\') { out += '\\\\'; continue }
      if (ch === '{')  { out += '\\{';  continue }
      if (ch === '}')  { out += '\\}';  continue }
      if (cp > 127) {
        out += cp <= 255 ? `\\'${cp.toString(16).padStart(2, '0')}` : `\\u${cp}?`
        continue
      }
      out += ch
    }
    return out
  }

  function renderInline(raw: string): string {
    const INLINE = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g
    let result = ''
    let last = 0
    let m: RegExpExecArray | null
    while ((m = INLINE.exec(raw)) !== null) {
      result += escRtf(raw.slice(last, m.index))
      if (m[2] !== undefined)      result += `\\b\\i ${escRtf(m[2])}\\b0\\i0 `
      else if (m[3] !== undefined) result += `\\b ${escRtf(m[3])}\\b0 `
      else if (m[4] !== undefined) result += `\\i ${escRtf(m[4])}\\i0 `
      else if (m[5] !== undefined) result += `{\\f1 ${escRtf(m[5])}}`
      last = m.index + m[0].length
    }
    result += escRtf(raw.slice(last))
    return result
  }

  const codeBlocks: string[] = []
  const protected_ = markdown.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length
    codeBlocks.push(code.trimEnd())
    return `\x00CODE${idx}\x00`
  })

  const rtfLines: string[] = []
  const rawLines = protected_.split('\n')
  let i = 0

  while (i < rawLines.length) {
    const line = rawLines[i]

    const codeMatch = line.match(/^\x00CODE(\d+)\x00$/)
    if (codeMatch) {
      const block = codeBlocks[Number(codeMatch[1])]
      block.split('\n').forEach(cl => rtfLines.push(`\\pard\\li360\\f1\\fs20 ${escRtf(cl)}\\par`))
      rtfLines.push('\\pard\\f0\\fs24\\par')
      i++; continue
    }

    if (/^\|.+\|/.test(line) && i + 1 < rawLines.length && /^\|[-: |]+\|/.test(rawLines[i + 1])) {
      const parseRow = (r: string) =>
        r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const headers = parseRow(line)
      i += 2
      const colWidth = Math.floor(9360 / Math.max(headers.length, 1))
      const headerDefs = headers.map((_h, ci) => `\\cellx${colWidth * (ci + 1)}`).join('')
      const headerCells = headers.map(h => `\\pard\\intbl\\b ${renderInline(h)}\\b0\\cell`).join('')
      rtfLines.push(`\\trowd${headerDefs}${headerCells}\\row`)
      while (i < rawLines.length && /^\|.+\|/.test(rawLines[i])) {
        const cells = parseRow(rawLines[i])
        const cellDefs = cells.map((_c, ci) => `\\cellx${colWidth * (ci + 1)}`).join('')
        const cellContent = cells.map(c => `\\pard\\intbl ${renderInline(c)}\\cell`).join('')
        rtfLines.push(`\\trowd${cellDefs}${cellContent}\\row`)
        i++
      }
      rtfLines.push('\\pard\\par')
      continue
    }

    const bqMatch = line.match(/^> (.+)$/)
    if (bqMatch) { rtfLines.push(`\\pard\\li720\\ri720\\i ${renderInline(bqMatch[1])}\\i0\\par`); i++; continue }

    if (/^---+$/.test(line)) { rtfLines.push('\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par'); i++; continue }

    const h1 = line.match(/^# (.+)$/)
    const h2 = line.match(/^## (.+)$/)
    const h3 = line.match(/^### (.+)$/)
    if (h1) { rtfLines.push(`\\pard\\sb240\\sa120\\b\\fs40 ${renderInline(h1[1])}\\b0\\fs24\\par`); i++; continue }
    if (h2) { rtfLines.push(`\\pard\\sb200\\sa80\\b\\fs32 ${renderInline(h2[1])}\\b0\\fs24\\par`); i++; continue }
    if (h3) { rtfLines.push(`\\pard\\sb160\\sa60\\b\\fs28 ${renderInline(h3[1])}\\b0\\fs24\\par`); i++; continue }

    const ulMatch = line.match(/^[-*+] (.+)$/)
    if (ulMatch) { rtfLines.push(`\\pard\\li360\\fi-180\\bullet  ${renderInline(ulMatch[1])}\\par`); i++; continue }

    const olMatch = line.match(/^\d+\. (.+)$/)
    if (olMatch) { rtfLines.push(`\\pard\\li360\\fi-180\\bullet  ${renderInline(olMatch[1])}\\par`); i++; continue }

    if (line.trim() === '') { rtfLines.push('\\pard\\par'); i++; continue }

    rtfLines.push(`\\pard ${renderInline(line)}\\par`)
    i++
  }

  const rtf = `{\\rtf1\\ansi\\deff0\n{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fmodern\\fcharset0 Courier New;}}\n{\\colortbl;\\red0\\green0\\blue0;}\n{\\info{\\title ${escRtf(title)}}}\n\\widowctrl\\hyphauto\\f0\\fs24\n${rtfLines.join('\n')}\n}`

  return Buffer.from(rtf, 'utf-8')
}

// ---------------------------------------------------------------------------
// Markdown → Notion-compatible markdown
// ---------------------------------------------------------------------------

function exportToNotion(markdown: string): string {
  return markdown
    // Notion uses same # heading syntax — just ensure consistent spacing
    .replace(/^#{1,6} /gm, (match) => match)
    // Convert > blockquotes to Notion callout hint
    .replace(/^> (.+)$/gm, '> 💡 $1')
    // Ensure code blocks have language hints
    .replace(/^```\s*$/gm, '```text')
    // Horizontal rules become Notion dividers
    .replace(/^---+$/gm, '---')
    .trim()
}

// ---------------------------------------------------------------------------
// Markdown → slide-format PPTX
// Expects slides formatted as "## Slide N: Title" or just "## Heading"
// ---------------------------------------------------------------------------

async function exportToPptx(markdown: string, title: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PptxGen = _require('pptxgenjs') as any
  const pptx = new PptxGen()
  pptx.layout = 'LAYOUT_WIDE'

  const sections = markdown.split(/^## /m).filter(Boolean)

  // Cover slide from # title
  const titleMatch = markdown.match(/^# (.+)$/m)
  const coverSlide = pptx.addSlide()
  coverSlide.background = { color: '1a1a2e' }
  coverSlide.addText(titleMatch?.[1] ?? title, {
    x: 0.5, y: 2.5, w: 9, h: 1.5,
    fontSize: 36, bold: true, color: 'ffffff', align: 'center',
  })

  for (const section of sections) {
    const lines = section.split('\n')
    const heading = lines[0].replace(/^Slide \d+:\s*/, '').trim()
    const bodyLines = lines.slice(1).filter((l) => l.trim() && !l.startsWith('> Note:'))
    const noteLines = lines.filter((l) => l.startsWith('> Note:'))

    const slide = pptx.addSlide()
    slide.background = { color: 'ffffff' }

    // Heading
    slide.addText(heading, {
      x: 0.5, y: 0.4, w: 9, h: 0.8,
      fontSize: 24, bold: true, color: '1a1a2e',
    })

    // Body bullets
    const bullets = bodyLines
      .map((l) => l.replace(/^[-*•] /, '').replace(/^\d+\. /, '').trim())
      .filter(Boolean)
      .slice(0, 7)

    if (bullets.length > 0) {
      const bulletText = bullets.map((b) => ({ text: b, options: { bullet: true, fontSize: 16 } }))
      slide.addText(bulletText, { x: 0.5, y: 1.4, w: 9, h: 4, color: '333333' })
    }

    // Speaker notes
    if (noteLines.length > 0) {
      const note = noteLines.map((l) => l.replace(/^> Note:\s*/, '')).join(' ')
      slide.addNotes(note)
    }
  }

  const buffer = await pptx.write({ outputType: 'nodebuffer' })
  return buffer as Buffer
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export async function exportDocument(
  content: string,
  format: OutputFormat,
  title: string,
): Promise<ExportResult> {
  const safeTitle = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)

  switch (format) {
    case 'md':
      return {
        buffer: Buffer.from(content, 'utf-8'),
        mimeType: 'text/markdown',
        filename: `${safeTitle}.md`,
      }

    case 'txt':
      return {
        buffer: Buffer.from(markdownToText(content), 'utf-8'),
        mimeType: 'text/plain',
        filename: `${safeTitle}.txt`,
      }

    case 'pdf': {
      const buffer = await exportToPdf(content, title)
      return { buffer, mimeType: 'application/pdf', filename: `${safeTitle}.pdf` }
    }

    case 'docx': {
      const buffer = await exportToDocx(content, title)
      return {
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: `${safeTitle}.docx`,
      }
    }

    case 'rtf': {
      const buffer = exportToRtf(content, title)
      return { buffer, mimeType: 'application/rtf', filename: `${safeTitle}.rtf` }
    }

    case 'pptx': {
      const buffer = await exportToPptx(content, title)
      return {
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        filename: `${safeTitle}.pptx`,
      }
    }

    case 'notion':
      return {
        buffer: Buffer.from(exportToNotion(content), 'utf-8'),
        mimeType: 'text/markdown',
        filename: `${safeTitle}-notion.md`,
      }

    default:
      return {
        buffer: Buffer.from(content, 'utf-8'),
        mimeType: 'text/markdown',
        filename: `${safeTitle}.md`,
      }
  }
}
