/**
 * The slice of Alexa's request and response JSON this skill uses, checked with src/shape.ts
 * instead of the Alexa SDK. Unknown fields are ignored, so new ones Amazon adds do not break it.
 * Reference: https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html
 */
import * as is from "./shape";

// For a custom slot type Alexa says what it heard (`value`) and, separately, which of the
// type's values that resolved to (`resolutions`), so "past seven days" can arrive as "week".
const resolution = is.object({
  status: is.object({ code: is.string }),
  values: is.optional(is.array(is.object({ value: is.object({ name: is.string, id: is.optional(is.string) }) }))),
});
const slot = is.object({
  name: is.string,
  value: is.optional(is.string),
  resolutions: is.optional(is.object({ resolutionsPerAuthority: is.array(resolution) })),
});
export type Slot = is.Checked<typeof slot>;

/** The id of the slot type value Alexa matched, if it matched one ("ER_SUCCESS_MATCH"). */
export function resolvedId(slot: Slot | undefined): string | undefined {
  const match = slot?.resolutions?.resolutionsPerAuthority.find((r) => r.status.code === "ER_SUCCESS_MATCH");
  const value = match?.values?.[0]?.value;
  return value?.id ?? value?.name;
}

const common = { requestId: is.string, timestamp: is.string, locale: is.optional(is.string) };

const launchRequest = is.object({ type: is.literal("LaunchRequest"), ...common });
const intentRequest = is.object({
  type: is.literal("IntentRequest"),
  ...common,
  intent: is.object({ name: is.string, slots: is.optional(is.record(slot)) }),
});
const sessionEndedRequest = is.object({
  type: is.literal("SessionEndedRequest"),
  ...common,
  reason: is.optional(is.string),
  error: is.optional(is.object({ type: is.string, message: is.string })),
});
// Anything else Alexa might send (System.ExceptionEncountered, CanFulfillIntentRequest, …).
const otherRequest = is.object({ type: is.string, ...common });

const application = is.object({ applicationId: is.string });

export const isEnvelope = is.object({
  version: is.string,
  session: is.optional(is.object({ new: is.boolean, application })),
  context: is.optional(is.object({ System: is.object({ application }) })),
  request: is.union(launchRequest, intentRequest, sessionEndedRequest, otherRequest),
});
export type Envelope = is.Checked<typeof isEnvelope>;
export type AlexaRequest = Envelope["request"];
export type IntentRequest = is.Checked<typeof intentRequest>;
export type SessionEndedRequest = is.Checked<typeof sessionEndedRequest>;

// `otherRequest` has `type: string`, so comparing `type` alone does not narrow the union.
export const isIntentRequest = intentRequest as (request: AlexaRequest) => request is IntentRequest;
export const isSessionEndedRequest = sessionEndedRequest as (request: AlexaRequest) => request is SessionEndedRequest;

/** The skill id the request is addressed to. `context` is always sent; `session` is the fallback. */
export function applicationId(envelope: Envelope): string | undefined {
  return envelope.context?.System.application.applicationId ?? envelope.session?.application.applicationId;
}

/** What a handler decides to say. */
export interface Reply {
  speech: string;
  /** Said again if the user is silent. Only used when the session stays open. */
  reprompt?: string;
  /** Close the session after speaking (the default for a one-shot question). */
  endSession: boolean;
}

export interface ResponseEnvelope {
  version: "1.0";
  response: {
    outputSpeech?: { type: "PlainText"; text: string };
    reprompt?: { outputSpeech: { type: "PlainText"; text: string } };
    shouldEndSession?: boolean;
  };
}

export function toResponse(reply: Reply): ResponseEnvelope {
  return {
    version: "1.0",
    response: {
      outputSpeech: { type: "PlainText", text: reply.speech },
      ...(reply.reprompt && !reply.endSession
        ? { reprompt: { outputSpeech: { type: "PlainText", text: reply.reprompt } } }
        : {}),
      shouldEndSession: reply.endSession,
    },
  };
}

/** SessionEndedRequest must not be answered with speech. */
export function emptyResponse(): ResponseEnvelope {
  return { version: "1.0", response: {} };
}
