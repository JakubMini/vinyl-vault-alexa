import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { FAKE_COLLECTION } from "./fake-vault";
import { type SpokenResponse, call, envelope, intent, signedRequest } from "./helpers";

async function spoken(request: Request): Promise<SpokenResponse> {
  const response = await call(request);
  expect(response.status).toBe(200);
  return response.json();
}

describe("POST /alexa", () => {
  it("welcomes the user and waits for a question when the skill is opened", async () => {
    const { response } = await spoken(signedRequest(envelope({ type: "LaunchRequest" })));
    expect(response.outputSpeech?.text).toMatch(/^Vinyl Vault here\./);
    expect(response.reprompt?.outputSpeech.text).toMatch(/which record is the most valuable/);
    expect(response.shouldEndSession).toBe(false);
  });

  it("says what the collection is worth, from the vault, and ends the session", async () => {
    const { response } = await spoken(signedRequest(intent("CollectionValueIntent")));
    expect(FAKE_COLLECTION).toMatchObject({ record_count: 163, total_minor: 345_012, unpriced_count: 12 });
    expect(response.outputSpeech).toEqual({
      type: "PlainText",
      text: "Your 163 records are worth about £3,450. 12 of them haven't been priced yet, so the real total is higher.",
    });
    expect(response.shouldEndSession).toBe(true);
  });

  it("names the most valuable record, from the vault's record list", async () => {
    const { response } = await spoken(signedRequest(intent("MostValuableIntent")));
    expect(response.outputSpeech?.text).toMatch(/^Your most valuable record is Blue Train by John Coltrane, worth about £850\./);
    expect(response.shouldEndSession).toBe(true);
  });

  it("names the biggest risers over the last month, leaving out records that have left the collection", async () => {
    const { response } = await spoken(signedRequest(intent("RisersIntent", { period: { name: "period", value: "month" } })));
    expect(response.outputSpeech?.text).toBe(
      "Over the last month, your biggest riser is Blue Train by John Coltrane, up £25 to about £850. Then OK Computer by Radiohead, up £12, and Nevermind by Nirvana, up £4.",
    );
  });

  it("looks a record up by what was heard", async () => {
    const { response } = await spoken(signedRequest(intent("FindRecordIntent", { query: { name: "query", value: "rumors by fleetwood mac" } })));
    expect(response.outputSpeech?.text).toBe("Yes, you have 2 copies of Rumours by Fleetwood Mac.");
  });

  it("apologises, rather than failing the request, when the vault cannot answer", async () => {
    // The stub vault refuses a wrong key, as the real one does.
    const response = await call(signedRequest(intent("CollectionValueIntent")), { VAULT_API_KEY: "wrong-key" });
    expect(response.status).toBe(200);
    const { response: reply } = await response.json<SpokenResponse>();
    expect(reply.outputSpeech?.text).toBe("Sorry, I couldn't reach your vault just now. Please try again in a minute.");
    expect(reply.shouldEndSession).toBe(true);
  });

  it("answers the end of a session with no speech", async () => {
    const body = await spoken(signedRequest(envelope({ type: "SessionEndedRequest", reason: "USER_INITIATED" })));
    expect(body).toEqual({ version: "1.0", response: {} });
  });

  it("answers an unfamiliar request type with no speech", async () => {
    const body = await spoken(signedRequest(envelope({ type: "System.ExceptionEncountered" })));
    expect(body).toEqual({ version: "1.0", response: {} });
  });

  it("refuses an unsigned request", async () => {
    const response = await call(
      new Request("https://alexa.test/alexa", { method: "POST", body: JSON.stringify(intent("CollectionValueIntent")) }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a signed request for another skill", async () => {
    const body = { ...intent("CollectionValueIntent"), context: { System: { application: { applicationId: "amzn1.ask.skill.other" } } } };
    expect((await call(signedRequest(body))).status).toBe(400);
  });

  it("refuses a signed request that is too old", async () => {
    const body = envelope({ type: "LaunchRequest", timestamp: new Date(Date.now() - 5 * 60_000).toISOString() });
    expect((await call(signedRequest(body))).status).toBe(400);
  });

  it("refuses a signed body that is not an Alexa request", async () => {
    expect((await call(signedRequest("not json"))).status).toBe(400);
    expect((await call(signedRequest({ hello: "world" }))).status).toBe(400);
  });

  it("does not answer other methods or paths", async () => {
    expect((await call(new Request("https://alexa.test/alexa"))).status).toBe(404);
    expect((await call(new Request("https://alexa.test/elsewhere", { method: "POST" }))).status).toBe(404);
  });
});

describe("the deployed entry point", () => {
  it("is healthy", async () => {
    const response = await exports.default.fetch(new Request("https://alexa.test/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: "vinyl-vault-alexa" });
  });

  it("only trusts Amazon's roots, so a request signed by the test CA is refused", async () => {
    const response = await exports.default.fetch(signedRequest(intent("CollectionValueIntent")));
    expect(response.status).toBe(400);
  });
});
