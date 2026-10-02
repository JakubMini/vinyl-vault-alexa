#!/bin/sh
# Generates the certificate chains the tests use in place of Amazon's echo-api certificate.
# Nothing here is trusted outside the test suite: the Worker only trusts the roots pinned in
# src/amazon-roots.ts, and tests hand the verifier test-root.pem explicitly.
#
# The output is committed, so this only needs running again to change the fixtures:
#   sh scripts/make-test-certs.sh
set -eu

out="$(cd "$(dirname "$0")/.." && pwd)/test/fixtures/certs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
days=36500

printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n' >"$tmp/ca.ext"
leaf_ext() {
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nsubjectAltName=DNS:%s\n' "$1" >"$tmp/leaf.ext"
}

# A self-signed root.
selfsigned() { # name subject
  openssl genrsa -out "$tmp/$1.key" 2048 2>/dev/null
  openssl req -new -key "$tmp/$1.key" -subj "$2" -out "$tmp/$1.csr"
  openssl x509 -req -sha256 -days "$days" -in "$tmp/$1.csr" -signkey "$tmp/$1.key" \
    -extfile "$tmp/ca.ext" -out "$tmp/$1.pem" 2>/dev/null
}

# A certificate for key $2 with subject $3, signed by CA $4, using extensions file $5.
issue() { # name key subject issuer extfile
  openssl req -new -key "$2" -subj "$3" -out "$tmp/$1.csr"
  openssl x509 -req -sha256 -days "$days" -in "$tmp/$1.csr" \
    -CA "$tmp/$4.pem" -CAkey "$tmp/$4.key" -set_serial "0x$(openssl rand -hex 8)" \
    -extfile "$5" -out "$tmp/$1.pem" 2>/dev/null
}

# The trusted test hierarchy: root -> intermediate -> leaf, like Amazon's.
selfsigned root "/CN=Vinyl Vault Alexa Test Root"
openssl genrsa -out "$tmp/intermediate.key" 2048 2>/dev/null
issue intermediate "$tmp/intermediate.key" "/CN=Vinyl Vault Alexa Test Intermediate" root "$tmp/ca.ext"

# One signing key for every leaf, so a request signed with it is valid under any of them and
# each test isolates exactly one fault.
openssl genrsa -out "$tmp/leaf-rsa.key" 2048 2>/dev/null
openssl pkcs8 -topk8 -nocrypt -in "$tmp/leaf-rsa.key" -out "$out/leaf-key.pem"

leaf_ext echo-api.amazon.com
issue leaf "$out/leaf-key.pem" "/CN=echo-api.amazon.com" intermediate "$tmp/leaf.ext"
leaf_ext echo-api.example.com
issue wrong-san "$out/leaf-key.pem" "/CN=echo-api.example.com" intermediate "$tmp/leaf.ext"

# An untrusted hierarchy that otherwise looks right.
selfsigned rogue "/CN=Rogue Root"
leaf_ext echo-api.amazon.com
issue rogue-leaf "$out/leaf-key.pem" "/CN=echo-api.amazon.com" rogue "$tmp/leaf.ext"

cp "$tmp/root.pem" "$out/test-root.pem"
cat "$tmp/leaf.pem" "$tmp/intermediate.pem" >"$out/chain.pem"
cat "$tmp/wrong-san.pem" "$tmp/intermediate.pem" >"$out/wrong-san-chain.pem"
cat "$tmp/rogue-leaf.pem" "$tmp/rogue.pem" >"$out/rogue-chain.pem"

echo "Wrote test certificates to $out"
