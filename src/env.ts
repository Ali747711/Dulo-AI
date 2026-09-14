// src/env.ts
// Load .env from the harness's own checkout, not from the working directory,
// and do it before any other module reads process.env. Import this first in
// every entry point (server.ts, index.ts): ES module imports run in order, and
// src/paths.ts reads DULO_* variables the moment it is evaluated.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: path.resolve(fileURLToPath(new URL("../.env", import.meta.url))), quiet: true });
