/**
 * Questions answered over the record list. The vault returns the whole collection in one page,
 * as its dashboard uses it, with each record's current value and 30-day change already worked
 * out; ranking and matching that list is all that happens here.
 */
import { artistName } from "./speech";
import type { CollectionRecord } from "./vault";

type Priced = CollectionRecord & { current_value_minor: number };

/** The `n` records worth the most, most valuable first. Unpriced records are left out. */
export function mostValuable(records: readonly CollectionRecord[], n: number): Priced[] {
  return records
    .filter((record): record is Priced => record.current_value_minor !== null)
    .sort((a, b) => b.current_value_minor - a.current_value_minor || a.artist.localeCompare(b.artist))
    .slice(0, n);
}

type Changed = CollectionRecord & { change_30d_minor: number; current_value_minor: number };

/** The `n` records that gained the most over 30 days, biggest gain first. Only actual gains. */
export function risers(records: readonly CollectionRecord[], n: number): Changed[] {
  return records
    .filter(
      (record): record is Changed =>
        record.change_30d_minor !== null && record.change_30d_minor > 0 && record.current_value_minor !== null,
    )
    .sort((a, b) => b.change_30d_minor - a.change_30d_minor || a.artist.localeCompare(b.artist))
    .slice(0, n);
}

// Words people say around a record's name that are not part of it: "do I have ANY records BY
// Radiohead", "do I have A COPY OF The Dark Side OF THE Moon". Ignored when matching, unless
// the query is made of nothing else.
const FILLER = new Set([
  "a", "an", "and", "the", "of", "by", "any", "anything", "some", "something", "my",
  "record", "records", "album", "albums", "vinyl", "vinyls", "lp", "lps", "copy", "copies",
]);

// Letters that Unicode does not treat as a base letter plus an accent, so NFKD leaves them
// alone, but that speech recognition writes as plain Latin: "Młynarski" is heard as "mlynarski".
const OWN_LETTERS: Record<string, string> = {
  ł: "l", ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ð: "d", þ: "th", ı: "i",
};

/** Lowercase words without accents or punctuation: "Björk's Début!" -> ["bjorks", "debut"]. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[łøæœßđðþı]/g, (letter) => OWN_LETTERS[letter] ?? letter)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // the accents NFKD split off
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Records whose artist and title, together, contain every meaningful word of the query.
 * Speech recognition spells names its own way ("rumors" for "Rumours"), so longer words may be
 * off by a letter or two.
 */
export function findRecords(records: readonly CollectionRecord[], query: string): CollectionRecord[] {
  const all = words(query);
  const wanted = all.filter((word) => !FILLER.has(word));
  const needles = wanted.length > 0 ? wanted : all;
  if (needles.length === 0) return [];
  return records.filter((record) => {
    const haystack = words(`${artistName(record.artist)} ${record.title}`);
    return needles.every((needle) => haystack.some((word) => similar(needle, word)));
  });
}

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  const allowed = shorter >= 9 ? 2 : shorter >= 5 ? 1 : 0;
  return allowed > 0 && Math.abs(a.length - b.length) <= allowed && editDistance(a, b) <= allowed;
}

/** Levenshtein distance: the fewest single-letter edits that turn `a` into `b`. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length]!;
}
