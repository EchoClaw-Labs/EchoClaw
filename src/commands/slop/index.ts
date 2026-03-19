import { Command } from "commander";
import { createTokenSubcommand } from "./token.js";
import { createTokensSubcommand } from "./tokens.js";
import { createTradeSubcommand } from "./trade.js";
import { createPriceSubcommand, createCurveSubcommand } from "./view.js";
import { createFeesSubcommand } from "./fees.js";
import { createRewardSubcommand } from "./reward.js";

export function createSlopCommand(): Command {
  const slop = new Command("slop")
    .description("Slop.money bonding curve operations")
    .exitOverride();

  slop.addCommand(createTokenSubcommand());
  slop.addCommand(createTokensSubcommand());
  slop.addCommand(createTradeSubcommand());
  slop.addCommand(createPriceSubcommand());
  slop.addCommand(createCurveSubcommand());
  slop.addCommand(createFeesSubcommand());
  slop.addCommand(createRewardSubcommand());

  return slop;
}
