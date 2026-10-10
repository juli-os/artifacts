// Artifact byte side (counterpart of Go internal/infra/storage): Backend port + disk/S3 implementations.
// S3 presign uses hand-rolled AWS SigV4 signing (zero SDK dependency; R2/OSS/minio-compatible path-style).

import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { err, ok, toResult, type Result } from '../shared/result.ts';
import { guessMime } from './ledger.ts';

export interface ArtifactBackend {
  put(key: string, bytes: Buffer): Promise<Result<void, Error>>;
  get(key: string): Promise<Result<Buffer, Error>>;
  delete(key: string): Promise<Result<void, Error>>;
  list(prefix: string): Promise<readonly string[]>;
  /** Produce an accessible URL: disk = local API path; S3 = presigned GET. */
  url(key: string, ttlSec?: number): Promise<Result<string, Error>>;
}

// ---- Disk backend ------------------------------------------------------------------

/** Containment: the resolved path must stay inside rootDir; traversal keys (../,
 * absolute paths pointing outside) are always rejected — keys come from the ledger/HTTP
 * params and must never be trusted as filesystem input. */
const containedPath = (rootDir: string, key: string): { path: string } | { error: Error } => {
  const root = resolve(rootDir);
  const p = resolve(join(rootDir, key));
  if (!p.startsWith(root + sep)) {
    return { error: new Error(`artifact key escapes backend root: ${key.slice(0, 100)}`) };
  }
  return { path: p };
};

export const createDiskBackend = (rootDir: string): ArtifactBackend => ({
  async put(key, bytes) {
    const c = containedPath(rootDir, key);
    if ('error' in c) return err(c.error);
    await mkdir(c.path.replace(/[/\\][^/\\]*$/, ''), { recursive: true });
    return toResult(writeFile(c.path, bytes), 'disk put failed');
  },
  async get(key) {
    const c = containedPath(rootDir, key);
    if ('error' in c) return err(c.error);
    return toResult(readFile(c.path), 'disk get failed');
  },
  async delete(key) {
    const c = containedPath(rootDir, key);
    if ('error' in c) return err(c.error);
    return toResult((async () => {
      await unlink(c.path);
    })(), 'disk delete failed');
  },
  async list(prefix) {
    try {
      const dir = join(rootDir, prefix);
      const walk = async (d: string): Promise<readonly string[]> => {
        const entries = await readdir(d, { withFileTypes: true });
        const out: string[] = [];
        for (const e of entries) {
          const full = join(d, e.name);
          if (e.isDirectory()) out.push(...await walk(full));
          else out.push(full.slice(rootDir.length + 1));
        }
        return out;
      };
      return await walk(dir);
    } catch {
      return [];
    }
  },
  async url(key) { return ok(`/api/artifacts/content/${encodeURIComponent(key)}`); },
});

// ---- S3-compatible backend (SigV4 presign) ---------------------------------------------------

export interface S3Opts {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly pathStyle?: boolean;
  /** Public share host (e.g. share.juliasia.cn, a CNAME to the bucket): outbound links
   * are rewritten only for OSS V1 — the V1 signature covers just the resource path, not
   * the domain, so a rewritten link stays valid; SigV4 signs the host, so rewriting
   * breaks it and this setting is ignored there. Empty = no rewriting; serve the endpoint's own domain. */
  readonly publicHost?: string;
  /** Test injection point: presign clock (defaults to the system clock) — prerequisite for known-answer signature tests. */
  readonly now?: () => Date;
}

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const shaHex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** URL-encode a key: per-segment encodeURIComponent (keeps /) — keys come from file
 * names (case-inbox readdir, agent/user-controlled) and may contain ?, #, spaces, or a
 * literal %; splicing them in raw gets cut at URL structure and mismatches the string
 * to sign (SignatureDoesNotMatch/404). */
const encodeKeyPath = (key: string): string =>
  key.split('/').map(encodeURIComponent).join('/');

/** Slim down S3/OSS error bodies: extract only <Code>/<Message> (the error XML contains
 * AK IDs and internal endpoints — never log it whole); for non-XML bodies, mask the
 * accessKeyId and truncate. */
const sanitizeErrorBody = (body: string, accessKeyId: string): string => {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  const msg = /<Message>([^<]+)<\/Message>/.exec(body)?.[1];
  if (code !== undefined || msg !== undefined) return [code, msg].filter((x) => x !== undefined).join(': ');
  // An empty-string accessKeyId would make split('') degrade to per-character masking — fall back to \u0000, which never occurs.
  return body.split(accessKeyId || '\u0000').join('***AK***').slice(0, 200);
};

const presignUrl = (opts: S3Opts, key: string, method: 'GET' | 'PUT' | 'DELETE', ttlSec: number): string => {
  const now = opts.now?.() ?? new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${opts.region}/s3/aws4_request`;
  const host = opts.endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const canonicalUri = opts.pathStyle === false
    ? `/${encodeKeyPath(key)}`
    : `/${opts.bucket}/${encodeKeyPath(key)}`;
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${opts.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(ttlSec),
    'X-Amz-SignedHeaders': 'host',
  });
  const canonicalRequest = [
    method, canonicalUri, query.toString(), `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope, shaHex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${opts.secretAccessKey}`, dateStamp), opts.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `https://${host}${canonicalUri}?${query.toString()}&X-Amz-Signature=${signature}`;
};

