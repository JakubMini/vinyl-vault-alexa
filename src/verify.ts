/**
 * Proves a request really came from Alexa, as Amazon requires of every skill hosted outside
 * AWS Lambda: https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html
 *
 * Alexa signs the raw body with the private key of a certificate for echo-api.amazon.com and
 * says where to fetch that certificate. We check the URL is Amazon's, the certificate is current,
 * names echo-api.amazon.com and chains to a pinned Amazon root, and that the signature matches
 * the body. Then, once the body is parsed, that it is fresh and addressed to this skill.
 *
 * All the cryptography is node:crypto, which Workers implement natively: no pure-JS RSA.
 */
import { Buffer } from "node:buffer";
import { X509Certificate, verify } from "node:crypto";

/** Amazon's limit: requests more than 150 seconds from now are refused. */
export const MAX_CLOCK_SKEW_MS = 150_000;
const SIGNING_HOST = "echo-api.amazon.com";
const CERT_FETCH_TIMEOUT_MS = 3_000;

/** A request that must be refused with a 400. `reason` is for logs, never for the caller. */
export class VerificationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "VerificationError";
  }
}

/** The certificate URL must be https://s3.amazonaws.com[:443]/echo.api/…, path case-sensitive. */
export function checkCertUrl(raw: string | null): URL {
  if (!raw) throw new VerificationError("missing SignatureCertChainUrl");
  let url: URL;
  try {
    url = new URL(raw); // normalises "/echo.api/../echo.api/x" the way Amazon's examples expect
  } catch {
    throw new VerificationError("unparseable SignatureCertChainUrl");
  }
  // The URL parser lowercases the scheme and host, and drops an explicit default port.
  if (url.protocol !== "https:") throw new VerificationError("cert URL is not https");
  if (url.hostname !== "s3.amazonaws.com") throw new VerificationError("cert URL host is not s3.amazonaws.com");
  if (url.port !== "") throw new VerificationError("cert URL port is not 443");
  if (!url.pathname.startsWith("/echo.api/")) throw new VerificationError("cert URL path is not /echo.api/");
  return url;
}

/** Splits a PEM bundle into certificates, leaf first, as Amazon serves it. */
export function parseChain(pem: string): X509Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (blocks.length === 0) throw new VerificationError("no certificates in chain");
  try {
    return blocks.map((block) => new X509Certificate(block));
  } catch {
    throw new VerificationError("unparseable certificate in chain");
  }
}

/**
 * The leaf must be current and name echo-api.amazon.com, and the chain must lead to one of
 * `anchors`. Walking from the leaf, the first certificate that is an anchor, or is signed by
 * one, ends the walk; until then each certificate must be signed by the CA after it. Stopping at
 * the first anchor means extra cross-signed certificates at the end of the bundle do not matter.
 */
export function checkChain(chain: X509Certificate[], anchors: readonly X509Certificate[], now: Date): void {
  const leaf = chain[0];
  if (!leaf) throw new VerificationError("empty chain");
  const sans = (leaf.subjectAltName ?? "").split(/,\s*/);
  if (!sans.includes(`DNS:${SIGNING_HOST}`)) throw new VerificationError("signing cert does not name echo-api.amazon.com");

  for (const [i, cert] of chain.entries()) {
    if (now < new Date(cert.validFrom)) throw new VerificationError(`cert ${i} is not yet valid`);
    if (now > new Date(cert.validTo)) throw new VerificationError(`cert ${i} has expired`);
    if (anchors.some((anchor) => cert.fingerprint256 === anchor.fingerprint256 || signedBy(cert, anchor))) return;
    const issuer = chain[i + 1];
    if (!issuer) break;
    if (!issuer.ca) throw new VerificationError(`cert ${i + 1} is not a CA`);
    if (!signedBy(cert, issuer)) throw new VerificationError(`cert ${i} is not signed by cert ${i + 1}`);
  }
  throw new VerificationError("chain does not reach a trusted root");
}

function signedBy(cert: X509Certificate, issuer: X509Certificate): boolean {
  return cert.checkIssued(issuer) && cert.verify(issuer.publicKey);
}

/**
 * Checks the signature headers against the raw body. Fetches the certificate chain from Amazon
 * (one subrequest). Throws VerificationError on any failure.
 */
export async function verifySignature(
  headers: Headers,
  body: string,
  anchors: readonly X509Certificate[],
  now: Date,
): Promise<void> {
  const url = checkCertUrl(headers.get("SignatureCertChainUrl"));
  const signature = headers.get("Signature-256");
  if (!signature) throw new VerificationError("missing Signature-256");

  let pem: string;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(CERT_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new VerificationError(`cert fetch returned ${response.status}`);
    pem = await response.text();
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError("cert fetch failed");
  }

  const chain = parseChain(pem);
  checkChain(chain, anchors, now);
  const leaf = chain[0]!; // parseChain never returns an empty array
  const matches = verify("sha256", Buffer.from(body), leaf.publicKey, Buffer.from(signature, "base64"));
  if (!matches) throw new VerificationError("signature does not match body");
}

/** Once the body is parsed: it must be recent and addressed to this skill. */
export function checkEnvelope(
  envelope: { timestamp: string; applicationId: string | undefined },
  skillId: string,
  now: Date,
): void {
  if (!skillId) throw new VerificationError("ALEXA_SKILL_ID is not configured");
  if (envelope.applicationId !== skillId) throw new VerificationError("request is for another skill");
  const sent = Date.parse(envelope.timestamp);
  if (Number.isNaN(sent) || Math.abs(now.getTime() - sent) > MAX_CLOCK_SKEW_MS) {
    throw new VerificationError("timestamp is outside the 150 second window");
  }
}
