// SetFlow mobile companion - skeleton. The real Expo app (screens: login,
// today's workout, workout detail, active player, history, settings) is
// scaffolded in Segment 10 per the build plan.

import type { GlassesCapabilities } from "@setflow/shared";

export const APP_NAME = "SetFlow";

// Proves the shared-types import path works from mobile (Segment 01
// acceptance criterion). The mobile-only fallback profile: no glasses at all.
export const MOBILE_ONLY_CAPABILITIES: GlassesCapabilities = {
  displayCards: false,
  playShortVideo: false,
  playAudioCues: false,
  captureMicrophone: false,
  captureCamera: false,
  gestures: false,
  offlineMediaCache: false,
};

export function placeholder(): string {
  return `${APP_NAME} mobile skeleton - Expo scaffold arrives in Segment 10.`;
}
