import { describe, expect, it } from "vitest";

// The Workers free plan allows 10 ms of CPU per request, and Alexa's sparse traffic means most
// requests meet a fresh isolate. Some APIs cost more than that budget the first time an isolate
// uses them, so the source must not reach for them. Measured in Node (same V8 and ICU), first call:
//   Intl.NumberFormat ~9 ms, Intl.DateTimeFormat ~10 ms, String#localeCompare ~6 ms.
// Zod: the full build is ~800 KiB to load per isolate, and even zod/mini's schemas take ~2 ms to build.
// Importing node:crypto makes workerd load its Node crypto layer into every isolate: ~8 ms.
const sources = import.meta.glob<string>("../src/*.ts", { query: "?raw", import: "default", eager: true });

const FORBIDDEN: [RegExp, string][] = [
  [/\bIntl\.[A-Z]/, "Intl formatters (format by hand, see src/speech.ts)"],
  [/\.localeCompare\(/, "localeCompare (use byText from src/collection.ts)"],
  [/\.toLocale\w*\(/, "toLocale* methods (they create Intl formatters)"],
  [/from "zod/, "zod (schemas cost ~2 ms to build per isolate; use src/shape.ts)"],
  [/from "node:(crypto|buffer)"/, "node:crypto or node:buffer (~8 ms to load per isolate; use WebCrypto and src/x509.ts)"],
];

describe("the CPU budget", () => {
  it("has source files to check", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });

  it.each(Object.entries(sources))("%s avoids APIs that are expensive on first use", (_path, source) => {
    for (const [pattern, what] of FORBIDDEN) {
      expect(source, `uses ${what}`).not.toMatch(pattern);
    }
  });
});
