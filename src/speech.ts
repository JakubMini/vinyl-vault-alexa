/**
 * Turning numbers and names into things worth saying out loud. Alexa reads "£3,450" as "three
 * thousand four hundred and fifty pounds", so the job here is choosing what to say, not how to
 * say it.
 *
 * Amounts and dates are formatted by hand rather than with Intl. The first Intl formatter an
 * isolate creates loads locale data, about 10 ms of CPU: the free plan's whole budget for a
 * request, and Alexa traffic is sparse enough that most requests meet a fresh isolate. A test
 * checks the hand-made amounts against Intl's.
 */

/**
 * Market prices are estimates, so pence are noise above £10: 345012 -> "£3,450". Below that
 * they still matter, 450 -> "£4.50", unless there are none: 400 -> "£4".
 */
export function money(minor: number, currency: string): string {
  const units = Math.abs(minor) / 100;
  const wholeUnits = units >= 10 || minor % 100 === 0;
  const [whole = "0", pence] = (wholeUnits ? Math.round(units).toString() : units.toFixed(2)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${minor < 0 ? "-" : ""}${symbol}${grouped}${pence ? `.${pence}` : ""}`;
}

const SYMBOLS: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };

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

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10-02" -> "2 October", with the year only when it is not this year. */
export function day(isoDay: string, now: Date): string {
  const [year, month, date] = isoDay.slice(0, 10).split("-").map(Number);
  const spoken = `${date} ${MONTHS[(month ?? 1) - 1]}`;
  return year === now.getUTCFullYear() ? spoken : `${spoken} ${year}`;
}
