# Meta Ray-Ban Display integration notes (Segment 19)

How SetFlow will actually reach the glasses, based on hands-on research from
the Glass - Meta project (2026-07; ShadowJack shipped and verified on real
hardware there).

## The two integration paths

**1. Web App (on-glasses HTML/CSS/JS)** — a plain web page loaded onto the
glasses from an HTTPS link via the Meta AI app.

- Display: 600×600 logical pixels, right lens only, **black = transparent**
  (dark background, bright text, no scrolling). Our `GlassesCardView` /
  `GlassesCardRN` renderers already follow these rules.
- Input: Neural Band swipes arrive as **arrow keys**, pinches as
  **Enter/Escape**. No custom gesture API.
- Available: motion, compass, GPS, ~5 MB local storage.
- NOT available: **camera, microphone, text input**, Meta's built-in AI.
- Distribution: Developer Preview — private sharing to ~100 testers; no
  public store until "later in 2026".

**2. Native phone app + Meta Wearables DAT SDK** — a native iOS/Android SDK
inside the companion app (what LabelLens uses for camera access).

- Gives camera/mic bridging and on-lens Display rendering driven from the
  phone.
- No raw/custom gesture API as of SDK v0.8.0 — Meta engineers confirmed
  "not planned yet / roadmapped, no ETA" (facebook/meta-wearables-dat-ios
  issues #224, #228; dat-android #112). The glasses OS *does* give free
  swipe-between-Buttons navigation when a screen shows multiple Buttons.
- The DAT SDK is a native module: it requires a dev build (EAS / Xcode), not
  Expo Go.

## What SetFlow does today

- `createGlassesAdapter()` probes for the SDK (`isMetaSdkAvailable()`), gets
  the mock when absent — the app can never crash from a missing SDK.
- All feature gating runs on `GlassesCapabilities`; every capability defaults
  to unavailable in the Meta adapter until real calls exist.
- Voice logging falls back per build doc section 4: glasses mic → phone mic →
  typed input (typed input is what ships today).
- The mock adapter + `/glasses` web preview remain the development surface;
  they render the exact `GlassesCard` union the real lens will show.

## Recommended first hardware step

Ship the workout cards as a **Web App** (path 1): export a static page that
runs the shared `workout-engine` against the plan JSON and renders
`GlassesCard`s at 600×600, driven by arrow/enter keys (Neural Band). That
needs no SDK, works with Keith's proven ShadowJack pipeline (GitHub Pages +
Meta AI app), and exercises the real display constraints. Voice stays on the
phone until path 2 lands.

## Later: real DAT integration checklist

1. Eject to an Expo dev build (EAS) so native modules can link.
2. Add the DAT SDK; register the app in the Meta Wearables Developer Center
   (Keith already has an account + a registered project from LabelLens).
3. Implement `meta.ts`: session pairing, `showCard` → Display Button rows
   (mirrors Meta's CarMaintenanceDisplay sample), mic capture → voice parser.
4. Set `globalThis.__META_WEARABLES_SDK__` from the native bootstrap so
   `isMetaSdkAvailable()` flips and `createGlassesAdapter()` picks the real
   adapter automatically.
