// Meta Ray-Ban Display adapter (Segment 19 spike).
// The real Meta SDKs cannot run here yet: the camera/mic-capable DAT SDK is
// a native iOS/Android library that lives inside the phone app build (not
// Expo Go), and the on-glasses Web App runtime doesn't run React Native at
// all. So this adapter's job today is honest capability detection - report
// nothing available, never crash, and let the app's existing capability
// gating fall back (typed/mobile input, phone-screen cards). The interface
// is the contract; the SDK calls drop in behind it later without touching
// the engine or the UI. See docs/META_INTEGRATION.md for the full plan.

import type { GlassesCapabilities, VoiceCaptureResult } from "@setflow/shared";
import { CapabilityUnavailableError, type GlassesAdapter } from "./types";

const NOTHING_AVAILABLE: GlassesCapabilities = {
  displayCards: false,
  playShortVideo: false,
  playAudioCues: false,
  captureMicrophone: false,
  captureCamera: false,
  gestures: false,
  offlineMediaCache: false,
};

/** True once a real Meta wearables SDK is linked into the host app. */
export function isMetaSdkAvailable(): boolean {
  // The DAT SDK exposes a native module; probe without importing so this
  // file stays safe in every runtime (Expo Go, web, node tests).
  try {
    const g = globalThis as Record<string, unknown>;
    return Boolean(g.__META_WEARABLES_SDK__);
  } catch {
    return false;
  }
}

export function createMetaGlassesAdapter(): GlassesAdapter {
  return {
    async getCapabilities() {
      // With a real SDK present this would query the device; until then,
      // everything is off and the app degrades per its capability gates.
      return { ...NOTHING_AVAILABLE };
    },
    async connect() {
      // Placeholder: real implementation pairs via the Meta AI app session.
    },
    async disconnect() {},
    async showCard() {
      throw new CapabilityUnavailableError("displayCards");
    },
    async playVideo() {
      throw new CapabilityUnavailableError("playShortVideo");
    },
    async playAudioCue() {
      throw new CapabilityUnavailableError("playAudioCues");
    },
    startVoiceCapture(): Promise<VoiceCaptureResult> {
      return Promise.reject(new CapabilityUnavailableError("captureMicrophone"));
    },
    async stopVoiceCapture() {},
    onGesture() {
      // No gesture stream without the device; the app's buttons cover it.
    },
  };
}
