import { describe, expect, it } from "vitest";

import { findRecords, mostValuable, risers, words } from "../src/collection";
import { fakeRecord } from "./fake-vault";

describe("words", () => {
  it("lowercases and drops accents, apostrophes and punctuation", () => {
    expect(words("Björk's Début!")).toEqual(["bjorks", "debut"]);
    expect(words("Simon & Garfunkel")).toEqual(["simon", "and", "garfunkel"]);
    // Letters that are not an accent on a base letter, as in Polish and Nordic names.
    expect(words("Wojciech Młynarski – Śpiewa Swoje Piosenki")).toEqual(["wojciech", "mlynarski", "spiewa", "swoje", "piosenki"]);
    expect(words("Sigur Rós, Mø, Æ")).toEqual(["sigur", "ros", "mo", "ae"]);
    expect(words("  ")).toEqual([]);
  });
});

describe("mostValuable", () => {
  it("ranks priced records by value and leaves unpriced ones out", () => {
    const records = [
      fakeRecord({ artist: "A", title: "Cheap", current_value_minor: 500 }),
      fakeRecord({ artist: "B", title: "Unpriced", current_value_minor: null }),
      fakeRecord({ artist: "C", title: "Dear", current_value_minor: 90_000 }),
      fakeRecord({ artist: "D", title: "Middling", current_value_minor: 4_000 }),
    ];
    expect(mostValuable(records, 2).map((r) => r.title)).toEqual(["Dear", "Middling"]);
    expect(mostValuable(records, 10)).toHaveLength(3);
  });
});

describe("risers", () => {
  it("ranks records by how much they gained, leaving out flat, falling and unpriced ones", () => {
    const records = [
      fakeRecord({ artist: "A", title: "Small rise", change_30d_minor: 100 }),
      fakeRecord({ artist: "B", title: "Fall", change_30d_minor: -5_000 }),
      fakeRecord({ artist: "C", title: "Big rise", change_30d_minor: 2_000 }),
      fakeRecord({ artist: "D", title: "Flat", change_30d_minor: 0 }),
      fakeRecord({ artist: "E", title: "Unpriced", current_value_minor: null }),
    ];
    expect(risers(records, 3).map((r) => r.title)).toEqual(["Big rise", "Small rise"]);
  });
});

describe("findRecords", () => {
  const collection = [
    fakeRecord({ artist: "Fleetwood Mac", title: "Rumours" }),
    fakeRecord({ artist: "Fleetwood Mac", title: "Tusk" }),
    fakeRecord({ artist: "Radiohead", title: "Kid A" }),
    fakeRecord({ artist: "Radiohead", title: "OK Computer" }),
    fakeRecord({ artist: "Nirvana (2)", title: "Nevermind" }),
    fakeRecord({ artist: "Björk", title: "Début" }),
    fakeRecord({ artist: "Pink Floyd", title: "The Dark Side Of The Moon" }),
    fakeRecord({ artist: "Simon & Garfunkel", title: "Bookends" }),
  ];
  const titles = (query: string) => findRecords(collection, query).map((r) => r.title);

  it.each([
    ["rumours", ["Rumours"]],
    ["rumours by fleetwood mac", ["Rumours"]],
    ["fleetwood mac", ["Rumours", "Tusk"]],
    ["anything by radiohead", ["Kid A", "OK Computer"]],
    ["kid a", ["Kid A"]],
    ["a copy of the dark side of the moon", ["The Dark Side Of The Moon"]],
    ["dark side of the moon", ["The Dark Side Of The Moon"]],
    ["nirvana", ["Nevermind"]],
    ["bjork", ["Début"]],
    ["simon and garfunkel", ["Bookends"]],
  ])("finds %s", (query, expected) => {
    expect(titles(query)).toEqual(expected);
  });

  it("tolerates a letter or two of misspelling in longer words", () => {
    expect(titles("rumors")).toEqual(["Rumours"]); // how speech recognition may spell it
    expect(titles("never mind")).toEqual([]); // two words for one is too far
    expect(titles("nevermnd")).toEqual(["Nevermind"]);
  });

  it("does not stretch short words", () => {
    expect(titles("tusks")).toEqual([]); // "tusk" is too short to allow a letter off
    expect(titles("ok")).toEqual(["OK Computer"]);
  });

  it("needs every meaningful word to match", () => {
    expect(titles("rumours by radiohead")).toEqual([]);
    expect(titles("abbey road")).toEqual([]);
  });

  it("finds nothing for an empty query", () => {
    expect(titles("")).toEqual([]);
    expect(titles("?!")).toEqual([]);
  });
});
