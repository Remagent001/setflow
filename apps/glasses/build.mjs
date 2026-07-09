// Builds the on-glasses Web App into ONE self-contained index.html
// (ShadowJack-style), then stages it + its icons for hosting. Run from anywhere:
//   node apps/glasses/build.mjs
//
// The Supabase URL + anon key are read from setflow/.env and inlined at build
// time (both are PUBLIC client values - the web app ships them too). The built
// app + static assets land in TWO places:
//   apps/glasses/dist/        - the standalone bundle (reference / manual deploy)
//   apps/web/public/glasses-app/ - served by the SetFlow site at /glasses-app/
// so the glasses no longer depend on the separate glass-apps repo.

import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(here)); // setflow/

// --- public Supabase config from .env (safe to inline: client-side values) ---
function readEnv() {
  try {
    const raw = readFileSync(join(repoRoot, ".env"), "utf8");
    return Object.fromEntries(
      raw.split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
    );
  } catch {
    return {};
  }
}
const env = readEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn("⚠  NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY missing from .env - the glasses will show the pair screen and can't sync.");
}

const result = await build({
  entryPoints: [join(here, "src", "main.ts")],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  target: "es2020",
  define: {
    __SF_SUPABASE_URL__: JSON.stringify(SUPABASE_URL),
    __SF_SUPABASE_ANON__: JSON.stringify(SUPABASE_ANON),
  },
});

const js = result.outputFiles[0].text;
const template = readFileSync(join(here, "src", "template.html"), "utf8");
const html = template.replace("/*__APP__*/", () => js);

// Stage into dist/ and the web app's public/glasses-app/.
const staticDir = join(here, "static");
const targets = [join(here, "dist"), join(repoRoot, "apps", "web", "public", "glasses-app")];
for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  for (const f of readdirSync(staticDir)) copyFileSync(join(staticDir, f), join(dir, f));
}

console.log(`built index.html (${Math.round(html.length / 1024)} KB) -> dist/ + apps/web/public/glasses-app/`);
console.log(`  supabase: ${SUPABASE_URL ? "configured" : "MISSING"}`);
