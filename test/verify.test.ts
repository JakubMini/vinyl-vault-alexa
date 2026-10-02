import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { AMAZON_ROOT_PEMS } from "../src/amazon-roots";
import { VerificationError, checkCertUrl, checkChain, checkEnvelope, parseChain, verifySignature } from "../src/verify";
import {
  CERT_URL,
  SKILL_ID,
  chainPem,
  ecChainPem,
  ecRootPem,
  impostorChainPem,
  realAmazonChainPem,
  renamedIntermediatePem,
  rogueChainPem,
  serveCertificate,
  signatureFor,
  testRootPem,
  wrongSanChainPem,
} from "./helpers";
import { network } from "./network";

const anchors = parseChain(testRootPem);
const amazonRoots = () => AMAZON_ROOT_PEMS.flatMap((pem) => parseChain(pem));
const now = new Date();
const bytes = (text: string) => new TextEncoder().encode(text);

function reason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof VerificationError) return error.reason;
    throw error;
  }
  return undefined;
}

async function asyncReason(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof VerificationError) return error.reason;
    throw error;
  }
  return undefined;
}

describe("the certificate URL", () => {
  // Amazon's own list of URLs that must be accepted and refused.
  it.each([
    "https://s3.amazonaws.com/echo.api/echo-api-cert.pem",
    "https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem",
    "https://s3.amazonaws.com/echo.api/../echo.api/echo-api-cert.pem",
    "HTTPS://S3.AMAZONAWS.COM/echo.api/echo-api-cert.pem",
  ])("accepts %s", (url) => {
    expect(reason(() => checkCertUrl(url))).toBeUndefined();
  });

  it.each([
    ["http://s3.amazonaws.com/echo.api/echo-api-cert.pem", "cert URL is not https"],
    ["https://notamazon.com/echo.api/echo-api-cert.pem", "cert URL host is not s3.amazonaws.com"],
    ["https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem", "cert URL path is not /echo.api/"],
    ["https://s3.amazonaws.com/invalid.path/echo-api-cert.pem", "cert URL path is not /echo.api/"],
    ["https://s3.amazonaws.com/echo.api/../invalid.path/echo-api-cert.pem", "cert URL path is not /echo.api/"],
    ["https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem", "cert URL port is not 443"],
    ["not a url", "unparseable SignatureCertChainUrl"],
    [null, "missing SignatureCertChainUrl"],
  ])("refuses %s", (url, expected) => {
    expect(reason(() => checkCertUrl(url))).toBe(expected);
  });
});

