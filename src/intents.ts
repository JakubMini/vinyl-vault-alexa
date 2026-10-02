/**
 * What the skill says. One handler per intent in the interaction model
 * (skill-package/interactionModels/custom/en-GB.json); a test keeps the two in step.
 * Handlers ask the vault, pick out what matters (src/collection.ts) and phrase the answer.
 */
import { findRecords, mostValuable, risers, words } from "./collection";
import { type Reply, type Slot, resolvedId } from "./envelope";
import { artistName, count, day, grade, list, money, recordName } from "./speech";
import type { CollectionRecord, CollectionSummary, Vault } from "./vault";

export interface HandlerInput {
  slots: Record<string, Slot>;
  vault: Vault;
  now: Date;
}
export type Handler = (input: HandlerInput) => Reply | Promise<Reply>;

/** Slot names, as declared in the interaction model. */
export const SLOTS = { period: "period", query: "query" } as const;

const WHAT_YOU_CAN_ASK =
  "You can ask what your collection is worth, which record is the most valuable, what's gone up this month, or whether you have a particular record.";
const EXAMPLE = "Try asking: which record is the most valuable?";

/** Opening the skill without a question ("Alexa, open vinyl vault"). */
export function welcome(): Reply {
  return { speech: `Vinyl Vault here. ${WHAT_YOU_CAN_ASK} What would you like to know?`, reprompt: EXAMPLE, endSession: false };
}

/** An intent the model declares but nothing here handles. Should never happen; a test checks. */
export function unknownIntent(): Reply {
  return { speech: `Sorry, I can't help with that yet. ${WHAT_YOU_CAN_ASK}`, endSession: true };
}

export function vaultUnavailable(): Reply {
  return { speech: "Sorry, I couldn't reach your vault just now. Please try again in a minute.", endSession: true };
}

const EMPTY_VAULT: Reply = { speech: "Your vault is empty, so there's nothing to value yet.", endSession: true };

const goodbye: Handler = () => ({ speech: "Goodbye.", endSession: true });

export const handlers: Record<string, Handler> = {
  CollectionValueIntent: async ({ vault }) => collectionValue(await vault.collection()),
  MostValuableIntent: async ({ vault }) => mostValuableAnswer(await vault.records()),
  RisersIntent: async ({ vault, slots, now }) => {
    // 31 days of totals reach back to 30 days ago, the same window as each record's change.
    const [records, trackedDays] = await Promise.all([vault.records(), vault.trackedDays(31)]);
    return risersAnswer(records, trackedDays, resolvedId(slots[SLOTS.period]), now);
  },
  FindRecordIntent: async ({ vault, slots }) => {
    const query = slots[SLOTS.query]?.value?.trim();
    if (!query) {
      return {
        speech: "Which record should I look for? You can say, for example, do I have Rumours.",
        reprompt: "Which record should I look for?",
        endSession: false,
      };
    }
    return findAnswer(await vault.records(), query);
  },

  "AMAZON.HelpIntent": () => ({
    speech: `I keep track of what your records are worth. ${WHAT_YOU_CAN_ASK} What would you like to know?`,
    reprompt: EXAMPLE,
    endSession: false,
  }),
  "AMAZON.FallbackIntent": () => ({
    speech: `Sorry, I can't help with that yet. ${WHAT_YOU_CAN_ASK}`,
    reprompt: EXAMPLE,
    endSession: false,
  }),
  "AMAZON.StopIntent": goodbye,
  "AMAZON.CancelIntent": goodbye,
  "AMAZON.NavigateHomeIntent": goodbye,
};

/** "What is my collection worth?" Says how many records the figure covers, and how many it misses. */
export function collectionValue(summary: CollectionSummary): Reply {
  const { record_count: records, valued_count: valued, unpriced_count: unpriced } = summary;
  if (records === 0) return EMPTY_VAULT;
  if (valued === 0) {
    return {
      speech: `You have ${count(records, "record")}, but none of them has a price yet. Ask me again once the vault has priced them.`,
      endSession: true,
    };
  }

  const total = money(summary.total_minor, summary.currency);
  const headline = records === 1 ? `Your one record is worth about ${total}.` : `Your ${records} records are worth about ${total}.`;
  if (unpriced === 0) return { speech: headline, endSession: true };
  const missing = unpriced === 1 ? "One of them hasn't" : `${unpriced} of them haven't`;
  return { speech: `${headline} ${missing} been priced yet, so the real total is higher.`, endSession: true };
}

