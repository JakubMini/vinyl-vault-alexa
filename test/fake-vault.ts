/**
 * Stands in for the vinyl-value-vault Worker behind the VAULT service binding in tests
 * (wired up in vitest.config.ts). It insists on the Bearer key, like the real vault, so a test
 * fails if the client ever stops sending it. Responses carry the fields the skill reads, plus a
 * few it should ignore.
 */
export const TEST_VAULT_API_KEY = "test-vault-key";

export const FAKE_COLLECTION = {
  currency: "GBP",
  total_minor: 345_012,
  total: "£3,450.12",
  record_count: 163,
  valued_count: 151,
  unpriced_count: 12,
  last_valued_at: "2026-10-02T09:00:00.000Z",
};

export interface FakeRecord {
  id: number;
  artist: string;
  title: string;
  year: number | null;
  media_condition: string;
  current_value_minor: number | null;
  current_currency: string | null;
  discogs_removed_at: string | null;
  change_30d_minor: number | null;
  label?: string | null;
}

let nextId = 1;

/** A record as the vault lists it. Priced at £10 and unchanged unless told otherwise. */
export function fakeRecord(fields: Partial<FakeRecord> & Pick<FakeRecord, "artist" | "title">): FakeRecord {
  const priced = fields.current_value_minor !== null;
  return {
    id: nextId++,
    year: null,
    media_condition: "VG+",
    current_value_minor: 1_000,
    current_currency: priced ? "GBP" : null,
    discogs_removed_at: null,
    change_30d_minor: priced ? 0 : null,
    label: "Some Label",
    ...fields,
  };
}

/** A small collection with the awkward cases in it. */
export const FAKE_RECORDS: FakeRecord[] = [
  fakeRecord({ artist: "John Coltrane", title: "Blue Train", year: 1957, media_condition: "NM", current_value_minor: 85_000, change_30d_minor: 2_500 }),
  fakeRecord({ artist: "Miles Davis*", title: "Kind Of Blue", year: 1959, current_value_minor: 30_000, change_30d_minor: -1_000 }),
  fakeRecord({ artist: "Radiohead", title: "OK Computer", year: 1997, media_condition: "NM", current_value_minor: 12_000, change_30d_minor: 1_200 }),
  fakeRecord({ artist: "Radiohead", title: "Kid A", year: 2000, current_value_minor: 9_000 }),
  fakeRecord({ artist: "Radiohead", title: "Amnesiac", year: 2001, media_condition: "VG", current_value_minor: null }),
  fakeRecord({ artist: "Nirvana (2)", title: "Nevermind", year: 1991, current_value_minor: 4_000, change_30d_minor: 400 }),
  fakeRecord({ artist: "Fleetwood Mac", title: "Rumours", year: 1977, media_condition: "NM", current_value_minor: 2_500, change_30d_minor: 300 }),
  fakeRecord({ artist: "Fleetwood Mac", title: "Rumours", year: 1977, media_condition: "VG", current_value_minor: 1_800 }),
  fakeRecord({ artist: "Björk", title: "Début", year: 1993, media_condition: "NM", current_value_minor: 5_000, change_30d_minor: 150 }),
  // Left the Discogs collection: worth a lot and rising, but must never be mentioned.
  fakeRecord({
    artist: "Pink Floyd",
    title: "The Dark Side Of The Moon",
    year: 1973,
    current_value_minor: 50_000,
    change_30d_minor: 9_000,
    discogs_removed_at: "2026-09-30T12:00:00.000Z",
  }),
];

/** Days with a collection total, oldest first. Tracking began 40 days ago, so a month is covered. */
function trackedDays(days: number): { day: string }[] {
  const out: { day: string }[] = [];
  for (let back = Math.min(days - 1, 40); back >= 0; back--) {
    out.push({ day: new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10) });
  }
  return out;
}

export function fakeVault(request: Request): Response {
  if (request.headers.get("Authorization") !== `Bearer ${TEST_VAULT_API_KEY}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/collection") {
    const days = Number(url.searchParams.get("days") ?? 30);
    return Response.json({ ...FAKE_COLLECTION, daily: trackedDays(days) });
  }
  if (request.method === "GET" && url.pathname === "/api/records") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return Response.json({ records: FAKE_RECORDS.slice(offset, offset + limit), total: FAKE_RECORDS.length, limit, offset });
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}