// ---- OSS native V1 presign ----------------------------------------------------------
// Alibaba Cloud OSS rejects AWS SigV4 query auth (in practice always 400
// AuthorizationQueryParametersError, with an error message misleadingly blaming the
// date format) — .aliyuncs.com endpoints must use V1: the string to sign is
// "VERB\n\n\nExpires\n/bucket/key", and the URL uses the virtual-host path /key. Real S3/R2/MinIO stay on SigV4.

const isOssEndpoint = (endpoint: string): boolean => /\.aliyuncs\.com(?::\d+)?\/?$/.test(endpoint);

const ossPresignUrl = (opts: S3Opts, key: string, method: 'GET' | 'PUT' | 'DELETE', ttlSec: number, contentType = ''): string => {
  const host = opts.endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const expires = Math.floor((opts.now?.() ?? new Date()).getTime() / 1000) + ttlSec;
  // The signed resource is always /bucket/key with the raw unencoded key — the server
  // decodes the request path before verifying; the request URL adapts to the endpoint
  // shape: bucket-subdomain endpoints (host starting with `${bucket}.`) use
  // virtual-host (/key), bare regional endpoints use path-style (/bucket/key). We
  // previously emitted virtual-host links regardless of endpoint shape, which broke
  // every presign under bare-endpoint configs (path_style defaults to true).
  const resource = `/${opts.bucket}/${key}`;
  const vhost = host.startsWith(`${opts.bucket}.`);
  const path = vhost ? `/${encodeKeyPath(key)}` : `/${opts.bucket}/${encodeKeyPath(key)}`;
  // Content-Type takes part in the V1 signature (unavoidable when a PUT carries object
  // metadata) — the string to sign and the request header must match verbatim; a GET
  // fetch has no body, so it is always the empty string (GET known-answer vectors unaffected).
  const signature = createHmac('sha1', opts.secretAccessKey)
    .update(`${method}\n\n${contentType}\n${expires}\n${resource}`)
    .digest('base64');
  return `https://${host}${path}?OSSAccessKeyId=${encodeURIComponent(opts.accessKeyId)}`
    + `&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
};

/** Dispatch presigning by endpoint type (the auth shape is transparent to callers). ttl only
 * applies to outbound-link semantics; inline read/write actions get short-lived tickets.
 * contentType only enters the OSS V1 string to sign (PUT metadata); a SigV4 presign URL
 * signs only the host — send Content-Type with the request; it plays no part in the signature. */
const presignFor = (opts: S3Opts, key: string, method: 'GET' | 'PUT' | 'DELETE', ttlSec: number, contentType = ''): string =>
  isOssEndpoint(opts.endpoint)
    ? ossPresignUrl(opts, key, method, ttlSec, contentType)
    : presignUrl(opts, key, method, ttlSec);

export const createS3Backend = (opts: S3Opts): ArtifactBackend => {
  const base = opts.endpoint.replace(/\/$/, '');
  // For non-OSS (S3/R2/minio) the URL shape is controlled explicitly by pathStyle; OSS
  // follows the same rules as presign: bucket-subdomain endpoints get virtual-host,
  // bare endpoints get path-style (otherwise the list URL shape is wrong on OSS).
  const hostNoScheme = base.replace(/^https?:\/\//, '');
  const objectUrl = (key: string): string =>
    isOssEndpoint(opts.endpoint) && hostNoScheme.startsWith(`${opts.bucket}.`)
      ? `${base}/${key}`
      : opts.pathStyle === false
        ? `${base}/${key}`
        : `${base}/${opts.bucket}/${key}`;
  const signed = (key: string, method: 'GET' | 'PUT' | 'DELETE', ttlSec = 300, contentType = ''): string =>
    presignFor(opts, key, method, ttlSec, contentType);
  // Put the object Content-Type into metadata: OSS does not sniff, so a PUT without it
  // is always octet-stream and browsers treat the share link as a download (verified on
  // existing objects 2026-09-30: html with no type, json octet-stream).
  // text/* and json must carry a charset — the recipient's browser decodes a bare
  // text/html as windows-1252 and turns Chinese text into mojibake (same judgment as
  // the disk fetch route).
  const storedContentType = (key: string): string => {
    const mime = guessMime(key.split('/').pop() ?? key);
    return mime.startsWith('text/') || mime === 'application/json' ? `${mime}; charset=utf-8` : mime;
  };
  const publicHost = opts.publicHost?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '';
  return {
    async put(key, bytes) {
      // Content-Type must appear in both the OSS V1 string to sign and the request header, byte-identical (signed already includes it).
      const contentType = storedContentType(key);
      return toResult((async () => {
        const res = await fetch(signed(key, 'PUT', 300, contentType), {
          method: 'PUT', body: new Uint8Array(bytes), headers: { 'content-type': contentType },
        });
        if (!res.ok) throw new Error(`s3 put http ${res.status}: ${sanitizeErrorBody(await res.text(), opts.accessKeyId)}`);
      })(), 's3 put failed');
    },
    async get(key) {
      return toResult((async () => {
        const res = await fetch(signed(key, 'GET'));
        if (!res.ok) throw new Error(`s3 get http ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      })(), 's3 get failed');
    },
    async delete(key) {
      return toResult((async () => {
        const res = await fetch(signed(key, 'DELETE'), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error(`s3 delete http ${res.status}`);
      })(), 's3 delete failed');
    },
    async list(prefix) {
      // Known limitation: anonymous ListObjects, only usable on public buckets — a 403 on
      // a private bucket is swallowed into [] (silently empty). No production caller
      // today (the ledger list goes through the DB); before enabling, switch to
      // presigned ListObjects (SigV4 requires list-type/prefix in the string to sign;
      // OSS V1 sub-resource rules need separate verification).
      try {
        const res = await fetch(`${objectUrl('')}?list-type=2&prefix=${encodeURIComponent(prefix)}`);
        if (!res.ok) return [];
        const xml = await res.text();
        return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1] ?? '').filter(Boolean);
      } catch {
        return [];
      }
    },
    async url(key, ttlSec = 3600) {
      let out = presignFor(opts, key, 'GET', ttlSec);
      // Public share-host rewrite (OSS V1 only): the signature covers only the resource
      // path, so the link stays valid after the domain rewrite — a regression of the
      // same share.juliasia.cn CNAME setup from the Go makro era. SigV4 signs the host; rewriting breaks it.
      if (publicHost !== '' && isOssEndpoint(opts.endpoint)) {
        out = out.replace(`https://${hostNoScheme}`, `https://${publicHost}`);
      }
      return ok(out);
    },
  };
};

