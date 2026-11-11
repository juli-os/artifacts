[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / DeliverableDecl

# Interface: DeliverableDecl

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:229](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L229)

申报单（reply.json / manifest.json）——agent 对自己交付物的声明。
注意：这是待核验的申报，不是事实——文件在不在、哈希是什么、body 是谁
全由 sweep 核验后决定；信封地址类字段引擎结构性无视（to 只认 meta.from）。

## Properties

### file

> `readonly` **file**: `string`

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:230](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L230)

***

### role

> `readonly` **role**: `string`

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:231](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L231)

***

### summary

> `readonly` **summary**: `string`

Defined in: [peel-l2-artifacts/src/platform/artifacts/ledger.ts:232](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L232)
