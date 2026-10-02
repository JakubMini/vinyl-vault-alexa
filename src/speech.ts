/**
 * Turning numbers into things worth saying out loud. Alexa reads "£3,450" as "three thousand
 * four hundred and fifty pounds", so the job here is choosing what to say, not how to say it.
 */

/**
 * Market prices are estimates, so pence are noise above £10: 345012 -> "£3,450". Below that
 * they still matter: 450 -> "£4.50".
 */
export function money(minor: number, currency: string): string {
  const wholeUnits = Math.abs(minor) >= 1000;
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
