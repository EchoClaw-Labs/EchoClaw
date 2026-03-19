import { Command } from "commander";
import type { Address } from "viem";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { getAuthenticatedBroker, resetAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { withSuppressedConsole } from "../../0g-compute/bridge.js";
import { normalizeSubAccount, serializeSubAccount } from "../../0g-compute/account.js";
import { calculateProviderPricing, formatPricePerMTokens } from "../../0g-compute/pricing.js";
import { serializeBigInts } from "../../0g-compute/helpers.js";

export function createProvidersSubcommand(): Command {
  return new Command("providers")
    .description("List available 0G Compute services (requires wallet)")
    .option("--detailed", "Include detailed info (TEE status, health, pricing)")
    .option("--with-balances", "Include sub-account balances per provider (requires --detailed)")
    .option("--fresh", "Refresh broker state before reading providers")
    .option("--json", "JSON output")
    .action(async (options: { detailed?: boolean; withBalances?: boolean; fresh?: boolean; json?: boolean }) => {
      if (options.withBalances && !options.detailed) {
        const { EchoError, ErrorCodes } = await import("../../errors.js");
        throw new EchoError(
          ErrorCodes.INVALID_AMOUNT,
          "--with-balances requires --detailed",
          "Use: echoclaw 0g providers --detailed --with-balances"
        );
      }

      if (options.fresh) {
        resetAuthenticatedBroker();
      }

      const broker = await getAuthenticatedBroker();

      if (options.detailed) {
        const services = await withSuppressedConsole(() => broker.inference.listServiceWithDetail());

        // Build enriched provider data
        const enriched = [];
        for (const svc of services) {
          const inputPrice = svc.inputPrice as bigint;
          const outputPrice = svc.outputPrice as bigint;
          const pricing = calculateProviderPricing(inputPrice, outputPrice);

          const entry: Record<string, unknown> = {
            ...serializeBigInts(svc) as Record<string, unknown>,
            inputPricePerMTokens: formatPricePerMTokens(inputPrice),
            outputPricePerMTokens: formatPricePerMTokens(outputPrice),
            recommendedMinLockedOg: pricing.recommendedMinLockedOg,
            recommendedAlertLockedOg: pricing.recommendedAlertLockedOg,
          };

          // Optionally fetch sub-account balance
          if (options.withBalances) {
            try {
              const account = await withSuppressedConsole(() =>
                broker.inference.getAccount(svc.provider as Address)
              );
              const normalized = normalizeSubAccount(account);
              const needsTopUp = normalized.lockedOg < pricing.recommendedMinLockedOg;
              entry.totalOg = normalized.totalOg;
              entry.pendingRefundOg = normalized.pendingRefundOg;
              entry.lockedOg = normalized.lockedOg;
              entry.needsTopUp = needsTopUp;
              entry.suggestedTopUpOg = needsTopUp
                ? Math.max(0, pricing.recommendedMinLockedOg - normalized.lockedOg)
                : 0;
            } catch {
              entry.totalOg = null;
              entry.pendingRefundOg = null;
              entry.lockedOg = null;
              entry.needsTopUp = null;
              entry.suggestedTopUpOg = null;
            }
          }

          enriched.push(entry);
        }

        if (isHeadless()) {
          writeJsonSuccess({ providers: enriched });
        } else {
          if (services.length === 0) {
            process.stderr.write("No providers found.\n");
            return;
          }
          process.stderr.write(`Found ${services.length} provider(s):\n\n`);
          for (let i = 0; i < services.length; i++) {
            const svc = services[i]!;
            const e = enriched[i]!;
            const inputPrice = svc.inputPrice as bigint;
            const outputPrice = svc.outputPrice as bigint;
            process.stderr.write(`  Provider: ${svc.provider}\n`);
            process.stderr.write(`  Model:    ${svc.model}\n`);
            process.stderr.write(`  Type:     ${svc.serviceType}\n`);
            process.stderr.write(`  URL:      ${svc.url}\n`);
            process.stderr.write(`  Input:    ${formatPricePerMTokens(inputPrice)} 0G/M tokens\n`);
            process.stderr.write(`  Output:   ${formatPricePerMTokens(outputPrice)} 0G/M tokens\n`);
            process.stderr.write(`  TEE ack:  ${svc.teeSignerAcknowledged}\n`);
            process.stderr.write(
              `  Recommended locked: ~${(e.recommendedMinLockedOg as number).toFixed(3)} 0G` +
              ` (alert when < ${(e.recommendedAlertLockedOg as number).toFixed(3)} 0G)\n`
            );

            if (options.withBalances && e.lockedOg != null) {
              const locked = e.lockedOg as number;
              const recMin = e.recommendedMinLockedOg as number;
              const ok = locked >= recMin;
              const status = ok
                ? "OK"
                : `TOP UP ~${(e.suggestedTopUpOg as number).toFixed(3)} 0G`;
              process.stderr.write(
                `  Locked: ${locked.toFixed(4)} 0G (recommended: ${recMin.toFixed(3)} 0G) — ${status}\n`
              );
            } else if (options.withBalances) {
              process.stderr.write("  Locked: (no sub-account)\n");
            }

            process.stderr.write("\n");
          }
        }
      } else {
        const services = await withSuppressedConsole(() => broker.inference.listService());
        if (isHeadless()) {
          writeJsonSuccess({ providers: services.map((s) => serializeBigInts(s)) });
        } else {
          if (services.length === 0) {
            process.stderr.write("No providers found.\n");
            return;
          }
          process.stderr.write(`Provider                                     | Model                          | URL\n`);
          process.stderr.write("-".repeat(110) + "\n");
          for (const svc of services) {
            const provider = String(svc[0]).slice(0, 42).padEnd(42);
            const model = String(svc[6]).padEnd(30);
            const url = String(svc[2]);
            process.stderr.write(`${provider} | ${model} | ${url}\n`);
          }
          process.stderr.write(`\nTotal: ${services.length}\n`);
        }
      }
    });
}
