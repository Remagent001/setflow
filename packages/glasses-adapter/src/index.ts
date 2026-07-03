// @setflow/glasses-adapter - the glasses abstraction (build doc section 13).
// Mock adapter ships first; the real Meta integration arrives as another
// implementation of the same interface (Segment 19).

export { CapabilityUnavailableError, type GlassesAdapter } from "./types";
export {
  createMockGlassesAdapter,
  DEFAULT_MOCK_CAPABILITIES,
  type MockGlassesAdapter,
  type MockGlassesEvent,
} from "./mock";

export const PACKAGE_NAME = "@setflow/glasses-adapter";
