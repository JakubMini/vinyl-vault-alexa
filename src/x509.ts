/**
 * Just enough X.509 to check Alexa's signing certificate with WebCrypto.
 *
 * Why not node:crypto's X509Certificate: importing node:crypto makes workerd load its Node
 * compatibility layer for crypto into every new isolate, about 8 ms of CPU, most of the free
 * plan's 10 ms budget for a request. WebCrypto is built in and costs nothing to load, but it has
 * no certificate parser, so this reads the DER structure itself (RFC 5280, section 4.1). It reads
 * only what the verifier needs and refuses anything it does not expect.
 *
 * A test compares every field read here with node:crypto's reading of the same certificates.
 */

/** A certificate this module cannot read. The verifier turns it into a 400. */
export class CertificateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertificateError";
  }
}

export interface PublicKeyInfo {
  /** SubjectPublicKeyInfo, DER: what WebCrypto's importKey("spki") takes. */
  spki: Uint8Array;
  /** Key algorithm OID: rsaEncryption or id-ecPublicKey. */
  algorithm: string;
  /** Named curve OID, for EC keys. */
  curve?: string;
}

export interface Certificate {
  der: Uint8Array;
  /** The TBSCertificate: the bytes the issuer signed. */
  tbs: Uint8Array;
  /** Signature algorithm OID, e.g. sha256WithRSAEncryption. */
  signatureAlgorithm: string;
  signature: Uint8Array;
  /** Issuer and subject names as DER, compared byte for byte to link a chain. */
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: Date;
  notAfter: Date;
  publicKey: PublicKeyInfo;
  /** basicConstraints cA: may this certificate sign others? */
  isCA: boolean;
  /** subjectAltName dNSName entries. */
  dnsNames: string[];
}

// DER tags used in certificates.
const BOOLEAN = 0x01;
const INTEGER = 0x02;
const BIT_STRING = 0x03;
const OCTET_STRING = 0x04;
const OID = 0x06;
const UTC_TIME = 0x17;
const GENERALIZED_TIME = 0x18;
const SEQUENCE = 0x30;
const VERSION = 0xa0; // [0] EXPLICIT
const EXTENSIONS = 0xa3; // [3] EXPLICIT
const DNS_NAME = 0x82; // GeneralName [2] IMPLICIT IA5String

const BASIC_CONSTRAINTS = "2.5.29.19";
const SUBJECT_ALT_NAME = "2.5.29.17";
export const RSA_KEY = "1.2.840.113549.1.1.1";
export const EC_KEY = "1.2.840.10045.2.1";

/** One DER element: its tag and where its content sits in the byte array. */
interface Element {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
}

function read(bytes: Uint8Array, offset: number, limit: number): Element {
  if (offset + 2 > limit) throw new CertificateError("truncated");
  const tag = bytes[offset]!;
  if ((tag & 0x1f) === 0x1f) throw new CertificateError("unexpected multi-byte tag");
  let length = bytes[offset + 1]!;
  let contentStart = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    // 0 would be BER's indefinite length, which DER forbids; certificates never need over 4 bytes.
    if (count === 0 || count > 4) throw new CertificateError("unsupported length encoding");
    if (contentStart + count > limit) throw new CertificateError("truncated");
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[contentStart + i]!;
    contentStart += count;
  }
  const end = contentStart + length;
  if (end > limit) throw new CertificateError("truncated");
  return { tag, start: offset, contentStart, end };
}

function children(bytes: Uint8Array, parent: Element): Element[] {
  const out: Element[] = [];
  for (let at = parent.contentStart; at < parent.end; ) {
    const child = read(bytes, at, parent.end);
    out.push(child);
    at = child.end;
  }
  return out;
}

function want(element: Element | undefined, tag: number, what: string): Element {
  if (!element || element.tag !== tag) throw new CertificateError(`expected ${what}`);
  return element;
}

function whole(bytes: Uint8Array, element: Element): Uint8Array {
  return bytes.subarray(element.start, element.end);
}

function content(bytes: Uint8Array, element: Element): Uint8Array {
  return bytes.subarray(element.contentStart, element.end);
}

