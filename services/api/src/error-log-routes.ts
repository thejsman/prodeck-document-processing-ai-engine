/**
 * Hidden error-log viewer.
 *
 * Serves the error log as a minimal HTML table at an obscure, unguessable path.
 * There is no token or API-key auth — the obscurity of the path is the only
 * guard (see the auth-exemption in server.ts). Read-only.
 *
 * Override the path with the ERROR_LOG_ROUTE env var if you want a different one.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readErrorEntries, type ErrorLogEntry } from './error-log.js';

export const ERROR_LOG_ROUTE =
  process.env.ERROR_LOG_ROUTE ?? '/__internal/error-log-a7f3e9c2';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRows(entries: ErrorLogEntry[]): string {
  return entries
    .map((e, i) => {
      const detailsId = `d${i}`;
      const time = escapeHtml(e.timestamp ?? '');
      const ns = escapeHtml(e.namespace ?? '—');
      const status = e.statusCode != null ? ` · ${escapeHtml(String(e.statusCode))}` : '';
      const proc = escapeHtml(e.process ?? '—') + status;
      const msg = escapeHtml(e.message ?? '');
      const userInput = escapeHtml(e.userInput ?? '—');
      const stack = escapeHtml(e.stack ?? '(no stack captured)');
      return `
      <tr class="row" onclick="document.getElementById('${detailsId}').classList.toggle('open')">
        <td class="mono nowrap">${time}</td>
        <td>${ns}</td>
        <td class="mono">${proc}</td>
        <td class="msg">${msg}</td>
      </tr>
      <tr id="${detailsId}" class="details">
        <td colspan="4">
          <div class="label">User input</div><pre>${userInput}</pre>
          <div class="label">Stack</div><pre>${stack}</pre>
        </td>
      </tr>`;
    })
    .join('');
}

function renderPage(entries: ErrorLogEntry[]): string {
  const table = entries.length
    ? `<table>
        <thead><tr><th>Time</th><th>Namespace</th><th>Process</th><th>Error</th></tr></thead>
        <tbody>${renderRows(entries)}</tbody>
      </table>`
    : `<p class="empty">No errors logged yet.</p>`;

  const count = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Error log</title>
<style>
  body { font: 13px/1.5 -apple-system, system-ui, sans-serif; margin: 24px; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #666; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { background: #f4f4f5; font-weight: 600; position: sticky; top: 0; }
  .row { cursor: pointer; }
  .row:hover { background: #f9f9fb; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .nowrap { white-space: nowrap; }
  .msg { color: #b00020; }
  .details { display: none; background: #fbfbfd; }
  .details.open { display: table-row; }
  .label { font-weight: 600; color: #666; margin: 6px 0 2px; }
  pre { margin: 0 0 8px; padding: 8px; background: #f4f4f5; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  .empty { color: #666; }
</style></head>
<body>
  <h1>Error log</h1>
  <div class="meta">${count} · newest first · click a row to expand</div>
  ${table}
</body></html>`;
}

export function registerErrorLogRoutes(app: FastifyInstance): void {
  app.get(ERROR_LOG_ROUTE, async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { limit?: string } | undefined;
    const parsed = q?.limit ? Number(q.limit) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
    const entries = await readErrorEntries(limit);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(renderPage(entries));
  });
}
