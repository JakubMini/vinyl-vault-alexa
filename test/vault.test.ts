import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { VaultError, vaultClient } from "../src/vault";
import { FAKE_COLLECTION, TEST_VAULT_API_KEY } from "./fake-vault";

/** A service binding that answers every call with `respond`, recording what it was asked. */
function binding(respond: (request: Request) => Response | Promise<Response>) {
  const seen: Request[] = [];
  const fetcher = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push(request);
      return respond(request);
    },
  } as unknown as Fetcher;
  return { fetcher, seen };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof VaultError) return error.message;
    throw error;
  }
  throw new Error("expected a VaultError");
}

describe("the vault client", () => {
  it("reads the collection summary over the binding, with the API key", async () => {
    const { fetcher, seen } = binding(() => Response.json(FAKE_COLLECTION));
    await expect(vaultClient(fetcher, "k3y").collection()).resolves.toMatchObject({ total_minor: 345_012, record_count: 163 });
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0]!.url).pathname).toBe("/api/collection");
    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer k3y");
  });

  it("talks to the stub vault through the real VAULT binding in tests", async () => {
    await expect(vaultClient(env.VAULT, TEST_VAULT_API_KEY).collection()).resolves.toMatchObject({ record_count: 163 });
    expect(await failure(vaultClient(env.VAULT, "wrong-key").collection())).toBe("GET /collection returned 401");
  });

  it("fails when the vault answers with an error", async () => {
    const { fetcher } = binding(() => new Response("down", { status: 503 }));
    expect(await failure(vaultClient(fetcher, "k3y").collection())).toBe("GET /collection returned 503");
  });

  it("fails when the vault answers with something unexpected", async () => {
    const { fetcher } = binding(() => Response.json({ total: "£3,450" }));
    expect(await failure(vaultClient(fetcher, "k3y").collection())).toBe("GET /collection returned an unexpected shape");
    const { fetcher: html } = binding(() => new Response("<html>", { headers: { "Content-Type": "text/html" } }));
    expect(await failure(vaultClient(html, "k3y").collection())).toBe("GET /collection returned an unexpected shape");
  });

  it("fails when the vault cannot be reached", async () => {
    const { fetcher } = binding(() => Promise.reject(new Error("connection reset")));
    expect(await failure(vaultClient(fetcher, "k3y").collection())).toBe("GET /collection failed: connection reset");
  });

  it("fails closed, without calling the vault, when no API key is set", async () => {
    const { fetcher, seen } = binding(() => Response.json(FAKE_COLLECTION));
    expect(await failure(vaultClient(fetcher, "").collection())).toBe("VAULT_API_KEY is not configured");
    expect(seen).toHaveLength(0);
  });
});
