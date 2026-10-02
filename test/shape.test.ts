import { describe, expect, it } from "vitest";

import * as is from "../src/shape";

describe("shape checks", () => {
  it("checks primitives strictly", () => {
    expect([is.string("a"), is.string(1), is.string(null)]).toEqual([true, false, false]);
    expect([is.int(3), is.int(-2), is.int(1.5), is.int(Number.NaN), is.int("3"), is.int(2 ** 60)]).toEqual([
      true, true, false, false, false, false,
    ]);
    expect([is.boolean(false), is.boolean(0)]).toEqual([true, false]);
    expect([is.literal("A")("A"), is.literal("A")("a")]).toEqual([true, false]);
  });

  it("distinguishes nullable from optional", () => {
    expect([is.nullable(is.int)(null), is.nullable(is.int)(undefined)]).toEqual([true, false]);
    expect([is.optional(is.int)(undefined), is.optional(is.int)(null)]).toEqual([true, false]);
  });

  const record = is.object({ id: is.int, name: is.string, year: is.nullable(is.int), note: is.optional(is.string) });

  it("checks every field of an object, and allows fields it does not know", () => {
    expect(record({ id: 1, name: "x", year: null })).toBe(true);
    expect(record({ id: 1, name: "x", year: 1999, note: "n", extra: [1, 2] })).toBe(true);
    expect(record({ id: 1, name: "x" })).toBe(false); // year must be present, even if null
    expect(record({ id: "1", name: "x", year: null })).toBe(false);
    expect(record({ id: 1, name: "x", year: null, note: 5 })).toBe(false);
  });

  it("refuses things that are not plain objects", () => {
    for (const value of [null, undefined, 1, "x", [], [{ id: 1, name: "x", year: null }]]) expect(record(value)).toBe(false);
  });

  it("checks every element of an array and every value of a record", () => {
    expect(is.array(is.int)([1, 2, 3])).toBe(true);
    expect(is.array(is.int)([1, "2"])).toBe(false);
    expect(is.array(is.int)({ 0: 1, length: 1 })).toBe(false);
    expect(is.record(is.string)({ a: "x", b: "y" })).toBe(true);
    expect(is.record(is.string)({ a: "x", b: 2 })).toBe(false);
  });

  it("accepts a union member, and only those", () => {
    const either = is.union(is.object({ kind: is.literal("a"), n: is.int }), is.object({ kind: is.literal("b") }));
    expect([either({ kind: "a", n: 1 }), either({ kind: "b" }), either({ kind: "a" }), either({ kind: "c" })]).toEqual([
      true, true, false, false,
    ]);
  });
});
