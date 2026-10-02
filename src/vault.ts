/**
 * The vault's HTTP API, reached over the VAULT service binding. Every response is checked
 * against the fields this skill relies on, so a change on the vault side fails loudly here
 * rather than being read aloud wrongly.
 */
import * as is from "./shape";

/** Alexa gives up after 8 seconds; leave room for the certificate fetch and speaking. */
const VAULT_TIMEOUT_MS = 4_000;
/** The most records the vault returns in one page. A personal collection fits in one. */
const PAGE_SIZE = 1_000;
/** A runaway paging loop would spend the free plan's 50 subrequests; this is plenty. */
const MAX_PAGES = 5;

/** The vault could not answer: unreachable, refused us, or said something unexpected. */
export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

const collectionSummary = is.object({
  currency: is.string,
  total_minor: is.int,
  record_count: is.int,
  valued_count: is.int,
  unpriced_count: is.int,
  last_valued_at: is.nullable(is.string),
});
export type CollectionSummary = is.Checked<typeof collectionSummary>;

const dailyTotals = is.object({
  /** One entry per UTC day that has a total, oldest first. Days before tracking began are absent. */
  daily: is.array(is.object({ day: is.string })),
});

const listedRecord = is.object({
  id: is.int,
  artist: is.string,
  title: is.string,
  year: is.nullable(is.int),
  media_condition: is.string,
  current_value_minor: is.nullable(is.int),
  current_currency: is.nullable(is.string),
  /** Set when the record has left the Discogs collection; such records are not "in" the collection. */
  discogs_removed_at: is.nullable(is.string),
  /** Value now minus value 30 days ago, or minus its first price if that was more recent. */
  change_30d_minor: is.nullable(is.int),
});
export type CollectionRecord = is.Checked<typeof listedRecord>;

const recordsPage = is.object({ records: is.array(listedRecord), total: is.int });

export interface Vault {
  /** GET /api/collection: the total value of every record still in the collection. */
  collection(): Promise<CollectionSummary>;
  /** GET /api/collection?days=N: the days in that window that have a collection total. */
  trackedDays(days: number): Promise<string[]>;
  /** GET /api/records: every record still in the collection (removed ones are left out). */
  records(): Promise<CollectionRecord[]>;
}

export function vaultClient(binding: Fetcher, apiKey: string): Vault {
  async function get<T>(path: string, schema: is.Check<T>): Promise<T> {
    if (!apiKey) throw new VaultError("VAULT_API_KEY is not configured");
    let response: Response;
    try {
      // The hostname is ignored by a service binding; the path is what the vault routes on.
      response = await binding.fetch(`https://vault/api${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(VAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new VaultError(`GET ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new VaultError(`GET ${path} returned ${response.status}`);
    const body: unknown = await response.json().catch(() => undefined);
    if (!schema(body)) throw new VaultError(`GET ${path} returned an unexpected shape`);
    return body;
  }

  return {
    collection: () => get("/collection", collectionSummary),

    trackedDays: async (days) => (await get(`/collection?days=${days}`, dailyTotals)).daily.map((d) => d.day),

    records: async () => {
      const all: CollectionRecord[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const { records, total } = await get(`/records?limit=${PAGE_SIZE}&offset=${all.length}`, recordsPage);
        all.push(...records);
        if (records.length === 0 || all.length >= total) break;
      }
      return all.filter((record) => record.discogs_removed_at === null);
    },
  };
}
