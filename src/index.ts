// L2 artifacts layer facade — the only public surface of this layer.
// This is the COMPLETE export surface of the two source modules.
// Dependency rule: only inward deps (shared); consumers must never bypass
// this facade to reach internal files.
export {
  createDiskBackend, createS3Backend, createDualBackend,
  type ArtifactBackend, type S3Opts, assertSigV4PresignShape,
} from './platform/artifacts/store.ts';
export {
  createArtifactLedger, guessMime, parseEnvelope, isDeliverableRef, sweepCaseInbox,
  type ArtifactLedger, type ArtifactRow, type ArtifactRole, type ViewRole,
  type DeliverableDecl, type SweepEnvelope, type DeliverableRef, type SweepResult,
} from './platform/artifacts/ledger.ts';
export { ok, err, toResult, type Result } from './platform/shared/result.ts';
export { rfc3339, systemClock, randomIds, type Clock, type IdGen } from './platform/shared/clock.ts';
export { asRecord, safeParse, type JsonRecord, type JsonValue } from './platform/shared/json.ts';
