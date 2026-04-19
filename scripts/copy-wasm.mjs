import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy the web-ifc WASM runtime and multi-threaded worker from node_modules
 * into public/web-ifc so the browser can fetch them from /web-ifc/*.
 *
 * This runs before `next build` (and on postinstall), which means the binary
 * artifacts never have to live in git — they are rehydrated from the pinned
 * npm package on every build. Keeps the repo small and the deploy reproducible
 * (Vercel will pull the exact same WASM every time).
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "node_modules", "web-ifc");
const dst = join(root, "public", "web-ifc");

const files = ["web-ifc.wasm", "web-ifc-mt.wasm", "web-ifc-mt.worker.js"];

if (!existsSync(src)) {
  // On CI/Vercel this should never happen because npm install runs first.
  // Log and bail softly — the Next build will still succeed, but IFC loading
  // will fail at runtime with a clearer 404 on the missing WASM.
  console.warn(
    `[copy-wasm] ${src} does not exist; skipping. Did npm install run?`
  );
  process.exit(0);
}

mkdirSync(dst, { recursive: true });

for (const name of files) {
  const from = join(src, name);
  const to = join(dst, name);
  if (!existsSync(from)) {
    console.warn(`[copy-wasm] missing ${from}, skipping`);
    continue;
  }
  cpSync(from, to);
  console.log(`[copy-wasm] ${name}`);
}
