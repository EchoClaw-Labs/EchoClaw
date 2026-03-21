import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock("../../agent/db/client.js", () => ({
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  execute: (...args: unknown[]) => mockExecute(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock("../../utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const telegramRepo = await import("../../agent/db/repos/telegram.js");

describe("telegram repo config encryption", () => {
  let storedRow: Record<string, unknown> | null = null;
  const originalAuthToken = process.env.AGENT_AUTH_TOKEN;

  beforeEach(() => {
    storedRow = null;
    mockQueryOne.mockReset();
    mockExecute.mockReset();
    mockExistsSync.mockReset().mockReturnValue(false);
    mockReadFileSync.mockReset();
    mockLoggerWarn.mockReset();

    mockExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("UPDATE telegram_config SET bot_token_encrypted")) {
        storedRow = {
          enabled: false,
          bot_token_encrypted: params?.[0] ?? null,
          authorized_chat_ids: JSON.parse(String(params?.[1] ?? "[]")),
          loop_mode: params?.[2] ?? "restricted",
        };
      } else if (sql.includes("UPDATE telegram_config SET enabled")) {
        storedRow = { ...(storedRow ?? {}), enabled: params?.[0] ?? false };
      } else if (sql.includes("bot_token_encrypted = NULL")) {
        storedRow = {
          enabled: false,
          bot_token_encrypted: null,
          authorized_chat_ids: [],
          loop_mode: "restricted",
        };
      }
      return 1;
    });

    mockQueryOne.mockImplementation(async () => storedRow);
  });

  afterEach(() => {
    if (originalAuthToken === undefined) {
      delete process.env.AGENT_AUTH_TOKEN;
    } else {
      process.env.AGENT_AUTH_TOKEN = originalAuthToken;
    }
  });

  it("decrypts config using persisted token file when env token is missing", async () => {
    process.env.AGENT_AUTH_TOKEN = "stable-secret";
    await telegramRepo.saveConfig("123456:ABC-DEF_123", [111], "restricted");

    delete process.env.AGENT_AUTH_TOKEN;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("stable-secret");

    const row = await telegramRepo.getConfig();

    expect(row.botToken).toBe("123456:ABC-DEF_123");
    expect(row.authorizedChatIds).toEqual([111]);
    expect(row.decryptionFailed).toBe(false);
  });

  it("surfaces decryption failure when persisted key does not match", async () => {
    process.env.AGENT_AUTH_TOKEN = "secret-a";
    await telegramRepo.saveConfig("123456:ABC-DEF_123", [222], "full");

    delete process.env.AGENT_AUTH_TOKEN;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("secret-b");

    const row = await telegramRepo.getConfig();

    expect(row.botToken).toBeNull();
    expect(row.decryptionFailed).toBe(true);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "telegram.config.decrypt_failed",
      expect.objectContaining({
        hint: expect.stringContaining("reconfigure Telegram bot token"),
      }),
    );
  });
});