function oid(bytes: Uint8Array, element: Element): string {
  const arcs: number[] = [];
  let value = 0;
  for (let i = element.contentStart; i < element.end; i++) {
    const byte = bytes[i]!;
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      arcs.push(value);
      value = 0;
    }
  }
  const [first, ...rest] = arcs;
  if (first === undefined) throw new CertificateError("empty object identifier");
  const head = first < 40 ? [0, first] : first < 80 ? [1, first - 40] : [2, first - 80];
  return [...head, ...rest].join(".");
}

/** UTCTime YYMMDDHHMMSSZ or GeneralizedTime YYYYMMDDHHMMSSZ, the only forms RFC 5280 allows. */
function time(bytes: Uint8Array, element: Element | undefined): Date {
  const text = element ? String.fromCharCode(...content(bytes, element)) : "";
  const match =
    element?.tag === UTC_TIME
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
      : element?.tag === GENERALIZED_TIME
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
        : null;
  if (!match) throw new CertificateError("unreadable validity date");
  const [, y, mo, d, h, mi, s] = match.map(Number) as [number, number, number, number, number, number, number];
  const year = element?.tag === UTC_TIME ? (y >= 50 ? 1900 + y : 2000 + y) : y;
  return new Date(Date.UTC(year, mo - 1, d, h, mi, s));
}

/** A BIT STRING holding whole bytes, as keys and signatures do. */
function bitStringBytes(bytes: Uint8Array, element: Element): Uint8Array {
  const value = content(bytes, element);
  if (value[0] !== 0) throw new CertificateError("bit string with unused bits");
  return value.subarray(1);
}

export function parseCertificate(der: Uint8Array): Certificate {
  const certificate = want(read(der, 0, der.length), SEQUENCE, "certificate");
  if (certificate.end !== der.length) throw new CertificateError("trailing bytes");
  const parts = children(der, certificate);
  if (parts.length !== 3) throw new CertificateError("expected three certificate parts");
  const tbs = want(parts[0], SEQUENCE, "TBSCertificate");
  const outerAlgorithm = want(parts[1], SEQUENCE, "signature algorithm");
  const signature = want(parts[2], BIT_STRING, "signature");

  const fields = children(der, tbs);
  let i = fields[0]?.tag === VERSION ? 1 : 0;
  want(fields[i++], INTEGER, "serial number");
  const innerAlgorithm = want(fields[i++], SEQUENCE, "signature algorithm");
  const issuer = want(fields[i++], SEQUENCE, "issuer");
  const validity = children(der, want(fields[i++], SEQUENCE, "validity"));
  const subject = want(fields[i++], SEQUENCE, "subject");
  const spki = want(fields[i++], SEQUENCE, "subject public key info");
  // Optional issuer and subject unique ids ([1], [2]) may come before the extensions.
  const extensions = fields.slice(i).find((field) => field.tag === EXTENSIONS);

  // RFC 5280 4.1.1.2: the algorithm inside the signed part must match the one outside it.
  if (!equalBytes(whole(der, innerAlgorithm), whole(der, outerAlgorithm))) {
    throw new CertificateError("signature algorithms disagree");
  }

  const [keyAlgorithm] = children(der, spki);
  const [keyOid, keyParameters] = children(der, want(keyAlgorithm, SEQUENCE, "key algorithm"));
  const algorithm = oid(der, want(keyOid, OID, "key algorithm"));
  const publicKey: PublicKeyInfo = { spki: whole(der, spki), algorithm };
  if (algorithm === EC_KEY) publicKey.curve = oid(der, want(keyParameters, OID, "named curve"));

  const parsed: Certificate = {
    der,
    tbs: whole(der, tbs),
    signatureAlgorithm: oid(der, want(children(der, outerAlgorithm)[0], OID, "signature algorithm")),
    signature: bitStringBytes(der, signature),
    issuer: whole(der, issuer),
    subject: whole(der, subject),
    notBefore: time(der, validity[0]),
    notAfter: time(der, validity[1]),
    publicKey,
    isCA: false,
    dnsNames: [],
  };
  if (extensions) readExtensions(der, extensions, parsed);
  return parsed;
}

