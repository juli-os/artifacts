[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / ArtifactBackend

# Interface: ArtifactBackend

Defined in: [artifacts/store.ts:10](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L10)

## Methods

### delete()

> **delete**(`key`): `Promise`\<[`Result`](../type-aliases/Result.md)\<`void`, `Error`\>\>

Defined in: [artifacts/store.ts:13](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L13)

#### Parameters

##### key

`string`

#### Returns

`Promise`\<[`Result`](../type-aliases/Result.md)\<`void`, `Error`\>\>

***

### get()

> **get**(`key`): `Promise`\<[`Result`](../type-aliases/Result.md)\<`Buffer`\<`ArrayBufferLike`\>, `Error`\>\>

Defined in: [artifacts/store.ts:12](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L12)

#### Parameters

##### key

`string`

#### Returns

`Promise`\<[`Result`](../type-aliases/Result.md)\<`Buffer`\<`ArrayBufferLike`\>, `Error`\>\>

***

### list()

> **list**(`prefix`): `Promise`\<readonly `string`[]\>

Defined in: [artifacts/store.ts:14](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L14)

#### Parameters

##### prefix

`string`

#### Returns

`Promise`\<readonly `string`[]\>

***

### put()

> **put**(`key`, `bytes`): `Promise`\<[`Result`](../type-aliases/Result.md)\<`void`, `Error`\>\>

Defined in: [artifacts/store.ts:11](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L11)

#### Parameters

##### key

`string`

##### bytes

`Buffer`

#### Returns

`Promise`\<[`Result`](../type-aliases/Result.md)\<`void`, `Error`\>\>

***

### url()

> **url**(`key`, `ttlSec?`): `Promise`\<[`Result`](../type-aliases/Result.md)\<`string`, `Error`\>\>

Defined in: [artifacts/store.ts:16](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L16)

生成可访问 URL：disk = 本地 API 路径；S3 = presigned GET。

#### Parameters

##### key

`string`

##### ttlSec?

`number`

#### Returns

`Promise`\<[`Result`](../type-aliases/Result.md)\<`string`, `Error`\>\>
