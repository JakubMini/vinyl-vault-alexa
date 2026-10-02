/**
 * The slice of Alexa's request and response JSON this skill uses, typed with Zod instead of
 * the Alexa SDK. Unknown fields are ignored, so new ones Amazon adds do not break parsing.
 * Reference: https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html
 */
import * as z from "zod/mini";

// For a custom slot type Alexa says what it heard (`value`) and, separately, which of the
// type's values that resolved to (`resolutions`), so "past seven days" can arrive as "week".
const resolution = z.object({
  status: z.object({ code: z.string() }),
  values: z.optional(z.array(z.object({ value: z.object({ name: z.string(), id: z.optional(z.string()) }) }))),
});
const slot = z.object({
  name: z.string(),
  value: z.optional(z.string()),
  resolutions: z.optional(z.object({ resolutionsPerAuthority: z.array(resolution) })),
});
export type Slot = z.infer<typeof slot>;

/** The id of the slot type value Alexa matched, if it matched one ("ER_SUCCESS_MATCH"). */
export function resolvedId(slot: Slot | undefined): string | undefined {
  const match = slot?.resolutions?.resolutionsPerAuthority.find((r) => r.status.code === "ER_SUCCESS_MATCH");
  const value = match?.values?.[0]?.value;
  return value?.id ?? value?.name;
}

const common = { requestId: z.string(), timestamp: z.string(), locale: z.optional(z.string()) };

const launchRequest = z.object({ type: z.literal("LaunchRequest"), ...common });
const intentRequest = z.object({
  type: z.literal("IntentRequest"),
  ...common,
  intent: z.object({ name: z.string(), slots: z.optional(z.record(z.string(), slot)) }),
});
const sessionEndedRequest = z.object({
  type: z.literal("SessionEndedRequest"),
  ...common,
  reason: z.optional(z.string()),
  error: z.optional(z.object({ type: z.string(), message: z.string() })),
});
// Anything else Alexa might send (System.ExceptionEncountered, CanFulfillIntentRequest, …).
const otherRequest = z.object({ type: z.string(), ...common });

const application = z.object({ applicationId: z.string() });

export const envelopeSchema = z.object({
  version: z.string(),
  session: z.optional(z.object({ new: z.boolean(), application })),
  context: z.optional(z.object({ System: z.object({ application }) })),
  request: z.union([launchRequest, intentRequest, sessionEndedRequest, otherRequest]),
});
export type Envelope = z.infer<typeof envelopeSchema>;
export type AlexaRequest = Envelope["request"];
export type IntentRequest = z.infer<typeof intentRequest>;
export type SessionEndedRequest = z.infer<typeof sessionEndedRequest>;

// `otherRequest` has `type: string`, so comparing `type` alone does not narrow the union.
export function isIntentRequest(request: AlexaRequest): request is IntentRequest {
  return request.type === "IntentRequest" && "intent" in request;
}
export function isSessionEndedRequest(request: AlexaRequest): request is SessionEndedRequest {
  return request.type === "SessionEndedRequest";
}

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
