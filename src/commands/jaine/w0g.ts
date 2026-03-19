import { Command } from "commander";
import { parseUnits, formatUnits } from "viem";
import { loadConfig } from "../../config/store.js";
import { getPublicClient } from "../../wallet/client.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { getSigningClient } from "../../wallet/signingClient.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors, formatBalance } from "../../utils/ui.js";
import { W0G_ABI } from "../../jaine/abi/w0g.js";

export function createW0gSubcommand(): Command {
  const w0g = new Command("w0g")
    .description("Wrap/unwrap native 0G to w0G")
    .exitOverride();

  w0g
    .command("balance")
    .description("Show native 0G and w0G balances")
    .action(async () => {
      const cfg = loadConfig();
      if (!cfg.wallet.address) {
        throw new EchoError(ErrorCodes.WALLET_NOT_CONFIGURED, "No wallet configured.");
      }

      const client = getPublicClient();
      const w0gAddr = cfg.protocol.w0g;

      const [nativeBalance, w0gBalance] = await Promise.all([
        client.getBalance({ address: cfg.wallet.address }),
        client.readContract({
          address: w0gAddr,
          abi: W0G_ABI,
          functionName: "balanceOf",
          args: [cfg.wallet.address],
        }),
      ]);

      if (isHeadless()) {
        writeJsonSuccess({
          native0G: nativeBalance.toString(),
          w0G: w0gBalance.toString(),
          formatted: {
            native0G: formatUnits(nativeBalance, 18),
            w0G: formatUnits(w0gBalance, 18),
          },
        });
      } else {
        infoBox(
          "0G Balances",
          `Native 0G: ${colors.value(formatBalance(nativeBalance, 18))} 0G\n` +
            `Wrapped w0G: ${colors.value(formatBalance(w0gBalance, 18))} w0G`
        );
      }
    });

  w0g
    .command("wrap")
    .description("Wrap native 0G to w0G")
    .requiredOption("--amount <0G>", "Amount of native 0G to wrap")
    .requiredOption("--yes", "Confirm the transaction")
    .action(async (options: { amount: string; yes: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      const { privateKey } = requireWalletAndKeystore();
      const cfg = loadConfig();

      const amount = parseUnits(options.amount, 18);
      if (amount <= 0n) {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, "Amount must be greater than 0");
      }

      const spin = spinner("Wrapping 0G...");
      spin.start();

      const walletClient = getSigningClient(privateKey);

      try {
        const txHash = await walletClient.writeContract({
          address: cfg.protocol.w0g,
          abi: W0G_ABI,
          functionName: "deposit",
          value: amount,
        });

        spin.succeed("0G wrapped successfully");

        const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

        if (isHeadless()) {
          writeJsonSuccess({
            txHash,
            explorerUrl,
            amount: amount.toString(),
            formatted: options.amount,
          });
        } else {
          successBox(
            "0G Wrapped",
            `Amount: ${colors.value(options.amount)} 0G → w0G\n` +
              `Tx: ${colors.info(txHash)}\n` +
              `Explorer: ${colors.muted(explorerUrl)}`
          );
        }
      } catch (err) {
        spin.fail("Wrap failed");
        throw new EchoError(ErrorCodes.RPC_ERROR, `Wrap failed: ${err instanceof Error ? err.message : err}`);
      }
    });

  w0g
    .command("unwrap")
    .description("Unwrap w0G to native 0G")
    .requiredOption("--amount <w0G>", "Amount of w0G to unwrap")
    .requiredOption("--yes", "Confirm the transaction")
    .action(async (options: { amount: string; yes: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      const { privateKey } = requireWalletAndKeystore();
      const cfg = loadConfig();

      const amount = parseUnits(options.amount, 18);
      if (amount <= 0n) {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, "Amount must be greater than 0");
      }

      const spin = spinner("Unwrapping w0G...");
      spin.start();

      const walletClient = getSigningClient(privateKey);

      try {
        const txHash = await walletClient.writeContract({
          address: cfg.protocol.w0g,
          abi: W0G_ABI,
          functionName: "withdraw",
          args: [amount],
        });

        spin.succeed("w0G unwrapped successfully");

        const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

        if (isHeadless()) {
          writeJsonSuccess({
            txHash,
            explorerUrl,
            amount: amount.toString(),
            formatted: options.amount,
          });
        } else {
          successBox(
            "w0G Unwrapped",
            `Amount: ${colors.value(options.amount)} w0G → 0G\n` +
              `Tx: ${colors.info(txHash)}\n` +
              `Explorer: ${colors.muted(explorerUrl)}`
          );
        }
      } catch (err) {
        spin.fail("Unwrap failed");
        throw new EchoError(ErrorCodes.RPC_ERROR, `Unwrap failed: ${err instanceof Error ? err.message : err}`);
      }
    });

  return w0g;
}
