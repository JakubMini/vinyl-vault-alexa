import { describe, expect, it } from "vitest";

import model from "../skill-package/interactionModels/custom/en-GB.json";
import type { Slot } from "../src/envelope";
import { SLOTS, collectionValue, findAnswer, handlers, mostValuableAnswer, risersAnswer } from "../src/intents";
import type { CollectionSummary, Vault } from "../src/vault";
import { FAKE_RECORDS, type FakeRecord, fakeRecord } from "./fake-vault";

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

const NOW = new Date("2026-11-15T12:00:00Z");
const notCalled = () => Promise.reject(new Error("this handler should not call the vault"));
const unusedVault: Vault = { collection: notCalled, trackedDays: notCalled, records: notCalled };

/** The records the vault would return: the fake collection without the one that has left it. */
const inCollection = FAKE_RECORDS.filter((r) => r.discogs_removed_at === null);

/** Days from `first` to NOW, as the vault lists days with a total. */
function daysSince(first: string): string[] {
  const days: string[] = [];
  for (let d = new Date(`${first}T00:00:00Z`); d <= NOW; d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

describe("the interaction model", () => {
  const intents = model.interactionModel.languageModel.intents;

  it("has a handler for every intent, and an intent for every handler", () => {
    expect(Object.keys(handlers).sort()).toEqual(intents.map((i) => i.name).sort());
  });

  it("declares the slots the handlers read, with the right types", () => {
    const declared = intents.flatMap((i: { slots?: { name: string; type: string }[] }) => i.slots ?? []);
    const slots = Object.fromEntries(declared.map((s) => [s.name, s.type]));
    expect(slots).toEqual({ [SLOTS.period]: "PERIOD", [SLOTS.query]: "AMAZON.SearchQuery" });
    const periods = model.interactionModel.languageModel.types.find((t) => t.name === "PERIOD")?.values.map((v) => v.id);
    expect(periods).toEqual(["week", "month", "year"]);
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

describe("which record is the most valuable", () => {
  it("names the top record, then the next two", () => {
    expect(mostValuableAnswer(inCollection)).toEqual({
      speech:
        "Your most valuable record is Blue Train by John Coltrane, worth about £850. After that come Kind Of Blue by Miles Davis at about £300, and OK Computer by Radiohead at about £120.",
      endSession: true,
    });
  });

  it("copes with only one or two priced records", () => {
    const two = [fakeRecord({ artist: "A", title: "One", current_value_minor: 2_000 }), fakeRecord({ artist: "B", title: "Two" })];
    expect(mostValuableAnswer(two).speech).toBe("Your most valuable record is One by A, worth about £20. After that comes Two by B at about £10.");
    expect(mostValuableAnswer(two.slice(0, 1)).speech).toBe("Your most valuable record is One by A, worth about £20.");
  });

  it("says so when nothing is priced, or there is nothing at all", () => {
    expect(mostValuableAnswer([fakeRecord({ artist: "A", title: "B", current_value_minor: null })]).speech).toBe(
      "None of your records has a price yet, so I can't tell which is the most valuable.",
    );
    expect(mostValuableAnswer([]).speech).toBe("Your vault is empty, so there's nothing to value yet.");
  });
});

describe("which records have gained the most value", () => {
  const monthOfHistory = daysSince("2026-10-01");

  it("names the three biggest risers over the last month", () => {
    expect(risersAnswer(inCollection, monthOfHistory, "month", NOW)).toEqual({
      speech:
        "Over the last month, your biggest riser is Blue Train by John Coltrane, up £25 to about £850. Then OK Computer by Radiohead, up £12, and Nevermind by Nirvana, up £4.",
      endSession: true,
    });
  });

  it("assumes a month when no period is given", () => {
    expect(risersAnswer(inCollection, monthOfHistory, undefined, NOW).speech).toMatch(/^Over the last month, /);
  });

  it("says since when prices go back, when that is less than a month", () => {
    expect(risersAnswer(inCollection, daysSince("2026-11-02"), "month", NOW).speech).toMatch(
      /^Since 2 November, your biggest riser is Blue Train by John Coltrane/,
    );
  });

  it("is honest that it cannot do weeks or years yet", () => {
    expect(risersAnswer(inCollection, monthOfHistory, "week", NOW).speech).toMatch(
      /^I can only compare with a month ago for now\. Over the last month, your biggest riser is/,
    );
    expect(risersAnswer(inCollection, monthOfHistory, "year", NOW).speech).toMatch(/^I can only compare with a month ago for now\./);
  });

  it("says when nothing has gone up", () => {
    const flat = [fakeRecord({ artist: "A", title: "B", change_30d_minor: -100 })];
    expect(risersAnswer(flat, monthOfHistory, "month", NOW).speech).toBe("Over the last month, none of your records has gone up in value.");
  });

  it("does not compare anything before there is history to compare", () => {
    expect(risersAnswer(inCollection, [], "month", NOW).speech).toBe("I don't have any price history to compare with yet.");
    expect(risersAnswer(inCollection, ["2026-11-15"], "month", NOW).speech).toBe(
      "I only started tracking prices today, so nothing has had time to change yet.",
    );
  });
});

describe("do I have …", () => {
  const ask = (query: string, records: FakeRecord[] = inCollection) => findAnswer(records, query).speech;

  it("describes a single match: grade and value", () => {
    expect(ask("blue train")).toBe("Yes, you have Blue Train by John Coltrane. Your copy is near mint, and worth about £850.");
    expect(ask("amnesiac")).toBe("Yes, you have Amnesiac by Radiohead. Your copy is very good, and it hasn't been priced yet.");
  });

  it("counts copies of the same record", () => {
    expect(ask("rumours")).toBe("Yes, you have 2 copies of Rumours by Fleetwood Mac.");
  });

  it("lists an artist's records, most valuable first", () => {
    expect(ask("anything by radiohead")).toBe("Yes, you have 3 records by Radiohead: OK Computer, Kid A and Amnesiac.");
  });

  it("lists only some of a long run by one artist", () => {
    const many = ["One", "Two", "Three", "Four", "Five"].map((title, i) =>
      fakeRecord({ artist: "Prolific", title, current_value_minor: 1_000 * (5 - i) }),
    );
    expect(ask("prolific", many)).toBe("Yes, you have 5 records by Prolific, including One, Two and Three.");
  });

  it("lists matches across artists", () => {
    expect(ask("blue")).toBe("I found 2 records that match: Blue Train by John Coltrane and Kind Of Blue by Miles Davis.");
  });

  it("says when it cannot find something, repeating what it heard", () => {
    expect(ask("abbey road")).toBe("I couldn't find abbey road in your collection.");
  });

  it("does not find a record that has left the collection", () => {
    // The vault client drops removed records before they get here; this guards the fixture.
    expect(ask("dark side of the moon")).toBe("I couldn't find dark side of the moon in your collection.");
  });

  it("asks what to look for when it heard no record", async () => {
    const reply = await handlers.FindRecordIntent!({ slots: {}, vault: unusedVault, now: NOW });
    expect(reply).toMatchObject({ speech: expect.stringMatching(/^Which record should I look for\?/), endSession: false });
  });
});

describe("the period slot", () => {
  const vault: Vault = {
    collection: notCalled,
    trackedDays: () => Promise.resolve(daysSince("2026-10-01")),
    records: () => Promise.resolve(inCollection),
  };
  const period = (resolved: string | null, value: string): Slot => ({
    name: SLOTS.period,
    value,
    resolutions: {
      resolutionsPerAuthority: [
        resolved
          ? { status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { name: resolved, id: resolved } }] }
          : { status: { code: "ER_SUCCESS_NO_MATCH" } },
      ],
    },
  });

  it("uses the value Alexa resolved, not the words it heard", async () => {
    const reply = await handlers.RisersIntent!({ slots: { period: period("week", "seven days") }, vault, now: NOW });
    expect(reply.speech).toMatch(/^I can only compare with a month ago for now\./);
  });

  it("treats an unresolved period as a month", async () => {
    const reply = await handlers.RisersIntent!({ slots: { period: period(null, "decade") }, vault, now: NOW });
    expect(reply.speech).toMatch(/^Over the last month, /);
  });
});

describe("the built-in intents", () => {
  it.each(["AMAZON.HelpIntent", "AMAZON.FallbackIntent"])("%s explains what to ask and keeps listening", async (name) => {
    const reply = await handlers[name]!({ slots: {}, vault: unusedVault, now: NOW });
    expect(reply.speech).toMatch(/what your collection is worth, which record is the most valuable/);
    expect(reply.reprompt).toBeDefined();
    expect(reply.endSession).toBe(false);
  });

  it.each(["AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.NavigateHomeIntent"])("%s says goodbye", async (name) => {
    expect(await handlers[name]!({ slots: {}, vault: unusedVault, now: NOW })).toEqual({ speech: "Goodbye.", endSession: true });
  });
});
