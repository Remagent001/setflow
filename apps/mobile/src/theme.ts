// Theme system (Segment 20): dark and light palettes with a live toggle.
// `colors` is mutated IN PLACE on toggle and stylesheets are built through
// themedStyles() factories, so every screen re-skins without a restart.
// The virtual glasses lens (GlassesCardRN) intentionally stays black in both
// themes - it mirrors the real display, where black = transparent.

import { StyleSheet } from "react-native";

export type ThemeMode = "dark" | "light";

const dark = {
  bg: "#0d1117",
  panel: "#161b22",
  panel2: "#1c2330",
  border: "#2a3240",
  text: "#e6edf3",
  muted: "#8b98a9",
  accent: "#7aa2ff",
  green: "#57d9a3",
  red: "#ff7a7a",
  lensText: "#eaffff",
  lensDim: "#9adfff",
};

const light: typeof dark = {
  bg: "#f2f4f8",
  panel: "#ffffff",
  panel2: "#e8ecf3",
  border: "#d0d7e2",
  text: "#1b2330",
  muted: "#5f6b7d",
  accent: "#3564d9",
  green: "#118a5f",
  red: "#c93c3c",
  lensText: "#eaffff", // the lens stays dark by design
  lensDim: "#9adfff",
};

export type Palette = typeof dark;

/** The live palette. Mutated in place by setThemeMode - always read, never copy. */
export const colors: Palette = { ...dark };

let mode: ThemeMode = "dark";
let version = 0;
const listeners = new Set<() => void>();

export function getThemeMode(): ThemeMode {
  return mode;
}

export function setThemeMode(next: ThemeMode): void {
  if (next === mode) return;
  mode = next;
  Object.assign(colors, next === "dark" ? dark : light);
  version++;
  listeners.forEach((l) => l());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Wrap a StyleSheet factory so it rebuilds when the theme changes:
 *   const getStyles = themedStyles(() => StyleSheet.create({...}));
 *   ...inside the component: const styles = getStyles();
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(factory: () => T): () => T {
  let builtFor = -1;
  let cached: T;
  return () => {
    if (builtFor !== version) {
      cached = factory();
      builtFor = version;
    }
    return cached;
  };
}
