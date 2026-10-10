// Artifact ledger (counterpart of the Go lifecycle artifacts table + case-inbox scan):
// rows are immutable — only two one-way transitions, storage promotion and deleted_at
// (tombstone); never a DELETE. Bytes flow through the Backend port (disk/S3); the
// ledger records only facts.

import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { JsonRecord } from '../shared/json.ts';
import { asRecord, safeParse } from '../shared/json.ts';
import { rfc3339, type Clock, systemClock, type IdGen, randomIds } from '../shared/clock.ts';
import type { ArtifactBackend } from './store.ts';

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent_output',
  name TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  step_id TEXT,
  key TEXT NOT NULL DEFAULT '',
  meta TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifacts_wf ON artifacts(workflow_id, seq);
`;

export type ArtifactRole =
  | 'intake_attachment' | 'agent_output' | 'draft_attachment'
  | 'email_original' | 'email_attachment'
  | 'amendment' | 'send_check'
  | 'case_journey';

/** Render role of a deliverable (meta.view_role): declared in the agent's declaration
 * (reply.json) and stamped by the engine after verification. body = the outgoing text
 * (rendered verbatim, never embellished); report = an intermediate state for human
 * review (iframe rendering); data = structured data; attachment = an attachment sent
 * along with the message (the web app renders it like report; the send-side check is
 * view_role!=='body', so it is attached naturally). */
export type ViewRole = 'body' | 'report' | 'data' | 'attachment';

export interface ArtifactRow {
  readonly id: string;
  readonly workflowId: string;
  readonly role: ArtifactRole;
  readonly name: string;
  readonly seq: number;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly stepId: string;
  readonly key: string;
  readonly meta: JsonRecord;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

export interface ArtifactLedger {
  register(a: {
    workflowId: string; role: ArtifactRole; name: string; mime?: string;
    bytes: number; sha256: string; stepId?: string; key: string; meta?: JsonRecord;
  }): ArtifactRow;
  list(workflowId: string, includeDeleted?: boolean): readonly ArtifactRow[];
  /** Fetch a registered row by id (with hash and key; the single entry point for the send step's fetch). */
  get(id: string): ArtifactRow | null;
  updateMeta(id: string, patch: JsonRecord): void;
  tombstone(id: string): void;
  /** Byte upload + registration (disk-primary: on upload failure, record a pending marker instead of throwing). */
  putAndRegister(a: {
    workflowId: string; role: ArtifactRole; name: string; bytes: Buffer;
    mime?: string; stepId?: string; meta?: JsonRecord;
  }): Promise<ArtifactRow>;
}

type Row = Record<string, string | number | bigint | null | Uint8Array>;
const str = (v: string | number | bigint | null | Uint8Array | undefined): string =>
  typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
const num = (v: string | number | bigint | null | Uint8Array | undefined): number =>
  typeof v === 'number' ? v : Number(v ?? 0);

const rowTo = (r: Row): ArtifactRow => ({
  id: str(r['id']), workflowId: str(r['workflow_id']), role: str(r['role']) as ArtifactRole,
  name: str(r['name']), seq: num(r['seq']), mime: str(r['mime']), bytes: num(r['bytes']),
  sha256: str(r['sha256']), stepId: str(r['step_id']), key: str(r['key']),
  meta: asRecord(safeParse(str(r['meta']))), createdAt: str(r['created_at']),
  deletedAt: r['deleted_at'] === null ? null : str(r['deleted_at']),
});

/** Filename-to-MIME vocabulary (shared by ledger registration and byte-side PUT metadata; single source of truth). */
export const guessMime = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    html: 'text/html', htm: 'text/html', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', pdf: 'application/pdf',
    json: 'application/json', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    // Office family: iOS QuickLook picks the preview by MIME; without these it shows "octet-stream not supported"
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
  };
  return map[ext] ?? 'application/octet-stream';
};

export const createArtifactLedger = (
  db: DatabaseSync,
  backend: ArtifactBackend | null,
  deps: { clock?: Clock; ids?: IdGen } = {},
): ArtifactLedger => {
  db.exec(MIGRATIONS);
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? randomIds;
  const now = (): string => rfc3339(clock.now());

  const nextSeq = (workflowId: string, name: string): number => {
    const r = db.prepare('SELECT COALESCE(MAX(seq),0) AS s FROM artifacts WHERE workflow_id=? AND name=?')
      .get(workflowId, name);
    return num(r?.['s']) + 1;
  };

  return {
    register(a) {
      const id = ids.newId('art');
      db.prepare(`INSERT INTO artifacts (id, workflow_id, role, name, seq, mime, bytes, sha256, step_id, key, meta, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, a.workflowId, a.role, a.name, nextSeq(a.workflowId, a.name),
        a.mime ?? guessMime(a.name), a.bytes, a.sha256, a.stepId ?? null,
        a.key, JSON.stringify(a.meta ?? {}), now(),
      );
      return this.list(a.workflowId).find((x) => x.id === id)!;
    },

    list(workflowId, includeDeleted = false) {
      const rows = (db.prepare(
        `SELECT * FROM artifacts WHERE workflow_id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY seq`,
      ).all(workflowId) as Row[]).map(rowTo);
      return rows;
    },

    get(id) {
      const r = db.prepare('SELECT * FROM artifacts WHERE id=?').get(id);
      return r ? rowTo(r as Row) : null;
    },

    updateMeta(id, patch) {
      const row = db.prepare("SELECT COALESCE(meta,'{}') AS v FROM artifacts WHERE id=?").get(id);
      const cur = asRecord(safeParse(str(row?.['v'])));
      db.prepare('UPDATE artifacts SET meta=? WHERE id=?').run(JSON.stringify({ ...cur, ...patch }), id);
    },

    tombstone(id) {
      db.prepare('UPDATE artifacts SET deleted_at=? WHERE id=? AND deleted_at IS NULL').run(now(), id);
    },

    async putAndRegister(a) {
      const sha256 = createHash('sha256').update(a.bytes).digest('hex');
      const key = `cases/${a.workflowId}/${a.role}/${Date.now()}-${a.name}`;
      const row = {
        workflowId: a.workflowId, role: a.role, name: a.name,
        mime: a.mime ?? guessMime(a.name), bytes: a.bytes.length, sha256, stepId: a.stepId ?? '',
        key: '', meta: a.meta ?? {},
      };
      if (backend) {
        const put = await backend.put(key, a.bytes);
        if (put.ok) row.key = key;
        else row.meta = { ...row.meta, pending: true, upload_error: put.error.message };
      } else {
        row.meta = { ...row.meta, pending: true, upload_error: 'no backend configured' };
      }
      return this.register({ ...row, key: row.key, meta: row.meta });
    },
  };
};

