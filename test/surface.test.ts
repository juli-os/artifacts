// Facade 表面快照：显式名单断言（非盲快照）——增删导出必须显式改这份名单。
// 教训：漏导出此前靠主仓 typecheck 才发现（四包合计 4+ 次 revert 记录）；
// 本测试把围栏前移到本仓 CI 红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../src/index.ts';

test('facade value-export surface matches the explicit snapshot list', () => {
  const expected = [
    // store
    'createDiskBackend', 'createS3Backend', 'createDualBackend', 'assertSigV4PresignShape',
    // ledger
    'createArtifactLedger', 'guessMime', 'parseEnvelope', 'isDeliverableRef', 'sweepCaseInbox',
    // shared（主仓也经本包消费 Result/时钟——见报告 B 跨包备案）
    'ok', 'err', 'toResult',
    'rfc3339', 'systemClock', 'randomIds',
    'asRecord', 'safeParse',
  ];
  assert.deepEqual(Object.keys(facade).sort(), [...expected].sort());
});
