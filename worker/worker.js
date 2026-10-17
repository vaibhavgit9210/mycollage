// mycollage backend, behind vaibhavkumar.is-a.dev/mycollage/
//
// One Durable Object (SQLite) holds the live collage, the editable project behind it
// and every image. Images are content addressed (sha256 hex of their bytes, checked on
// upload) and stored as 1 MiB rows, because one SQLite value is capped at 2 MB.
//
// Public, no key (CORS *):
//   GET  /live           {id, at, title, W, H, full, preview, og, lqip}, or {none:true}.
//                        full/preview/og = {id, w, h, bytes}: three sizes of one render.
//   GET  /r/<sha256>     a rendered collage image. Immutable.
//   GET  /og.jpg         the live collage's link preview image
//
// Studio only, "Authorization: Bearer <ADMIN_KEY>":
//   GET  /auth           {ok:true}, so the studio can check a key
//   POST /have           {ids:[sha256]} -> {missing:[sha256]}, source photos not stored yet
//   PUT  /src/<sha256>   store a source photo (body = jpeg/png/webp bytes)
//   GET  /src/<sha256>   read one back
//   PUT  /r/<sha256>     store a render
//   PUT  /publish        {title, W, H, full, preview, og, lqip, doc} -> {id, at}
//                        Every render and every photo in doc.images must be stored first
//                        (409 {missing} otherwise). Afterwards renders older than the
//                        previous deploy and photos no longer in doc.images are deleted.
//   GET  /project        {id, at, doc} behind the live collage, or {none:true}
//
// Source photos are never public: the live page only ever sees the flattened renders,
// so whatever a crop hides stays hidden.

import { DurableObject } from 'cloudflare:workers';

const ALLOWED_ORIGINS = [
  'https://vaibhavkumar.is-a.dev',
  'https://vaibhavgit9210.github.io',
];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const PUBLIC = /^\/(live|og\.jpg|r\/[0-9a-f]{64})$/;
const HASH = /^[0-9a-f]{64}$/;
const CHUNK = 1 << 20;
const MAX_IMG = 24 << 20, MAX_BODY = 2 << 20;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MAGIC = {
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': b => String.fromCharCode(...b.subarray(8, 12)) === 'WEBP',
};

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (ALLOWED_ORIGINS.includes(origin) || LOCAL.test(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

const json = (data, status = 200, cache = 'no-store') => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
});

// Same cleaning as claudenotepad: no control, bidi or invisible format chars.
function clean(s) {
  return String(s)
    .replace(/[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁩﻿]/g, '')
    .trim();
}

async function hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time: compare fixed-length digests, never the raw strings.
async function keyOk(req, key) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') || '');
  const enc = s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const a = new Uint8Array(await enc(m ? m[1] : '')), b = new Uint8Array(await enc(key));
  let diff = m ? 0 : 1;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Read and discard an upload we are refusing. Cancelling it instead breaks the next
// request in wrangler dev, and streaming it through keeps memory flat.
async function drain(req) {
  for await (const _ of req.body) { /* discard */ }
}