/** Declaration (reply.json / manifest.json) — the agent's statement about its own deliverables.
 * Note: this is a claim awaiting verification, not a fact — whether files exist, what the
 * hashes are, and which one is the body are all decided by the sweep after verification;
 * the engine structurally ignores envelope address fields (to only honors meta.from). */
export interface DeliverableDecl {
  readonly file: string;
  readonly role: string;
  readonly summary: string;
}

export interface SweepEnvelope {
  readonly in_reply_to_hint: string;
  readonly feedback_refs: readonly string[];
}

/** Deliverable pointer (the shape after the sweep consolidates; the element type of step
 * output.deliverables). The single declaration shared by engine, ports and ledger —
 * independently hand-written shapes in multiple places used to drift apart. */
export interface DeliverableRef {
  readonly id: string;
  readonly name: string;
  readonly view_role: ViewRole;
  readonly sha256: string;
  readonly bytes: number;
  readonly summary: string;
}

/** Lenient JSON type check: is it a sweep-produced deliverable pointer (id/sha256/name all present). */
export const isDeliverableRef = (v: unknown): v is DeliverableRef =>
  v !== null && typeof v === 'object' &&
  typeof (v as DeliverableRef).id === 'string' &&
  typeof (v as DeliverableRef).sha256 === 'string' &&
  typeof (v as DeliverableRef).name === 'string';

/** Lenient type check for the (declaration) envelope: malformed shapes return null. A
 * declaration is a claim awaiting verification, not a fact — parsing only narrows the
 * shape; semantic verification happens in the sweep. */
export const parseEnvelope = (v: unknown): SweepEnvelope | null => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const env = v as { in_reply_to_hint?: unknown; feedback_refs?: unknown };
  return {
    in_reply_to_hint: typeof env.in_reply_to_hint === 'string' ? env.in_reply_to_hint : '',
    feedback_refs: Array.isArray(env.feedback_refs)
      ? env.feedback_refs.filter((x): x is string => typeof x === 'string') : [],
  };
};

/** Sweep result: registered deliverable pointers (the data source of step output.deliverables). */
export interface SweepResult {
  readonly count: number;
  readonly entries: readonly DeliverableRef[];
  readonly envelope: SweepEnvelope | null;
  readonly warnings: readonly string[];
  readonly has_manifest: boolean;
}

const MANIFEST_NAMES = ['reply.json', 'manifest.json'] as const;
const VIEW_ROLES: readonly ViewRole[] = ['body', 'report', 'data', 'attachment'];

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON for the data island in <script>-safe form (closes the `</script>` injection surface). */
const islandJson = (v: Record<string, string>): string =>
  JSON.stringify(v).replace(/</g, '\\u003c');