// ---- Dual backend (disk primary + S3/OSS remote) ---------------------------------------------
// Discipline: disk always keeps a shadow copy (local reads need zero network; remote
// flakiness never hurts the pipeline); the remote carries outbound-link presigns; url()
// lazily backfills existing bytes — old artifacts reach the remote automatically on
// their first share, no migration script needed.

export const createDualBackend = (primary: ArtifactBackend, remote: ArtifactBackend): ArtifactBackend => ({
  async put(key, bytes) {
    const local = await primary.put(key, bytes);
    if (!local.ok) return local;
    const up = await remote.put(key, bytes);
    if (!up.ok) console.error(`[artifacts] remote put failed (disk copy landed, remote link unavailable): ${up.error.message}`);
    return local;
  },
  async get(key) {
    const local = await primary.get(key);
    if (local.ok) return local;
    return remote.get(key);
  },
  async delete(key) {
    // Remote delete failures are no longer silent: log first, then fold the remote error
    // into the return value — otherwise the purge route only sees the primary result and
    // still returns purged=N while the bytes linger on OSS forever.
    const up = await remote.delete(key);
    if (!up.ok) console.error(`[artifacts] remote delete failed (bytes may remain on remote): ${up.error.message}`);
    const local = await primary.delete(key);
    if (!local.ok) return local;
    return up.ok ? local : err(new Error(`remote delete failed: ${up.error.message}`));
  },
  async list(prefix) {
    const seen = new Set(await primary.list(prefix));
    for (const k of await remote.list(prefix)) seen.add(k);
    return [...seen];
  },
  async url(key, ttlSec = 3600) {
    const local = await primary.get(key);
    if (local.ok) {
      // Lazy backfill: when the remote is missing bytes, upload them from the primary
      // store first. A failed backfill = no bytes on the remote, so the outbound link is
      // certainly dead (presign is a pure local computation and always succeeds) — return
      // err so the upstream (share) takes the failed branch: retryable, no share_url
      // memoization, and never bake a dead link into meta.
      const up = await remote.put(key, local.value);
      if (!up.ok) {
        console.error(`[artifacts] remote lazy-backfill failed: ${up.error.message}`);
        return err(new Error(`remote backfill failed: ${up.error.message}`));
      }
      return remote.url(key, ttlSec);
    }
    // No bytes in the primary store: hand out a link only when the remote confirms it
    // has the bytes; none on either side = dead link, also return err.
    const has = await remote.get(key);
    if (!has.ok) return err(new Error(`no bytes at either backend for key ${key.slice(0, 100)}`));
    return remote.url(key, ttlSec);
  },
});

/** SigV4 presign shape assertion — only valid for AWS SigV4 URLs; not for OSS V1 links
 * (the OSSAccessKeyId/Expires/Signature triple); do not use it to judge OSS distribution links. */
export const assertSigV4PresignShape = (url: string): boolean =>
  url.includes('X-Amz-Signature=') && url.includes('X-Amz-Credential=');
export { err };
