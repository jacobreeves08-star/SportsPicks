import { env } from "./env.js";

/**
 * Abstraction over the paid sports-data API. `mock` is used in dev/test so
 * local work and CI never make network calls or spend API quota; `live`
 * hits the real provider and is only wired up in staging/prod.
 */
export interface GameUpdate {
  externalGameId: string;
  status: "scheduled" | "in_progress" | "final";
  winningTeam?: string;
}

export interface SportsProvider {
  fetchUpdates(): Promise<GameUpdate[]>;
}

class MockSportsProvider implements SportsProvider {
  async fetchUpdates(): Promise<GameUpdate[]> {
    return [];
  }
}

class LiveSportsProvider implements SportsProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async fetchUpdates(): Promise<GameUpdate[]> {
    throw new Error("LiveSportsProvider not yet implemented — foundation phase only");
  }
}

export function createSportsProvider(): SportsProvider {
  if (env.SPORTS_API_PROVIDER === "mock") {
    return new MockSportsProvider();
  }
  return new LiveSportsProvider(env.SPORTS_API_BASE_URL!, env.SPORTS_API_KEY!);
}
