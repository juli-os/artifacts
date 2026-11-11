// L2 artifacts layer facade — the only public surface of this layer.
// This is the COMPLETE export surface of the source modules.
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
// 0.3.0：工具出口（ok/err/toResult/Result/rfc3339/systemClock/randomIds/Clock/
// IdGen/asRecord/safeParse/JsonRecord/JsonValue）已删——事实源收编回主仓
// src/platform/shared/（juli-service-ts 2026-11-11 架构调整第 1 步）。本包
// 内部继续用 src/platform/shared/，不再对外导出。
