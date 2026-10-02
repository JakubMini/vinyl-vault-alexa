/**
 * The slice of Alexa's request and response JSON this skill uses, typed with Zod instead of
 * the Alexa SDK. Unknown fields are ignored, so new ones Amazon adds do not break parsing.
 * Reference: https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html
 */
import { z } from "zod";

const slot = z.object({ name: z.string(), value: z.string().optional() });
export type Slot = z.infer<typeof slot>;

const common = { requestId: z.string(), timestamp: z.string(), locale: z.string().optional() };

const launchRequest = z.object({ type: z.literal("LaunchRequest"), ...common });
const intentRequest = z.object({
  type: z.literal("IntentRequest"),
  ...common,
  intent: z.object({ name: z.string(), slots: z.record(z.string(), slot).optional() }),
});
const sessionEndedRequest = z.object({
  type: z.literal("SessionEndedRequest"),
  ...common,
  reason: z.string().optional(),
  error: z.object({ type: z.string(), message: z.string() }).optional(),
});
// Anything else Alexa might send (System.ExceptionEncountered, CanFulfillIntentRequest, …).
const otherRequest = z.object({ type: z.string(), ...common });

const application = z.object({ applicationId: z.string() });

export const envelopeSchema = z.object({
  version: z.string(),
  session: z.object({ new: z.boolean(), application }).optional(),
  context: z.object({ System: z.object({ application }) }).optional(),
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
