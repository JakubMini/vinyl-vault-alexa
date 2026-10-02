import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AMAZON_ROOT_PEMS } from "../src/amazon-roots";
import { CertificateError, type Certificate, isSignedBy, parseCertificate, pemCertificates } from "../src/x509";
import {
  chainPem,
  currentAmazonChainPem,
  ecChainPem,
  ecRootPem,
  impostorChainPem,
  realAmazonChainPem,
  renamedIntermediatePem,
  rogueChainPem,
  testRootPem,
  wrongSanChainPem,
} from "./helpers";

// The hand-written parser is checked against node:crypto, which the Worker no longer loads but
// the tests can: every certificate the tests or production meet, read both ways.
const bundles = {
  "test chain": chainPem,
  "test root": testRootPem,
  "wrong-SAN chain": wrongSanChainPem,
  "rogue chain": rogueChainPem,
  "EC chain": ecChainPem,
  "EC root": ecRootPem,
  "impostor chain": impostorChainPem,
  "renamed intermediate": renamedIntermediatePem,
  "real Amazon chain (2023)": realAmazonChainPem,
  "Amazon chain in use (2026)": currentAmazonChainPem,
  "pinned Amazon roots": AMAZON_ROOT_PEMS.join("\n"),
};

interface Pair {
  name: string;
  ours: Certificate;
  node: X509Certificate;
}

const certificates: Pair[] = Object.entries(bundles).flatMap(([bundle, pem]) =>
  pemCertificates(pem).map((der, i) => ({
    name: `${bundle} #${i}`,
    ours: parseCertificate(der),
    node: new X509Certificate(der),
  })),
);

describe("parseCertificate, against node:crypto", () => {
  it("has every fixture to compare", () => {
    expect(certificates.length).toBe(2 + 1 + 2 + 2 + 2 + 1 + 2 + 1 + 4 + 3 + 5);
  });

  it.each(certificates.map((c) => [c.name, c] as const))("reads %s the same way", (_name, { ours, node }) => {
    expect(ours.notBefore).toEqual(new Date(node.validFrom));
    expect(ours.notAfter).toEqual(new Date(node.validTo));
    expect(ours.isCA).toBe(node.ca);
    const sans = (node.subjectAltName ?? "").split(/,\s*/).filter((s) => s.startsWith("DNS:")).map((s) => s.slice(4));
    expect(ours.dnsNames).toEqual(sans);
    expect(ours.publicKey.spki).toEqual(new Uint8Array(node.publicKey.export({ type: "spki", format: "der" })));
    expect(ours.der).toEqual(new Uint8Array(node.raw));
  });

  it("agrees on which certificate signed which, for every pair", async () => {
    let signed = 0;
    for (const a of certificates) {
      for (const b of certificates) {
        const nodeSays = a.node.checkIssued(b.node) && a.node.verify(b.node.publicKey);
        expect(await isSignedBy(a.ours, b.ours), `${a.name} signed by ${b.name}`).toBe(nodeSays);
        if (nodeSays) signed++;
      }
    }
    expect(signed).toBeGreaterThan(10); // the comparison really covered real links, RSA and ECDSA
  });
});

describe("parseCertificate, on damaged input", () => {
  const [leafDer] = pemCertificates(chainPem);
  const [intermediateDer] = pemCertificates(chainPem).slice(1);
  const intermediate = parseCertificate(intermediateDer!);

  it("refuses every truncation with a CertificateError, never a crash", () => {
    for (let length = 0; length < leafDer!.length; length++) {
      expect(() => parseCertificate(leafDer!.subarray(0, length)), `first ${length} bytes`).toThrow(CertificateError);
    }
  });

  it("refuses trailing bytes", () => {
    const longer = new Uint8Array([...leafDer!, 0]);
    expect(() => parseCertificate(longer)).toThrow(CertificateError);
  });

  it("never accepts a certificate with any single byte changed", async () => {
    for (let i = 0; i < leafDer!.length; i++) {
      const damaged = leafDer!.slice();
      damaged[i]! ^= 0x01;
      let parsed: Certificate;
      try {
        parsed = parseCertificate(damaged);
      } catch (error) {
        expect(error, `byte ${i}`).toBeInstanceOf(CertificateError);
        continue;
      }
      expect(await isSignedBy(parsed, intermediate), `byte ${i}`).toBe(false);
    }
  });
});
