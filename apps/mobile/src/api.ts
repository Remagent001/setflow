// Single ApiClient for the mobile app. Mock mode, in-memory (persistence
// arrives with the offline cache in Segment 17); pre-seeded with the sample
// "Upper Body A" workout so the shell has data on first launch.

import { createMockApiClient, type ApiClient } from "@setflow/api-client";

let client: ApiClient | null = null;

export function getApi(): ApiClient {
  if (!client) client = createMockApiClient();
  return client;
}

export const MOCK_USER_ID = "mock-user";
