import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { ConvertedMemoryDoc, LLMGenerateFn } from './document-converter.js';

export interface CsvTable {
  columns: string[];
  rows: Record<string, string>[];
}

/** Parses a CSV file. Permissive: a ragged row (wrong column count) is kept rather
 * than throwing, so one malformed line doesn't fail the whole upload. */
export async function loadCsv(filePath: string): Promise<CsvTable> {
  const raw = await readFile(filePath, 'utf-8');
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows };
}

type ColumnType = 'numeric' | 'text';

/** Samples up to 20 non-empty values per column; a column is 'numeric' only if every
 * sampled value parses as a number — used to steer the query-spec LLM toward sensible
 * aggregate targets, not to coerce the underlying data itself. */
function inferColumnTypes(columns: string[], rows: Record<string, string>[]): Record<string, ColumnType> {
  const types: Record<string, ColumnType> = {};
  for (const col of columns) {
    const samples: string[] = [];
    for (const row of rows) {
      const v = row[col]?.trim();
      if (v) samples.push(v);
      if (samples.length >= 20) break;
    }
    types[col] = samples.length > 0 && samples.every((v) => Number.isFinite(Number(v))) ? 'numeric' : 'text';
  }
  return types;
}

function escapeTableCell(v: string): string {
  return (v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function toMarkdownTable(columns: string[], rows: Record<string, string>[]): string {
  const header = `| ${columns.join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${columns.map((c) => escapeTableCell(r[c] ?? '')).join(' | ')} |`).join('\n');
  return [header, sep, body].join('\n');
}

const SAMPLE_ROWS = 8;

/**
 * Deterministic (no LLM) memory-doc builder for CSV uploads — never a rewrite, always
 * a small, fixed-size schema + sample regardless of file size, so unlike other upload
 * types this doc never needs truncation. Precise retrieval over the FULL data happens
 * separately via maybeQueryCsvs, not by embedding the bulk of the file here.
 */
export async function convertCsvToMemoryDoc(fileName: string, filePath: string): Promise<ConvertedMemoryDoc> {
  try {
    const { columns, rows } = await loadCsv(filePath);
    if (columns.length === 0) {
      const raw = await readFile(filePath, 'utf-8');
      return {
        description: `Uploaded CSV: ${fileName} (could not be parsed as tabular data)`,
        markdown: `# ${fileName}\n\n\`\`\`csv\n${raw.slice(0, 4000)}\n\`\`\``,
      };
    }
    const sample = rows.slice(0, SAMPLE_ROWS);
    const markdown = [
      `# ${fileName}`,
      `**Rows:** ${rows.length} | **Columns:** ${columns.length} (${columns.join(', ')})`,
      `Sample of the first ${sample.length} of ${rows.length} rows — the full data is queryable in chat, ask a specific question (filter, sum, count, etc.) to retrieve exact results:`,
      '',
      toMarkdownTable(columns, sample),
    ].join('\n\n');
    return {
      description: `CSV — ${rows.length} rows × ${columns.length} columns (${columns.join(', ')})`,
      markdown,
    };
  } catch {
    const raw = await readFile(filePath, 'utf-8').catch(() => '');
    return {
      description: `Uploaded CSV: ${fileName} (could not be parsed as tabular data)`,
      markdown: raw.trim()
        ? `# ${fileName}\n\n\`\`\`csv\n${raw.slice(0, 4000)}\n\`\`\``
        : `# ${fileName}\n\n(No extractable content.)`,
    };
  }
}

// ---------------------------------------------------------------------------
// Query spec: LLM proposes a structured filter/aggregate, Node executes it
// exactly against the real parsed rows — the LLM never does the arithmetic.
// ---------------------------------------------------------------------------

const CsvQuerySpecSchema = z
  .object({
    fileName: z.string(),
    filters: z
      .array(
        z.object({
          column: z.string(),
          op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']),
          value: z.string(),
        }),
      )
      .optional(),
    aggregate: z.object({ column: z.string(), op: z.enum(['sum', 'avg', 'count', 'min', 'max']) }).optional(),
    select: z.array(z.string()).optional(),
    sort: z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
    limit: z.number().int().positive().max(50).optional(),
  })
  .nullable();

type CsvQuerySpec = NonNullable<z.infer<typeof CsvQuerySpecSchema>>;

interface CsvDocRef {
  fileName: string;
  filePath: string;
}

/** Extract the first JSON object from an LLM reply, tolerating markdown fences/prose.
 * Same small pattern already duplicated in document-converter.ts and intent-gate.ts —
 * kept local rather than shared, matching that existing precedent. */
function safeParseJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildCsvQueryPrompt(
  message: string,
  schemas: { fileName: string; rowCount: number; columns: { name: string; type: ColumnType }[] }[],
): string {
  const catalog = schemas
    .map(
      (s) =>
        `- "${s.fileName}" (${s.rowCount} rows): ${s.columns.map((c) => `${c.name} [${c.type}]`).join(', ')}`,
    )
    .join('\n');
  return `You decide whether the user's message needs precise data retrieved from one of these uploaded CSV files, and if so express that as a structured query — you never compute the answer yourself, a separate deterministic step executes your query against the real data.

Available CSVs:
${catalog}

If the message doesn't need data from any of these (general question, not about the data, or answerable from a small sample), return: {"query": null}

Otherwise return a query spec:
{"query": {
  "fileName": "<exact file name from the list above>",
  "filters": [{"column": "<exact column name>", "op": "eq|neq|gt|gte|lt|lte|contains", "value": "<string>"}],
  "aggregate": {"column": "<exact column name>", "op": "sum|avg|count|min|max"},
  "select": ["<column names to show, omit for all>"],
  "sort": {"column": "<column name>", "direction": "asc|desc"},
  "limit": <number, max 50, omit for default>
}}

Rules:
- "filters" are ALL combined with AND — there is no OR.
- Use "aggregate" only when the user wants a single computed number (total, average, count, min, max). Omit it to return matching rows instead.
- Column names must match exactly (case-sensitive) one of the columns listed above for the chosen file.
- Only set fields you actually need — omit filters/aggregate/select/sort/limit entirely when not relevant.

User's message:
"""${message}"""

Respond with ONLY JSON, no prose or markdown fences: {"query": null} or {"query": {...}}`;
}

function coerceNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

function matchesFilter(row: Record<string, string>, filter: NonNullable<CsvQuerySpec['filters']>[number]): boolean {
  const cell = row[filter.column] ?? '';
  if (filter.op === 'eq') return cell.trim().toLowerCase() === filter.value.trim().toLowerCase();
  if (filter.op === 'neq') return cell.trim().toLowerCase() !== filter.value.trim().toLowerCase();
  if (filter.op === 'contains') return cell.toLowerCase().includes(filter.value.toLowerCase());
  const cellNum = coerceNumber(cell);
  const valNum = coerceNumber(filter.value);
  if (cellNum === null || valNum === null) return false;
  if (filter.op === 'gt') return cellNum > valNum;
  if (filter.op === 'gte') return cellNum >= valNum;
  if (filter.op === 'lt') return cellNum < valNum;
  return cellNum <= valNum; // 'lte'
}

/** Runs a validated spec against the real rows. Returns null if the spec references a
 * column that doesn't actually exist on this file — abort rather than silently answer
 * from a mismatched/misspelled column. */
function executeCsvQuery(spec: CsvQuerySpec, table: CsvTable): string | null {
  const known = new Set(table.columns.map((c) => c.toLowerCase()));
  const resolveColumn = (name: string): string | null =>
    table.columns.find((c) => c.toLowerCase() === name.toLowerCase()) ?? null;

  for (const f of spec.filters ?? []) {
    if (!known.has(f.column.toLowerCase())) return null;
  }
  if (spec.aggregate && !known.has(spec.aggregate.column.toLowerCase())) return null;
  for (const s of spec.select ?? []) {
    if (!known.has(s.toLowerCase())) return null;
  }
  if (spec.sort && !known.has(spec.sort.column.toLowerCase())) return null;

  const filters = (spec.filters ?? []).map((f) => ({ ...f, column: resolveColumn(f.column)! }));
  let matched = table.rows.filter((row) => filters.every((f) => matchesFilter(row, f)));

  if (spec.aggregate) {
    const col = resolveColumn(spec.aggregate.column)!;
    if (spec.aggregate.op === 'count') {
      return `Query: filter (${filters.length ? filters.map((f) => `${f.column} ${f.op} "${f.value}"`).join(' AND ') : 'none'}), then count\nResult: ${matched.length} matching rows (of ${table.rows.length} total)`;
    }
    const nums = matched.map((r) => coerceNumber(r[col]));
    const valid = nums.filter((n): n is number => n !== null);
    const skipped = nums.length - valid.length;
    let value: number;
    if (spec.aggregate.op === 'sum') value = valid.reduce((a, b) => a + b, 0);
    else if (spec.aggregate.op === 'avg') value = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
    else if (spec.aggregate.op === 'min') value = valid.length ? Math.min(...valid) : 0;
    else value = valid.length ? Math.max(...valid) : 0; // 'max'
    return `Query: filter (${filters.length ? filters.map((f) => `${f.column} ${f.op} "${f.value}"`).join(' AND ') : 'none'}), then ${spec.aggregate.op}(${col})\nResult: ${value} (computed over ${valid.length} of ${matched.length} matching rows${skipped ? `; ${skipped} skipped as non-numeric` : ''}; ${table.rows.length} total rows in file)`;
  }

  if (spec.sort) {
    const col = resolveColumn(spec.sort.column)!;
    const dir = spec.sort.direction === 'desc' ? -1 : 1;
    matched = [...matched].sort((a, b) => {
      const an = coerceNumber(a[col]);
      const bn = coerceNumber(b[col]);
      if (an !== null && bn !== null) return (an - bn) * dir;
      return a[col].localeCompare(b[col]) * dir;
    });
  }

  const totalMatches = matched.length;
  const limit = Math.min(spec.limit ?? 20, 50);
  const cols = (spec.select ?? table.columns).map((c) => resolveColumn(c)!).filter(Boolean);
  const shown = matched.slice(0, limit);

  return [
    `Query: filter (${filters.length ? filters.map((f) => `${f.column} ${f.op} "${f.value}"`).join(' AND ') : 'none'})${spec.sort ? `, sort by ${spec.sort.column} ${spec.sort.direction}` : ''}`,
    `Result: showing ${shown.length} of ${totalMatches} matching rows (${table.rows.length} total rows in file)`,
    '',
    toMarkdownTable(cols, shown),
  ].join('\n');
}

/**
 * Orchestrates the query step for one turn: asks the LLM whether any of the relevant
 * CSVs need querying, and if so executes deterministically and returns a markdown
 * block to inject into the generation prompt. Never throws — any failure at any step
 * just returns null and the turn proceeds without a query result, same as before this
 * feature existed.
 */
export async function maybeQueryCsvs(
  message: string,
  csvDocs: CsvDocRef[],
  generateFn: LLMGenerateFn,
): Promise<string | null> {
  if (csvDocs.length === 0) return null;
  try {
    const tables = new Map<string, CsvTable>();
    const schemas: { fileName: string; rowCount: number; columns: { name: string; type: ColumnType }[] }[] = [];
    for (const doc of csvDocs) {
      const table = await loadCsv(doc.filePath);
      tables.set(doc.fileName, table);
      const types = inferColumnTypes(table.columns, table.rows);
      schemas.push({
        fileName: doc.fileName,
        rowCount: table.rows.length,
        columns: table.columns.map((name) => ({ name, type: types[name] })),
      });
    }

    const raw = await generateFn(buildCsvQueryPrompt(message, schemas));
    const parsed = safeParseJson(raw);
    const result = z.object({ query: CsvQuerySpecSchema }).safeParse(parsed);
    if (!result.success || !result.data.query) return null;

    const spec = result.data.query;
    const table = tables.get(spec.fileName);
    if (!table) return null;

    const resultBlock = executeCsvQuery(spec, table);
    if (!resultBlock) return null;

    return `\n## CSV Query Result (${spec.fileName})\n${resultBlock}`;
  } catch {
    return null;
  }
}
