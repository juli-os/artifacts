// L2 artifacts standalone smoke test: zero npm deps, `node --test`.
// The acceptance line for peel-ability: outside the full juli system,
// hash-registered deliverables remain fully usable — and tamper-evident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  createDiskBackend, createArtifactLedger, guessMime,
} from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'peel-l2-'));
mkdirSync(join(dir, 'store'));
const backend = createDiskBackend(join(dir, 'store'));
const db = new DatabaseSync(join(dir, 'artifacts.db'));
const ledger = createArtifactLedger(db, backend);

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('disk backend containment: traversal keys fail, outside world untouched', async () => {
  const r = await backend.put('../evil.txt', Buffer.from('x'));
  assert.equal(r.ok, false, 'traversal put must fail');
  const g = await backend.get('../../etc/passwd');
  assert.equal(g.ok, false, 'traversal get must fail');
});

test('put + register + get back by id, hash matches', async () => {
  const row = await ledger.putAndRegister({
    workflowId: 'wf_peel_smoke', role: 'body', name: 'report.md',
    bytes: Buffer.from('# Hello from the peeled layer\n'), mime: 'text/markdown',
  });
  const back = ledger.get(row.id);
  assert.ok(back, 'registered row readable by id');
  assert.equal(back!.sha256.length, 64);
  const fetched = await backend.get(back!.key);
  assert.ok(fetched.ok, 'content fetchable via backend by key');
  const buf = (fetched as { ok: true; value: Buffer }).value;
  assert.equal(sha(buf), back!.sha256, 'content hash matches registration');
});

test('tamper detection: mutated content no longer matches the registered hash', async () => {
  const row = await ledger.putAndRegister({
    workflowId: 'wf_peel_smoke', role: 'report', name: 'numbers.csv',
    bytes: Buffer.from('a,b\n1,2\n'),
  });
  // overwrite the stored bytes directly (simulating tampering)
  await backend.put(row.key, Buffer.from('a,b\n9,9\n'));
  const fetched = await backend.get(row.key);
  const buf = (fetched as { ok: true; value: Buffer }).value;
  assert.notEqual(sha(buf), row.sha256, 'tampered content diverges from registered hash');
});

test('list per workflow + mime guessing', () => {
  const rows = ledger.list('wf_peel_smoke');
  assert.ok(rows.length >= 2);
  assert.equal(guessMime('x.html'), 'text/html');
  assert.equal(guessMime('x.json'), 'application/json');
});

test('cleanup temp dir', () => {
  rmSync(dir, { recursive: true, force: true });
});
