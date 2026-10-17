// Round-1 回归测试:只锁已修缺陷的形状,不测正常路径(smoke.test.ts 的职责)。
// 纪律:SigV4 已知向量用注入时钟 + 手写 amzDate(不经 toISOString 推导),
// 双 Z 或"签名串用坏日期"任一回归都会与期望 URL 失配。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  createDiskBackend, createS3Backend, createArtifactLedger,
} from '../src/index.ts';

// ---- P0: SigV4 amzDate 单 Z + 签名串用修正后的值 --------------------------------------

test('sigv4 presign: X-Amz-Date is YYYYMMDDTHHMMSSZ (no doubled Z), signature computed over it', async () => {
  const fixed = new Date('2026-01-02T03:04:05.678Z');
  const backend = createS3Backend({
    endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'bkt',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI', now: () => fixed,
  });
  const r = await backend.url('a/b.txt', 600);
  assert.ok(r.ok, 'presign url must resolve');
  const url = r.value;

  // 形状:恰好一个尾随 Z(修复前是 ...T030405ZZ)。
  assert.match(url, /X-Amz-Date=20260102T030405Z&/, 'amzDate must be 20260102T030405Z');
  assert.ok(!url.includes('ZZ'), 'no doubled Z anywhere in the URL');
  assert.match(url, /X-Amz-Date=\d{8}T\d{6}Z&/);

  // 已知向量:期望 URL 完全独立手算——amzDate 字面量单 Z,签名串(含
  // stringToSign 的第二行)也用它;实现若用坏日期签名或坏日期出链,全串必不匹配。
  const amzDate = '20260102T030405Z'; // 手写,不从 toISOString 推导
  const dateStamp = '20260102';
  const scope = `${dateStamp}/us-east-1/s3/aws4_request`;
  const host = 's3.example.com';
  const canonicalUri = '/bkt/a/b.txt';
  const q = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `AKIDEXAMPLE/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '600',
    'X-Amz-SignedHeaders': 'host',
  });
  const canonicalRequest = ['GET', canonicalUri, q.toString(), `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const shaHex = (d: string) => createHash('sha256').update(d).digest('hex');
  const hmac = (k: string | Buffer, d: string) => createHmac('sha256', k).update(d).digest();
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, shaHex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4wJalrXUtnFEMI', dateStamp), 'us-east-1'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  assert.equal(url, `https://${host}${canonicalUri}?${q.toString()}&X-Amz-Signature=${signature}`);
});

test('sigv4 canonical URI: sub-delims !\'()* are percent-encoded (RFC3986 strict)', async () => {
  const backend = createS3Backend({
    endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'bkt',
    accessKeyId: 'AK', secretAccessKey: 'SK', now: () => new Date('2026-01-02T03:04:05Z'),
  });
  const r = await backend.url("weird !'()*key.txt", 60);
  assert.ok(r.ok);
  assert.ok(r.value.includes('%21%27%28%29%2A'), `expected strict encoding in ${r.value}`);
});

// ---- P1: disk list containment ---------------------------------------------------------

test('disk list: traversal prefix must not escape root or leak sibling dirs', async () => {
  const base = mkdtempSync(join(tmpdir(), 'peel-reg-'));
  try {
    const root = join(base, 'store');
    mkdirSync(join(base, 'secret'), { recursive: true });
    writeFileSync(join(base, 'secret', 'creds.txt'), 'top-secret');
    const backend = createDiskBackend(root);
    await backend.put('cases/wf1/report.md', Buffer.from('x'));

    // 正常路径不受影响:键恒为根相对形(walk 从 prefix 起步但不去前缀)。
    assert.deepEqual(await backend.list(''), ['cases/wf1/report.md']);
    assert.deepEqual(await backend.list('cases'), ['cases/wf1/report.md']);

    // 逃逸:此前 '../secret' 会列出兄弟目录并返回带根外前缀的坏键。
    assert.deepEqual(await backend.list('../secret'), []);
    assert.deepEqual(await backend.list('..'), []);
    assert.deepEqual(await backend.list('../../'), []);
    assert.deepEqual(await backend.list('/etc'), []); // 绝对路径指外同理拒绝
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ---- P2: putAndRegister 走注入时钟 -----------------------------------------------------

test('putAndRegister: key timestamp comes from the injected clock, not Date.now()', async () => {
  const base = mkdtempSync(join(tmpdir(), 'peel-reg-clock-'));
  try {
    const backend = createDiskBackend(join(base, 'store'));
    const fixedMs = Date.UTC(2020, 0, 2, 3, 4, 5); // 与真实墙钟必然不同的可判值
    let n = 0;
    const ledger = createArtifactLedger(new DatabaseSync(join(base, 'a.db')), backend, {
      clock: { now: () => new Date(fixedMs) },
      ids: { newId: (p: string) => `${p}_${++n}` },
    });
    const row = await ledger.putAndRegister({
      workflowId: 'wf_clock', role: 'body', name: 'a.txt', bytes: Buffer.from('x'),
    });
    assert.equal(row.key, `cases/wf_clock/body/${fixedMs}-a.txt`);
    assert.ok((await backend.get(row.key)).ok, 'bytes landed at the clock-derived key');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ---- P2: put() 父目录推导用 dirname ----------------------------------------------------

test('disk put: literal backslash in key must not mint a spurious parent dir', async () => {
  const base = mkdtempSync(join(tmpdir(), 'peel-reg-bs-'));
  try {
    const root = join(base, 'store');
    const backend = createDiskBackend(root);
    await backend.put('sub\\file.txt', Buffer.from('backslash-name')); // POSIX 文件名含字面 \
    const g = await backend.get('sub\\file.txt');
    assert.ok(g.ok && (g as { ok: true; value: Buffer }).value.toString() === 'backslash-name');
    // 修复前正则按 \ 截尾,会 mkdir <root>/sub(凭空多出的目录)。
    assert.throws(() => statSync(join(root, 'sub')), { code: 'ENOENT' });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
