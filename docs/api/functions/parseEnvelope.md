[**@juli-os/artifacts**](../index.md)

***

[@juli-os/artifacts](../index.md) / parseEnvelope

# Function: parseEnvelope()

> **parseEnvelope**(`v`): [`SweepEnvelope`](../interfaces/SweepEnvelope.md) \| `null`

Defined in: [artifacts/ledger.ts:215](https://github.com/juli-os/artifacts/blob/main/src/platform/artifacts/ledger.ts#L215)

信封（申报单 envelope）宽容判型：异形返回 null。申报单是待核验的
申报不是事实——解析只做形状收窄，语义核验在 sweep。

## Parameters

### v

`unknown`

## Returns

[`SweepEnvelope`](../interfaces/SweepEnvelope.md) \| `null`
