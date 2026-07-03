// App settings store (Segment 20): privacy, units, sounds, theme.
// Persisted to AsyncStorage; hydrated at launch alongside the data store.
// Raw audio storage is not a setting - it's off, permanently, by design:
// voice capture is always user-triggered and only transcripts (optionally)
// are kept. There is no always-listening behavior anywhere in the app.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { setThemeMode, type ThemeMode } from "./theme";

export type AppSettings = {
  theme: ThemeMode;
  weightUnit: "lb" | "kg";
  /** Voice logging UI available in the player. Capture is tap-to-start only. */
  voiceLogging: boolean;
  /** Keep the spoken transcript on saved set logs. */
  storeTranscripts: boolean;
  /** Locked off: raw audio is never stored. Shown in Settings for transparency. */
  rawAudioStorage: false;
  demoAutoplay: boolean;
  audioCues: boolean;
  restTimerSounds: boolean;
  disclaimerAccepted: boolean;
};

const DEFAULTS: AppSettings = {
  theme: "dark",
  weightUnit: "lb",
  voiceLogging: true,
  storeTranscripts: true,
  rawAudioStorage: false,
  demoAutoplay: false,
  audioCues: true,
  restTimerSounds: true,
  disclaimerAccepted: false,
};

const KEY = "setflow-settings-v1";

let current: AppSettings = { ...DEFAULTS };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function initSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) current = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>), rawAudioStorage: false };
  } catch {
    current = { ...DEFAULTS };
  }
  setThemeMode(current.theme);
  return current;
}

export function getSettings(): AppSettings {
  return current;
}

export function updateSettings(patch: Partial<Omit<AppSettings, "rawAudioStorage">>): AppSettings {
  current = { ...current, ...patch, rawAudioStorage: false };
  if (patch.theme) setThemeMode(patch.theme);
  AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
  notify();
  return current;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
