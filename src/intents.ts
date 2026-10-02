/**
 * What the skill says. One handler per intent in the interaction model
 * (skill-package/interactionModels/custom/en-GB.json); a test keeps the two in step.
 * Handlers ask the vault and phrase the answer. They hold no data logic of their own.
 */
import type { Reply, Slot } from "./envelope";
import { count, money } from "./speech";
import type { CollectionSummary, Vault } from "./vault";

export interface HandlerInput {
  slots: Record<string, Slot>;
  vault: Vault;
}
export type Handler = (input: HandlerInput) => Reply | Promise<Reply>;

const WHAT_YOU_CAN_ASK = "You can ask me what your collection is worth.";
const EXAMPLE = "Try asking: what is my collection worth?";

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

const goodbye: Handler = () => ({ speech: "Goodbye.", endSession: true });

export const handlers: Record<string, Handler> = {
  CollectionValueIntent: async ({ vault }) => collectionValue(await vault.collection()),

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
  if (records === 0) {
    return { speech: "Your vault is empty, so there's nothing to value yet.", endSession: true };
  }
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
