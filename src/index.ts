import { AMAZON_ROOT_PEMS } from "./amazon-roots";
import { createApp } from "./app";

const app = createApp({ trustAnchors: AMAZON_ROOT_PEMS });

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
