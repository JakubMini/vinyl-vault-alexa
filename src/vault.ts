/**
 * The vault's HTTP API, reached over the VAULT service binding. Every response is checked
 * against the fields this skill relies on, so a change on the vault side fails loudly here
 * rather than being read aloud wrongly.
 */
import * as z from "zod/mini";

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

const collectionSummary = z.object({
  currency: z.string(),
  total_minor: z.int(),
  record_count: z.int(),
  valued_count: z.int(),
  unpriced_count: z.int(),
  last_valued_at: z.nullable(z.string()),
});
export type CollectionSummary = z.infer<typeof collectionSummary>;

const dailyTotals = z.object({
  /** One entry per UTC day that has a total, oldest first. Days before tracking began are absent. */
  daily: z.array(z.object({ day: z.string() })),
});

const listedRecord = z.object({
  id: z.int(),
  artist: z.string(),
  title: z.string(),
  year: z.nullable(z.int()),
  media_condition: z.string(),
  current_value_minor: z.nullable(z.int()),
  current_currency: z.nullable(z.string()),
  /** Set when the record has left the Discogs collection; such records are not "in" the collection. */
  discogs_removed_at: z.nullable(z.string()),
  /** Value now minus value 30 days ago, or minus its first price if that was more recent. */
  change_30d_minor: z.nullable(z.int()),
});
export type CollectionRecord = z.infer<typeof listedRecord>;

const recordsPage = z.object({ records: z.array(listedRecord), total: z.int() });

export interface Vault {
  /** GET /api/collection: the total value of every record still in the collection. */
  collection(): Promise<CollectionSummary>;
  /** GET /api/collection?days=N: the days in that window that have a collection total. */
  trackedDays(days: number): Promise<string[]>;
  /** GET /api/records: every record still in the collection (removed ones are left out). */
  records(): Promise<CollectionRecord[]>;
}

export function vaultClient(binding: Fetcher, apiKey: string): Vault {
  async function get<T>(path: string, schema: z.ZodMiniType<T>): Promise<T> {
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
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new VaultError(`GET ${path} returned an unexpected shape`);
    return parsed.data;
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
