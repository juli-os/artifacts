// 工件字节侧（对应 Go internal/infra/storage）：Backend 端口 + disk/S3 双实现。
// S3 presign 用 AWS SigV4 手签（零 SDK 依赖，R2/OSS/minio 兼容 path-style）。

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
  /** 生成可访问 URL：disk = 本地 API 路径；S3 = presigned GET。 */
  url(key: string, ttlSec?: number): Promise<Result<string, Error>>;
}

// ---- Disk 后端 ------------------------------------------------------------------

/** containment：解析后的路径必须落在 rootDir 内，穿越键（../、绝对路径指外）
 * 一律拒绝——key 来自账本/HTTP 参数，绝不能当文件系统信任输入。 */
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

// ---- S3 兼容后端（SigV4 presign）---------------------------------------------------

export interface S3Opts {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly pathStyle?: boolean;
  /** 公网分享域(如 share.juliasia.cn,CNAME 指向桶):仅对 OSS V1 出链改写——
   * V1 签名只覆盖资源路径不覆盖域名,改写后链仍有效;SigV4 签 host,改写即废,
   * 配了也忽略。空 = 不改写出端点原域。 */
  readonly publicHost?: string;
  /** 测试注入点:预签时钟(缺省系统时钟)——签名已知向量(known-answer)测试的前提。 */
  readonly now?: () => Date;
}

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const shaHex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** key 的 URL 编码:逐段 encodeURIComponent(保留 /)——key 来自文件名
 * (case-inbox readdir,agent/用户可控),可含 ?、#、空格、字面 %;裸拼会被
 * 当 URL 结构截断,并与签名串失配(SignatureDoesNotMatch/404)。 */
const encodeKeyPath = (key: string): string =>
  key.split('/').map(encodeURIComponent).join('/');

/** S3/OSS 错误体瘦身:只提取 <Code>/<Message>(错误 XML 含 AK ID、内部端点,
 * 不整段入日志);非 XML 时掩码 accessKeyId 后截断。 */
const sanitizeErrorBody = (body: string, accessKeyId: string): string => {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  const msg = /<Message>([^<]+)<\/Message>/.exec(body)?.[1];
  if (code !== undefined || msg !== undefined) return [code, msg].filter((x) => x !== undefined).join(': ');
  // accessKeyId 为空串时 split('') 会按字符退化掩码——用必不出现的 \u0000 兜底。
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

// ---- OSS 原生 V1 presign ----------------------------------------------------------
// 阿里云 OSS 不认 AWS SigV4 query 鉴权（实测恒 400 AuthorizationQueryParametersError，
// 报错话术误导性地指向日期格式）——.aliyuncs.com 端点必须走 V1：签名串
// "VERB\n\n\nExpires\n/bucket/key"，URL 用 virtual-host 路径 /key。真 S3/R2/MinIO 仍走 SigV4。

const isOssEndpoint = (endpoint: string): boolean => /\.aliyuncs\.com(?::\d+)?\/?$/.test(endpoint);

const ossPresignUrl = (opts: S3Opts, key: string, method: 'GET' | 'PUT' | 'DELETE', ttlSec: number, contentType = ''): string => {
  const host = opts.endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const expires = Math.floor((opts.now?.() ?? new Date()).getTime() / 1000) + ttlSec;
  // 签名 resource 恒为 /bucket/key 且用未编码原始 key——服务端对请求路径解码
  // 后核对;请求 URL 形态随端点自适应:桶子域端点(host 以 `${bucket}.` 开头)
  // 走 virtual-host(/key),裸区域端点走 path-style(/bucket/key)。此前无视
  // 端点形态按 virtual-host 出链,裸端点配置(path_style 默认 true)预签全挂。
  const resource = `/${opts.bucket}/${key}`;
  const vhost = host.startsWith(`${opts.bucket}.`);
  const path = vhost ? `/${encodeKeyPath(key)}` : `/${opts.bucket}/${encodeKeyPath(key)}`;
  // Content-Type 参与 V1 签名(带 PUT 对象元数据的必经面)——签名串与请求头必须
  // 逐字一致;GET 取件无 body,恒空串(GET 已知向量不受影响)。
  const signature = createHmac('sha1', opts.secretAccessKey)
    .update(`${method}\n\n${contentType}\n${expires}\n${resource}`)
    .digest('base64');
  return `https://${host}${path}?OSSAccessKeyId=${encodeURIComponent(opts.accessKeyId)}`
    + `&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
};

/** 按端点类型分发预签（鉴权形状对调用方透明）。ttl 仅对外链语义；读写内联动作给短票。
 * contentType 仅进 OSS V1 签名串（PUT 元数据）；SigV4 预签 URL 只签 host，
 * Content-Type 随请求发即可、不参与签名。 */
const presignFor = (opts: S3Opts, key: string, method: 'GET' | 'PUT' | 'DELETE', ttlSec: number, contentType = ''): string =>
  isOssEndpoint(opts.endpoint)
    ? ossPresignUrl(opts, key, method, ttlSec, contentType)
    : presignUrl(opts, key, method, ttlSec);

export const createS3Backend = (opts: S3Opts): ArtifactBackend => {
  const base = opts.endpoint.replace(/\/$/, '');
  // 非 OSS(S3/R2/minio)URL 形态由 pathStyle 显式控制;OSS 与预签同规则:
  // 桶子域端点 virtual-host、裸端点 path-style(否则 OSS 下 list URL 形状错)。
  const hostNoScheme = base.replace(/^https?:\/\//, '');
  const objectUrl = (key: string): string =>
    isOssEndpoint(opts.endpoint) && hostNoScheme.startsWith(`${opts.bucket}.`)
      ? `${base}/${key}`
      : opts.pathStyle === false
        ? `${base}/${key}`
        : `${base}/${opts.bucket}/${key}`;
  const signed = (key: string, method: 'GET' | 'PUT' | 'DELETE', ttlSec = 300, contentType = ''): string =>
    presignFor(opts, key, method, ttlSec, contentType);
  // 对象 Content-Type 进元数据:OSS 不 sniff,PUT 不带 = 恒 octet-stream,浏览器把
  // 分享链当下载件(2026-09-30 存量对象实测:html 无类型、json octet-stream)。
  // text/* 与 json 必须带 charset——收件人浏览器对裸 text/html 按 windows-1252
  // 解码中文=乱码(与磁盘取件路由同判)。
  const storedContentType = (key: string): string => {
    const mime = guessMime(key.split('/').pop() ?? key);
    return mime.startsWith('text/') || mime === 'application/json' ? `${mime}; charset=utf-8` : mime;
  };
  const publicHost = opts.publicHost?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '';
  return {
    async put(key, bytes) {
      // Content-Type 必须同时出现在 OSS V1 签名串与请求头且逐字一致(signed 已带)。
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
      // 已知局限:匿名 ListObjects,仅公开桶可用——私有桶 403 被吞成 [](静默
      // 为空)。当前无生产调用方(账本 list 走 DB);启用前须改为预签 ListObjects
      //(SigV4 需把 list-type/prefix 纳入签名串,OSS V1 子资源规则另核)。
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
      // 公网分享域改写(仅 OSS V1):签名只覆盖资源路径,域名改写后链仍有效——
      // Go makro 时代 share.juliasia.cn CNAME 同款回归。SigV4 签 host,改写即废。
      if (publicHost !== '' && isOssEndpoint(opts.endpoint)) {
        out = out.replace(`https://${hostNoScheme}`, `https://${publicHost}`);
      }
      return ok(out);
    },
  };
};

