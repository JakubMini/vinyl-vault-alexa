/**
 * Checking the shape of JSON from Alexa and from the vault, before anything trusts it.
 *
 * Why not Zod, which the vault uses: building Zod schemas when the module loads costs about
 * 2 ms of CPU on a fast laptop and more on Cloudflare's machines, in every new isolate. That is a
 * large share of the free plan's 10 ms per request, and Alexa's sparse traffic means most
 * requests meet a new isolate. These checks are plain functions: nothing to build, nothing to
 * copy. Each is a type guard, so a value that passes is typed from then on.
 */

export type Check<T> = (value: unknown) => value is T;
export type Checked<C> = C extends Check<infer T> ? T : never;

export const string: Check<string> = (value): value is string => typeof value === "string";
export const int: Check<number> = (value): value is number => Number.isSafeInteger(value);
export const boolean: Check<boolean> = (value): value is boolean => typeof value === "boolean";

export function literal<const T extends string>(expected: T): Check<T> {
  return (value): value is T => value === expected;
}

export function nullable<T>(check: Check<T>): Check<T | null> {
  return (value): value is T | null => value === null || check(value);
}

export function optional<T>(check: Check<T>): Check<T | undefined> {
  return (value): value is T | undefined => value === undefined || check(value);
}

export function array<T>(check: Check<T>): Check<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(check);
}

/** An object whose every value passes `check`, such as Alexa's slots keyed by name. */
export function record<T>(check: Check<T>): Check<Record<string, T>> {
  return (value): value is Record<string, T> => isObject(value) && Object.values(value).every(check);
}

export function union<C extends Check<unknown>[]>(...checks: C): Check<Checked<C[number]>> {
  return (value): value is Checked<C[number]> => checks.some((check) => check(value));
}

type Fields<S extends Record<string, Check<unknown>>> = {
  [K in keyof S as undefined extends Checked<S[K]> ? never : K]: Checked<S[K]>;
} & {
  [K in keyof S as undefined extends Checked<S[K]> ? K : never]?: Checked<S[K]>;
};

/** An object with at least these fields. Other fields are allowed and left alone. */
export function object<S extends Record<string, Check<unknown>>>(fields: S): Check<Fields<S>> {
  const entries = Object.entries(fields);
  return (value): value is Fields<S> => isObject(value) && entries.every(([key, check]) => check(value[key]));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
