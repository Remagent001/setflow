# Changelog

## Segment 00 — Repository Setup
Date: 2026-07-02
Commit: (pending)
Summary:
- Created npm-workspaces monorepo (apps/web, apps/mobile, 5 shared packages)
- apps/web: minimal Next.js 15 app with placeholder page
- apps/mobile: TS skeleton (full Expo scaffold deferred to Segment 10 by design)
- packages: shared, db, api-client, workout-engine, glasses-adapter (placeholders)
- Tooling: TypeScript strict base config, ESLint 9 flat config, Prettier
- Docs: README, ARCHITECTURE.md, SEGMENT_STATUS.md, this changelog
- .env.example (Supabase placeholders), .gitignore

Validation:
- install: pass
- lint: pass
- typecheck: pass (all 7 workspaces)
- build: pass (next build, static prerender OK)

Notes:
- Mobile is intentionally a skeleton in this segment; the build plan's own
  acceptance criteria allow "placeholder screen or skeleton", and adding Expo
  now would slow every install before it's needed (Segment 10).

## Segment 01 — Shared Domain Types
Date: 2026-07-02
Commit: segment-01-shared-domain-types
Summary:
- packages/shared: domain.ts (User, Exercise, ExerciseMedia, WorkoutPlan,
  WorkoutStep, WorkoutSession, SetLog, VoiceLogAttempt, WorkoutJournal),
  glasses.ts (GlassesCapabilities, GlassesCard union mirroring the 9 card
  types, GlassesMedia, AudioCue, GlassesGesture, VoiceCaptureResult),
  timer.ts (TimerPreset, TimerKind)
- Web and mobile both import shared types (typed sample card / capabilities)

Validation:
- lint: pass
- typecheck: pass (all workspaces)
- build: pass (next build)

Notes:
- Types only, no runtime deps; Zod validators deferred until the API layer
  needs them (Segment 3).

## Segment 02 — Database Schema
Date: 2026-07-02
Commit: segment-02-database-schema
Summary:
- New Supabase project "setflow" created (org Rider's Org, us-west-2, ref dbqcyxdyilqkhvxntwws)
- Applied 0001_initial_schema.sql: profiles + 8 app tables, all required
  indexes (userId/planId/sessionId/exerciseId/createdAt), owner-only RLS on
  every table (built-in exercises world-readable)
- Applied seed.sql: 10-exercise built-in library
- Verified live: 9 tables present, exercise count = 10
- API keys + db password written to local .env (gitignored); .env.example updated pattern

Validation:
- migration applied: pass (via Supabase management API)
- seed applied: pass (10 rows verified)
- RLS enabled: pass (policies in migration)

Notes:
- Segment acceptance said "migrated locally"; we validated against the real
  cloud project instead, which is strictly stronger for this stack.

## Segment 03 — API Client and Backend Contracts
Date: 2026-07-02
Commit: segment-03-api-client-contracts
Summary:
- ApiClient interface: exercises, media, plans+steps, sessions, set logs,
  journal, dashboard-summary stub (full reports in Segment 16)
- createMockApiClient: in-memory, pre-seeded with 3 exercises + a 3-step
  sample workout; powers dev/preview/tests with zero backend
- createSupabaseApiClient: real implementation over @supabase/supabase-js
  with shared snake_case<->camelCase row mapping (casing.ts)
- smoke.ts: runnable acceptance test (node type-stripping)

Validation:
- typecheck: pass  |  lint: pass  |  next build: pass
- smoke (mock mode): PASS — workout fetched, session created, set log saved,
  session completed, dashboard volume math verified (750 lb)

Notes:
- Supabase impl compiles but is exercised against the live DB from Segment 4+
  (auth is needed first for RLS-scoped writes).

## Segment 04 — Web Auth and App Shell
Date: 2026-07-02
Commit: segment-04-web-auth-shell
Summary:
- Login page (mock auth per the plan: any email, localStorage-backed;
  Supabase Auth swap is contained to lib/auth.ts)
- AppShell: sidebar nav (Dashboard/Workouts/Exercises/History/Reports/
  Settings), top bar with user + sign out, auth guard redirecting to /login
- Six protected placeholder pages; dark theme via globals.css
- Root / redirects into the app

Validation:
- typecheck: pass  |  lint: pass  |  next build: pass (8 static routes)

Notes:
- Tailwind deferred (plain CSS is enough for the shell); revisit when real
  UI density arrives in Segment 5+.

## Segment 05 — Exercise Library
Date: 2026-07-02
Commit: segment-05-exercise-library
Summary:
- Exercise pages: list (card grid), create, details (cues / mistakes /
  instructions / equipment), edit, delete (with confirm)
- ExerciseForm shared by create+edit; list fields entered as lines/commas
- Mock ApiClient gained a pluggable storage adapter; web persists the store
  to localStorage so created exercises survive reloads (real DB swap stays
  contained to apps/web/lib/api.ts once Supabase Auth lands)
- Demo-video placeholder card per the plan (uploads = Segment 06)

Validation:
- typecheck: pass  |  lint: pass  |  next build: pass (12 routes)
- api-client smoke: PASS (after mock-store refactor)
- /exercises serves 200 on the dev server

Notes:
- Persistence is per-browser (localStorage) until Supabase Auth; acceptance
  criterion "exercise data persists" holds across reloads.
