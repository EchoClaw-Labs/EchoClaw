/**
 * 0G Compute SDK smoke-test — standalone script.
 *
 * Validates end-to-end: npm SDK + Echo wallet → list → ledger → API key → inference.
 * Run after `npm run build`:
 *   ECHO_KEYSTORE_PASSWORD=xxx node dist/0g-compute/smoke-test.js [--provider 0x...] [--dry-run]
 *
 * Default provider: 0x1B3AAe... (deepseek-chat-v3-0324, cheapest chatbot).
 */

import { parseArgs } from "node:util";
import { formatUnits, getAddress } from "ethers";
import { requireWalletAndKeystore } from "../bot/executor.js";
import { createBrokerFromKey } from "./sdk-bridge.cjs";
import { withSuppressedConsole } from "./bridge.js";
import { loadConfig } from "../config/store.js";
import logger from "../utils/logger.js";

function normalizeAddress(raw: string): string {
  const trimmed = raw.trim();
  try {
    return getAddress(trimmed);
  } catch {
    if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      return `0x${trimmed.slice(2).toLowerCase()}`;
    }
    throw new Error(`Invalid address: ${raw}`);
  }
}

function redactToken(token: string): string {
  if (token.startsWith("app-sk-")) return "app-sk-***";
  return "***";
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      provider: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: false,
  });

  const providerArg = values.provider as string | undefined;
  const dryRun = values["dry-run"] as boolean;

  logger.info("[smoke-test] Starting 0G Compute SDK smoke test");
  logger.info(`[smoke-test] Provider: ${providerArg ?? "(auto)"}`);
  logger.info(`[smoke-test] Dry run: ${dryRun}`);

  // 1. Get wallet
  const { address, privateKey } = requireWalletAndKeystore();
  logger.info(`[smoke-test] Wallet: ${address}`);

  // 2. Create authenticated broker via CJS bridge (avoids ESM/CJS type mismatch)
  const cfg = loadConfig();
  const broker = await withSuppressedConsole(() =>
    createBrokerFromKey(privateKey, cfg.chain.rpcUrl)
  );
  logger.info("[smoke-test] Broker initialized");

  // 3. List services
  const services = await broker.inference.listService();
  logger.info(`[smoke-test] Found ${services.length} services:`);
  for (const svc of services) {
    const provider = typeof (svc as any).provider === "string" ? (svc as any).provider : (typeof svc[0] === "string" ? svc[0] : String(svc[0]));
    const model = typeof (svc as any).model === "string" ? (svc as any).model : (typeof svc[6] === "string" ? svc[6] : String(svc[6]));
    const url = typeof (svc as any).url === "string" ? (svc as any).url : (typeof svc[2] === "string" ? svc[2] : String(svc[2]));
    logger.info(`  - ${model} (provider: ${provider.slice(0, 10)}..., url: ${url})`);
  }

  // Choose provider
  const selectedProviderRaw = providerArg
    ? providerArg
    : (
        (services.find((s) => (s as any).serviceType === "chatbot") as any)?.provider ??
        (services[0] as any)?.provider ??
        (services[0] as any)?.[0]
      );

  const providerAddress = normalizeAddress(String(selectedProviderRaw));
  logger.info(`[smoke-test] Using provider: ${providerAddress}`);

  // Metadata (read-only)
  let metadata: { endpoint: string; model: string } | null = null;
  try {
    metadata = await broker.inference.getServiceMetadata(providerAddress);
    logger.info(`[smoke-test] Model: ${metadata.model}`);
    logger.info(`[smoke-test] Endpoint: ${metadata.endpoint}`);
  } catch (err) {
    logger.warn(`[smoke-test] Failed to fetch service metadata: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Check ledger
  try {
    const ledger = await broker.ledger.getLedger();
    logger.info(`[smoke-test] Ledger found: ${JSON.stringify(ledger, (_k, v) => typeof v === "bigint" ? formatUnits(v, 18) + " 0G" : v)}`);
  } catch (err) {
    logger.warn(`[smoke-test] No ledger found: ${err instanceof Error ? err.message : String(err)}`);
    logger.warn("[smoke-test] Hint: create ledger with `echoclaw 0g-compute ledger deposit <amount> --yes`");
  }

  // 5. Check sub-account balance
  try {
    const account = await broker.inference.getAccount(providerAddress);
    logger.info(`[smoke-test] Sub-account: ${JSON.stringify(account, (_k, v) => typeof v === "bigint" ? formatUnits(v, 18) + " 0G" : v)}`);
  } catch (err) {
    logger.warn(`[smoke-test] No sub-account for provider: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 6. Check user-level ack (read-only)
  let userAcked = false;
  try {
    userAcked = await broker.inference.acknowledged(providerAddress);
    logger.info(`[smoke-test] User acknowledged: ${userAcked}`);
  } catch (err) {
    logger.warn(`[smoke-test] Failed to check user acknowledgement: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (dryRun) {
    logger.info("[smoke-test] Dry run complete — skipping ack, API key, and inference.");
    const result = {
      step: "dry-run",
      services: services.length,
      provider: providerAddress,
      model: metadata?.model ?? null,
      endpoint: metadata?.endpoint ?? null,
      userAcked,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  // 8. Acknowledge provider signer (idempotent)
  logger.info("[smoke-test] Acknowledging provider signer...");
  await withSuppressedConsole(() => broker.inference.acknowledgeProviderSigner(providerAddress));
  logger.info("[smoke-test] Provider signer acknowledged");

  // 9. Create API key
  logger.info("[smoke-test] Creating API key (tokenId=0, never expires)...");
  const apiKeyInfo = await withSuppressedConsole(() =>
    broker.inference.requestProcessor.createApiKey(
      providerAddress,
      { tokenId: 0, expiresIn: 0 }
    )
  );
  logger.info(`[smoke-test] API key created: tokenId=${apiKeyInfo.tokenId}, token=${redactToken(apiKeyInfo.rawToken)}`);

  // 10. Make inference request
  const metadata2 = metadata ?? (await broker.inference.getServiceMetadata(providerAddress));
  const inferenceUrl = `${metadata2.endpoint}/chat/completions`;
  logger.info(`[smoke-test] Inference URL: ${inferenceUrl}`);
  logger.info(`[smoke-test] Model: ${metadata2.model}`);

  const response = await fetch(inferenceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKeyInfo.rawToken}`,
    },
    body: JSON.stringify({
      model: metadata2.model,
      messages: [{ role: "user", content: "Say hello in one sentence." }],
      max_tokens: 50,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error(`[smoke-test] Inference failed: ${response.status} ${body}`);
    process.exit(1);
  }

  const inferenceResult = await response.json();
  logger.info(`[smoke-test] Inference response: ${JSON.stringify(inferenceResult).slice(0, 500)}`);

  // Summary (rawToken REDACTED)
  const summary = {
    step: "complete",
    wallet: address,
    provider: providerAddress,
    model: metadata2.model,
    endpoint: metadata2.endpoint,
    apiKey: { tokenId: apiKeyInfo.tokenId, token: redactToken(apiKeyInfo.rawToken) },
    inferenceStatus: response.status,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main().catch((err) => {
  logger.error(`[smoke-test] Fatal: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    logger.debug(err.stack);
  }
  process.exit(1);
});
