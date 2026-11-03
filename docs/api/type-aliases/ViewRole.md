[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / ViewRole

# Type Alias: ViewRole

> **ViewRole** = `"body"` \| `"report"` \| `"data"` \| `"attachment"`

Defined in: [artifacts/ledger.ts:43](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L43)

交付物的渲染角色（meta.view_role）：agent 申报单（reply.json）声明，
引擎核验后盖章。body=将发出的原文（原样渲染，绝不美化）；report=给人
审的中间态（iframe 渲染）；data=结构化数据；attachment=随信附件（web
端按 report 同路渲染；发送侧判定是 view_role!=='body'，天然随信附上）。
