[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / ArtifactLedger

# Interface: ArtifactLedger

Defined in: [artifacts/ledger.ts:61](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L61)

## Methods

### get()

> **get**(`id`): [`ArtifactRow`](ArtifactRow.md) \| `null`

Defined in: [artifacts/ledger.ts:68](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L68)

按 id 取登记行（含哈希与 key；发送步取件的唯一入口）。

#### Parameters

##### id

`string`

#### Returns

[`ArtifactRow`](ArtifactRow.md) \| `null`

***

### list()

> **list**(`workflowId`, `includeDeleted?`): readonly [`ArtifactRow`](ArtifactRow.md)[]

Defined in: [artifacts/ledger.ts:66](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L66)

#### Parameters

##### workflowId

`string`

##### includeDeleted?

`boolean`

#### Returns

readonly [`ArtifactRow`](ArtifactRow.md)[]

***

### putAndRegister()

> **putAndRegister**(`a`): `Promise`\<[`ArtifactRow`](ArtifactRow.md)\>

Defined in: [artifacts/ledger.ts:72](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L72)

字节上传 + 登记（disk-primary：上传失败落 pending 标记，不抛）。

#### Parameters

##### a

###### bytes

`Buffer`

###### meta?

[`JsonRecord`](../type-aliases/JsonRecord.md)

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

Defined in: [artifacts/ledger.ts:62](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L62)

#### Parameters

##### a

###### bytes

`number`

###### key

`string`

###### meta?

[`JsonRecord`](../type-aliases/JsonRecord.md)

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

Defined in: [artifacts/ledger.ts:70](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L70)

#### Parameters

##### id

`string`

#### Returns

`void`

***

### updateMeta()

> **updateMeta**(`id`, `patch`): `void`

Defined in: [artifacts/ledger.ts:69](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L69)

#### Parameters

##### id

`string`

##### patch

[`JsonRecord`](../type-aliases/JsonRecord.md)

#### Returns

`void`