function readExtensions(der: Uint8Array, extensions: Element, into: Certificate): void {
  const [list] = children(der, extensions);
  for (const extension of children(der, want(list, SEQUENCE, "extensions"))) {
    const [id, ...rest] = children(der, want(extension, SEQUENCE, "extension"));
    const value = want(rest.at(-1), OCTET_STRING, "extension value");
    const inner = read(der, value.contentStart, value.end);
    switch (oid(der, want(id, OID, "extension id"))) {
      case BASIC_CONSTRAINTS: {
        const [ca] = children(der, want(inner, SEQUENCE, "basic constraints"));
        into.isCA = ca?.tag === BOOLEAN && der[ca.contentStart] !== 0;
        break;
      }
      case SUBJECT_ALT_NAME:
        for (const name of children(der, want(inner, SEQUENCE, "subject alternative names"))) {
          if (name.tag === DNS_NAME) into.dnsNames.push(String.fromCharCode(...content(der, name)));
        }
        break;
    }
  }
}

/** Every certificate in a PEM bundle, in order. */
export function pemCertificates(pem: string): Uint8Array[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g) ?? [];
  return blocks.map((block) => base64(block.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, "")));
}

export function base64(text: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new CertificateError("invalid base64");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// --- Signatures, with WebCrypto -------------------------------------------------------------

const SIGNATURE_ALGORITHMS: Record<string, { hash: string; key: string }> = {
  "1.2.840.113549.1.1.11": { hash: "SHA-256", key: RSA_KEY }, // sha256WithRSAEncryption
  "1.2.840.113549.1.1.12": { hash: "SHA-384", key: RSA_KEY }, // sha384WithRSAEncryption
  "1.2.840.113549.1.1.13": { hash: "SHA-512", key: RSA_KEY }, // sha512WithRSAEncryption
  "1.2.840.10045.4.3.2": { hash: "SHA-256", key: EC_KEY }, // ecdsa-with-SHA256
  "1.2.840.10045.4.3.3": { hash: "SHA-384", key: EC_KEY }, // ecdsa-with-SHA384
};

const CURVES: Record<string, { name: string; size: number }> = {
  "1.2.840.10045.3.1.7": { name: "P-256", size: 32 },
  "1.3.132.0.34": { name: "P-384", size: 48 },
};

/**
 * Does `signature` over `data` check out against `key`? RSA uses PKCS#1 v1.5; ECDSA signatures
 * arrive DER-encoded and are converted to the r||s form WebCrypto expects. Anything else,
 * including a key WebCrypto will not import, is a no.
 */
export async function verifySignatureWith(
  key: PublicKeyInfo,
  hash: string,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  try {
    if (key.algorithm === RSA_KEY) {
      const imported = await crypto.subtle.importKey("spki", key.spki, { name: "RSASSA-PKCS1-v1_5", hash }, false, ["verify"]);
      return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", imported, signature, data);
    }
    const curve = key.algorithm === EC_KEY && key.curve ? CURVES[key.curve] : undefined;
    if (curve) {
      const imported = await crypto.subtle.importKey("spki", key.spki, { name: "ECDSA", namedCurve: curve.name }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "ECDSA", hash }, imported, ecdsaRaw(signature, curve.size), data);
    }
  } catch {
    // An unreadable key or signature is a failed check, not a crash.
  }
  return false;
}

/** Was `certificate` issued and signed by `issuer`? */
export async function isSignedBy(certificate: Certificate, issuer: Certificate): Promise<boolean> {
  const algorithm = SIGNATURE_ALGORITHMS[certificate.signatureAlgorithm];
  if (!algorithm || algorithm.key !== issuer.publicKey.algorithm) return false;
  if (!equalBytes(certificate.issuer, issuer.subject)) return false;
  return verifySignatureWith(issuer.publicKey, algorithm.hash, certificate.signature, certificate.tbs);
}

/** ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER } -> r || s, each `size` bytes. */
function ecdsaRaw(der: Uint8Array, size: number): Uint8Array {
  const sequence = want(read(der, 0, der.length), SEQUENCE, "ECDSA signature");
  const [r, s, ...rest] = children(der, sequence);
  if (rest.length > 0) throw new CertificateError("unexpected ECDSA signature");
  const out = new Uint8Array(size * 2);
  for (const [k, integer] of [want(r, INTEGER, "r"), want(s, INTEGER, "s")].entries()) {
    let value = content(der, integer);
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    if (value.length > size) throw new CertificateError("ECDSA value too long");
    out.set(value, k * size + (size - value.length));
  }
  return out;
}
