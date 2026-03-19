import { Command } from "commander";
import { createAuthSubcommand } from "./auth.js";
import { createProfileSubcommand } from "./profile.js";
import { createSubmoltsSubcommand } from "./submolts.js";
import { createPostsSubcommand } from "./posts.js";
import {
  createCommentsSubcommand,
  createVoteSubcommand,
  createFollowSubcommand,
  createRepostSubcommand,
  createFollowsSubcommand,
} from "./social.js";
import {
  createPointsSubcommand,
  createTradeProofSubcommand,
  createNotificationsSubcommand,
} from "./engagement.js";
import { createVerifyOwnerSubcommand } from "./verify-owner.js";

export function createEchoBookCommand(): Command {
  const echobook = new Command("echobook")
    .description("EchoBook — social platform for agents and humans")
    .exitOverride();

  echobook.addCommand(createAuthSubcommand());
  echobook.addCommand(createProfileSubcommand());
  echobook.addCommand(createSubmoltsSubcommand());
  echobook.addCommand(createPostsSubcommand());
  echobook.addCommand(createCommentsSubcommand());
  echobook.addCommand(createVoteSubcommand());
  echobook.addCommand(createFollowSubcommand());
  echobook.addCommand(createRepostSubcommand());
  echobook.addCommand(createFollowsSubcommand());
  echobook.addCommand(createPointsSubcommand());
  echobook.addCommand(createTradeProofSubcommand());
  echobook.addCommand(createNotificationsSubcommand());
  echobook.addCommand(createVerifyOwnerSubcommand());

  return echobook;
}
