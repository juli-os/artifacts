// 工件账本（对应 Go lifecycle artifacts 表 + case-inbox 扫描）：行不可变——
// 仅 storage 晋升与 deleted_at（墓碑）两个单向转变，从不 DELETE。字节侧经
// Backend 端口（disk/S3），账本只记事实。

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

/** 交付物的渲染角色（meta.view_role）：agent 申报单（reply.json）声明，
 * 引擎核验后盖章。body=将发出的原文（原样渲染，绝不美化）；report=给人
 * 审的中间态（iframe 渲染）；data=结构化数据；attachment=随信附件（web
 * 端按 report 同路渲染；发送侧判定是 view_role!=='body'，天然随信附上）。 */
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
  /** 按 id 取登记行（含哈希与 key；发送步取件的唯一入口）。 */
  get(id: string): ArtifactRow | null;
  updateMeta(id: string, patch: JsonRecord): void;
  tombstone(id: string): void;
  /** 字节上传 + 登记（disk-primary：上传失败落 pending 标记，不抛）。 */
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

/** 文件名→MIME 词表（账本登记与字节侧 PUT 元数据共用，单一事实源）。 */
export const guessMime = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    html: 'text/html', htm: 'text/html', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', pdf: 'application/pdf',
    json: 'application/json', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    // Office 家族：iOS QuickLook 按 MIME 判预览，缺了就是「octet-stream 暂不支持」
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

/** 申报单（reply.json / manifest.json）——agent 对自己交付物的声明。
 * 注意：这是待核验的申报，不是事实——文件在不在、哈希是什么、body 是谁
 * 全由 sweep 核验后决定；信封地址类字段引擎结构性无视（to 只认 meta.from）。 */
export interface DeliverableDecl {
  readonly file: string;
  readonly role: string;
  readonly summary: string;
}

export interface SweepEnvelope {
  readonly in_reply_to_hint: string;
  readonly feedback_refs: readonly string[];
}

/** 交付物指针（sweep 收编后的形态；step output.deliverables 的元素类型）。
 * 引擎、端口与账本共用的唯一声明——多处独立手写形状曾各自漂移。 */
export interface DeliverableRef {
  readonly id: string;
  readonly name: string;
  readonly view_role: ViewRole;
  readonly sha256: string;
  readonly bytes: number;
  readonly summary: string;
}

/** JSON 宽容判型：是 sweep 产出的交付物指针（id/sha256/name 齐备）。 */
export const isDeliverableRef = (v: unknown): v is DeliverableRef =>
  v !== null && typeof v === 'object' &&
  typeof (v as DeliverableRef).id === 'string' &&
  typeof (v as DeliverableRef).sha256 === 'string' &&
  typeof (v as DeliverableRef).name === 'string';

/** 信封（申报单 envelope）宽容判型：异形返回 null。申报单是待核验的
 * 申报不是事实——解析只做形状收窄，语义核验在 sweep。 */
export const parseEnvelope = (v: unknown): SweepEnvelope | null => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const env = v as { in_reply_to_hint?: unknown; feedback_refs?: unknown };
  return {
    in_reply_to_hint: typeof env.in_reply_to_hint === 'string' ? env.in_reply_to_hint : '',
    feedback_refs: Array.isArray(env.feedback_refs)
      ? env.feedback_refs.filter((x): x is string => typeof x === 'string') : [],
  };
};

/** sweep 结果：登记后的交付物指针（step output.deliverables 的数据源）。 */
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

/** 数据岛 JSON 转 <script> 安全形（`</script>` 注入面收口）。 */
const islandJson = (v: Record<string, string>): string =>
  JSON.stringify(v).replace(/</g, '\\u003c');

/** 引擎兜底结果页：sweep 收编后发现无 HTML 主交付物时，把最佳文本交付物
 * （body 优先）包成自包含 HTML——详情页不再渲染无意义的 txt 墙
 * （wf_9658ce9225e0，2026-10-05 用户裁定：结果 artifact 本来就该是 html）。
 * 兜底身份显性化：页眉注明 + 数据岛 generated_by=engine-fallback。 */
const fallbackResultHtml = (workflowId: string, sourceName: string, text: string): string =>
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  `<title>结果工件 · ${escapeHtml(workflowId)}</title>` +
  '<style>:root{color-scheme:light dark}body{margin:0;padding:24px;background:#f7f7f8;color:#1c1c1e;' +
  'font:15px/1.75 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}' +
  'main{max-width:760px;margin:0 auto}header{border-bottom:1px solid #d9d9de;padding-bottom:12px;margin-bottom:20px}' +
  'h1{font-size:17px;margin:0 0 6px}.note{font-size:12.5px;color:#6e6e73;margin:0}' +
  'pre{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e3e3e8;border-radius:10px;padding:18px;margin:0}' +
  '@media(prefers-color-scheme:dark){body{background:#161618;color:#f2f2f7}pre{background:#232326;border-color:#323236}}</style>' +
  '</head><body><main>' +
  '<header><h1>结果工件 · 引擎兜底视图</h1>' +
  `<p class="note">agent 未交付 HTML 主工件（makro-artifacts 单一 HTML 契约），引擎已将 ${escapeHtml(sourceName)} 内容包成可渲染视图。</p></header>` +
  `<pre>${escapeHtml(text)}</pre>` +
  '</main><script type="application/json" id="makro-meta">' +
  islandJson({ workflow_id: workflowId, generated_by: 'engine-fallback', source_file: sourceName }) +
  '</script></body></html>';

