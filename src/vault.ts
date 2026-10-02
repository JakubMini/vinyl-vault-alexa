/**
 * The vault's HTTP API, reached over the VAULT service binding. Every response is checked
 * against the fields this skill relies on, so a change on the vault side fails loudly here
 * rather than being read aloud wrongly.
 */
import { z } from "zod";

/** Alexa gives up after 8 seconds; leave room for the certificate fetch and speaking. */
const VAULT_TIMEOUT_MS = 4_000;

/** The vault could not answer: unreachable, refused us, or said something unexpected. */
export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

const collectionSummary = z.object({
  currency: z.string(),
  total_minor: z.number().int(),
  record_count: z.number().int(),
  valued_count: z.number().int(),
  unpriced_count: z.number().int(),
  last_valued_at: z.string().nullable(),
});
export type CollectionSummary = z.infer<typeof collectionSummary>;

export interface Vault {
  /** GET /api/collection: the total value of every record still in the collection. */
  collection(): Promise<CollectionSummary>;
}

export function vaultClient(binding: Fetcher, apiKey: string): Vault {
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
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
  };
}
