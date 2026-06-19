#!/usr/bin/env node
// cert-manager: provisions Let's Encrypt certs for custom domains via certbot HTTP-01 webroot,
// writes per-domain nginx server blocks, and reloads nginx.
//
// Internal Docker network only — never expose this port publicly.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const CERTBOT_EMAIL = process.env.CERTBOT_EMAIL ?? '';
const NGINX_CONTAINER = process.env.NGINX_CONTAINER ?? 'ai-engine-nginx-1';
const WEBROOT = '/var/www/certbot';
const LETSENCRYPT_DIR = '/etc/letsencrypt/live';
const NGINX_CONF_DIR = '/etc/nginx/conf.d';

// RFC-compliant FQDN validation (two or more labels, no path/port/scheme)
const FQDN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function isValidDomain(domain) {
  return FQDN_RE.test(domain) && domain.length <= 253;
}

function certPath(domain) {
  return path.join(LETSENCRYPT_DIR, domain, 'fullchain.pem');
}

function hasCert(domain) {
  try {
    return fs.existsSync(certPath(domain));
  } catch {
    return false;
  }
}

function nginxConfPath(domain) {
  return path.join(NGINX_CONF_DIR, `${domain}.conf`);
}

function buildNginxConf(domain) {
  return `server {
    listen 443 ssl;
    server_name ${domain};

    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    client_max_body_size 25m;
    proxy_connect_timeout 600s;
    proxy_send_timeout    600s;
    proxy_read_timeout    600s;

    location / {
        proxy_pass         http://ui:3001;
        proxy_http_version 1.1;
        proxy_set_header   Connection "";
        proxy_buffering    off;
        proxy_cache        off;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
`;
}

async function runCertbot(domain, email) {
  const args = [
    'certonly',
    '--webroot',
    '-w', WEBROOT,
    '-d', domain,
    '--email', email,
    '--agree-tos',
    '--non-interactive',
    '--keep-until-expiring',
  ];
  await execFileAsync('certbot', args, { timeout: 120_000 });
}

async function reloadNginx() {
  await execFileAsync('docker', ['exec', NGINX_CONTAINER, 'nginx', '-s', 'reload'], { timeout: 10_000 });
}

async function provision(domain, email) {
  await runCertbot(domain, email);
  fs.mkdirSync(NGINX_CONF_DIR, { recursive: true });
  fs.writeFileSync(nginxConfPath(domain), buildNginxConf(domain), 'utf8');
  await reloadNginx();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /status?domain=deck.acme.com
  if (req.method === 'GET' && url.pathname === '/status') {
    const domain = url.searchParams.get('domain')?.trim().toLowerCase() ?? '';
    if (!domain || !isValidDomain(domain)) return send(res, 400, { error: 'invalid domain' });
    return send(res, 200, { hasCert: hasCert(domain) });
  }

  // POST /provision  { domain, email? }
  if (req.method === 'POST' && url.pathname === '/provision') {
    let body;
    try { body = await readBody(req); }
    catch { return send(res, 400, { error: 'invalid JSON' }); }

    const domain = (body.domain ?? '').trim().toLowerCase();
    const email = (body.email ?? CERTBOT_EMAIL).trim();

    if (!domain || !isValidDomain(domain)) return send(res, 400, { error: 'invalid domain' });
    if (!email) return send(res, 400, { error: 'email is required for Let\'s Encrypt registration' });

    try {
      await provision(domain, email);
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error(`[cert-manager] provision failed for ${domain}:`, err);
      return send(res, 500, { ok: false, error: String(err?.message ?? err) });
    }
  }

  // GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[cert-manager] listening on :${PORT}`);
});
