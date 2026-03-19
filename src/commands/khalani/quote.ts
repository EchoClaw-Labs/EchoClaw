import { Command } from "commander";
import { getChain } from "../../khalani/chains.js";
import { getKhalaniClient } from "../../khalani/client.js";
import type { QuoteRoute, QuoteStreamRoute } from "../../khalani/types.js";
import { writeJsonSuccess, writeStdout, isHeadless } from "../../utils/output.js";
import { colors, infoBox, printTable, spinner } from "../../utils/ui.js";
import { formatChainFamily, resolveRouteBestIndex } from "./helpers.js";
import { prepareQuoteRequest } from "./request.js";

function renderQuoteTable(
  quoteId: string,
  routes: QuoteRoute[],
  bestRouteIndex: number,
  fromChainName: string,
  fromChainType: "eip155" | "solana",
  toChainName: string,
  toChainType: "eip155" | "solana",
  amount: string,
  tradeType: string,
): void {
  const rows = routes.map((route, index) => [
    index === bestRouteIndex ? colors.success("best") : "",
    route.routeId,
    route.quote.amountOut,
    `${route.quote.expectedDurationSeconds}s`,
    route.depositMethods.join(", ") || "-",
    route.quote.tags?.join(", ") ?? "-",
  ]);

  infoBox(
    "Khalani Quote",
    [
      `Quote ID: ${colors.info(quoteId)}`,
      `From: ${fromChainName} (${formatChainFamily(fromChainType)})`,
      `To: ${toChainName} (${formatChainFamily(toChainType)})`,
      `Amount In: ${amount}`,
      `Trade Type: ${tradeType}`,
    ].join("\n"),
  );

  printTable(
    [
      { header: "Best", width: 8 },
      { header: "Route", width: 20 },
      { header: "Amount Out", width: 22 },
      { header: "ETA", width: 10 },
      { header: "Deposit Methods", width: 26 },
      { header: "Tags", width: 22 },
    ],
    rows,
  );
}

function toQuoteRoute(route: QuoteStreamRoute): QuoteRoute {
  return {
    routeId: route.routeId,
    type: route.type,
    icon: route.icon,
    exactOutMethod: route.exactOutMethod,
    depositMethods: route.depositMethods,
    quote: route.quote,
  };
}

export function createQuoteSubcommand(): Command {
  return new Command("quote")
    .description("Request Khalani cross-chain quotes")
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
    .option("--route <routeId>", "Filter to a specific route")
    .option("--stream", "Stream NDJSON routes as they arrive")
    .option("--refresh-chains", "Refresh Khalani chain metadata first")
    .action(async (options: {
      fromChain: string;
      fromToken: string;
      toChain: string;
      toToken: string;
      amount: string;
      tradeType: string;
      fromAddress?: string;
      recipient?: string;
      refundTo?: string;
      referrer?: string;
      referrerFeeBps?: string;
      route?: string;
      stream?: boolean;
      refreshChains?: boolean;
    }) => {
      const prepared = await prepareQuoteRequest(options);
      const { chains, fromChainId, toChainId, request } = prepared;
      const fromChain = getChain(fromChainId, chains);
      const toChain = getChain(toChainId, chains);

      if (options.stream) {
        const routes: QuoteRoute[] = [];
        let streamQuoteId: string | null = null;
        const spin = isHeadless() ? null : spinner("Streaming Khalani quotes...");
        spin?.start();

        for await (const routeEvent of getKhalaniClient().streamQuotes(
          request,
          options.route ? { routes: [options.route] } : undefined,
        )) {
          streamQuoteId ??= routeEvent.quoteId;
          const route = toQuoteRoute(routeEvent);
          routes.push(route);

          if (isHeadless()) {
            writeStdout(JSON.stringify({
              success: true,
              type: "route",
              quoteId: routeEvent.quoteId,
              route,
            }));
          }
        }

        spin?.stop();
        const bestRouteIndex = routes.length > 0 ? resolveRouteBestIndex(routes) : -1;
        if (isHeadless()) {
          writeStdout(JSON.stringify({
            success: true,
            type: "complete",
            quoteId: streamQuoteId,
            routeCount: routes.length,
            bestRouteIndex,
            bestRoute: bestRouteIndex >= 0 ? routes[bestRouteIndex] : null,
          }));
        } else if (routes.length === 0) {
          infoBox("Khalani Quote", "No routes arrived from the Khalani stream.");
        } else {
          renderQuoteTable(
            streamQuoteId ?? "stream",
            routes,
            bestRouteIndex,
            fromChain.name,
            fromChain.type,
            toChain.name,
            toChain.type,
            options.amount,
            request.tradeType,
          );
        }

        return;
      }

      const spin = isHeadless() ? null : spinner("Fetching Khalani quotes...");
      const response = await getKhalaniClient().getQuotes(request, options.route ? { routes: [options.route] } : undefined);
      spin?.stop();
      const bestRouteIndex = response.routes.length > 0 ? resolveRouteBestIndex(response.routes) : -1;

      if (isHeadless()) {
        writeJsonSuccess({
          request,
          quoteId: response.quoteId,
          routes: response.routes,
          bestRouteIndex,
          bestRoute: bestRouteIndex >= 0 ? response.routes[bestRouteIndex] : null,
        });
        return;
      }
      renderQuoteTable(
        response.quoteId,
        response.routes,
        bestRouteIndex,
        fromChain.name,
        fromChain.type,
        toChain.name,
        toChain.type,
        options.amount,
        request.tradeType,
      );
    });
}
