# SetFlow Architecture

Source of truth for product scope: the build document
(`setflow_claude_code_segmented_ddd.md` in the parent workspace).

## Core principle

- Web = planning (create workouts, exercises, demos; view reports)
- Mobile = syncing and session control (start sessions, fallback player, mic fallback)
- Glasses = execution (glanceable cards, demos, timers, voice logging)

## Monorepo

npm workspaces. TypeScript everywhere. Apps consume `packages/*` directly as
TS source (Next.js `transpilePackages`).

| Piece | Role | Built in |
|---|---|---|
| `apps/web` | Next.js app: auth, workout builder, exercise library, reports | Segments 4–7, 16 |
| `apps/mobile` | Expo companion: start sessions, workout player, voice fallback | Segments 10–11, 13, 17 |
| `packages/shared` | Domain types (User, Exercise, WorkoutPlan, SetLog, cards, capabilities) | Segment 1 |
| `packages/db` | Schema + migrations (Supabase Postgres planned) | Segment 2 |
| `packages/api-client` | Typed API operations, mock mode first | Segment 3 |
| `packages/workout-engine` | Platform-agnostic state machine (states, events, card generation) | Segment 8 |
| `packages/glasses-adapter` | `GlassesAdapter` interface: mock → mobile-fallback → Meta | Segments 9, 19 |

## Hard rules

1. **Never** hard-code Meta SDK behavior into the workout engine — everything
   glasses-specific goes through `packages/glasses-adapter`.
2. Glasses features are **capabilities that may be absent** (display, video,
   audio, mic, camera, gestures, offline cache). Every feature has a fallback
   (mobile mic, thumbnails, mobile controls, mobile-only player).
3. Glasses UI = **cards, not pages.** Minimal info during a set; demos before
   the set; rest/next info between sets.
4. Voice capture is **user-triggered only.** No always-listening. Transcripts
   stored, raw audio not stored.

## Backend plan (Segment 2+)

Supabase: Postgres + Auth + Storage for demo videos. The api-client wraps it
so the apps never talk to Supabase directly, and a mock mode works with no
backend at all.
