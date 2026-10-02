import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

import { TEST_VAULT_API_KEY, fakeVault } from "./test/fake-vault.ts";

// Tests run inside the Workers runtime (workerd). The vault binding is replaced by a stub, and
// the network is mocked by test/setup-network.ts, so nothing leaves the machine.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ALEXA_SKILL_ID: "amzn1.ask.skill.test",
          VAULT_API_KEY: TEST_VAULT_API_KEY,
        },
        serviceBindings: { VAULT: fakeVault },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup-network.ts"],
  },
});