/** Engine fallback result page: when the sweep finds no primary HTML deliverable, wrap
 * the best text deliverable (body first) into a self-contained HTML — the detail page no
 * longer renders a meaningless wall of txt (wf_9658ce9225e0, user ruling 2026-10-05:
 * the result artifact should have been html in the first place). The fallback identity is
 * explicit: noted in the page header + data island generated_by=engine-fallback. */
const fallbackResultHtml = (workflowId: string, sourceName: string, text: string): string =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  `<title>Result artifact · ${escapeHtml(workflowId)}</title>` +
  '<style>:root{color-scheme:light dark}body{margin:0;padding:24px;background:#f7f7f8;color:#1c1c1e;' +
  'font:15px/1.75 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}' +
  'main{max-width:760px;margin:0 auto}header{border-bottom:1px solid #d9d9de;padding-bottom:12px;margin-bottom:20px}' +
  'h1{font-size:17px;margin:0 0 6px}.note{font-size:12.5px;color:#6e6e73;margin:0}' +
  'pre{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e3e3e8;border-radius:10px;padding:18px;margin:0}' +
  '@media(prefers-color-scheme:dark){body{background:#161618;color:#f2f2f7}pre{background:#232326;border-color:#323236}}</style>' +
  '</head><body><main>' +
  '<header><h1>Result artifact · engine fallback view</h1>' +
  `<p class="note">The agent did not deliver a primary HTML artifact (single-HTML contract), so the engine wrapped the contents of ${escapeHtml(sourceName)} into a renderable view.</p></header>` +
  `<pre>${escapeHtml(text)}</pre>` +
  '</main><script type="application/json" id="julios-meta">' +
  islandJson({ workflow_id: workflowId, generated_by: 'engine-fallback', source_file: sourceName }) +
  '</script></body></html>';

/** case-inbox consolidation (aligned with Go collectCaseInbox, upgraded to a contract entry point):
 * ① read the declaration first (declares view_role/summary/envelope hints);
 * ② register files one by one (hash goes into the ledger, view_role stamped into meta) —
 *    the body role is unique; multiple body declarations are all demoted to report with a
 *    warning (the send step sees a single body only, contract violations surface explicitly);
 * ③ delete each file from the inbox once registered — after the artifact store owns the
 *    bytes the inbox returns to empty; re-delivering the same name naturally forms a new
 *    version (seq+1) instead of duplicate registration;
 * ④ HTML fallback — when the deliverables contain no HTML, the engine synthesizes
 *    result.html (see fallbackResultHtml); count=entries.length (fallback included). */
