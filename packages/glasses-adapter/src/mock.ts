// Mock glasses: full GlassesAdapter with no hardware. The preview UI
// subscribes to card/event changes, toggles capabilities live, injects
// gestures and voice results. Everything the real adapter will do, faked
// deterministically.

import type {
  AudioCue,
  GlassesCapabilities,
  GlassesCard,
  GlassesGesture,
  GlassesMedia,
  VoiceCaptureResult,
} from "@setflow/shared";
import { CapabilityUnavailableError, type GlassesAdapter } from "./types";

/** A line in the preview's event log. */
export type MockGlassesEvent = {
  kind:
    | "connect"
    | "disconnect"
    | "show_card"
    | "play_video"
    | "play_audio"
    | "voice_capture_start"
    | "voice_capture_stop"
    | "voice_result"
    | "gesture"
    | "error";
  detail: string;
};

export type MockGlassesAdapter = GlassesAdapter & {
  /** Preview hook: fires whenever the on-lens card changes (null = blank). */
  onCardChange(callback: (card: GlassesCard | null) => void): () => void;
  /** Preview hook: fires for every adapter activity (the event log). */
  onEvent(callback: (event: MockGlassesEvent) => void): () => void;
  /** Flip one capability at runtime (the preview's toggle switches). */
  setCapability(name: keyof GlassesCapabilities, enabled: boolean): void;
  /** Simulate the wearer performing a gesture. */
  emitGesture(gesture: GlassesGesture): void;
  /** Resolve a pending startVoiceCapture() as if the wearer spoke. */
  injectVoice(transcript: string, confidence?: number): void;
  /** Current card, for renderers that mount after showCard(). */
  currentCard(): GlassesCard | null;
  isConnected(): boolean;
};

export const DEFAULT_MOCK_CAPABILITIES: GlassesCapabilities = {
  displayCards: true,
  playShortVideo: true,
  playAudioCues: true,
  captureMicrophone: true,
  captureCamera: false, // Web Apps on the real device have no camera
  gestures: true,
  offlineMediaCache: false,
};

export function createMockGlassesAdapter(options?: {
  capabilities?: Partial<GlassesCapabilities>;
}): MockGlassesAdapter {
  const capabilities: GlassesCapabilities = {
    ...DEFAULT_MOCK_CAPABILITIES,
    ...options?.capabilities,
  };

  let connected = false;
  let card: GlassesCard | null = null;
  let cardListeners: Array<(card: GlassesCard | null) => void> = [];
  let eventListeners: Array<(event: MockGlassesEvent) => void> = [];
  const gestureListeners: Array<(gesture: GlassesGesture) => void> = [];
  let pendingVoice: {
    resolve: (result: VoiceCaptureResult) => void;
    reject: (error: Error) => void;
  } | null = null;

  const emitCard = () => cardListeners.forEach((l) => l(card));
  const emitEvent = (kind: MockGlassesEvent["kind"], detail: string) =>
    eventListeners.forEach((l) => l({ kind, detail }));

  const require = (name: keyof GlassesCapabilities) => {
    if (!capabilities[name]) {
      emitEvent("error", `blocked: ${name} capability is off`);
      throw new CapabilityUnavailableError(name);
    }
  };

  return {
    async getCapabilities() {
      return { ...capabilities };
    },

    async connect() {
      connected = true;
      emitEvent("connect", "glasses connected (mock)");
    },

    async disconnect() {
      connected = false;
      card = null;
      emitCard();
      emitEvent("disconnect", "glasses disconnected");
    },

    async showCard(next: GlassesCard) {
      require("displayCards");
      card = next;
      emitCard();
      emitEvent("show_card", next.kind);
    },

    async playVideo(media: GlassesMedia) {
      require("playShortVideo");
      emitEvent("play_video", `${media.mediaType}: ${media.url}`);
    },

    async playAudioCue(cue: AudioCue) {
      require("playAudioCues");
      emitEvent("play_audio", cue.text ? `${cue.kind}: "${cue.text}"` : cue.kind);
    },

    startVoiceCapture() {
      return new Promise<VoiceCaptureResult>((resolve, reject) => {
        try {
          require("captureMicrophone");
        } catch (err) {
          reject(err as Error);
          return;
        }
        // A new capture replaces any forgotten one.
        pendingVoice?.reject(new Error("voice capture superseded"));
        pendingVoice = { resolve, reject };
        emitEvent("voice_capture_start", "listening...");
      });
    },

    async stopVoiceCapture() {
      pendingVoice?.reject(new Error("voice capture stopped"));
      pendingVoice = null;
      emitEvent("voice_capture_stop", "stopped");
    },

    onGesture(callback) {
      gestureListeners.push(callback);
    },

    // --- mock/preview extensions --------------------------------------------

    onCardChange(callback) {
      cardListeners.push(callback);
      return () => {
        cardListeners = cardListeners.filter((l) => l !== callback);
      };
    },

    onEvent(callback) {
      eventListeners.push(callback);
      return () => {
        eventListeners = eventListeners.filter((l) => l !== callback);
      };
    },

    setCapability(name, enabled) {
      capabilities[name] = enabled;
      emitEvent("error", `capability ${name} -> ${enabled ? "on" : "off"}`);
      if (name === "displayCards" && !enabled) {
        card = null;
        emitCard();
      }
    },

    emitGesture(gesture) {
      if (!capabilities.gestures) {
        emitEvent("error", "blocked: gestures capability is off");
        return;
      }
      emitEvent("gesture", gesture);
      gestureListeners.forEach((l) => l(gesture));
    },

    injectVoice(transcript, confidence = 0.9) {
      if (!pendingVoice) {
        emitEvent("error", "no voice capture in progress");
        return;
      }
      const result: VoiceCaptureResult = {
        transcript,
        confidence,
        source: "glasses_mic",
      };
      const p = pendingVoice;
      pendingVoice = null;
      emitEvent("voice_result", `"${transcript}" (${Math.round(confidence * 100)}%)`);
      p.resolve(result);
    },

    currentCard() {
      return card;
    },

    isConnected() {
      return connected;
    },
  };
}
