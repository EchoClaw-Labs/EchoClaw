import { Command } from "commander";
import { createOrderSubcommand } from "./order.js";
import { createStartSubcommand, createStopSubcommand, createStatusSubcommand } from "./daemon.js";

export function createBotCommand(): Command {
  const bot = new Command("marketmaker").alias("mm").description("MarketMaker agent: orders, daemon, and monitoring");

  bot.addCommand(createOrderSubcommand());
  bot.addCommand(createStartSubcommand());
  bot.addCommand(createStopSubcommand());
  bot.addCommand(createStatusSubcommand());

  return bot;
}
