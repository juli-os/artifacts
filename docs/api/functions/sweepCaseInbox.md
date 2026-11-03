[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / sweepCaseInbox

# Function: sweepCaseInbox()

> **sweepCaseInbox**(`deps`): `Promise`\<[`SweepResult`](../interfaces/SweepResult.md)\>

Defined in: [artifacts/ledger.ts:274](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L274)

case-inbox 收编（对齐 Go collectCaseInbox 并升级为契约入口）：
① 申报单先读（声明 view_role/摘要/信封提示）；
② 逐文件登记（哈希入账，meta 盖 view_role）——body 角色唯一，多重申报
   全部降级 report 并记 warning（发送步只见唯一 body，契约违规显式暴露）；
③ 登记成功即从 inbox 删除文件——工件库拥有字节后，inbox 回到空位，
   同名再交付自然形成新版本（seq+1），而不是重复登记；
④ HTML 兜底——交付物里没有 HTML 时引擎合成 result.html（见
   fallbackResultHtml），count=entries.length（含兜底件）。

## Parameters

### deps

#### inboxDir

`string`

#### ledger

[`ArtifactLedger`](../interfaces/ArtifactLedger.md)

#### log?

(`m`) => `void`

#### stepId?

`string`

#### workflowId

`string`

## Returns

`Promise`\<[`SweepResult`](../interfaces/SweepResult.md)\>