/** case-inbox 收编（对齐 Go collectCaseInbox 并升级为契约入口）：
 * ① 申报单先读（声明 view_role/摘要/信封提示）；
 * ② 逐文件登记（哈希入账，meta 盖 view_role）——body 角色唯一，多重申报
 *    全部降级 report 并记 warning（发送步只见唯一 body，契约违规显式暴露）；
 * ③ 登记成功即从 inbox 删除文件——工件库拥有字节后，inbox 回到空位，
 *    同名再交付自然形成新版本（seq+1），而不是重复登记；
 * ④ HTML 兜底——交付物里没有 HTML 时引擎合成 result.html（见
 *    fallbackResultHtml），count=entries.length（含兜底件）。 */
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
    } catch { /* 竞态消失 */ }
  }
  // ① 申报单：只认 inbox 里的第一份合法 JSON；畸形 JSON = 无申报单处理。
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
      deps.log?.(`case-inbox manifest 解析失败: ${String(e)}`);
    }
    break; // 只认第一份命中的申报单名
  }
  // ② body 唯一性核验：多重 body 申报整体降级。
  const warnings: string[] = [];
  const bodyFiles = decls.filter((d) => d.role === 'body');
  if (bodyFiles.length > 1) {
    warnings.push(`申报了 ${bodyFiles.length} 个 body（${bodyFiles.map((d) => d.file).join(', ')}）——全部降级 report，发送步将拒发`);
  }
  const declOf = new Map(decls.map((d) => [d.file, d]));
  const entries: SweepResult['entries'][number][] = [];
  // HTML 兜底线索（2026-10-05 wf_9658ce9225e0）：sweep 里没有 HTML 交付物时，
  // 引擎把最佳文本交付物包成 result.html——结果工件恒为可渲染的 HTML，
  // 不再依赖 agent 的契约纪律（宪法：引擎负责查，人只裁断）。
  let hasHtml = false;
  let bodySrc: { name: string; viewRole: ViewRole; bytes: Buffer } | null = null;
  let textSrc: { name: string; viewRole: ViewRole; bytes: Buffer } | null = null;
  for (const name of files) {
    const p = join(deps.inboxDir, name);
    if (MANIFEST_NAMES.includes(name as (typeof MANIFEST_NAMES)[number])) {
      // 申报单本身不入交付物列表（它不是给人审的产物），登记后同样收编删除。
      try {
        await deps.ledger.putAndRegister({
          workflowId: deps.workflowId, role: 'agent_output', name,
          bytes: Buffer.from(await readFile(p)), stepId: deps.stepId,
          meta: { view_role: 'data', manifest: true },
        });
        await unlink(p);
      } catch (e) {
        deps.log?.(`case-inbox manifest 收编失败: ${String(e)}`);
      }
      continue;
    }
    try {
      const bytes = await readFile(p);
      const decl = declOf.get(name);
      let viewRole: ViewRole = 'report'; // 无申报 = 默认 report；body 必须显式申报
      let summary = '';
      if (decl) {
        summary = typeof decl.summary === 'string' ? decl.summary : '';
        const claimed = decl.role;
        if (VIEW_ROLES.includes(claimed as ViewRole)) {
          viewRole = claimed as ViewRole;
          if (viewRole === 'body' && bodyFiles.length > 1) viewRole = 'report';
        } else if (claimed !== '') {
          warnings.push(`${name}: 未知 role "${claimed}"，按 report 处理`);
        }
      }
      const row = await deps.ledger.putAndRegister({
        workflowId: deps.workflowId, role: 'agent_output', name, bytes,
        stepId: deps.stepId, meta: { view_role: viewRole, ...(summary !== '' ? { summary } : {}) },
      });
      await unlink(p); // ③ 所有权转移：登记即收编，inbox 回空
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
  // ④ HTML 兜底：无 HTML 交付物且有文本可包时合成 result.html（view_role=
  // report，不随信出门；纯非文本交付如图片原生可渲染，不强行包壳）。
  // 十四跑 R1（P2-6）：先查工件库——多步单步 1 已交真 HTML 时，步 2 的
  // sweep 不再合成冗余兜底件（版本链+1、警告误报）。只认非兜底件
  // （generated!=engine_fallback），排除本引擎自己先前合成的兜底；墓碑
  // （已删真 HTML）不算在场。list 默认剔墓碑。
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
      bytes: row.bytes, summary: `引擎兜底：${src.name} 的 HTML 视图`,
    });
    warnings.push(`无 HTML 主交付物（makro-artifacts 单一 HTML 契约）——引擎已将 ${src.name} 包成兜底 result.html`);
    deps.log?.(`case-inbox HTML 兜底：${deps.workflowId} 合成 result.html（源 ${src.name}）`);
  }
  return { count: entries.length, entries, envelope, warnings, has_manifest: hasManifest };
};
