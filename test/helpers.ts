import { Buffer } from "node:buffer";
import { sign } from "node:crypto";
import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";

import { createApp } from "../src/app";
import chainPem from "./fixtures/certs/chain.pem?raw";
import leafKeyPem from "./fixtures/certs/leaf-key.pem?raw";
import testRootPem from "./fixtures/certs/test-root.pem?raw";
import { network } from "./network";

export { chainPem, testRootPem };
export { default as rogueChainPem } from "./fixtures/certs/rogue-chain.pem?raw";
export { default as wrongSanChainPem } from "./fixtures/certs/wrong-san-chain.pem?raw";
export { default as ecChainPem } from "./fixtures/certs/ec-chain.pem?raw";
export { default as ecRootPem } from "./fixtures/certs/ec-root.pem?raw";
export { default as impostorChainPem } from "./fixtures/certs/impostor-chain.pem?raw";
export { default as renamedIntermediatePem } from "./fixtures/certs/renamed-intermediate.pem?raw";
export { default as realAmazonChainPem } from "./fixtures/certs/amazon-echo-api-cert-12.pem?raw";
export { default as currentAmazonChainPem } from "./fixtures/certs/amazon-echo-api-cert-eu-2026.pem?raw";

export const SKILL_ID = "amzn1.ask.skill.test";
export const CERT_URL = "https://s3.amazonaws.com/echo.api/echo-api-cert-test.pem";

/** The app as production builds it, except that it trusts the test root instead of Amazon's. */
export const testApp = createApp({ trustAnchors: [testRootPem] });

/** Calls the test app with the test bindings (fake vault, test skill id), optionally overridden. */
export function call(request: Request, overrides: Partial<Env> = {}): Promise<Response> {
  return Promise.resolve(testApp.fetch(request, { ...env, ...overrides }));
}

/** A full Alexa request body. `request` fields override the defaults; timestamp is now. */
export function envelope(request: Record<string, unknown>, applicationId = SKILL_ID): Record<string, unknown> {
  const application = { applicationId };
  return {
    version: "1.0",
    session: { new: true, sessionId: "amzn1.echo-api.session.test", application, user: { userId: "amzn1.ask.account.test" } },
    context: { System: { application, user: { userId: "amzn1.ask.account.test" }, device: { deviceId: "amzn1.ask.device.test" } } },
    request: {
      requestId: "amzn1.echo-api.request.test",
      timestamp: new Date().toISOString(),
      locale: "en-GB",
      ...request,
    },
  };
}

export function intent(name: string, slots?: Record<string, { name: string; value?: string }>): Record<string, unknown> {
  return envelope({ type: "IntentRequest", intent: { name, confirmationStatus: "NONE", ...(slots ? { slots } : {}) } });
}

/** Signs a body with the test leaf key, as Alexa signs with echo-api.amazon.com's key. */
export function signatureFor(body: string): string {
  return sign("sha256", Buffer.from(body), leafKeyPem).toString("base64");
}

/** Serves `pem` at `url` once, as Amazon serves the signing certificate from S3. */
export function serveCertificate(pem = chainPem, url = CERT_URL): void {
  network.use(http.get(url, () => HttpResponse.text(pem), { once: true }));
}

/**
 * A request exactly as Alexa would send it: the body signed with the test key and the
 * certificate chain served at the URL in the header.
 */
export function signedRequest(body: Record<string, unknown> | string): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  serveCertificate();
  return new Request("https://alexa.test/alexa", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      SignatureCertChainUrl: CERT_URL,
      "Signature-256": signatureFor(text),
    },
    body: text,
  });
}

/** The parts of an Alexa response the tests look at. */
export interface SpokenResponse {
  version: string;
  response: {
    outputSpeech?: { type: string; text: string };
    reprompt?: { outputSpeech: { type: string; text: string } };
    shouldEndSession?: boolean;
  };
}
