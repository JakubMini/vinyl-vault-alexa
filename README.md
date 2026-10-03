<div align="center">

# Vinyl Vault for Alexa

**Ask an Echo about my record collection.**

[![CI](https://github.com/JakubMini/vinyl-vault-alexa/actions/workflows/ci.yml/badge.svg)](https://github.com/JakubMini/vinyl-vault-alexa/actions/workflows/ci.yml)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Status](https://img.shields.io/badge/status-live_(private)-2ea44f)

</div>

The voice front end for [Vinyl Value Vault](https://github.com/JakubMini/vinyl-value-vault), which holds the collection and its prices. One Cloudflare Worker, free to run.

> "Alexa, ask vinyl vault what my collection is worth."
>
> *"Your 163 records are worth about £3,450. 12 of them haven't been priced yet, so the real total is higher."*

> [!NOTE]
> **Live since 2 October 2026** as a private skill on my own Amazon account. Weekly and yearly changes, and recommendations, wait on the vault. See the [roadmap](#roadmap).

## What you can ask

| Ask | It answers | |
| --- | --- | :---: |
| "What is my collection worth?" | Total value, record count, and how many aren't priced yet | ✅ |
| "Which record is the most valuable?" | The top record, then the next two | ✅ |
| "What has gained the most this month?" | The three biggest risers and what each gained | ✅ |
| "Do I have Rumours?" | Grade and value, how many copies, or a plain "no" | ✅ |
| "Recommend me a record." | Something I own, never one of the last ten suggested | 🚧 |

It's honest about gaps. Unpriced records are mentioned. With less than a month of history, "this month" becomes "since 2 October". Ask about a week or a year and it says it can only compare with a month ago for now.

> [!TIP]
> Private skills must be called by name ("ask vinyl vault…"). For fixed questions, an Alexa Routine hides that: **More → Routines → +**, voice trigger *"what is my vinyl collection worth"*, action *"ask vinyl vault what my collection is worth"*. It can't pass a record name through, so "do I have…" still needs the name.

## How it works

```mermaid
flowchart LR
  echo([Echo Dot]) -->|speech| alexa["Alexa service<br/>(Amazon)"]
  alexa -->|"signed HTTPS POST<br/>/alexa"| skill
  subgraph cf["Cloudflare"]
    skill["This Worker<br/>verify, route, phrase"]
    vault["Vinyl Value Vault<br/>Worker + D1"]
    skill -->|"service binding<br/>GET /api/…"| vault
  end
  skill -.->|"signing certificate<br/>(once per request)"| s3[("Amazon S3")]
```

1. Alexa turns speech into an intent using the [interaction model](skill-package/interactionModels/custom/en-GB.json) and posts it as signed JSON.
2. The Worker proves the request came from Alexa before reading it.
3. The intent's handler asks the vault for what it needs.
4. The answer is phrased for the ear ("one record", whole pounds, only the caveats that matter), then the session ends.

**The skill is thin on purpose.** Totals, price changes and anything stored live in the vault's API, the same figures its dashboard shows. The skill only ranks and matches the record list ([`src/collection.ts`](src/collection.ts)). It reaches the vault over a [service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/): no public hop, no extra cost, API key still checked.

<details>
<summary><b>How "Do I have…" matches</b></summary>

- Every meaningful word heard must appear in the artist or title. Filler like "any", "by", "the" or "a copy of" is ignored.
- Accents and punctuation don't matter: "bjork" finds Björk.
- Near misses count: "rumors" finds "Rumours". Words of five letters or more may be one letter off; nine or more, two.
- Discogs suffixes like "Nirvana (2)" are never matched or spoken.
- Records that have left the Discogs collection are dropped on arrival.

</details>

### Proving a request came from Alexa

The endpoint is public, so [`src/verify.ts`](src/verify.ts) checks every request before anything else runs:

| Check | Rule |
| --- | --- |
| Certificate URL | Exactly `https://s3.amazonaws.com/echo.api/…` |
| Certificate | In date, issued to `echo-api.amazon.com`, chains to an Amazon root pinned in the code |
| Signature | Matches the raw body (RSA or ECDSA, via WebCrypto) |
| Freshness | Under 150 seconds old, so replays fail |
| Skill id | Addressed to this skill |

Any failure is a `400`, logged with the reason.

> [!IMPORTANT]
> There is no bypass and no dev mode. Tests sign requests with a throwaway CA ([`scripts/make-test-certs.sh`](scripts/make-test-certs.sh)). Production trusts only Amazon's roots, and a test proves it rejects the test certificates.

<details>
<summary><b>How the certificate reader is tested</b></summary>

[`src/x509.ts`](src/x509.ts) replaced Node's `X509Certificate` to save ~8 ms of CPU. It's security code, so:

- On 25 certificates, every field it reads and every "who signed whom" pair is compared with Node's answer. They include Amazon's roots, today's signing chain and one from 2023.
- Every truncated, extended or single-byte-altered certificate is refused.
- Separate tests cover an ECDSA chain, an impostor reusing trusted names with its own keys, and a renamed intermediate keeping the real key.

</details>

### Staying inside 10 ms of CPU

The free plan allows 10 ms of CPU per request. Alexa traffic is sparse, so most requests hit a fresh isolate and pay start-up costs. The first version used 5–37 ms, nearly all of it on things the skill didn't need:

| Cost per fresh isolate[^laptop] | CPU | Replaced with |
| --- | ---: | --- |
| Loading `node:crypto` | ~8 ms | WebCrypto and a small X.509 reader |
| First `Intl.NumberFormat`, for "£3,450" | ~9 ms | Hand-written formatting, checked against `Intl` in a test |
| First `localeCompare`, for sort ties | ~6 ms | A plain comparison |
| Loading and building Zod schemas | ~10 ms | Type guards in [`src/shape.ts`](src/shape.ts) |

| | Before | After |
| --- | ---: | ---: |
| CPU per request (live, via Alexa) | 5–37 ms | 4 ms median, 12 ms worst seen |
| Bundle | 855 KiB | 80 KiB |
| Start-up (Cloudflare's measure) | 21 ms | 4 ms |

The 12 ms was a fresh isolate answering "do I have…", which scans every record. A test fails if any of those APIs comes back.

[^laptop]: Measured on a laptop. Cloudflare's machines are slower.

## Stack

| | Choice | Why |
| --- | --- | --- |
| Hosting | [Cloudflare Workers](https://developers.cloudflare.com/workers/) | The vault already lives there, one binding away. Lambda would add a second cloud for one endpoint. The price is doing Amazon's request checks myself. |
| HTTP | [Hono](https://hono.dev/) (`hono/tiny`) | Same router as the vault, smallest build. Two routes need nothing more. |
| Validation | Plain type guards | No Alexa SDK, no Zod. The skill uses a sliver of the format, and even `zod/mini` cost ~2 ms per cold start. |
| Language | TypeScript, strict | Binding types are generated from the Wrangler config. |
| Tests | [Vitest](https://vitest.dev/) in workerd | The real Workers runtime, a stub vault, and [MSW](https://mswjs.io/) for Amazon's certificate. No network. |
| Skill definition | [ASK CLI](https://developer.amazon.com/en-US/docs/alexa/smapi/ask-cli-intro.html) | Manifest and interaction model are JSON in this repo, not clicks in a console. |
| CI | GitHub Actions | Types, typecheck, tests and a dry-run deploy on every PR. |

## Run it locally

Needs Node 24, and the vault running in another terminal.

```bash
npm install
cp .dev.vars.example .dev.vars   # set VAULT_API_KEY to the vault's local API_KEY
npm run dev                      # http://localhost:8787
npm run check                    # types, typecheck, tests
```

Unsigned requests to `/alexa` are refused, so locally only `/health` answers. Exercise the skill through the tests, or the Alexa developer console once deployed.

<details>
<summary><b>Deploy and register the skill</b> (one-off, needs my logins)</summary>

1. **Skill.** Register as a developer at [developer.amazon.com](https://developer.amazon.com) with the Echo's Amazon account. Without that, the CLI fails with "There is no Vendor ID associated with your account". Then run `npx ask-cli configure` and `npx ask-cli deploy`. `ask-resources.json` has no infrastructure section, so AWS is never touched.
2. **Skill id.** The CLI writes it to `.ask/ask-states.json`, which is committed so later deploys update the same skill. Copy it to `ALEXA_SKILL_ID` in `wrangler.jsonc`. If that's empty, the Worker refuses every request.
3. **Worker.** Check `npx wrangler whoami` names the personal Cloudflare account. Then run `npx wrangler secret put VAULT_API_KEY` and `npm run deploy`. It lands at `https://vinyl-vault-alexa.jakub-m-szypicyn.workers.dev`, which `skill.json` points at.
4. **Test.** Use the console's test tab, then the Echo. A skill in development works on every device on the developer's account. The Echo's language must be English (UK).

Afterwards, changed utterances or intents need `npx ask-cli deploy`; changed code needs `npm run deploy`.

</details>

<details>
<summary><b>Project layout</b></summary>

```
src/
  index.ts         Worker entry: the app, trusting Amazon's roots
  app.ts           routes: /health, and /alexa (verify, parse, answer)
  verify.ts        proving a request came from Alexa
  x509.ts          reading certificates, checking signatures with WebCrypto
  amazon-roots.ts  the pinned Amazon root certificates
  envelope.ts      the Alexa request and response format
  shape.ts         type-guard checks for JSON from Alexa and the vault
  intents.ts       one handler per intent: what the skill says
  collection.ts    ranking and matching: most valuable, risers, "do I have"
  vault.ts         the vault client, over the service binding
  speech.ts        money, counts, lists, grades, dates, phrased for the ear
skill-package/     skill manifest and interaction model (ASK CLI)
scripts/           make-test-certs.sh: the throwaway CA for tests
test/              Vitest suites inside workerd; fixtures/certs holds the test chain
wrangler.jsonc     Worker config: the vault binding, the skill id
```

</details>

## How I work

- **Nothing lands on `main` directly.** Every change is a branch and a PR, merged only on green CI.
- **Every request check has a test** that fails if the check is removed. URL rules are tested against Amazon's own good and bad examples.
- **Model and code move together.** A test fails if an intent has no handler, or a handler no intent.
- **Performance is measured, not guessed.** CPU comes from `wrangler tail` on real Alexa requests, start-up from `wrangler check startup`, and hunches go through a profiler before any code changes.
- **No secrets in the repo.** `.dev.vars` locally, `wrangler secret put` in production.
- **This README stays true.** Changes to architecture, questions, setup or roadmap update it in the same PR.
- **AI-assisted.** Built with Claude Code as a pair programmer. Design decisions, reviews and merges are mine.

## Roadmap

- [x] Request verification and "what is my collection worth?"
- [x] Register the skill and deploy
- [x] "Which record is the most valuable?"
- [x] "What has gained the most this month?"
- [x] "Do I have …?"
- [ ] Vault: changes over a week or a year, and a log of recommendations ([vinyl-value-vault](https://github.com/JakubMini/vinyl-value-vault))
- [ ] Weekly and yearly changes, and "what has lost the most?"
- [ ] "Recommend me a record"
- [ ] Better recognition of record names, by feeding artists and titles into the interaction model
- [ ] "…and that's up £120 this month" on the collection total
- [ ] Cards with cover art in the Alexa app

## Licence

None yet, all rights reserved. Read and learn from it freely; ask before reusing.
