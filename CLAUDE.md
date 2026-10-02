# Vinyl Vault Alexa: working agreement

Rules for anyone (human or Claude) changing this repo. Read before touching code.

This repo is the voice front end for [vinyl-value-vault](https://github.com/JakubMini/vinyl-value-vault).
The vault owns the data and the logic; this Worker turns Alexa requests into vault API calls
and vault answers into speech. Nothing more.

## Branches, commits, pull requests

- **Never commit to main.** Every piece of work, however small, gets its own branch cut from an
  up-to-date main and lands through a pull request. Fixing a typo in the README is a branch too.
- Branch names say what the branch is for: `feat/<thing>`, `fix/<thing>`, `chore/<thing>`, `docs/<thing>`.
- Start every task with: `git switch main && git pull --ff-only && git switch -c <branch>`.
- One PR, one purpose. If you notice something unrelated, note it and open a separate branch later.
- Commit subjects are imperative and under 72 characters. Say what changed; say why when it is not obvious.
- Run `npm run check` (types, typecheck, tests) before pushing. CI must be green before merging.
- The PR body says what changed, how it was verified, and whether the README needed updating.

## The README is for humans

- The README is the front door. It is written for someone deciding in two minutes whether this
  project, and the person behind it, are worth their attention: often a technical recruiter or a
  hiring engineer. It must explain what the skill does, how it works, why the stack was chosen,
  how to run it, how work is done here, and where it is heading.
- Keep it true. Any PR that changes the architecture, the interaction model, setup steps or the
  roadmap updates the README in the same PR. Stale docs are a bug.
- Plain English first, code second. Explain decisions, not just facts. Short sentences.
- Do not inflate. Say what is built and tested, what is deployed, and what is still an idea.

## Cloudflare account: check it first

- This machine is logged in to one of two Cloudflare accounts. This Worker, like the vault, lives
  only on the **personal account, jakub.m.szypicyn@gmail.com**. The work account,
  jakub@blueskyip.com, must never be used for this project: do not deploy, set secrets or create
  resources there. The service binding to the vault only works on the personal account anyway.
- Before any wrangler command that touches Cloudflare (deploy, `secret`, `tail`), run
  `npx wrangler whoami` and confirm it names jakub.m.szypicyn@gmail.com. If it names anything
  else, stop and ask Jakub to switch: `npx wrangler logout && npx wrangler login`. Never log in on
  Jakub's behalf.
- The same goes for the Amazon developer account behind the ASK CLI: Jakub logs in with
  `npx ask-cli configure`; never do it on Jakub's behalf.
- Run wrangler from this repo's root, so it uses this project's `wrangler.jsonc` and Worker name.

## Alexa rules

- **Never weaken request verification.** Every request to `/alexa` must pass the signature,
  certificate chain, timestamp and skill id checks in `src/verify.ts` before anything else runs.
  No bypass flag, no "dev mode". Tests sign requests with a test CA instead.
- **The interaction model and the handlers move together.** Every custom intent in
  `skill-package/interactionModels/custom/*.json` has a handler in `src/intents.ts` and vice
  versa; a test enforces it. Changing utterances means `ask deploy` afterwards (see README).
- Speech is short. One answer, then end the session, unless the user opened the skill without a
  question. Say honestly when the vault does not know something yet (short price history,
  unpriced records) rather than guessing.
- Logs never contain Alexa user ids, device ids or `apiAccessToken`.

## Stack and conventions

- TypeScript in strict mode on Cloudflare Workers. Hono for HTTP, Zod for validation, Vitest
  running inside workerd for tests. No Alexa SDK: the request envelope is small and typed with Zod.
- Where things live: the Worker entry in `src/index.ts`; routes in `src/app.ts`; request verification in
  `src/verify.ts` with the pinned Amazon roots in `src/amazon-roots.ts`; the request envelope and
  response builder in `src/envelope.ts`; intent handlers in `src/intents.ts`; ranking and matching the record list in
  `src/collection.ts`; the vault client in
  `src/vault.ts`; phrasing helpers (money, lists, grades) in `src/speech.ts`; the Alexa skill
  manifest and interaction model in `skill-package/`.
- Anything worked out from price history (totals, value changes) or stored (recommendations)
  belongs in the vault's API, not here. The vault returns the whole collection in one page, as its
  dashboard uses it; ranking and matching that list for speech happens here, in
  `src/collection.ts`. If a question needs new data, add a vault endpoint first.
- The vault is reached through the `VAULT` service binding, never its public URL. Its bearer
  auth still applies: `VAULT_API_KEY` is a secret.
- Money arrives from the vault as integers in minor units (pence). Condition grades use the
  Goldmine scale: M, NM, VG+, VG, G+, G, F, P.
- Config lives in `wrangler.jsonc`. After changing bindings or vars run `npm run types`. The
  generated `worker-configuration.d.ts` is not committed. Secret names and types are declared in
  `src/env.d.ts`; secret values are never in the repo (`.dev.vars` locally, `wrangler secret put`
  in production).
- Respect the Workers free-plan budget: at most 50 outbound fetches and 10 ms CPU per invocation.
  A request here costs one fetch for Amazon's certificate and one vault call.
- Alexa waits 8 seconds at most. Vault calls time out well before that.
- Behaviour changes come with tests. Tests mock the network with Mock Service Worker and stub
  the vault binding; they never touch the internet.
- Logs are structured JSON: `console.log(JSON.stringify({ event: "...", ... }))`.
- Follow Cloudflare's Workers best practices: no request state in module scope, no floating
  promises, `ctx.waitUntil` for background work, timing-safe secret comparison, explicit error
  handling rather than `passThroughOnException`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local Worker on port 8787. |
| `npm run check` | Regenerate types, typecheck, run tests. Run before every push. |
| `npm test` | Tests only. |
| `npm run deploy` | Deploy the Worker to Cloudflare. |
| `npx ask-cli deploy` | Push `skill-package/` (manifest and interaction model) to the Alexa developer console. |
