// Static server for makeaiproveit.com
//
// No dependencies. The whole site is about 1 MB, so it is read into memory at
// boot, pre-compressed once, and served from RAM. Nothing touches the disk per
// request and there is no package tree to audit or keep patched.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = process.env.PORT || 3000;
// set CANONICAL_HOST to send www to the bare domain; leave unset to skip
const CANONICAL_HOST = process.env.CANONICAL_HOST || '';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.xml', '.txt', '.svg']);

// ---------------------------------------------------------------- load once
const files = new Map();

function load(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const url = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) { load(full, url); continue; }

    const body = fs.readFileSync(full);
    const ext = path.extname(entry.name).toLowerCase();
    const rec = {
      body,
      type: TYPES[ext] || 'application/octet-stream',
      etag: `"${crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)}"`,
      // hashed filenames can be cached forever; the HTML must always revalidate
      cache: url.startsWith('/img/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
    };
    if (COMPRESSIBLE.has(ext) && body.length > 512) {
      rec.br = zlib.brotliCompressSync(body, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
      });
      rec.gzip = zlib.gzipSync(body, { level: 9 });
    }
    files.set(url, rec);
  }
}
load(ROOT);
if (files.has('/index.html')) files.set('/', files.get('/index.html'));

// ------------------------------------------------------------------- serve
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=15552000',
};

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').toLowerCase();
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const url = new URL(req.url, `https://${host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  // Railway terminates TLS at the edge and forwards the original scheme
  if (proto === 'http' && host && !host.startsWith('localhost') && !host.startsWith('127.')) {
    res.writeHead(308, { Location: `https://${host}${req.url}` });
    return res.end();
  }
  if (CANONICAL_HOST && host && host !== CANONICAL_HOST && host.endsWith(CANONICAL_HOST)) {
    res.writeHead(308, { Location: `https://${CANONICAL_HOST}${req.url}` });
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY });
    return res.end();
  }

  const file = files.get(pathname) || files.get(pathname.replace(/\/$/, ''));
  if (!file) {
    // one-page site: anything else belongs at the front door
    res.writeHead(302, { Location: '/', ...SECURITY });
    return res.end();
  }

  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304, { ETag: file.etag, 'Cache-Control': file.cache, ...SECURITY });
    return res.end();
  }

  const accept = req.headers['accept-encoding'] || '';
  let body = file.body;
  const headers = {
    'Content-Type': file.type,
    'Cache-Control': file.cache,
    ETag: file.etag,
    Vary: 'Accept-Encoding',
    ...SECURITY,
  };
  if (file.br && /\bbr\b/.test(accept)) {
    body = file.br; headers['Content-Encoding'] = 'br';
  } else if (file.gzip && /\bgzip\b/.test(accept)) {
    body = file.gzip; headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;

  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(PORT, () => {
  const bytes = [...files.values()].reduce((n, f) => n + f.body.length, 0);
  console.log(`makeaiproveit.com listening on ${PORT} — ${files.size} files, ${Math.round(bytes / 1024)} KB in memory`);
});

// Railway sends SIGTERM on redeploy; finish in-flight requests first
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
