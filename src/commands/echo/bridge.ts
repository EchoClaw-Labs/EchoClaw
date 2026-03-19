import inquirer from "inquirer";
import { parseUnits } from "viem";
import { EchoError, ErrorCodes } from "../../errors.js";
import { getKhalaniClient } from "../../khalani/client.js";
import { getCachedKhalaniChains } from "../../khalani/chains.js";
import type { KhalaniChain, KhalaniToken } from "../../khalani/types.js";
import { colors, infoBox, warnBox } from "../../utils/ui.js";
import { createBridgeSubcommand } from "../khalani/bridge.js";
import { prepareQuoteRequest } from "../khalani/request.js";
import { resolveRouteBestIndex } from "../khalani/helpers.js";

function formatChainChoice(chain: KhalaniChain): string {
  return `${chain.name} (${chain.type === "solana" ? "Solana" : `EVM ${chain.id}`})`;
}

async function promptChain(message: string, chains: KhalaniChain[]): Promise<KhalaniChain | null> {
  const sorted = [...chains].sort((a, b) => a.name.localeCompare(b.name));
  const { chainId } = await inquirer.prompt([{
    type: "list",
    name: "chainId",
    message,
    choices: [
      ...sorted.map((chain) => ({
        name: formatChainChoice(chain),
        value: chain.id,
      })),
      { name: "Back", value: "back" },
    ],
  }]);

  if (chainId === "back") {
    return null;
  }

  return sorted.find((chain) => chain.id === chainId) ?? null;
}

const MAX_TOKEN_PROMPT_ATTEMPTS = 10;

async function promptToken(message: string, chain: KhalaniChain): Promise<KhalaniToken | null> {
  let attempts = 0;
  while (true) {
    if (++attempts > MAX_TOKEN_PROMPT_ATTEMPTS) {
      throw new EchoError(
        ErrorCodes.KHALANI_UNSUPPORTED_TOKEN,
        `Token search exceeded ${MAX_TOKEN_PROMPT_ATTEMPTS} attempts.`,
        "Try a more specific search term or use the CLI directly: echoclaw khalani bridge --help",
      );
    }

    const { query } = await inquirer.prompt([{
      type: "input",
      name: "query",
      message,
      default: "",
    }]);

    if (query.trim().toLowerCase() === "back") {
      return null;
    }

    const response = query.trim().length > 0
      ? await getKhalaniClient().searchTokens(query.trim(), [chain.id])
      : { data: await getKhalaniClient().getTopTokens([chain.id]) };

    const tokens = response.data.slice(0, 15);
    if (tokens.length === 0) {
      warnBox("No Tokens Found", `No Khalani tokens matched "${query}" on ${chain.name}. Type another search term or \`back\`.`);
      continue;
    }

    const { tokenAddress } = await inquirer.prompt([{
      type: "list",
      name: "tokenAddress",
      message: `Select a token on ${chain.name}`,
      choices: [
        ...tokens.map((token) => ({
          name: `${token.symbol} — ${token.name} (${token.address.slice(0, 8)}...${token.address.slice(-4)})`,
          value: token.address,
        })),
        { name: "Search again", value: "search-again" },
      ],
    }]);

    if (tokenAddress === "search-again") {
      continue;
    }

    return tokens.find((token) => token.address === tokenAddress) ?? null;
  }
}

async function promptAmount(token: KhalaniToken): Promise<{ human: string; smallest: string } | null> {
  while (true) {
    const { amount } = await inquirer.prompt([{
      type: "input",
      name: "amount",
      message: `Amount of ${token.symbol} to bridge`,
      default: "1",
    }]);

    if (amount.trim().toLowerCase() === "back") {
      return null;
    }

    try {
      return {
        human: amount.trim(),
        smallest: parseUnits(amount.trim(), token.decimals).toString(),
      };
    } catch {
      warnBox("Invalid Amount", `Could not parse "${amount}" with ${token.decimals} decimals. Try again or type \`back\`.`);
    }
  }
}

