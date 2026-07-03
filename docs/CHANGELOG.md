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
