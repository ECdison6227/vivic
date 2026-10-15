import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp({ config });

/**
 * Production story (documented in README): after `pnpm --filter @vivic/web
 * build`, this same loopback process also serves apps/web/dist, so a single
 * `pnpm dev:api` can host the whole local product. Auth on /api is unchanged.
 */
const dist = path.resolve(import.meta.dirname, "../../web/dist");
if (fs.existsSync(dist)) {
  // Only real files under dist are served; /api and /healthz fall through to
  // the routes defined above.
  app.use("/*", serveStatic({ root: dist }));
}

serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  (info) => {
    console.log(`[vivic-local-api] listening on http://${info.address}:${info.port} (loopback only)`);
    if (config.tokenGenerated) {
      console.log(`[vivic-local-api] session token written to ${config.tokenPath}`);
    }
  },
);
