import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { loadCsv, maybeQueryCsvs, convertCsvToMemoryDoc } from './csv-query.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `csv-query-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeCsv(name: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

const SALES_CSV = `date,region,product,units,revenue
2026-01-01,East,Widget,12,240.00
2026-01-02,West,Gadget,5,180.50
2026-01-03,East,Gadget,8,320.00
2026-01-04,North,Widget,3,60.00
2026-01-05,East,Widget,20,400.00
`;

describe('loadCsv', () => {
  it('parses columns and rows', async () => {
    const filePath = await writeCsv('sales.csv', SALES_CSV);
    const table = await loadCsv(filePath);
    expect(table.columns).toEqual(['date', 'region', 'product', 'units', 'revenue']);
    expect(table.rows).toHaveLength(5);
    expect(table.rows[0]).toEqual({
      date: '2026-01-01',
      region: 'East',
      product: 'Widget',
      units: '12',
      revenue: '240.00',
    });
  });

  it('tolerates ragged rows instead of throwing', async () => {
    const filePath = await writeCsv('ragged.csv', 'a,b,c\n1,2,3\n1,2\n1,2,3,4\n');
    await expect(loadCsv(filePath)).resolves.toBeDefined();
  });
});

describe('convertCsvToMemoryDoc', () => {
  it('produces a schema + sample doc without calling any LLM', async () => {
    const filePath = await writeCsv('sales.csv', SALES_CSV);
    const doc = await convertCsvToMemoryDoc('sales.csv', filePath);
    expect(doc.description).toBe('CSV — 5 rows × 5 columns (date, region, product, units, revenue)');
    expect(doc.markdown).toContain('**Rows:** 5');
    expect(doc.markdown).toContain('| date | region | product | units | revenue |');
    expect(doc.markdown).toContain('East');
  });

  it('falls back gracefully on unparseable content', async () => {
    const filePath = await writeCsv('empty.csv', '');
    const doc = await convertCsvToMemoryDoc('empty.csv', filePath);
    expect(doc.description).toContain('could not be parsed');
  });
});

describe('maybeQueryCsvs', () => {
  it('returns null when there are no CSV docs', async () => {
    const result = await maybeQueryCsvs('anything', [], async () => '{"query": null}');
    expect(result).toBeNull();
  });

  it('returns null when the LLM decides no query is needed', async () => {
    const filePath = await writeCsv('sales.csv', SALES_CSV);
    const result = await maybeQueryCsvs('hi there', [{ fileName: 'sales.csv', filePath }], async () =>
      '{"query": null}',
    );
    expect(result).toBeNull();
  });

  it('executes a filter + sum aggregate deterministically, matching the real data', async () => {
    const filePath = await writeCsv('sales.csv', SALES_CSV);
    const spec = {
      query: {
        fileName: 'sales.csv',
        filters: [{ column: 'region', op: 'eq', value: 'East' }],
        aggregate: { column: 'revenue', op: 'sum' },
      },
    };
    const result = await maybeQueryCsvs('total revenue for East', [{ fileName: 'sales.csv', filePath }], async () =>
      JSON.stringify(spec),
    );
    // East rows: 240.00 + 320.00 + 400.00 = 960
    expect(result).toContain('960');
    expect(result).toContain('CSV Query Result (sales.csv)');
  });

  it('executes a count aggregate', async () => {
    const filePath = await writeCsv('sales.csv', SALES_CSV);
    const spec = {
      query: {
        fileName: 'sales.csv',
        filters: [{ column: 'product', op: 'eq', value: 'Widget' }],
        aggregate: { column: 'units', op: 'count' },
      },
    };
    const result = await maybeQueryCsvs('how many widget rows', [{ fileName: 'sales.csv', filePath }], async () =>
      JSON.stringify(spec),
    );
    expect(result).toContain('3 matching rows');
  });

  it('returns matching rows for a non-aggregate query', async () => {
    const filePath = await writeCsv('sales.csv', SALES_CSV);
    const spec = { query: { fileName: 'sales.csv', filters: [{ column: 'region', op: 'eq', value: 'West' }] } };
    const result = await maybeQueryCsvs('show west rows', [{ fileName: 'sales.csv', filePath }], async () =>
      JSON.stringify(spec),
    );
    expect(result).toContain('showing 1 of 1 matching rows');
    expect(result).toContain('Gadget');
  });

  it('aborts (returns null) when the spec references an unknown column', async () => {
    const filePath = await writeCsv('sales.csv', SALES_CSV);
    const spec = { query: { fileName: 'sales.csv', aggregate: { column: 'not_a_real_column', op: 'sum' } } };
    const result = await maybeQueryCsvs('bogus query', [{ fileName: 'sales.csv', filePath }], async () =>
      JSON.stringify(spec),
    );
    expect(result).toBeNull();
  });

  it('never throws when the LLM returns garbage', async () => {
    const filePath = await writeCsv('sales.csv', SALES_CSV);
    const result = await maybeQueryCsvs('anything', [{ fileName: 'sales.csv', filePath }], async () => 'not json at all');
    expect(result).toBeNull();
  });

  it('skips non-numeric values in an aggregate and reports the skip count', async () => {
    const filePath = await writeCsv('mixed.csv', 'name,amount\na,10\nb,oops\nc,20\n');
    const spec = { query: { fileName: 'mixed.csv', aggregate: { column: 'amount', op: 'sum' } } };
    const result = await maybeQueryCsvs('total', [{ fileName: 'mixed.csv', filePath }], async () =>
      JSON.stringify(spec),
    );
    expect(result).toContain('30');
    expect(result).toContain('1 skipped as non-numeric');
  });
});
