import { Command } from "commander";
import { createBrowseSubcommand } from "./browse.js";
import { createTransferSubcommand, createSendTokenSubcommand } from "./transfer.js";
import { createSwapSubcommand } from "./swap.js";
import { createStakeSubcommand } from "./stake.js";
import { createBurnSubcommand, createCloseAccountsSubcommand } from "./burn.js";
import { createOrdersSubcommand, createLimitSubcommand } from "./orders.js";
import { createPriceSubcommand } from "./price.js";
import { createPortfolioSubcommand } from "./portfolio.js";
import { createLendSubcommand } from "./lend.js";
import { createSendInviteSubcommand, createInvitesSubcommand, createClawbackSubcommand } from "./send-invite.js";
import { createPredictSubcommand } from "./predict.js";
import { createStudioSubcommand } from "./studio.js";
import { createHoldingsSubcommand, createShieldSubcommand } from "./holdings.js";

export function createSolanaCommand(): Command {
  const solana = new Command("solana")
    .description("Solana DeFi via Jupiter (swap, browse, price, send, stake, lend, predict, dca, limit, studio, holdings, shield)")
    .exitOverride();

  solana.addCommand(createBrowseSubcommand());
  solana.addCommand(createPriceSubcommand());
  solana.addCommand(createTransferSubcommand());
  solana.addCommand(createSendTokenSubcommand());
  solana.addCommand(createSwapSubcommand());
  solana.addCommand(createStakeSubcommand());
  solana.addCommand(createBurnSubcommand());
  solana.addCommand(createCloseAccountsSubcommand());
  solana.addCommand(createOrdersSubcommand());
  solana.addCommand(createLimitSubcommand());
  solana.addCommand(createPortfolioSubcommand());
  solana.addCommand(createLendSubcommand());
  solana.addCommand(createSendInviteSubcommand());
  solana.addCommand(createInvitesSubcommand());
  solana.addCommand(createClawbackSubcommand());
  solana.addCommand(createPredictSubcommand());
  solana.addCommand(createStudioSubcommand());
  solana.addCommand(createHoldingsSubcommand());
  solana.addCommand(createShieldSubcommand());

  return solana;
}
