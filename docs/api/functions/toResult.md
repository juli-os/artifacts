[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / toResult

# Function: toResult()

> **toResult**\<`T`\>(`p`, `message?`): `Promise`\<[`Result`](../type-aliases/Result.md)\<`T`, `Error`\>\>

Defined in: [shared/result.ts:13](https://github.com/juli-os/artifacts/blob/main/src/platform/shared/result.ts#L13)

把 Promise 变成 Result——async 端口的统一收口。

## Type Parameters

### T

`T`

## Parameters

### p

`Promise`\<`T`\>

### message?

`string` = `'operation failed'`

## Returns

`Promise`\<[`Result`](../type-aliases/Result.md)\<`T`, `Error`\>\>
