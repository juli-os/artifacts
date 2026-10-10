// Injectable time and ID generation — the root of test determinism. The engine/store
// always take time and new IDs through these two ports; tests inject a fake
// clock/counter to assert entire flows.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface IdGen {
  newId(prefix: string): string;
}

const hex = (n: number): string =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export const randomIds: IdGen = {
  newId: (prefix: string) => `${prefix}_${hex(12)}`,
};

/** RFC3339 (second precision) — the canonical ledger timestamp format, matching the Go version. */
export const rfc3339 = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
