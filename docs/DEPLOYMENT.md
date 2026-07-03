# Running & deploying SetFlow

## Prerequisites
- Node 20+ and npm
- One `npm install` at the repo root (npm workspaces)

## Web app (planning, builder, reports)
```bash
npm --workspace @setflow/web run dev -- -p 3001   # dev server
npm --workspace @setflow/web run build            # production build
npm --workspace @setflow/web run start            # serve the build
```
Note: don't run `build` while a dev server is running — they share `.next/`
and the dev server will start returning 404s for its assets (restart it).
Port 3000 is often taken on Keith's PC (Kompl); use 3001.

## Phone app (Expo)
```bash
cd apps/mobile
npx expo start --port 8091
```
Open **Expo Go** on the phone (same Wi-Fi) and scan the QR / enter
`exp://<pc-ip>:8091`. The project is **pinned to Expo SDK 54** — the version
Expo Go on the test iPhone supports. To verify what the server advertises:
the manifest at `http://localhost:8091/` must say `"runtimeVersion":
"exposdk:54.0.0"`.

## Demo account & data
- Sign in with **any email** (mock auth).
- The store seeds three exercises and the "Upper Body A" workout on first
  run, so the full flow — Today → Start workout → sets/voice/rest → History
  → Reports — works immediately.
- Full reset: uninstall/reinstall Expo Go's app data, or clear the browser's
  site data for the web app.

## Quality gates (all must pass before pushing)
```bash
npm run typecheck --workspaces --if-present
npm run lint
npm --workspace @setflow/workout-engine run test   # 43 tests
npm --workspace @setflow/api-client run smoke
npm --workspace @setflow/web run build
```

## Switching to the real backend (when ready)
1. Supabase project `setflow` already exists (schema + RLS from Segment 02;
   keys in `setflow/.env`, git-ignored).
2. Apply migration `packages/db/supabase/migrations/0002_storage_media_bucket.sql`.
3. Swap `createMockApiClient` for `createSupabaseApiClient` in
   `apps/web/lib/api.ts` and `apps/mobile/src/api.ts` (both are single-file
   swap points by design), wire Supabase Auth, and the mobile write queue
   becomes the sync path.