export const sweepCaseInbox = async (deps: {
  inboxDir: string;
  workflowId: string;
  stepId?: string;
  ledger: ArtifactLedger;
  log?: (m: string) => void;
}): Promise<SweepResult> => {
  let names: string[] = [];
  try {
    names = await readdir(deps.inboxDir);
  } catch {
    return { count: 0, entries: [], envelope: null, warnings: [], has_manifest: false };
  }
  const files: string[] = [];
  for (const n of names) {
    try {
      if ((await stat(join(deps.inboxDir, n))).isFile()) files.push(n);
    } catch { /* vanished mid-race */ }
  }
  // ① Declaration: only the first valid JSON among inbox files counts; malformed JSON is treated as no declaration.
  let decls: DeliverableDecl[] = [];
  let envelope: SweepEnvelope | null = null;
  let hasManifest = false;
  for (const mn of MANIFEST_NAMES) {
    if (!files.includes(mn)) continue;
    hasManifest = true;
    try {
      const raw = JSON.parse(await readFile(join(deps.inboxDir, mn), 'utf8')) as unknown;
      if (raw !== null && typeof raw === 'object') {
        const rec = raw as { envelope?: unknown; deliverables?: unknown };
        if (Array.isArray(rec.deliverables)) {
          decls = rec.deliverables.filter((d): d is DeliverableDecl =>
            d !== null && typeof d === 'object' && typeof (d as DeliverableDecl).file === 'string');
        }
        if (rec.envelope !== null && typeof rec.envelope === 'object') {
          envelope = parseEnvelope(rec.envelope);
        }
      }
    } catch (e) {
      deps.log?.(`case-inbox manifest parse failed: ${String(e)}`);
    }
    break; // only the first matching declaration name counts
  }
  // ② body uniqueness check: multiple body declarations are demoted as a whole.
  const warnings: string[] = [];
  const bodyFiles = decls.filter((d) => d.role === 'body');
  if (bodyFiles.length > 1) {
    warnings.push(`declared ${bodyFiles.length} body file(s) (${bodyFiles.map((d) => d.file).join(', ')}) — all demoted to report; the send step will refuse to send`);
  }
  const declOf = new Map(decls.map((d) => [d.file, d]));
  const entries: SweepResult['entries'][number][] = [];
  // HTML fallback provenance (2026-10-05 wf_9658ce9225e0): when the sweep contains no
  // HTML deliverable, the engine wraps the best text deliverable into result.html — the
  // result artifact is always renderable HTML and no longer depends on the agent's
  // contract discipline (constitution: the engine checks, humans only rule).
  let hasHtml = false;
  let bodySrc: { name: string; viewRole: ViewRole; bytes: Buffer } | null = null;
  let textSrc: { name: string; viewRole: ViewRole; bytes: Buffer } | null = null;
  for (const name of files) {
    const p = join(deps.inboxDir, name);
    if (MANIFEST_NAMES.includes(name as (typeof MANIFEST_NAMES)[number])) {
      // The declaration itself does not enter the deliverable list (it is not an artifact
      // for human review); it is likewise consolidated (deleted) after registration.
      try {
        await deps.ledger.putAndRegister({
          workflowId: deps.workflowId, role: 'agent_output', name,
          bytes: Buffer.from(await readFile(p)), stepId: deps.stepId,
          meta: { view_role: 'data', manifest: true },
        });
        await unlink(p);
      } catch (e) {
        deps.log?.(`case-inbox manifest sweep failed: ${String(e)}`);
      }
      continue;
    }
    try {
      const bytes = await readFile(p);
      const decl = declOf.get(name);
      let viewRole: ViewRole = 'report'; // no declaration = default report; body must be declared explicitly
      let summary = '';
      if (decl) {
        summary = typeof decl.summary === 'string' ? decl.summary : '';
        const claimed = decl.role;
        if (VIEW_ROLES.includes(claimed as ViewRole)) {
          viewRole = claimed as ViewRole;
          if (viewRole === 'body' && bodyFiles.length > 1) viewRole = 'report';
        } else if (claimed !== '') {
          warnings.push(`${name}: unknown role "${claimed}", treated as report`);
        }
      }
      const row = await deps.ledger.putAndRegister({
        workflowId: deps.workflowId, role: 'agent_output', name, bytes,
        stepId: deps.stepId, meta: { view_role: viewRole, ...(summary !== '' ? { summary } : {}) },
      });
      await unlink(p); // ③ ownership transfer: to register is to consolidate; the inbox returns to empty
      entries.push({
        id: row.id, name, view_role: viewRole, sha256: row.sha256,
        bytes: row.bytes, summary,
      });
      const mime = row.mime;
      if (mime === 'text/html') hasHtml = true;
      if (mime === 'text/plain' || mime === 'text/markdown') {
        const src = { name, viewRole, bytes };
        if (viewRole === 'body') bodySrc ??= src;
        else textSrc ??= src;
      }
    } catch (e) {
      deps.log?.(`case-inbox sweep ${name}: ${String(e)}`);
    }
  }
  // ④ HTML fallback: synthesize result.html when there is no HTML deliverable but a text
  // one to wrap (view_role=report, never sent with the message; purely non-text
  // deliverables such as images render natively and are not force-wrapped).
  // Run-14 R1 (P2-6): check the artifact store first — once a multi-run's run 1 has
  // delivered real HTML, run 2's sweep no longer synthesizes a redundant fallback
  // (version chain +1, spurious warning). Only non-fallback rows count
  // (generated!=engine_fallback), excluding fallbacks this engine itself synthesized
  // earlier; tombstones (deleted real HTML) do not count as present. list drops
  // tombstones by default.
  const ledgerHasHtml = deps.ledger.list(deps.workflowId).some((row) =>
    row.mime === 'text/html' && row.meta['generated'] !== 'engine_fallback');
  const src = bodySrc ?? textSrc;
  if (entries.length > 0 && !hasHtml && !ledgerHasHtml && src !== null) {
    const html = fallbackResultHtml(deps.workflowId, src.name, src.bytes.toString('utf8'));
    const row = await deps.ledger.putAndRegister({
      workflowId: deps.workflowId, role: 'agent_output', name: 'result.html',
      bytes: Buffer.from(html), stepId: deps.stepId,
      meta: { view_role: 'report', generated: 'engine_fallback', source_file: src.name },
    });
    entries.push({
      id: row.id, name: 'result.html', view_role: 'report', sha256: row.sha256,
      bytes: row.bytes, summary: `engine fallback: HTML view of ${src.name}`,
    });
    warnings.push(`no primary HTML deliverable (single-HTML contract) — the engine wrapped ${src.name} into a fallback result.html`);
    deps.log?.(`case-inbox HTML fallback: synthesized result.html for ${deps.workflowId} (source ${src.name})`);
  }
  return { count: entries.length, entries, envelope, warnings, has_manifest: hasManifest };
};