// ---- 双后端（disk 主存 + S3/OSS 远端）---------------------------------------------
// 纪律：disk 永远留影子（本地读取零网络、远端抖动不伤管线）；远端承接外链
// presign；url() 时惰性回填存量字节——旧工件第一次分享时自动上远端，无迁移脚本。

export const createDualBackend = (primary: ArtifactBackend, remote: ArtifactBackend): ArtifactBackend => ({
  async put(key, bytes) {
    const local = await primary.put(key, bytes);
    if (!local.ok) return local;
    const up = await remote.put(key, bytes);
    if (!up.ok) console.error(`[artifacts] remote put failed (disk 已落,外链暂不可用): ${up.error.message}`);
    return local;
  },
  async get(key) {
    const local = await primary.get(key);
    if (local.ok) return local;
    return remote.get(key);
  },
  async delete(key) {
    // 远端删除失败不再静默:先记日志,并把远端错误并入返回值——否则 purge
    // 路由只看到 primary 结果,照样返回 purged=N 而字节永久残留 OSS。
    const up = await remote.delete(key);
    if (!up.ok) console.error(`[artifacts] remote delete failed (字节可能残留远端): ${up.error.message}`);
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
      // 惰性回填:远端缺字节时先从主存补传。回填失败 = 远端无字节,此时出链
      // 必死(presign 是纯本地计算恒 ok)——返回 err 让上游(share)走 failed
      // 分支:可重试、不记忆化 share_url,绝不把死链固化进 meta。
      const up = await remote.put(key, local.value);
      if (!up.ok) {
        console.error(`[artifacts] remote lazy-backfill failed: ${up.error.message}`);
        return err(new Error(`remote backfill failed: ${up.error.message}`));
      }
      return remote.url(key, ttlSec);
    }
    // 主存无字节:仅当远端确认有字节才出链,两端皆无 = 死链,同样返回 err。
    const has = await remote.get(key);
    if (!has.ok) return err(new Error(`no bytes at either backend for key ${key.slice(0, 100)}`));
    return remote.url(key, ttlSec);
  },
});

/** SigV4 预签形状断言——仅适用于 AWS SigV4 URL;OSS V1 链接(OSSAccessKeyId/
 * Expires/Signature 三参)不适用,勿用于 OSS 分发链路的判断。 */
export const assertSigV4PresignShape = (url: string): boolean =>
  url.includes('X-Amz-Signature=') && url.includes('X-Amz-Credential=');
export { err };
