# SetFlow

Hands-free workout player and workout logger for smart display glasses.

**The idea:** plan workouts on the web, start them from your phone, and follow
them on smart glasses — next exercise, short demo, set targets, rest timers —
then speak your weight and reps to log them, and review progress later.

- The **web app** is for planning.
- The **mobile app** is for syncing and session control.
- The **glasses** are for execution.

## Monorepo layout

```text
setflow/
  apps/
    web/              Next.js web app (planning, reports)
    mobile/           Mobile companion (Expo scaffold lands in Segment 10)
  packages/
    shared/           Domain types shared by everything
    db/               Database schema + migrations
    api-client/       Typed API operations
    workout-engine/   Platform-agnostic workout state machine
    glasses-adapter/  Glasses abstraction (mock first, Meta later)
  docs/               Build status, changelog, architecture
  scripts/            Dev/ops scripts
```

## Getting started

```bash
npm install
npm run typecheck
npm run lint
npm --workspace @setflow/web run dev   # web app on http://localhost:3000
```

## Build protocol

This project is built in **segments** (see `docs/SEGMENT_STATUS.md`). Each
segment is completed, validated, documented, and committed before the next
begins — a crash or interruption never loses more than the current segment.

## Disclaimer

SetFlow provides workout organization and tracking tools. It is not medical
advice. Stop exercising and consult a professional if you feel pain,
dizziness, or unusual discomfort.
