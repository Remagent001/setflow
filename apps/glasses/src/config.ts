// Supabase URL + anon key, injected at build time by build.mjs (esbuild
// `define`). Both are PUBLIC values - the web app already ships them to every
// browser - so baking them into the glasses HTML leaks nothing. The `typeof`
// guard keeps this importable in plain-node tests where define didn't run.

declare const __SF_SUPABASE_URL__: string;
declare const __SF_SUPABASE_ANON__: string;

export const SUPABASE_URL =
  typeof __SF_SUPABASE_URL__ !== "undefined" ? __SF_SUPABASE_URL__ : "";
export const SUPABASE_ANON =
  typeof __SF_SUPABASE_ANON__ !== "undefined" ? __SF_SUPABASE_ANON__ : "";
