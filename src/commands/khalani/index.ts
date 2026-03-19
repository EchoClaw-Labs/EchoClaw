import { Command } from "commander";
import { createChainsSubcommand } from "./chains.js";
import { createTokensSubcommand } from "./tokens.js";
import { createQuoteSubcommand } from "./quote.js";
import { createBridgeSubcommand } from "./bridge.js";
import { createOrderSubcommand, createOrdersSubcommand } from "./orders.js";

export function createKhalaniCommand(): Command {
  const khalani = new Command("khalani")
    .description("Cross-chain quotes, discovery, and order tracking via Khalani")
    .exitOverride();

  khalani.addCommand(createChainsSubcommand());
  khalani.addCommand(createTokensSubcommand());
  khalani.addCommand(createQuoteSubcommand());
  khalani.addCommand(createBridgeSubcommand());
  khalani.addCommand(createOrdersSubcommand());
  khalani.addCommand(createOrderSubcommand());

  return khalani;
}
