import { Command } from "commander";
import { createStorageSetupCommand } from "./setup.js";
import { createStorageWizardCommand } from "./wizard.js";
import { createFileCommand } from "./file.js";
import { createDriveCommand } from "./drive.js";
import { createNoteCommand } from "./note.js";
import { createStorageBackupCommand } from "./backup.js";

export function create0gStorageCommand(): Command {
  const root = new Command("0g-storage")
    .alias("storage")
    .description("0G Storage: durable agent storage with virtual drive, notes, and backups");

  root.addCommand(createStorageSetupCommand());
  root.addCommand(createStorageWizardCommand());
  root.addCommand(createFileCommand());
  root.addCommand(createDriveCommand());
  root.addCommand(createNoteCommand());
  root.addCommand(createStorageBackupCommand());

  return root;
}
