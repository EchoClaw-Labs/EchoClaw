/**
 * Telegram integration types.
 */

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  authorizedChatIds: number[];
  loopMode: "full" | "restricted" | "off";
}

export interface TelegramStatus {
  /** Whether a bot token has been saved (regardless of enabled/connected state). */
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  botUsername: string | null;
  authorizedChatIds: number[];
  loopMode: string;
  /** True if saved token could not be decrypted (key mismatch after restart). */
  decryptionFailed?: boolean;
}
