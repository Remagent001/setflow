// @setflow/glasses-adapter - the glasses abstraction (build doc section 13).
// Mock adapter ships first; the real Meta integration arrives as another
// implementation of the same interface (Segment 19).

import { createMetaGlassesAdapter, isMetaSdkAvailable } from "./meta";
import { createMockGlassesAdapter } from "./mock";
import type { GlassesAdapter } from "./types";

export { CapabilityUnavailableError, type GlassesAdapter } from "./types";
export {
  createMockGlassesAdapter,
  DEFAULT_MOCK_CAPABILITIES,
  type MockGlassesAdapter,
  type MockGlassesEvent,
} from "./mock";
export { createMetaGlassesAdapter, isMetaSdkAvailable } from "./meta";

/**
 * The adapter the app should use: the real Meta adapter when its SDK is
 * linked into the host build, otherwise the mock. Never throws, so the app
 * cannot crash from a missing SDK (Segment 19 acceptance).
 */
export function createGlassesAdapter(options?: { preferMock?: boolean }): GlassesAdapter {
  if (!options?.preferMock && isMetaSdkAvailable()) return createMetaGlassesAdapter();
  return createMockGlassesAdapter();
}

export const PACKAGE_NAME = "@setflow/glasses-adapter";
