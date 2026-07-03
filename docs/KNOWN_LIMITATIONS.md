# Known limitations (MVP, end of Segment 21)

Honest list of what the MVP does not do yet, and why.

## Data & accounts
- **Mock auth**: any email signs in; there are no real accounts. Supabase Auth
  is the planned swap (the database schema + RLS have been live since
  Segment 02, and `createSupabaseApiClient` already exists).
- **Data lives per device**: the phone persists everything locally
  (AsyncStorage); the web app persists to the browser (localStorage). They do
  not sync with each other until the Supabase client is switched on.
- **No cloud backup**: clearing the app/browser storage erases local data.

## Workout player
- **Mid-workout app kill loses the in-flight session**: completed sets are
  written incrementally, so logged sets survive, but the engine's position
  (current exercise/set, rest remaining) is not restored on relaunch.
- **Speech-to-text is typed**: the voice flow is real (parser, confirm,
  auto-save) but the transcript is typed or dictated via the keyboard mic.
  Native speech recognition needs a dev build (not Expo Go).
- **No audio yet**: audio cues and rest-timer sounds are settings only; sound
  playback lands with the audio pass.
- **Demo video playback on the phone**: demo cards render (with cue and clip
  metadata) but inline video playback isn't wired; web preview plays uploads.

## Builder & formats
- **Supersets are engine-level**: `supersetGroup` works end to end in the
  engine (tested), but the web builder has no UI to set it yet.
- **EMOM / AMRAP**: typed placeholders only, per the build plan.
- **Exercise media on the web** is stored in the browser (IndexedDB) until
  the Supabase storage bucket (migration 0002, already written) is applied.

## Glasses
- **No real glasses calls yet**: `createGlassesAdapter()` returns the mock;
  the Meta adapter reports zero capabilities until an SDK is linked.
  See `docs/META_INTEGRATION.md` for the two integration paths and the
  recommended first hardware step (on-glasses Web App).

## Platform
- **Expo SDK is pinned to 54** to match Expo Go on the test iPhone. Do not
  bump it without checking the phone's supported SDK first.
- **Android untested** (React Native should cover it; verify from a real
  device when the trainer starts testing).
