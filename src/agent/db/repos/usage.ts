import { query, queryOne, execute } from "../client.js";

export async function logUsage(sessionId: string, promptTokens: number, completionTokens: number, costOg: number): Promise<void> {
  await execute(
    "INSERT INTO usage_log (session_id, prompt_tokens, completion_tokens, total_tokens, cost_og) VALUES ($1, $2, $3, $4, $5)",
    [sessionId, promptTokens, completionTokens, promptTokens + completionTokens, costOg],
  );
}

export interface UsageStats {
  sessionTokens: number;
  sessionCost: number;
  lifetimeTokens: number;
  lifetimeCost: number;
  requestCount: number;
  lastRequestAt: string | null;
}

export async function getUsageStats(sessionId?: string): Promise<UsageStats> {
  // Lifetime totals
  const lifetime = await queryOne<{ tokens: string; cost: string; count: string; last: string | null }>(
    "SELECT COALESCE(SUM(total_tokens),0) AS tokens, COALESCE(SUM(cost_og),0) AS cost, COUNT(*) AS count, MAX(created_at) AS last FROM usage_log",
  );

  // Session totals
  let sessionTokens = 0, sessionCost = 0;
  if (sessionId) {
    const session = await queryOne<{ tokens: string; cost: string }>(
      "SELECT COALESCE(SUM(total_tokens),0) AS tokens, COALESCE(SUM(cost_og),0) AS cost FROM usage_log WHERE session_id = $1",
      [sessionId],
    );
    sessionTokens = parseInt(session?.tokens ?? "0", 10);
    sessionCost = parseFloat(session?.cost ?? "0");
  }

  return {
    sessionTokens,
    sessionCost,
    lifetimeTokens: parseInt(lifetime?.tokens ?? "0", 10),
    lifetimeCost: parseFloat(lifetime?.cost ?? "0"),
    requestCount: parseInt(lifetime?.count ?? "0", 10),
    lastRequestAt: lifetime?.last ?? null,
  };
}
