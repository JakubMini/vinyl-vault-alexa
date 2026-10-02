/**
 * Turning numbers and names into things worth saying out loud. Alexa reads "£3,450" as "three
 * thousand four hundred and fifty pounds", so the job here is choosing what to say, not how to
 * say it.
 */

/**
 * Market prices are estimates, so pence are noise above £10: 345012 -> "£3,450". Below that
 * they still matter, 450 -> "£4.50", unless there are none: 400 -> "£4".
 */
export function money(minor: number, currency: string): string {
  const wholeUnits = Math.abs(minor) >= 1000 || minor % 100 === 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: wholeUnits ? 0 : 2,
    maximumFractionDigits: wholeUnits ? 0 : 2,
  }).format(minor / 100);
}

/** 1 -> "1 record", 3 -> "3 records". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** ["A", "B", "C"] -> "A, B and C". */
export function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * Discogs tells apart artists who share a name with a number, "Nirvana (2)", and marks name
 * variations with an asterisk, "Miles Davis*". Neither should be read aloud.
 */
export function artistName(artist: string): string {
  return artist.replace(/\s*\(\d+\)/g, "").replace(/\*+/g, "").trim();
}

/** "Rumours by Fleetwood Mac". */
export function recordName(record: { artist: string; title: string }): string {
  return `${record.title} by ${artistName(record.artist)}`;
}

const GRADE_WORDS: Record<string, string> = {
  M: "mint",
  NM: "near mint",
  "VG+": "very good plus",
  VG: "very good",
  "G+": "good plus",
  G: "good",
  F: "fair",
  P: "poor",
};

/** Goldmine grade codes as words: "VG+" -> "very good plus". */
export function grade(code: string): string {
  return GRADE_WORDS[code] ?? code;
}

/** "2026-10-02" -> "2 October", with the year only when it is not this year. */
export function day(isoDay: string, now: Date): string {
  const date = new Date(`${isoDay.slice(0, 10)}T00:00:00Z`);
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
}
