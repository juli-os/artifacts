[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / DeliverableDecl

# Interface: DeliverableDecl

Defined in: [artifacts/ledger.ts:184](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L184)

申报单（reply.json / manifest.json）——agent 对自己交付物的声明。
注意：这是待核验的申报，不是事实——文件在不在、哈希是什么、body 是谁
全由 sweep 核验后决定；信封地址类字段引擎结构性无视（to 只认 meta.from）。

## Properties

### file

> `readonly` **file**: `string`

Defined in: [artifacts/ledger.ts:185](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L185)

***

### role

> `readonly` **role**: `string`

Defined in: [artifacts/ledger.ts:186](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L186)

***

### summary

> `readonly` **summary**: `string`

Defined in: [artifacts/ledger.ts:187](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L187)
