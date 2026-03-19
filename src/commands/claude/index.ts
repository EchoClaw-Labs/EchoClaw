import { Command } from "commander";
import { createProxySubcommand } from "./proxy-cmd.js";
import { createConfigSubcommand } from "./config-cmd.js";
import { runClaudeSetup } from "./setup-cmd.js";

export function createClaudeCommand(): Command {
  const cmd = new Command("claude")
    .description("Claude Code wizard, local proxy, and config via 0G Compute")
    .allowExcessArguments(false)
    .action(runClaudeSetup);

  cmd.addCommand(createProxySubcommand());
  cmd.addCommand(createConfigSubcommand());

  return cmd;
}
