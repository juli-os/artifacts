[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / S3Opts

# Interface: S3Opts

Defined in: [artifacts/store.ts:78](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L78)

## Properties

### accessKeyId

> `readonly` **accessKeyId**: `string`

Defined in: [artifacts/store.ts:82](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L82)

***

### bucket

> `readonly` **bucket**: `string`

Defined in: [artifacts/store.ts:81](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L81)

***

### endpoint

> `readonly` **endpoint**: `string`

Defined in: [artifacts/store.ts:79](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L79)

***

### now?

> `readonly` `optional` **now?**: () => `Date`

Defined in: [artifacts/store.ts:90](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L90)

测试注入点:预签时钟(缺省系统时钟)——签名已知向量(known-answer)测试的前提。

#### Returns

`Date`

***

### pathStyle?

> `readonly` `optional` **pathStyle?**: `boolean`

Defined in: [artifacts/store.ts:84](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L84)

***

### publicHost?

> `readonly` `optional` **publicHost?**: `string`

Defined in: [artifacts/store.ts:88](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L88)

公网分享域(如 share.juliasia.cn,CNAME 指向桶):仅对 OSS V1 出链改写——
V1 签名只覆盖资源路径不覆盖域名,改写后链仍有效;SigV4 签 host,改写即废,
配了也忽略。空 = 不改写出端点原域。

***

### region

> `readonly` **region**: `string`

Defined in: [artifacts/store.ts:80](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L80)

***

### secretAccessKey

> `readonly` **secretAccessKey**: `string`

Defined in: [artifacts/store.ts:83](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/store.ts#L83)
