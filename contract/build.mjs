import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// Wraps dts-bundle-generator so the output file explains itself — reading it
// unprompted looks like a wall of generated noise otherwise.
const OUT = "contract/dist/router.d.ts";

const HEADER = `/**
 * GENERATED FILE — do not edit, and don't read this to understand the API.
 *
 * A single, self-contained bundle of AppRouter's type, built from
 * src/router.ts by dts-bundle-generator. It exists so cookhouse-webplatform
 * (and a future mobile client) can import a real, derived tRPC type across a
 * repo boundary instead of the API's source. See cookhouse-api/CLAUDE.md ->
 * "Contract package" for why it looks like this, and why the inline
 * @prisma/client references inside are expected and harmless.
 *
 * To understand what the API does: read src/router.ts and the *.router.ts
 * files under src/modules/. To regenerate this file after any router change:
 * pnpm build:contract.
 */

`;

execFileSync("node_modules/.bin/dts-bundle-generator", ["--out-file", OUT, "src/router.ts"], {
  stdio: "inherit",
});

writeFileSync(OUT, HEADER + readFileSync(OUT, "utf8"));
