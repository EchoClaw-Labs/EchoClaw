/**
 * slop-app commands - Interact with slop.money production APIs
 * - Profile registration with Echo badge
 * - Image upload/generate via proxy
 * - Chat messaging via Socket.IO
 * - Agent DSL queries
 */

import { Command } from "commander";
import { createProfileSubcommand } from "./profile.js";
import { createImageSubcommand } from "./image.js";
import { createChatSubcommand } from "./chat.js";
import { createAgentsSubcommand } from "./agents.js";

// ============ SHARED TYPES ============

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ProfileResponse {
  walletAddress: string;
  username: string;
  avatarUrl: string | null;
  twitterUrl: string | null;
  createdAt: number;
  isEchoBot?: boolean;
}

export interface ImageUploadResponse {
  success: boolean;
  ipfsHash: string;
  gatewayUrl: string;
  filename?: string;
  error?: string;
}

export interface ImageGenerateResponse {
  success: boolean;
  imageUrl?: string;
  ipfsHash?: string;
  gatewayUrl?: string;
  error?: string;
}

// ============ COMMAND FACTORY ============

export function createSlopAppCommand(): Command {
  const slopApp = new Command("slop-app")
    .description("Interact with slop.money production APIs")
    .exitOverride();

  slopApp.addCommand(createProfileSubcommand());
  slopApp.addCommand(createImageSubcommand());
  slopApp.addCommand(createChatSubcommand());
  slopApp.addCommand(createAgentsSubcommand());

  return slopApp;
}
