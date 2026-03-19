import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { getAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { withSuppressedConsole } from "../../0g-compute/bridge.js";
import { requireAddress, requireTokenId, redactToken } from "../../0g-compute/helpers.js";
import { requireYes } from "./helpers.js";

export function createApiKeySubcommand(): Command {
  const apiKey = new Command("api-key").description("Manage persistent API keys");

  apiKey
    .command("create")
    .description("Create a persistent API key for a provider")
    .requiredOption("--provider <addr>", "Provider address")
    .requiredOption("--token-id <n>", "Token ID (0-254)")
    .option("--expires <sec>", "Expiry in seconds (0 = never)", "0")
    .option("--yes", "Confirm on-chain transaction")
    .option("--json", "JSON output")
    .action(
      async (options: {
        provider: string;
        tokenId: string;
        expires: string;
        yes?: boolean;
        json?: boolean;
      }) => {
        requireYes(options.yes, "create API key");
        const provider = requireAddress(options.provider, "provider");
        const tokenId = requireTokenId(options.tokenId);
        const expiresIn = Number(options.expires) * 1000; // SDK expects ms

        const broker = await getAuthenticatedBroker();

        let apiKeyInfo;
        try {
          apiKeyInfo = await withSuppressedConsole(() => broker.inference.requestProcessor.createApiKey(
            provider,
            { tokenId, expiresIn }
          ));
        } catch (err) {
          throw new EchoError(
            ErrorCodes.ZG_API_KEY_FAILED,
            `API key creation failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        respond({
          data: {
            tokenId: apiKeyInfo.tokenId,
            createdAt: apiKeyInfo.createdAt,
            expiresAt: apiKeyInfo.expiresAt,
            token: redactToken(apiKeyInfo.rawToken),
            provider,
          },
          ui: {
            type: "success",
            title: "API Key Created",
            body: `Token ID: ${apiKeyInfo.tokenId}\nProvider: ${provider.slice(0, 10)}...\nToken: ${redactToken(apiKeyInfo.rawToken)}`,
          },
        });
      }
    );

  apiKey
    .command("revoke")
    .description("Revoke a specific API key")
    .requiredOption("--provider <addr>", "Provider address")
    .requiredOption("--token-id <n>", "Token ID to revoke")
    .option("--yes", "Confirm on-chain transaction")
    .option("--json", "JSON output")
    .action(
      async (options: {
        provider: string;
        tokenId: string;
        yes?: boolean;
        json?: boolean;
      }) => {
        requireYes(options.yes, "revoke API key");
        const provider = requireAddress(options.provider, "provider");
        const tokenId = requireTokenId(options.tokenId);

        const broker = await getAuthenticatedBroker();
        await withSuppressedConsole(() => broker.inference.revokeApiKey(provider, tokenId));

        respond({
          data: { revoked: true, tokenId, provider },
          ui: {
            type: "success",
            title: "API Key Revoked",
            body: `Token ID ${tokenId} for provider ${provider.slice(0, 10)}... revoked.`,
          },
        });
      }
    );

  apiKey
    .command("revoke-all")
    .description("Revoke all API keys for a provider")
    .requiredOption("--provider <addr>", "Provider address")
    .option("--yes", "Confirm on-chain transaction")
    .option("--json", "JSON output")
    .action(
      async (options: {
        provider: string;
        yes?: boolean;
        json?: boolean;
      }) => {
        requireYes(options.yes, "revoke all API keys");
        const provider = requireAddress(options.provider, "provider");

        const broker = await getAuthenticatedBroker();
        await withSuppressedConsole(() => broker.inference.revokeAllTokens(provider));

        respond({
          data: { revokedAll: true, provider },
          ui: {
            type: "success",
            title: "All API Keys Revoked",
            body: `All API keys for provider ${provider.slice(0, 10)}... revoked.`,
          },
        });
      }
    );

  return apiKey;
}
