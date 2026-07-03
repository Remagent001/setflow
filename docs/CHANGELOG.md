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
