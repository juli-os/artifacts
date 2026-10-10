// Result/Either: the functional channel for expected errors. Port boundaries
// (network/disk/parsing) always return Result so errors become part of the type;
// programmatic bugs still throw.

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Turn a Promise into a Result — the single funnel for async ports. */
export const toResult = async <T>(p: Promise<T>, message = 'operation failed'): Promise<Result<T, Error>> => {
  try {
    return ok(await p);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(`${message}: ${String(e)}`));
  }
};
