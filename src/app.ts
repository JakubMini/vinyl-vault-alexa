/**
 * The HTTP surface: Alexa posts every request to /alexa. Nothing is read from the body until
 * the signature over it has been checked, and nothing is answered until the request is shown
 * to be fresh and addressed to this skill.
 */
import { Hono } from "hono/tiny";

import {
  type AlexaRequest,
  type Envelope,
  type ResponseEnvelope,
  applicationId,
  emptyResponse,
  isEnvelope,
  isIntentRequest,
  isSessionEndedRequest,
  toResponse,
} from "./envelope";
import { handlers, unknownIntent, vaultUnavailable, welcome } from "./intents";
import { type Vault, VaultError, vaultClient } from "./vault";
import { VerificationError, checkEnvelope, parseChain, verifySignature } from "./verify";

export interface AppOptions {
  /** PEM certificates a signing chain must reach. Production passes the pinned Amazon roots. */
  trustAnchors: readonly string[];
}

export function createApp({ trustAnchors }: AppOptions) {
  // Read once, when the isolate starts: they are constants, not request state.
  const anchors = trustAnchors.flatMap((pem) => parseChain(pem));
  const app = new Hono<{ Bindings: Env }>();

  app.get("/health", (c) => c.json({ ok: true, service: "vinyl-vault-alexa", now: new Date().toISOString() }));

  app.post("/alexa", async (c) => {
    const started = Date.now();
    const now = new Date();
    // The signature covers the exact bytes sent, so verify those, then decode them.
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const body = new TextDecoder().decode(raw);

    let envelope: Envelope;
    try {
      await verifySignature(c.req.raw.headers, raw, anchors, now);
      envelope = parseEnvelope(body);
      checkEnvelope({ timestamp: envelope.request.timestamp, applicationId: applicationId(envelope) }, c.env.ALEXA_SKILL_ID, now);
    } catch (error) {
      if (!(error instanceof VerificationError)) throw error;
      log({ event: "alexa.rejected", reason: error.reason, ms: Date.now() - started });
      return c.json({ error: "Bad request" }, 400);
    }

    const result = await respond(envelope.request, vaultClient(c.env.VAULT, c.env.VAULT_API_KEY), now);
    log({ event: "alexa.request", request_type: envelope.request.type, ...result.log, ms: Date.now() - started });
    return c.json(result.response);
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.onError((error, c) => {
    console.error(JSON.stringify({ event: "alexa.error", error: error.message }));
    return c.json({ error: "Internal error" }, 500);
  });

  return app;
}

function parseEnvelope(body: string): Envelope {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new VerificationError("body is not JSON");
  }
  if (!isEnvelope(json)) throw new VerificationError("body is not an Alexa request");
  return json;
}

interface Outcome {
  response: ResponseEnvelope;
  /** Fields for the request log line. Never user or device ids. */
  log: Record<string, unknown>;
}

async function respond(request: AlexaRequest, vault: Vault, now: Date): Promise<Outcome> {
  if (request.type === "LaunchRequest") {
    return { response: toResponse(welcome()), log: { outcome: "welcomed" } };
  }

  if (isIntentRequest(request)) {
    const intent = request.intent.name;
    const slots = request.intent.slots ?? {};
    // What was heard for each slot ("rumours", "week"): what the user said about records, and
    // the first thing to check when an answer misses.
    const heard = Object.fromEntries(Object.values(slots).map((slot) => [slot.name, slot.value ?? null]));
    const handler = handlers[intent];
    if (!handler) return { response: toResponse(unknownIntent()), log: { intent, slots: heard, outcome: "unknown_intent" } };
    try {
      const reply = await handler({ slots, vault, now });
      return { response: toResponse(reply), log: { intent, slots: heard, outcome: "answered" } };
    } catch (error) {
      if (!(error instanceof VaultError)) throw error;
      return {
        response: toResponse(vaultUnavailable()),
        log: { intent, slots: heard, outcome: "vault_unavailable", error: error.message },
      };
    }
  }

  if (isSessionEndedRequest(request)) {
    // Alexa only tells us the session is over; it must not be answered with speech.
    return { response: emptyResponse(), log: { outcome: "session_ended", reason: request.reason, error: request.error?.message } };
  }

  return { response: emptyResponse(), log: { outcome: "ignored" } };
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}
