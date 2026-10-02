import { describe, expect, it } from "vitest";

import { artistName, count, day, grade, list, money, recordName } from "../src/speech";

describe("money", () => {
  it.each([
    [345_012, "£3,450"],
    [123_456_789, "£1,234,568"],
    [1_000, "£10"],
    [1_050, "£11"],
    [999, "£9.99"],
    [450, "£4.50"],
    [400, "£4"],
    [0, "£0"],
  ])("says %i pence as %s", (minor, expected) => {
    expect(money(minor, "GBP")).toBe(expected);
  });

  it("uses the currency it is given", () => {
    expect(money(250_000, "EUR")).toBe("€2,500");
    expect(money(1_999, "USD")).toBe("$20");
    expect(money(1_250, "PLN")).toBe("PLN 13");
  });

  // Formatted by hand to avoid Intl's cold-start cost; these match what Intl.NumberFormat
  // ("en-GB", currency) said for the same amounts.
  it.each([
    [100_000_000, "£1,000,000"],
    [1_005, "£10"],
    [5, "£0.05"],
    [-1_200, "-£12"],
    [-450, "-£4.50"],
  ])("says %i pence as %s, as Intl did", (minor, expected) => {
    expect(money(minor, "GBP")).toBe(expected);
    const intl = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: Math.abs(minor) >= 1000 || minor % 100 === 0 ? 0 : 2,
      maximumFractionDigits: Math.abs(minor) >= 1000 || minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100);
    expect(money(minor, "GBP")).toBe(intl);
  });
});

describe("count", () => {
  it("pluralises", () => {
    expect(count(1, "record")).toBe("1 record");
    expect(count(2, "record")).toBe("2 records");
    expect(count(0, "copy", "copies")).toBe("0 copies");
  });
});

describe("list", () => {
  it("joins the way people say lists", () => {
    expect(list([])).toBe("");
    expect(list(["A"])).toBe("A");
    expect(list(["A", "B"])).toBe("A and B");
    expect(list(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("names", () => {
  it("drops Discogs' disambiguation numbers and name-variation asterisks", () => {
    expect(artistName("Nirvana (2)")).toBe("Nirvana");
    expect(artistName("Miles Davis*")).toBe("Miles Davis");
    expect(artistName("Simon & Garfunkel")).toBe("Simon & Garfunkel");
  });

  it("says a record as title by artist", () => {
    expect(recordName({ artist: "Nirvana (2)", title: "Nevermind" })).toBe("Nevermind by Nirvana");
  });
});

describe("grade", () => {
  it("says Goldmine grades as words", () => {
    expect(grade("NM")).toBe("near mint");
    expect(grade("VG+")).toBe("very good plus");
    expect(grade("G+")).toBe("good plus");
    expect(grade("??")).toBe("??");
  });
});

describe("day", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  it("says a date without the year when it is this year", () => {
    expect(day("2026-10-02", now)).toBe("2 October");
    expect(day("2026-01-31T23:00:00Z", now)).toBe("31 January");
  });
  it("adds the year otherwise", () => {
    expect(day("2025-12-25", now)).toBe("25 December 2025");
  });
});
