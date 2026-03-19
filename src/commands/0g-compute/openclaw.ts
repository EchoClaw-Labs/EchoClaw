import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { getAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { withSuppressedConsole } from "../../0g-compute/bridge.js";
import { requireAddress, requireTokenId, redactToken } from "../../0g-compute/helpers.js";
import { patchOpenclawConfig } from "../../openclaw/config.js";
import { requireYes } from "./helpers.js";
import logger from "../../utils/logger.js";

export function createOpenclawSubcommand(): Command {
  const openclaw = new Command("openclaw").description("OpenClaw compute wizard and config patching");

  openclaw
    .command("use")
    .description("Create API key and patch openclaw.json for a 0G provider")
    .requiredOption("--provider <addr>", "Provider address")
    .requiredOption("--token-id <n>", "Token ID for persistent API key (0-254)")
    .option("--set-default", "Set as default model in agents.defaults.model")
    .option("--fallback <ref>", "Fallback model reference (e.g., anthropic/claude-sonnet-4-5)")
    .option("--force", "Overwrite existing openclaw.json provider config")
    .option("--yes", "Confirm (required — creates API key on-chain)")
    .option("--json", "JSON output")
    .action(
      async (options: {
        provider: string;
        tokenId: string;
        setDefault?: boolean;
        fallback?: string;
        force?: boolean;
        yes?: boolean;
        json?: boolean;
      }) => {
        requireYes(options.yes, "openclaw use (creates API key on-chain)");
        const provider = requireAddress(options.provider, "provider");
        const tokenId = requireTokenId(options.tokenId);

        const broker = await getAuthenticatedBroker();

        // 1. Validate provider exists
        const metadata = await withSuppressedConsole(() => broker.inference.getServiceMetadata(provider));
        logger.info(`[0G Compute] Provider: ${metadata.model} at ${metadata.endpoint}`);

        // 2. Acknowledge provider signer (idempotent)
        await withSuppressedConsole(() => broker.inference.acknowledgeProviderSigner(provider));
        logger.info("[0G Compute] Provider signer acknowledged");

        // 3. Create API key
        let apiKeyInfo;
        try {
          apiKeyInfo = await withSuppressedConsole(() => broker.inference.requestProcessor.createApiKey(
            provider,
            { tokenId, expiresIn: 0 }
          ));
        } catch (err) {
          throw new EchoError(
            ErrorCodes.ZG_API_KEY_FAILED,
            `API key creation failed: ${err instanceof Error ? err.message : String(err)}`,
            "Check if tokenId is already in use. Try a different --token-id."
          );
        }
        logger.info(`[0G Compute] API key created: tokenId=${apiKeyInfo.tokenId}, token=${redactToken(apiKeyInfo.rawToken)}`);

        // 4. Patch openclaw.json — models.providers.zg
        const providerConfig = {
          baseUrl: metadata.endpoint,
          apiKey: apiKeyInfo.rawToken,
          api: "openai-completions",
          models: [
            {
              id: metadata.model,
              name: `${metadata.model} (0G Compute)`,
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        };

        const providerPatch = patchOpenclawConfig(
          "models.providers.zg",
          providerConfig,
          { force: options.force ?? false }
        );

        // Ensure models.mode = "merge"
        patchOpenclawConfig("models.mode", "merge", { force: false });

        // 5. Optionally set as default model
        let defaultPatch;
        if (options.setDefault) {
          const defaultModel: Record<string, unknown> = {
            primary: `zg/${metadata.model}`,
          };
          if (options.fallback) {
            defaultModel.fallbacks = [options.fallback];
          }
          defaultPatch = patchOpenclawConfig(
            "agents.defaults.model",
            defaultModel,
            { force: options.force ?? false }
          );
        }

        const resultData: Record<string, unknown> = {
          provider,
          model: metadata.model,
          endpoint: metadata.endpoint,
          apiKey: { tokenId: apiKeyInfo.tokenId, token: redactToken(apiKeyInfo.rawToken) },
          openclawConfig: {
            providerPatch: {
              status: providerPatch.status,
              path: providerPatch.path,
              keysSkipped: providerPatch.keysSkipped,
            },
            defaultPatch: defaultPatch
              ? { status: defaultPatch.status }
              : null,
          },
        };

        const hasSkipped = providerPatch.keysSkipped.length > 0;
        const bodyLines = [
          `Model:  ${metadata.model} (0G Compute)`,
          `Config: ${providerPatch.path} (${providerPatch.status})`,
        ];
        if (hasSkipped) {
          bodyLines.push("");
          bodyLines.push(`Skipped existing keys: ${providerPatch.keysSkipped.join(", ")}`);
          bodyLines.push("Use --force to overwrite.");
        }
        bodyLines.push("");
        bodyLines.push("Next steps:");
        bodyLines.push("  1. Restart OpenClaw gateway");
        bodyLines.push("  2. Run /reset in your agent session");
        bodyLines.push(
          options.setDefault
            ? `  3. Default model set to zg/${metadata.model}`
            : `  3. (Optional) Set default: --set-default`
        );

        respond({
          data: resultData,
          ui: {
            type: hasSkipped ? "warn" : "success",
            title: "OpenClaw Configured",
            body: bodyLines.join("\n"),
          },
        });
      }
    );

  return openclaw;
}
