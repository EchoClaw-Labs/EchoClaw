import { Command } from "commander";
import { addDriveNetworkCommands } from "./drive-network.js";
import { addDriveLocalCommands } from "./drive-local.js";
import { addDriveSnapshotCommands } from "./drive-snapshot.js";

export function createDriveCommand(): Command {
  const drive = new Command("drive")
    .description("Virtual filesystem over 0G Storage");

  addDriveNetworkCommands(drive);
  addDriveLocalCommands(drive);
  addDriveSnapshotCommands(drive);

  return drive;
}
