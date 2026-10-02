import { describe, expect, it } from "vitest";

import { count, money } from "../src/speech";

describe("money", () => {
  it.each([
    [345_012, "£3,450"],
    [123_456_789, "£1,234,568"],
    [1_000, "£10"],
    [1_050, "£11"],
    [999, "£9.99"],
    [450, "£4.50"],
    [0, "£0.00"],
  ])("says %i pence as %s", (minor, expected) => {
    expect(money(minor, "GBP")).toBe(expected);
  });

  it("uses the currency it is given", () => {
    expect(money(250_000, "EUR")).toBe("€2,500");
  });
});

describe("count", () => {
  it("pluralises", () => {
    expect(count(1, "record")).toBe("1 record");
    expect(count(2, "record")).toBe("2 records");
    expect(count(0, "copy", "copies")).toBe("0 copies");
  });
});
