/// <reference types="@cloudflare/vitest-plugin/types" />

// Vite serves any file as a string with ?raw. Used for the certificate fixtures.
declare module "*?raw" {
  const content: string;
  export default content;
}
