[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / ArtifactBackend

# Interface: ArtifactBackend

Defined in: silo/dist/silo/store.d.ts:2

## Methods

### delete()

> **delete**(`key`): `Promise`\<`Result`\<`void`, `Error`\>\>

Defined in: silo/dist/silo/store.d.ts:5

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`Result`\<`void`, `Error`\>\>

***

### get()

> **get**(`key`): `Promise`\<`Result`\<`Buffer`\<`ArrayBufferLike`\>, `Error`\>\>

Defined in: silo/dist/silo/store.d.ts:4

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`Result`\<`Buffer`\<`ArrayBufferLike`\>, `Error`\>\>

***

### list()

> **list**(`prefix`): `Promise`\<readonly `string`[]\>

Defined in: silo/dist/silo/store.d.ts:6

#### Parameters

##### prefix

`string`

#### Returns

`Promise`\<readonly `string`[]\>

***

### put()

> **put**(`key`, `bytes`): `Promise`\<`Result`\<`void`, `Error`\>\>

Defined in: silo/dist/silo/store.d.ts:3

#### Parameters

##### key

`string`

##### bytes

`Buffer`

#### Returns

`Promise`\<`Result`\<`void`, `Error`\>\>

***

### url()

> **url**(`key`, `ttlSec?`): `Promise`\<`Result`\<`string`, `Error`\>\>

Defined in: silo/dist/silo/store.d.ts:7

#### Parameters

##### key

`string`

##### ttlSec?

`number`

#### Returns

`Promise`\<`Result`\<`string`, `Error`\>\>
