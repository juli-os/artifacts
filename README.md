# @juli-os/artifacts — L2 Artifacts Layer (peel validation slice)

The L2 layer of the juli-os ladder: **hash-registered deliverables with provenance**. Content stays schema-free; the registration ledger is the only structure. Zero npm dependencies — the disk backend works out of the box, and S3-compatible presign is hand-rolled (no SDK).

## What's inside

| Capability | API | What it gives you |
|---|---|---|
| Backends | `createDiskBackend(root)` / `createS3Backend(opts)` / `createDualBackend(primary, remote)` | Pluggable storage with traversal protection on the disk backend |
| Registration ledger | `createArtifactLedger(db, backend)` → `putAndRegister / register / get / list / tombstone / updateMeta` | Every deliverable lands with sha256, role, name, mime, bytes, key — immutable once registered |
| Tamper evidence | register → later recompute | Content that no longer matches its registered hash is detectable immediately |
| Envelope parsing | `parseEnvelope / isDeliverableRef` | Typed deliverable references inside agent outputs |
| Case inbox sweep | `sweepCaseInbox` | Collect and register deliverables from a working directory |

## Peel boundary

Files are copied **verbatim** from the juli monorepo (import paths unchanged):

| File | Origin |
|---|---|
| `src/platform/artifacts/{ledger,store}.ts` | `src/platform/artifacts/` |
| `src/platform/shared/{json,result,clock}.ts` | `src/platform/shared/` |

Dependency rule: artifacts → shared, strictly downward. Consumers may only import the facade `src/index.ts`.

## Quick start — no install step

Requires Node ≥ 22.18 (built-in type stripping + `node:sqlite`).

```bash
node bin/juli-artifacts.ts demo /tmp/demo-artifacts    # seed 3 artifacts
node bin/juli-artifacts.ts ls /tmp/demo-artifacts       # list registrations
node bin/juli-artifacts.ts verify /tmp/demo-artifacts   # recompute hashes vs registrations
```

Or from code:

```ts
import { createDiskBackend, createArtifactLedger } from '@juli-os/artifacts';
import { DatabaseSync } from 'node:sqlite';

const backend = createDiskBackend('./store');
const ledger = createArtifactLedger(new DatabaseSync('./artifacts.db'), backend);
const row = await ledger.putAndRegister({
  workflowId: 'wf_1', role: 'body', name: 'summary.md',
  bytes: Buffer.from('# Hello\n'), mime: 'text/markdown',
});
// row.sha256 is now the receipt for those exact bytes
```

Run the test suite (zero npm install):

```bash
node --test "test/*.test.ts"
```

## This is a validation slice

Second empirical test of the **"layers you can peel off"** hypothesis (adopt at your altitude). Verified green on macOS node 22 and a bare Linux box on node 24 — including tamper-detection: mutate the stored bytes and `verify` fails loudly.

## License

Apache-2.0