async function readJSON(req, max) {
  if (Number(req.headers.get('Content-Length') || 0) > max) return null;
  const raw = await req.text();
  if (raw.length > max) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const dim = n => Number.isInteger(n) && n > 0 && n <= 20000;
const render = x => x && typeof x === 'object' && HASH.test(x.id) && dim(x.w) && dim(x.h)
  && Number.isSafeInteger(x.bytes) && x.bytes > 0;
const pick = x => ({ id: x.id, w: x.w, h: x.h, bytes: x.bytes });

export class Collage extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS blobs(
      kind TEXT, id TEXT, type TEXT, size INTEGER, ts INTEGER, PRIMARY KEY(kind, id))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chunks(
      kind TEXT, id TEXT, n INTEGER, data BLOB, PRIMARY KEY(kind, id, n))`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)');
  }
  get(k) {
    const r = this.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray()[0];
    return r ? JSON.parse(r.v) : null;
  }
  set(k, v) {
    this.sql.exec('INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v));
  }
  has(kind, id) {
    return this.sql.exec('SELECT 1 FROM blobs WHERE kind = ? AND id = ?', kind, id).toArray().length > 0;
  }
  drop(kind, id) {
    this.sql.exec('DELETE FROM chunks WHERE kind = ? AND id = ?', kind, id);
    this.sql.exec('DELETE FROM blobs WHERE kind = ? AND id = ?', kind, id);
  }

  serve(kind, id, req, cache) {
    const row = this.sql.exec('SELECT type, size FROM blobs WHERE kind = ? AND id = ?', kind, id).toArray()[0];
    if (!row) return json({ error: 'not found' }, 404);
    const headers = {
      'Content-Type': row.type, 'Cache-Control': cache, 'ETag': `"${id}"`,
      'X-Content-Type-Options': 'nosniff',
    };
    if ((req.headers.get('If-None-Match') || '').includes(id)) return new Response(null, { status: 304, headers });
    if (req.method === 'HEAD') return new Response(null, { headers: { ...headers, 'Content-Length': String(row.size) } });
    const out = new Uint8Array(row.size);
    let off = 0;
    for (const c of this.sql.exec('SELECT data FROM chunks WHERE kind = ? AND id = ? ORDER BY n', kind, id)) {
      out.set(new Uint8Array(c.data), off);
      off += c.data.byteLength;
    }
    return new Response(out, { headers });
  }

  async store(kind, id, req) {
    if (Number(req.headers.get('Content-Length') || 0) > MAX_IMG) return json({ error: 'too large' }, 413);
    const buf = await req.arrayBuffer();
    const type = (req.headers.get('Content-Type') || '').split(';')[0].trim();
    if (!MAGIC[type]) return json({ error: 'bad type' }, 415);
    if (!buf.byteLength || buf.byteLength > MAX_IMG) return json({ error: 'bad size' }, 413);
    if (!MAGIC[type](new Uint8Array(buf, 0, Math.min(16, buf.byteLength)))) return json({ error: 'not a ' + type }, 415);
    if (await hex(buf) !== id) return json({ error: 'hash mismatch' }, 400);
    if (this.has(kind, id)) return json({ ok: true });
    this.ctx.storage.transactionSync(() => {
      for (let off = 0, n = 0; off < buf.byteLength; off += CHUNK, n++)
        this.sql.exec('INSERT INTO chunks(kind, id, n, data) VALUES(?, ?, ?, ?)', kind, id, n, buf.slice(off, off + CHUNK));
      this.sql.exec('INSERT INTO blobs(kind, id, type, size, ts) VALUES(?, ?, ?, ?, ?)',
        kind, id, type, buf.byteLength, Date.now());
    });
    return json({ ok: true }, 201);
  }

  async publish(req) {
    const b = await readJSON(req, MAX_BODY);
    if (!b || typeof b !== 'object') return json({ error: 'bad json' }, 400);
    if (!render(b.full) || !render(b.preview) || !render(b.og)) return json({ error: 'bad renders' }, 400);
    if (!(b.W > 0 && b.W <= 10000 && b.H > 0 && b.H <= 10000)) return json({ error: 'bad size' }, 400);
    if (typeof b.lqip !== 'string' || b.lqip.length > 16000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(b.lqip))
      return json({ error: 'bad lqip' }, 400);
    const doc = b.doc;
    if (!doc || typeof doc !== 'object' || !doc.images || typeof doc.images !== 'object') return json({ error: 'bad doc' }, 400);
    const photos = Object.keys(doc.images);
    if (photos.length > 2000 || !photos.every(id => HASH.test(id))) return json({ error: 'bad photo ids' }, 400);
    const missing = [
      ...[b.full, b.preview, b.og].map(x => x.id).filter(id => !this.has('r', id)),
      ...photos.filter(id => !this.has('src', id)),
    ];
    if (missing.length) return json({ error: 'missing', missing }, 409);

    const prev = this.get('live');
    const live = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12), at: Date.now(),
      title: clean(b.title ?? '').slice(0, 120), W: +b.W, H: +b.H,
      full: pick(b.full), preview: pick(b.preview), og: pick(b.og), lqip: b.lqip,
    };
    const keepR = new Set([live, prev].filter(Boolean).flatMap(l => [l.full.id, l.preview.id, l.og.id]));
    const keepSrc = new Set(photos);
    this.ctx.storage.transactionSync(() => {
      this.set('live', live);
      this.set('project', { id: live.id, at: live.at, doc });
      for (const { kind, id } of this.sql.exec('SELECT kind, id FROM blobs').toArray())
        if (kind === 'r' ? !keepR.has(id) : !keepSrc.has(id)) this.drop(kind, id);
    });
    return json({ id: live.id, at: live.at });
  }

  // Only reachable through the Worker below, which has already checked the key
  // for everything that is not a public GET.
  async fetch(req) {
    const res = await this.route(req);
    if (req.body && !req.bodyUsed) await drain(req); // early answers leave uploads unread
    return res;
  }

  async route(req) {
    const p = new URL(req.url).pathname, m = req.method;
    const blob = /^\/(r|src)\/([0-9a-f]{64})$/.exec(p);
    if (blob) {
      const [, kind, id] = blob;
      if (m === 'GET' || m === 'HEAD') return this.serve(kind, id, req, kind === 'r' ? IMMUTABLE : 'private, max-age=31536000, immutable');
      if (m === 'PUT') return this.store(kind, id, req);
      return json({ error: 'method not allowed' }, 405);
    }
    if (p === '/live' && m === 'GET') return json(this.get('live') || { none: true }, 200, 'no-cache');
    if (p === '/og.jpg' && (m === 'GET' || m === 'HEAD')) {
      const live = this.get('live');
      return live ? this.serve('r', live.og.id, req, 'public, max-age=300') : json({ error: 'nothing live' }, 404);
    }
    if (p === '/auth' && m === 'GET') return json({ ok: true });
    if (p === '/project' && m === 'GET') return json(this.get('project') || { none: true });
    if (p === '/have' && m === 'POST') {
      const b = await readJSON(req, 256 * 1024);
      const ids = b && b.ids;
      if (!Array.isArray(ids) || ids.length > 2000 || !ids.every(x => typeof x === 'string' && HASH.test(x)))
        return json({ error: 'bad ids' }, 400);
      return json({ missing: ids.filter(id => !this.has('src', id)) });
    }
    if (p === '/publish' && m === 'PUT') return this.publish(req);
    return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const open = (req.method === 'GET' || req.method === 'HEAD') && PUBLIC.test(url.pathname);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
    const cors = open ? { 'Access-Control-Allow-Origin': '*' } : corsHeaders(req);
    const withCors = res => {
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    };
    if (!open && !(env.ADMIN_KEY && await keyOk(req, env.ADMIN_KEY))) {
      if (req.body) await drain(req);
      return withCors(env.ADMIN_KEY ? json({ error: 'locked' }, 401) : json({ error: 'not configured' }, 500));
    }
    return withCors(await env.COLLAGE.get(env.COLLAGE.idFromName('main')).fetch(req));
  },
};