export async function runInteractiveBridge(): Promise<void> {
  let chains: KhalaniChain[];
  try {
    chains = await getCachedKhalaniChains();
  } catch (err) {
    if (err instanceof EchoError) throw err;
    throw new EchoError(
      ErrorCodes.KHALANI_API_ERROR,
      `Failed to load Khalani chain registry: ${err instanceof Error ? err.message : String(err)}`,
      "Check your network connection or try again later.",
    );
  }

  const sourceChain = await promptChain("Select the source chain", chains);
  if (!sourceChain) return;

  const sourceToken = await promptToken("Search source token (symbol or address)", sourceChain);
  if (!sourceToken) return;

  const destinationChain = await promptChain("Select the destination chain", chains);
  if (!destinationChain) return;

  const destinationToken = await promptToken("Search destination token (symbol or address)", destinationChain);
  if (!destinationToken) return;

  const amount = await promptAmount(sourceToken);
  if (!amount) return;

  const prepared = await prepareQuoteRequest({
    fromChain: String(sourceChain.id),
    fromToken: sourceToken.address,
    toChain: String(destinationChain.id),
    toToken: destinationToken.address,
    amount: amount.smallest,
    tradeType: "EXACT_INPUT",
  });
  const quotes = await getKhalaniClient().getQuotes(prepared.request);

  if (quotes.routes.length === 0) {
    warnBox("No Routes", "Khalani did not return any routes for that pair and amount.");
    return;
  }

  const bestIndex = resolveRouteBestIndex(quotes.routes);
  const { routeId } = await inquirer.prompt([{
    type: "list",
    name: "routeId",
    message: "Select a route",
    choices: quotes.routes.map((route, index) => ({
      name: `${index === bestIndex ? "[best] " : ""}${route.routeId} — out ${route.quote.amountOut} — ETA ${route.quote.expectedDurationSeconds}s`,
      value: route.routeId,
    })),
  }]);

  const selectedRoute = quotes.routes.find((route) => route.routeId === routeId) ?? quotes.routes[bestIndex];
  const { depositMethod } = await inquirer.prompt([{
    type: "list",
    name: "depositMethod",
    message: "Choose a deposit method",
    choices: selectedRoute.depositMethods.map((method) => ({ name: method, value: method })),
  }]);

  infoBox(
    "Bridge Preview",
    [
      `From: ${sourceChain.name} / ${sourceToken.symbol}`,
      `To: ${destinationChain.name} / ${destinationToken.symbol}`,
      `Amount: ${colors.value(amount.human)} ${sourceToken.symbol}`,
      `Route: ${selectedRoute.routeId}`,
      `Deposit method: ${depositMethod}`,
    ].join("\n"),
  );

  const { mode } = await inquirer.prompt([{
    type: "list",
    name: "mode",
    message: "What next?",
    choices: [
      { name: "Preview deposit plan", value: "dry-run" },
      { name: "Execute bridge now", value: "execute" },
      { name: "Back", value: "back" },
    ],
  }]);

  if (mode === "back") return;

  const args = [
    "--from-chain", String(sourceChain.id),
    "--from-token", sourceToken.address,
    "--to-chain", String(destinationChain.id),
    "--to-token", destinationToken.address,
    "--amount", amount.smallest,
    "--route-id", selectedRoute.routeId,
    "--deposit-method", depositMethod,
  ];

  if (mode === "dry-run") {
    await createBridgeSubcommand().parseAsync(["node", "bridge", ...args, "--dry-run"], { from: "user" });
    return;
  }

  const { confirm } = await inquirer.prompt([{
    type: "confirm",
    name: "confirm",
    message: "Broadcast the selected bridge route now?",
    default: false,
  }]);

  if (!confirm) {
    return;
  }

  await createBridgeSubcommand().parseAsync(["node", "bridge", ...args, "--yes"], { from: "user" });
}
