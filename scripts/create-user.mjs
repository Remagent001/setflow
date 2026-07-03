// Creates (or resets) a SetFlow account directly via the Supabase admin API,
// pre-confirmed so no email link is needed. Local use only - reads the
// git-ignored .env for the service-role key, which must never ship in an app.
//   node scripts/create-user.mjs <email> <password>

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error("usage: node scripts/create-user.mjs <email> <password>");
  process.exit(1);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: created, error } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error && error.message.includes("already")) {
  // Existing account: reset the password instead.
  const { data: list } = await sb.auth.admin.listUsers();
  const user = list.users.find((u) => u.email === email);
  if (!user) throw new Error(`could not find existing user ${email}`);
  const { error: updateError } = await sb.auth.admin.updateUserById(user.id, { password });
  if (updateError) throw updateError;
  console.log(`password reset for ${email} (id ${user.id})`);
} else if (error) {
  throw error;
} else {
  console.log(`created ${email} (id ${created.user.id}), email pre-confirmed`);
}
