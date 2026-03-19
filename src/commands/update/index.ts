import { Command } from "commander";
import { createCheckSubcommand } from "./check.js";
import {
  createEnableSubcommand,
  createDisableSubcommand,
  createStatusSubcommand,
} from "./daemon-cmd.js";

export function createUpdateCommand(): Command {
  const update = new Command("update")
    .description("Manage one-shot auto-update preferences and status");

  update.addCommand(createCheckSubcommand());
  update.addCommand(createEnableSubcommand());
  update.addCommand(createDisableSubcommand());
  update.addCommand(createStatusSubcommand());

  return update;
}
