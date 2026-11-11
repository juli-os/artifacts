[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / createArtifactLedger

# Function: createArtifactLedger()

> **createArtifactLedger**(`db`, `backend`, `deps?`): [`ArtifactLedger`](../interfaces/ArtifactLedger.md)

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:124](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L124)

文件名→MIME 词表（账本登记与字节侧 PUT 元数据共用，单一事实源）。

## Parameters

### db

`DatabaseSync`

### backend

[`ArtifactBackend`](../interfaces/ArtifactBackend.md) \| `null`

### deps?

#### clock?

`Clock`

#### ids?

`IdGen`

## Returns

[`ArtifactLedger`](../interfaces/ArtifactLedger.md)