describe("the certificate chain", () => {
  it("accepts a current leaf for echo-api.amazon.com that chains to a trusted root", async () => {
    expect(await asyncReason(checkChain(parseChain(chainPem), anchors, now))).toBeUndefined();
  });

  it("accepts a bundle that includes the trusted root itself", async () => {
    expect(await asyncReason(checkChain(parseChain(chainPem + testRootPem), anchors, now))).toBeUndefined();
  });

  it("refuses a leaf that does not name echo-api.amazon.com", async () => {
    expect(await asyncReason(checkChain(parseChain(wrongSanChainPem), anchors, now))).toBe(
      "signing cert does not name echo-api.amazon.com",
    );
  });

  it("accepts an elliptic-curve chain (P-384 root, P-256 intermediate), as Amazon Root CA 3 and 4 would give", async () => {
    expect(await asyncReason(checkChain(parseChain(ecChainPem), parseChain(ecRootPem), now))).toBeUndefined();
    expect(await asyncReason(checkChain(parseChain(ecChainPem), anchors, now))).toBe("chain does not reach a trusted root");
  });

  it("refuses a chain that ends at an untrusted root", async () => {
    expect(await asyncReason(checkChain(parseChain(rogueChainPem), anchors, now))).toBe("chain does not reach a trusted root");
  });

  it("refuses a chain whose certificates were not signed by each other", async () => {
    const [leaf] = parseChain(chainPem);
    const [, rogueRoot] = parseChain(rogueChainPem);
    expect(await asyncReason(checkChain([leaf!, rogueRoot!], anchors, now))).toBe("cert 0 is not signed by cert 1");
  });

  it("refuses an impostor chain that copies the trusted names but not the keys", async () => {
    expect(await asyncReason(checkChain(parseChain(impostorChainPem), anchors, now))).toBe("chain does not reach a trusted root");
  });

  it("refuses a leaf from an impostor, presented with the real intermediate", async () => {
    const [impostorLeaf] = parseChain(impostorChainPem);
    const [, realIntermediate] = parseChain(chainPem);
    expect(await asyncReason(checkChain([impostorLeaf!, realIntermediate!], anchors, now))).toBe("cert 0 is not signed by cert 1");
  });

  it("refuses a link where the key matches but the issuer's name does not", async () => {
    const [leaf] = parseChain(chainPem);
    const [renamed] = parseChain(renamedIntermediatePem);
    expect(await asyncReason(checkChain([leaf!, renamed!], anchors, now))).toBe("cert 0 is not signed by cert 1");
  });

  it("refuses a chain that passes through a certificate that is not a CA", async () => {
    const [leaf] = parseChain(chainPem);
    const [otherLeaf] = parseChain(wrongSanChainPem);
    expect(await asyncReason(checkChain([leaf!, otherLeaf!], anchors, now))).toBe("cert 1 is not a CA");
  });

  it("refuses an expired certificate", async () => {
    expect(await asyncReason(checkChain(parseChain(chainPem), anchors, new Date("2200-01-01")))).toBe("cert 0 has expired");
  });

  it("refuses a certificate that is not valid yet", async () => {
    expect(await asyncReason(checkChain(parseChain(chainPem), anchors, new Date("2000-01-01")))).toBe("cert 0 is not yet valid");
  });

  it("does not trust the test root in production", async () => {
    const amazon = amazonRoots();
    expect(await asyncReason(checkChain(parseChain(chainPem), amazon, now))).toBe("chain does not reach a trusted root");
  });

  // A genuine chain Alexa signed with in 2023, from https://s3.amazonaws.com/echo.api/echo-api-cert-12.pem.
  // Leaf -> Amazon RSA 2048 M01 -> Amazon Root CA 1 (cross-signed by Starfield G2) -> Starfield G2
  // (cross-signed by Starfield Class 2, which is not pinned). The walk must stop at Amazon Root CA 1.
  it("accepts a real Amazon signing chain, checked as of when it was current", async () => {
    const amazon = amazonRoots();
    const chain = parseChain(realAmazonChainPem);
    expect(chain).toHaveLength(4);
    expect(await asyncReason(checkChain(chain, amazon, new Date("2023-06-01")))).toBeUndefined();
    expect(await asyncReason(checkChain(chain, amazon, now))).toBe("cert 0 has expired");
  });

  it("pins five Amazon roots that are all valid today", () => {
    const amazon = amazonRoots();
    expect(amazon).toHaveLength(5);
    for (const root of amazon) {
      expect(root.isCA).toBe(true);
      expect(root.notAfter.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("refuses a bundle with no certificates in it", () => {
    expect(reason(() => parseChain("nothing to see"))).toBe("no certificates in chain");
  });

  it("refuses a bundle with a corrupt certificate in it", () => {
    const corrupt = "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----";
    expect(reason(() => parseChain(chainPem + corrupt))).toBe("unparseable certificate in chain");
  });
});

describe("the signature", () => {
  const body = JSON.stringify({ hello: "alexa" });

  function headers(signature: string | null = signatureFor(body)): Headers {
    const h = new Headers({ SignatureCertChainUrl: CERT_URL });
    if (signature) h.set("Signature-256", signature);
    return h;
  }

  it("accepts a body signed by the certificate's key", async () => {
    serveCertificate();
    expect(await asyncReason(verifySignature(headers(), bytes(body), anchors, now))).toBeUndefined();
  });

  it("refuses a body changed after signing", async () => {
    serveCertificate();
    expect(await asyncReason(verifySignature(headers(), bytes(body.replace("alexa", "mallory")), anchors, now))).toBe(
      "signature does not match body",
    );
  });

  it("refuses a request without a signature, before fetching anything", async () => {
    expect(await asyncReason(verifySignature(headers(null), bytes(body), anchors, now))).toBe("missing Signature-256");
  });

  it("refuses a request whose certificate cannot be fetched", async () => {
    network.use(http.get(CERT_URL, () => new HttpResponse(null, { status: 403 }), { once: true }));
    expect(await asyncReason(verifySignature(headers(), bytes(body), anchors, now))).toBe("cert fetch returned 403");
  });

  it("refuses a request when Amazon cannot be reached for the certificate", async () => {
    network.use(http.get(CERT_URL, () => HttpResponse.error(), { once: true }));
    expect(await asyncReason(verifySignature(headers(), bytes(body), anchors, now))).toBe("cert fetch failed");
  });

  it("refuses a correctly signed body when the chain is untrusted", async () => {
    serveCertificate(rogueChainPem);
    expect(await asyncReason(verifySignature(headers(), bytes(body), anchors, now))).toBe("chain does not reach a trusted root");
  });
});

describe("the envelope", () => {
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();

  it("accepts a request for this skill sent just now", () => {
    expect(reason(() => checkEnvelope({ timestamp: at(-149_000), applicationId: SKILL_ID }, SKILL_ID, now))).toBeUndefined();
  });

  it.each([
    ["more than 150 seconds old", -151_000],
    ["more than 150 seconds in the future", 151_000],
  ])("refuses a request %s", (_label, offset) => {
    expect(reason(() => checkEnvelope({ timestamp: at(offset), applicationId: SKILL_ID }, SKILL_ID, now))).toBe(
      "timestamp is outside the 150 second window",
    );
  });

  it("refuses a request for another skill", () => {
    expect(reason(() => checkEnvelope({ timestamp: at(0), applicationId: "amzn1.ask.skill.other" }, SKILL_ID, now))).toBe(
      "request is for another skill",
    );
  });

  it("refuses everything while no skill id is configured", () => {
    expect(reason(() => checkEnvelope({ timestamp: at(0), applicationId: "" }, "", now))).toBe(
      "ALEXA_SKILL_ID is not configured",
    );
  });
});
