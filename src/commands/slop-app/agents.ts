import { Command } from "commander";
import { loadConfig } from "../../config/store.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner } from "../../utils/ui.js";
import { fetchWithTimeout } from "../../utils/http.js";
import { requireSlopAuth } from "../../slop/auth.js";

// --- Types ---

interface AgentFilter {
  field: string;
  op: string;
  value: string | number | boolean | (string | number)[];
}

interface AgentQuery {
  source: "tokens";
  filters?: AgentFilter[];
  orderBy?: { field: string; direction?: "asc" | "desc" };
  limit?: number;
  offset?: number;
}

interface AgentQueryResponse {
  tokens: Record<string, unknown>[];
  count: number;
  cached: boolean;
}

// --- Helpers ---

function normalizeQuery(query: AgentQuery): AgentQuery {
  const normalized: AgentQuery = {
    source: query.source,
    orderBy: query.orderBy ?? { field: "created_at_ms", direction: "desc" },
    limit: query.limit ?? 50,
  };
  if (query.filters && query.filters.length > 0) {
    normalized.filters = query.filters;
  }
  if (query.offset && query.offset > 0) {
    normalized.offset = query.offset;
  }
  return normalized;
}

async function executeAgentQuery(query: AgentQuery): Promise<AgentQueryResponse> {
  const { address, privateKey } = requireWalletAndKeystore();
  const cfg = loadConfig();

  const normalized = normalizeQuery(query);

  // 1. Authenticate (JWT)
  const accessToken = await requireSlopAuth(
    privateKey,
    address,
    cfg.services.backendApiUrl
  );

  // 2. Execute query with Bearer auth
  const response = await fetchWithTimeout(
    `${cfg.services.backendApiUrl}/agents/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query: normalized }),
    }
  );

  const body = (await response.json()) as { success: boolean; data?: Record<string, unknown>[]; error?: string; cached?: boolean };

  if (!response.ok) {
    const status = response.status;
    if (status === 400) {
      throw new EchoError(ErrorCodes.AGENT_QUERY_INVALID, body.error || "Invalid query");
    }
    if (status === 401) {
      throw new EchoError(ErrorCodes.SLOP_AUTH_FAILED, body.error || "Authentication failed");
    }
    if (status === 403) {
      throw new EchoError(
        ErrorCodes.PROFILE_NOT_FOUND,
        body.error || "Profile required",
        "Register profile first: echoclaw slop-app profile register --username <name> --yes --json"
      );
    }
    if (status === 429) {
      throw new EchoError(ErrorCodes.AGENT_QUERY_FAILED, "Rate limited, try again later");
    }
    if (status === 504) {
      throw new EchoError(ErrorCodes.AGENT_QUERY_TIMEOUT, "Query too complex, simplify filters");
    }
    throw new EchoError(ErrorCodes.AGENT_QUERY_FAILED, body.error || `Query failed (HTTP ${status})`);
  }

  if (!body.success) {
    throw new EchoError(ErrorCodes.AGENT_QUERY_FAILED, body.error || "Query failed");
  }

  const tokens = body.data || [];
  return { tokens, count: tokens.length, cached: body.cached ?? false };
}

function formatAgentTable(tokens: Record<string, unknown>[]): string {
  if (tokens.length === 0) return "No tokens found.";

  const header = `${"Symbol".padEnd(12)} ${"Name".padEnd(20)} ${"Price".padEnd(14)} ${"Vol 24h".padEnd(14)} ${"Status".padEnd(10)}`;
  const sep = "-".repeat(header.length);
  const rows = tokens.map((t) => {
    const sym = String(t.symbol ?? "").slice(0, 11).padEnd(12);
    const name = String(t.name ?? "").slice(0, 19).padEnd(20);
    const price = t.actual_price != null ? Number(t.actual_price).toFixed(6).padEnd(14) : "N/A".padEnd(14);
    const vol = t.volume_24h != null ? Number(t.volume_24h).toFixed(2).padEnd(14) : "N/A".padEnd(14);
    const status = String(t.status ?? "").padEnd(10);
    return `${sym} ${name} ${price} ${vol} ${status}`;
  });

  return [header, sep, ...rows].join("\n");
}

function collect(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}

// --- Commands ---

export function createAgentsSubcommand(): Command {
  const agents = new Command("agents")
    .description("Query tokens via Agent DSL")
    .exitOverride();

  agents
    .command("query")
    .description("Execute agent query with full DSL")
    .requiredOption("--source <source>", "Data source (tokens)")
    .option("--filter <json>", "Filter as JSON (repeatable)", collect, [])
    .option("--order-by <field>", "Order by field")
    .option("--order-dir <dir>", "Order direction (asc|desc)")
    .option("--limit <n>", "Result limit (1-200)")
    .option("--offset <n>", "Result offset")
    .action(async (options: {
      source: string;
      filter: string[];
      orderBy?: string;
      orderDir?: string;
      limit?: string;
      offset?: string;
    }) => {
      // Parse filters
      const filters: AgentFilter[] = [];
      for (const raw of options.filter) {
        try {
          const parsed = JSON.parse(raw) as AgentFilter;
          if (!parsed.field || !parsed.op) {
            throw new Error("Filter must have 'field' and 'op'");
          }
          filters.push(parsed);
        } catch (err) {
          throw new EchoError(
            ErrorCodes.AGENT_QUERY_INVALID,
            `Invalid filter JSON: ${raw}`,
            'Expected format: \'{"field":"status","op":"=","value":"active"}\''
          );
        }
      }

      const query: AgentQuery = {
        source: options.source as "tokens",
      };

      if (filters.length > 0) query.filters = filters;

      if (options.orderBy) {
        query.orderBy = {
          field: options.orderBy,
          direction: (options.orderDir as "asc" | "desc") || "desc",
        };
      }

      if (options.limit) {
        const limit = parseInt(options.limit, 10);
        if (isNaN(limit) || limit < 1 || limit > 200) {
          throw new EchoError(ErrorCodes.AGENT_QUERY_INVALID, "Limit must be 1-200");
        }
        query.limit = limit;
      }

      if (options.offset) {
        const offset = parseInt(options.offset, 10);
        if (isNaN(offset) || offset < 0) {
          throw new EchoError(ErrorCodes.AGENT_QUERY_INVALID, "Offset must be >= 0");
        }
        query.offset = offset;
      }

      const spin = spinner("Querying agents API...");
      spin.start();

      try {
        const result = await executeAgentQuery(query);
        spin.succeed(`Query returned ${result.count} tokens`);

        if (isHeadless()) {
          writeJsonSuccess({ tokens: result.tokens, count: result.count, cached: result.cached });
        } else {
          console.log(formatAgentTable(result.tokens));
        }
      } catch (err) {
        spin.fail("Query failed");
        throw err;
      }
    });

  agents
    .command("trending")
    .description("Top tokens by 24h volume")
    .option("--limit <n>", "Result limit (default: 20)")
    .action(async (options: { limit?: string }) => {
      const limit = options.limit ? parseInt(options.limit, 10) : 20;

      const spin = spinner("Fetching trending tokens...");
      spin.start();

      try {
        const result = await executeAgentQuery({
          source: "tokens",
          orderBy: { field: "volume_24h", direction: "desc" },
          limit,
        });
        spin.succeed(`Trending: ${result.count} tokens`);

        if (isHeadless()) {
          writeJsonSuccess({ tokens: result.tokens, count: result.count, cached: result.cached });
        } else {
          console.log(formatAgentTable(result.tokens));
        }
      } catch (err) {
        spin.fail("Failed to fetch trending tokens");
        throw err;
      }
    });

  agents
    .command("newest")
    .description("Newest tokens by creation time")
    .option("--limit <n>", "Result limit (default: 20)")
    .action(async (options: { limit?: string }) => {
      const limit = options.limit ? parseInt(options.limit, 10) : 20;

      const spin = spinner("Fetching newest tokens...");
      spin.start();

      try {
        const result = await executeAgentQuery({
          source: "tokens",
          orderBy: { field: "created_at_ms", direction: "desc" },
          limit,
        });
        spin.succeed(`Newest: ${result.count} tokens`);

        if (isHeadless()) {
          writeJsonSuccess({ tokens: result.tokens, count: result.count, cached: result.cached });
        } else {
          console.log(formatAgentTable(result.tokens));
        }
      } catch (err) {
        spin.fail("Failed to fetch newest tokens");
        throw err;
      }
    });

  agents
    .command("search")
    .description("Search tokens by name (ILIKE)")
    .requiredOption("--name <pattern>", "Name search pattern")
    .option("--limit <n>", "Result limit (default: 20)")
    .action(async (options: { name: string; limit?: string }) => {
      const limit = options.limit ? parseInt(options.limit, 10) : 20;

      if (options.name.length > 100) {
        throw new EchoError(ErrorCodes.AGENT_QUERY_INVALID, "Search pattern too long (max 100 characters)");
      }

      const spin = spinner(`Searching for "${options.name}"...`);
      spin.start();

      try {
        const result = await executeAgentQuery({
          source: "tokens",
          filters: [{ field: "name", op: "like", value: options.name }],
          limit,
        });
        spin.succeed(`Found ${result.count} tokens`);

        if (isHeadless()) {
          writeJsonSuccess({ tokens: result.tokens, count: result.count, cached: result.cached });
        } else {
          console.log(formatAgentTable(result.tokens));
        }
      } catch (err) {
        spin.fail("Search failed");
        throw err;
      }
    });

  return agents;
}
