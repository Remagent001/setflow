// The glasses abstraction (build doc section 13.1, verbatim interface).
// The app programs against this; implementations are the mock (Segment 09)
// and the real Meta integration (Segment 19 spike). Never call Meta SDKs
// outside an adapter.

import type {
  AudioCue,
  GlassesCapabilities,
  GlassesCard,
  GlassesGesture,
  GlassesMedia,
  VoiceCaptureResult,
} from "@setflow/shared";

export interface GlassesAdapter {
  getCapabilities(): Promise<GlassesCapabilities>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  showCard(card: GlassesCard): Promise<void>;
  playVideo(media: GlassesMedia): Promise<void>;
  playAudioCue(cue: AudioCue): Promise<void>;

  startVoiceCapture(): Promise<VoiceCaptureResult>;
  stopVoiceCapture(): Promise<void>;

  onGesture(callback: (gesture: GlassesGesture) => void): void;
}

/** Thrown when a call needs a capability the device doesn't have. */
export class CapabilityUnavailableError extends Error {
  readonly capability: keyof GlassesCapabilities;

  constructor(capability: keyof GlassesCapabilities) {
    super(`Glasses capability unavailable: ${capability}`);
    this.name = "CapabilityUnavailableError";
    this.capability = capability;
  }
}
