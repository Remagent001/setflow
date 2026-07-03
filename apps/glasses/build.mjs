// Builds the on-glasses Web App into ONE self-contained index.html
// (ShadowJack-style), ready for GitHub Pages. Run from anywhere:
//   node apps/glasses/build.mjs

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [join(here, "src", "main.ts")],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  target: "es2020",
});

const js = result.outputFiles[0].text;
const template = readFileSync(join(here, "src", "template.html"), "utf8");
const html = template.replace("/*__APP__*/", () => js);

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "index.html"), html);
console.log(`built dist/index.html (${Math.round(html.length / 1024)} KB)`);
