import { Command } from "commander";
import { createBalanceSubcommand, createBalanceMultiSubcommand, createTokenBalanceSubcommand, createTokenSupplySubcommand, createTxsSubcommand } from "./balance.js";
import { createTransfersSubcommand } from "./transfers.js";
import { createTxSubcommand, createContractSubcommand, createDecodeSubcommand } from "./inspect.js";
import { createStatsSubcommand } from "./stats.js";

export function createChainScanCommand(): Command {
  const chainscan = new Command("chainscan")
    .description("Query on-chain data from 0G ChainScan explorer")
    .exitOverride();

  chainscan.addCommand(createBalanceSubcommand());
  chainscan.addCommand(createBalanceMultiSubcommand());
  chainscan.addCommand(createTokenBalanceSubcommand());
  chainscan.addCommand(createTokenSupplySubcommand());
  chainscan.addCommand(createTxsSubcommand());
  chainscan.addCommand(createTransfersSubcommand());
  chainscan.addCommand(createTxSubcommand());
  chainscan.addCommand(createContractSubcommand());
  chainscan.addCommand(createDecodeSubcommand());
  chainscan.addCommand(createStatsSubcommand());

  return chainscan;
}
