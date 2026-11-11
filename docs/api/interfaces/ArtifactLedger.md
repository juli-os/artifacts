[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / ArtifactLedger

# Interface: ArtifactLedger

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:63](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L63)

## Methods

### get()

> **get**(`id`): [`ArtifactRow`](ArtifactRow.md) \| `null`

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:70](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L70)

按 id 取登记行（含哈希与 key；发送步取件的唯一入口）。

#### Parameters

##### id

`string`

#### Returns

[`ArtifactRow`](ArtifactRow.md) \| `null`

***

### getLight()

> **getLight**(`id`): [`ArtifactLightRow`](ArtifactLightRow.md) \| `null`

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:84](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L84)

按 id 取分享取件所需最小行（key/墓碑位/属主单）。

#### Parameters

##### id

`string`

#### Returns

[`ArtifactLightRow`](ArtifactLightRow.md) \| `null`

***

### getView()

> **getView**(`id`): [`ArtifactViewRow`](ArtifactViewRow.md) \| `null`

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:86](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L86)

按 id 取人视图行（多 name/mime）。

#### Parameters

##### id

`string`

#### Returns

[`ArtifactViewRow`](ArtifactViewRow.md) \| `null`

***

### list()

> **list**(`workflowId`, `includeDeleted?`): readonly [`ArtifactRow`](ArtifactRow.md)[]

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:68](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L68)

#### Parameters

##### workflowId

`string`

##### includeDeleted?

`boolean`

#### Returns

readonly [`ArtifactRow`](ArtifactRow.md)[]

***

### listLight()

> **listLight**(): readonly [`ArtifactLightRow`](ArtifactLightRow.md)[]

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:82](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L82)

全量轻量行（id/key/墓碑位）——工件页过滤幽灵条目用。

#### Returns

readonly [`ArtifactLightRow`](ArtifactLightRow.md)[]

***

### putAndRegister()

> **putAndRegister**(`a`): `Promise`\<[`ArtifactRow`](ArtifactRow.md)\>

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:74](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L74)

字节上传 + 登记（disk-primary：上传失败落 pending 标记，不抛）。

#### Parameters

##### a

###### bytes

`Buffer`

###### meta?

`JsonRecord`

###### mime?

`string`

###### name

`string`

###### role

[`ArtifactRole`](../type-aliases/ArtifactRole.md)

###### stepId?

`string`

###### workflowId

`string`

#### Returns

`Promise`\<[`ArtifactRow`](ArtifactRow.md)\>

***

### register()

> **register**(`a`): [`ArtifactRow`](ArtifactRow.md)

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:64](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L64)

#### Parameters

##### a

###### bytes

`number`

###### key

`string`

###### meta?

`JsonRecord`

###### mime?

`string`

###### name

`string`

###### role

[`ArtifactRole`](../type-aliases/ArtifactRole.md)

###### sha256

`string`

###### stepId?

`string`

###### workflowId

`string`

#### Returns

[`ArtifactRow`](ArtifactRow.md)

***

### tombstone()

> **tombstone**(`id`): `void`

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:72](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L72)

#### Parameters

##### id

`string`

#### Returns

`void`

***

### updateMeta()

> **updateMeta**(`id`, `patch`): `void`

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:71](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L71)

#### Parameters

##### id

`string`

##### patch

`JsonRecord`

#### Returns

`void`
