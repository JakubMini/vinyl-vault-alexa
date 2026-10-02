import { describe, expect, it } from "vitest";

import model from "../skill-package/interactionModels/custom/en-GB.json";
import { collectionValue, handlers } from "../src/intents";
import type { CollectionSummary, Vault } from "../src/vault";

function summary(fields: Partial<CollectionSummary>): CollectionSummary {
  return {
    currency: "GBP",
    total_minor: 0,
    record_count: 0,
    valued_count: 0,
    unpriced_count: 0,
    last_valued_at: null,
    ...fields,
  };
}

const unusedVault: Vault = {
  collection: () => Promise.reject(new Error("this handler should not call the vault")),
};

describe("the interaction model", () => {
  const modelIntents = model.interactionModel.languageModel.intents.map((i) => i.name).sort();

  it("has a handler for every intent, and an intent for every handler", () => {
    expect(Object.keys(handlers).sort()).toEqual(modelIntents);
  });

  it("is invoked as 'vinyl vault'", () => {
    expect(model.interactionModel.languageModel.invocationName).toBe("vinyl vault");
  });
});

describe("what is my collection worth", () => {
  it("gives the total and the record count when everything is priced", () => {
    expect(collectionValue(summary({ total_minor: 1_234_567, record_count: 40, valued_count: 40 }))).toEqual({
      speech: "Your 40 records are worth about £12,346.",
      endSession: true,
    });
  });

  it("says how many records the total leaves out", () => {
    expect(collectionValue(summary({ total_minor: 50_000, record_count: 10, valued_count: 9, unpriced_count: 1 })).speech).toBe(
      "Your 10 records are worth about £500. One of them hasn't been priced yet, so the real total is higher.",
    );
    expect(collectionValue(summary({ total_minor: 50_000, record_count: 10, valued_count: 7, unpriced_count: 3 })).speech).toBe(
      "Your 10 records are worth about £500. 3 of them haven't been priced yet, so the real total is higher.",
    );
  });

  it("speaks of a single record in the singular", () => {
    expect(collectionValue(summary({ total_minor: 450, record_count: 1, valued_count: 1 })).speech).toBe(
      "Your one record is worth about £4.50.",
    );
  });

  it("does not invent a total when nothing is priced yet", () => {
    expect(collectionValue(summary({ record_count: 163, unpriced_count: 163 })).speech).toBe(
      "You have 163 records, but none of them has a price yet. Ask me again once the vault has priced them.",
    );
  });

  it("says so when the vault is empty", () => {
    expect(collectionValue(summary({})).speech).toBe("Your vault is empty, so there's nothing to value yet.");
  });
});

describe("the built-in intents", () => {
  it.each(["AMAZON.HelpIntent", "AMAZON.FallbackIntent"])("%s explains what to ask and keeps listening", async (name) => {
    const reply = await handlers[name]!({ slots: {}, vault: unusedVault });
    expect(reply.speech).toMatch(/what your collection is worth/);
    expect(reply.reprompt).toBeDefined();
    expect(reply.endSession).toBe(false);
  });

  it.each(["AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.NavigateHomeIntent"])("%s says goodbye", async (name) => {
    expect(await handlers[name]!({ slots: {}, vault: unusedVault })).toEqual({ speech: "Goodbye.", endSession: true });
  });
});
