// Secrets are not in wrangler.jsonc, so `wrangler types` cannot know about them.
// They are merged into the generated Env here. Set with `wrangler secret put` in
// production and in .dev.vars locally.
interface AlexaSecrets {
  /** The vault's API key, sent as a Bearer token on every call over the VAULT binding. */
  VAULT_API_KEY: string;
}

interface Env extends AlexaSecrets {}

declare namespace Cloudflare {
  interface Env extends AlexaSecrets {}
}
