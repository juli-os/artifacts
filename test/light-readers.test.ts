// 轻量读侧（2026-11-12 ledger 关门）行为测试：工件路由迁移到这些方法后，
// 不再拿 db 句柄直查 artifacts 表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createDiskBackend, createArtifactLedger } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'artifacts-light-'));
const store = createDiskBackend(join(dir, 's'));
const l = createArtifactLedger(new DatabaseSync(join(dir, 'a.db')), store);

test('listLight/getLight/getView：墓碑与字段形状', async () => {
  const row = await l.putAndRegister({ workflowId: 'wf1', role: 'body', name: 'x.md', bytes: Buffer.from('hi') });
  l.tombstone(row.id);
  const light = l.listLight();
  assert.equal(light.length, 1);
  assert.equal(light[0]!.key, row.key);
  assert.ok(light[0]!.deletedAt !== null, '墓碑位已置');
  const one = l.getLight(row.id);
  assert.equal(one?.workflowId, 'wf1');
  const view = l.getView(row.id);
  assert.equal(view?.name, 'x.md');
  assert.equal(l.getLight('nope'), null);
  assert.equal(l.getView('nope'), null);
  rmSync(dir, { recursive: true, force: true });
});
