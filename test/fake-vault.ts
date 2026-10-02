/**
 * Stands in for the vinyl-value-vault Worker behind the VAULT service binding in tests
 * (wired up in vitest.config.ts). It insists on the Bearer key, like the real vault, so a test
 * fails if the client ever stops sending it.
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
  history: [],
};

export function fakeVault(request: Request): Response {
  if (request.headers.get("Authorization") !== `Bearer ${TEST_VAULT_API_KEY}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/api/collection") return Response.json(FAKE_COLLECTION);
  return Response.json({ error: "Not found" }, { status: 404 });
}
