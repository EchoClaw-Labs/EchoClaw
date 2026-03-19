import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { getKhalaniClient } from "../../khalani/client.js";
import { getChain, getChainExplorerUrl } from "../../khalani/chains.js";
import type { DepositMethod, QuoteRoute } from "../../khalani/types.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { colors, successBox, infoBox, spinner } from "../../utils/ui.js";
import { prepareQuoteRequest } from "./request.js";
import { resolveRouteBestIndex } from "./helpers.js";
import { executeDepositPlan } from "./bridge-executor.js";

interface BridgeOptions {
  fromChain: string;
  fromToken: string;
  toChain: string;
  toToken: string;
  amount: string;
  tradeType?: string;
  fromAddress?: string;
  recipient?: string;
  refundTo?: string;
  referrer?: string;
  referrerFeeBps?: string;
  routeId?: string;
  depositMethod?: string;
  refreshChains?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

function parseDepositMethod(value: string | undefined): DepositMethod | undefined {
  if (!value) return undefined;
  if (value === "CONTRACT_CALL" || value === "PERMIT2" || value === "TRANSFER") {
    return value;
  }
  throw new EchoError(ErrorCodes.KHALANI_VALIDATION_ERROR, `Unsupported deposit method: ${value}`);
}

function resolveSelectedRoute(routes: QuoteRoute[], routeId?: string): QuoteRoute {
  if (routes.length === 0) {
    throw new EchoError(ErrorCodes.KHALANI_QUOTE_NOT_FOUND, "No Khalani routes were returned for this quote.");
  }
  if (routeId) {
    const selected = routes.find((route) => route.routeId === routeId);
    if (!selected) {
      throw new EchoError(ErrorCodes.KHALANI_QUOTE_NOT_FOUND, `Route ${routeId} was not returned by Khalani.`);
    }
    return selected;
  }

  return routes[resolveRouteBestIndex(routes)];
}

function ensureRouteFresh(route: QuoteRoute): void {
  const expiresAt = route.quote.quoteExpiresAt ?? route.quote.validBefore;
  if (expiresAt > 0 && Date.now() >= expiresAt * 1000) {
    throw new EchoError(
      ErrorCodes.KHALANI_QUOTE_EXPIRED,
      `Selected route ${route.routeId} has expired.`,
      "Request a fresh quote and retry.",
    );
  }
}

export function createBridgeSubcommand(): Command {
  return new Command("bridge")
    .description("Build and execute a Khalani cross-chain deposit")
    .requiredOption("--from-chain <chain>", "Source chain ID or alias")
    .requiredOption("--from-token <address>", "Source token address")
    .requiredOption("--to-chain <chain>", "Destination chain ID or alias")
    .requiredOption("--to-token <address>", "Destination token address")
    .requiredOption("--amount <value>", "Amount in smallest units")
    .option("--trade-type <type>", "EXACT_INPUT | EXACT_OUTPUT", "EXACT_INPUT")
    .option("--from-address <address>", "Override source wallet address")
    .option("--recipient <address>", "Override destination recipient")
    .option("--refund-to <address>", "Override refund address")
    .option("--referrer <address>", "EVM checksum referrer address")
    .option("--referrer-fee-bps <bps>", "Referrer fee in basis points")
    .option("--route-id <routeId>", "Specific route ID to execute")
    .option("--deposit-method <method>", "CONTRACT_CALL | PERMIT2 | TRANSFER")
    .option("--refresh-chains", "Refresh Khalani chain metadata first")
    .option("--dry-run", "Build the deposit plan without broadcasting")
    .option("--yes", "Execute the selected deposit plan")
    .action(async (options: BridgeOptions) => {
      const prepared = await prepareQuoteRequest(options);
      const { chains, fromChainId, toChainId, request } = prepared;
      const sourceChain = getChain(fromChainId, chains);
      const destinationChain = getChain(toChainId, chains);

      const headless = isHeadless();
      const spinQuote = headless ? null : spinner("Fetching Khalani quotes...");
      const quotes = await getKhalaniClient().getQuotes(request, options.routeId ? { routes: [options.routeId] } : undefined);
      spinQuote?.stop();
      const selectedRoute = resolveSelectedRoute(quotes.routes, options.routeId);
      ensureRouteFresh(selectedRoute);

      const depositMethod = parseDepositMethod(options.depositMethod);
      const spinBuild = headless ? null : spinner("Building deposit plan...");
      const depositPlan = await getKhalaniClient().buildDeposit({
        from: request.fromAddress,
        quoteId: quotes.quoteId,
        routeId: selectedRoute.routeId,
        depositMethod,
      });
      spinBuild?.stop();

      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({
            dryRun: true,
            quoteId: quotes.quoteId,
            route: selectedRoute,
            request,
            depositPlan,
            sourceChain,
            destinationChain,
          });
        } else {
          infoBox(
            "Khalani Bridge Dry Run",
            [
              `Quote ID: ${colors.info(quotes.quoteId)}`,
              `Route: ${selectedRoute.routeId}`,
              `Deposit kind: ${depositPlan.kind}`,
              `From: ${sourceChain.name}`,
              `To: ${destinationChain.name}`,
            ].join("\n"),
          );
        }
        return;
      }

      if (!options.yes) {
        throw new EchoError(
          ErrorCodes.CONFIRMATION_REQUIRED,
          "Add --yes to execute the selected route (or --dry-run to preview the plan).",
        );
      }

      const spinExec = headless ? null : spinner("Executing cross-chain deposit...");
      const result = await executeDepositPlan(depositPlan, sourceChain, chains, quotes.quoteId, selectedRoute.routeId);
      spinExec?.stop();
      const explorerUrl = getChainExplorerUrl(sourceChain.id, chains);
      const txExplorerUrl = explorerUrl ? `${explorerUrl.replace(/\/$/, "")}/tx/${result.txHash}` : undefined;

      if (isHeadless()) {
        writeJsonSuccess({
          orderId: result.orderId,
          txHash: result.txHash,
          explorerUrl: txExplorerUrl,
          quoteId: quotes.quoteId,
          routeId: selectedRoute.routeId,
          sourceChainId: sourceChain.id,
          destinationChainId: destinationChain.id,
        });
        return;
      }

      successBox(
        "Khalani Bridge Submitted",
        [
          `Order ID: ${colors.info(result.orderId)}`,
          `Tx Hash: ${colors.info(result.txHash)}`,
          `From: ${sourceChain.name}`,
          `To: ${destinationChain.name}`,
          txExplorerUrl ? `Explorer: ${colors.muted(txExplorerUrl)}` : "",
        ].filter(Boolean).join("\n"),
      );
    });
}
