// L2 artifacts layer facade — the only public surface of this layer.
// Dependency rule: only inward deps (shared); consumers must never bypass
// this facade to reach internal files.
export {
  createDiskBackend, createS3Backend, createDualBackend,
  type ArtifactBackend, type S3Opts,
} from './platform/artifacts/store.ts';
export { assertSigV4PresignShape } from './platform/artifacts/store.ts';
export {
  createArtifactLedger, guessMime, parseEnvelope, isDeliverableRef,
  type ArtifactLedger, type ArtifactRow, type ArtifactRole,
  type DeliverableDecl, type SweepEnvelope, type DeliverableRef, type SweepResult,
} from './platform/artifacts/ledger.ts';
export { sweepCaseInbox } from './platform/artifacts/ledger.ts';
export { ok, err, toResult, type Result } from './platform/shared/result.ts';
export { rfc3339, systemClock, randomIds, type Clock, type IdGen } from './platform/shared/clock.ts';
export { asRecord, safeParse, type JsonRecord, type JsonValue } from './platform/shared/json.ts';