/** "Which record is the most valuable?" The top one, then the next two. */
export function mostValuableAnswer(records: readonly CollectionRecord[]): Reply {
  if (records.length === 0) return EMPTY_VAULT;
  const [first, ...rest] = mostValuable(records, 3);
  if (!first) {
    return { speech: "None of your records has a price yet, so I can't tell which is the most valuable.", endSession: true };
  }
  let speech = `Your most valuable record is ${recordName(first)}, worth about ${value(first.current_value_minor, first)}.`;
  if (rest.length > 0) {
    const others = rest.map((record) => `${recordName(record)} at about ${value(record.current_value_minor, record)}`);
    speech += ` After that ${rest.length === 1 ? "comes" : "come"} ${others.join(", and ")}.`;
  }
  return { speech, endSession: true };
}

/**
 * "Which records have gained the most value this month?" The vault works out each record's
 * change over 30 days. When prices have been tracked for less than that, the answer says since
 * when rather than claiming a month. Weeks and years are not offered by the vault yet.
 */
export function risersAnswer(
  records: readonly CollectionRecord[],
  trackedDays: readonly string[],
  period: string | undefined,
  now: Date,
): Reply {
  const caveat = period === "week" || period === "year" ? "I can only compare with a month ago for now. " : "";
  const start = trackedDays[0];
  const today = isoDay(now);
  if (!start) return { speech: `${caveat}I don't have any price history to compare with yet.`, endSession: true };
  if (start >= today) {
    return { speech: `${caveat}I only started tracking prices today, so nothing has had time to change yet.`, endSession: true };
  }

  const monthAgo = isoDay(new Date(now.getTime() - 30 * 86_400_000));
  const window = start > monthAgo ? `Since ${day(start, now)}` : "Over the last month";
  const [first, ...rest] = risers(records, 3);
  if (!first) return { speech: `${caveat}${window}, none of your records has gone up in value.`, endSession: true };

  let speech = `${caveat}${window}, your biggest riser is ${recordName(first)}, up ${value(first.change_30d_minor, first)} to about ${value(first.current_value_minor, first)}.`;
  if (rest.length > 0) {
    speech += ` Then ${rest.map((record) => `${recordName(record)}, up ${value(record.change_30d_minor, record)}`).join(", and ")}.`;
  }
  return { speech, endSession: true };
}

/** "Do I have Rumours?" One match gets its details; several are listed, most valuable first. */
export function findAnswer(records: readonly CollectionRecord[], query: string): Reply {
  const matches = [...findRecords(records, query)].sort(
    (a, b) => (b.current_value_minor ?? -1) - (a.current_value_minor ?? -1) || a.title.localeCompare(b.title),
  );
  const [first] = matches;
  if (!first) return { speech: `I couldn't find ${query} in your collection.`, endSession: true };

  const artists = new Set(matches.map((record) => artistName(record.artist).toLowerCase()));
  if (artists.size > 1) {
    const names = unique(matches.map(recordName));
    const shown = names.length > 3 ? `, including ${list(names.slice(0, 3))}` : `: ${list(names)}`;
    return { speech: `I found ${count(names.length, "record")} that match${shown}.`, endSession: true };
  }

  const titles = unique(matches.map((record) => record.title), (title) => words(title).join(" "));
  if (titles.length === 1) {
    if (matches.length > 1) {
      return { speech: `Yes, you have ${matches.length} copies of ${recordName(first)}.`, endSession: true };
    }
    const worth =
      first.current_value_minor === null
        ? "and it hasn't been priced yet"
        : `and worth about ${value(first.current_value_minor, first)}`;
    return {
      speech: `Yes, you have ${recordName(first)}. Your copy is ${grade(first.media_condition)}, ${worth}.`,
      endSession: true,
    };
  }

  const artist = artistName(first.artist);
  const shown = titles.length > 4 ? `, including ${list(titles.slice(0, 3))}` : `: ${list(titles)}`;
  return { speech: `Yes, you have ${titles.length} records by ${artist}${shown}.`, endSession: true };
}

function value(minor: number, record: CollectionRecord): string {
  return money(minor, record.current_currency ?? "GBP");
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** First occurrence of each item, compared by `key`. Keeps order. */
function unique(items: readonly string[], key: (item: string) => string = (item) => item.toLowerCase()): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
