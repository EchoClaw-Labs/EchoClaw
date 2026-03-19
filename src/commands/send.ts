import { Command } from "commander";
import { isAddress, getAddress, parseEther, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config/store.js";
import { getPublicClient } from "../wallet/client.js";
import { getSigningClient } from "../wallet/signingClient.js";
import { loadKeystore, decryptPrivateKey } from "../wallet/keystore.js";
import { createIntent, saveIntent, loadIntent, deleteIntent, isIntentExpired } from "../intents/store.js";
import type { EvmTransferIntent } from "../intents/types.js";
import { requireKeystorePassword } from "../utils/env.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { isHeadless, writeJsonSuccess } from "../utils/output.js";
import { spinner, successBox, infoBox, colors, formatBalance } from "../utils/ui.js";

export function createSendCommand(): Command {
  const send = new Command("send")
    .description("Send native 0G tokens")
    .exitOverride();

  // echoclaw send prepare --to <addr> --amount <0G>
  send
    .command("prepare")
    .description("Prepare a transfer intent (valid 10 min)")
    .requiredOption("--to <address>", "Recipient address")
    .requiredOption("--amount <0G>", "Amount in 0G (e.g. 1.5)")
    .option("--note <text>", "Optional note")
    .action(async (options: { to: string; amount: string; note?: string }) => {
      // 1. Validate address
      if (!isAddress(options.to)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${options.to}`);
      }
      const to = getAddress(options.to) as Address;

      // 2. Validate amount (parseEther for precision)
      let valueWei: bigint;
      try {
        valueWei = parseEther(options.amount);
      } catch {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid amount: ${options.amount}`);
      }
      if (valueWei <= 0n) {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, "Amount must be greater than 0");
      }

      // 3. Check wallet config
      const cfg = loadConfig();
      if (!cfg.wallet.address) {
        throw new EchoError(
          ErrorCodes.WALLET_NOT_CONFIGURED,
          "No wallet configured.",
          "Run: echoclaw wallet create --json"
        );
      }

      // 4. Gas estimate from RPC
      const client = getPublicClient();
      const spin = spinner("Estimating gas...");
      spin.start();

      let gasLimit: bigint;
      let maxFeePerGas: bigint | undefined;
      let gasPrice: bigint | undefined;

      try {
        const [estimatedGas, feeData] = await Promise.all([
          client.estimateGas({ account: cfg.wallet.address, to, value: valueWei }),
          client.estimateFeesPerGas().catch(() => null),
        ]);
        gasLimit = estimatedGas;
        // feeData can be EIP-1559 (maxFeePerGas) or legacy (gasPrice)
        if (feeData) {
          maxFeePerGas = feeData.maxFeePerGas ?? undefined;
          gasPrice = (feeData as { gasPrice?: bigint }).gasPrice ?? undefined;
        }
      } catch (err) {
        spin.fail("Failed to estimate gas");
        throw new EchoError(ErrorCodes.RPC_ERROR, `RPC error: ${err instanceof Error ? err.message : err}`);
      }

      spin.succeed("Gas estimated");

      // 5. Create and save intent
      const intent = createIntent<EvmTransferIntent>({
        type: "evm-transfer",
        chainId: cfg.chain.chainId,
        rpcUrl: cfg.chain.rpcUrl,
        from: cfg.wallet.address,
        to,
        valueWei: valueWei.toString(),
        gasLimit: gasLimit.toString(),
        maxFeePerGas: maxFeePerGas ? maxFeePerGas.toString() : undefined,
        gasPrice: gasPrice ? gasPrice.toString() : undefined,
        note: options.note,
      });
      saveIntent(intent);

      // 6. Output
      const result = {
        intentId: intent.intentId,
        from: intent.from,
        to: intent.to,
        value: options.amount,
        valueWei: intent.valueWei,
        expiresAt: intent.expiresAt,
      };

      if (isHeadless()) {
        writeJsonSuccess(result);
      } else {
        infoBox(
          "Transfer Prepared",
          `Intent ID: ${colors.info(intent.intentId)}\n` +
            `From: ${colors.address(intent.from)}\n` +
            `To: ${colors.address(intent.to)}\n` +
            `Amount: ${colors.value(options.amount + " 0G")}\n` +
            `Expires: ${colors.muted(intent.expiresAt)}\n\n` +
            `Confirm with:\n  ${colors.info(`echoclaw send confirm ${intent.intentId} --yes`)}`
        );
      }
    });

  // echoclaw send confirm <intentId> --yes
  send
    .command("confirm <intentId>")
    .description("Confirm and broadcast prepared transfer")
    .requiredOption("--yes", "Confirm the transfer (required)")
    .action(async (intentId: string, options: { yes: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      // 1. Load intent
      const intent = loadIntent<EvmTransferIntent>(intentId);
      if (!intent) {
        throw new EchoError(ErrorCodes.INTENT_NOT_FOUND, `Intent not found: ${intentId}`);
      }

      // 2. Check expiry
      if (isIntentExpired(intent)) {
        deleteIntent(intentId);
        throw new EchoError(ErrorCodes.INTENT_EXPIRED, "Intent expired.", "Run: echoclaw send prepare");
      }

      // 3. Verify chain match
      const cfg = loadConfig();
      if (cfg.chain.chainId !== intent.chainId) {
        throw new EchoError(
          ErrorCodes.CHAIN_MISMATCH,
          `Intent for chain ${intent.chainId}, current is ${cfg.chain.chainId}`
        );
      }

      // 4. Get password and decrypt keystore
      const password = requireKeystorePassword();
      const keystore = loadKeystore();
      if (!keystore) {
        throw new EchoError(ErrorCodes.KEYSTORE_NOT_FOUND, "Keystore not found.", "Run: echoclaw wallet create --json");
      }

      const spin = spinner("Signing and broadcasting...");
      spin.start();

      let privateKey;
      try {
        privateKey = decryptPrivateKey(keystore, password);
      } catch (err) {
        spin.fail("Failed to decrypt keystore");
        throw new EchoError(
          ErrorCodes.KEYSTORE_DECRYPT_FAILED,
          "Decryption failed: wrong password or corrupted keystore"
        );
      }

      // 5. Re-check balance with fresh gas estimate
      const client = getPublicClient();
      let balance: bigint;
      let freshMaxFeePerGas: bigint | undefined;
      let freshGasPrice: bigint | undefined;

      try {
        const [bal, feeData] = await Promise.all([
          client.getBalance({ address: intent.from }),
          client.estimateFeesPerGas().catch(() => null),
        ]);
        balance = bal;
        if (feeData) {
          freshMaxFeePerGas = feeData.maxFeePerGas ?? undefined;
          freshGasPrice = (feeData as { gasPrice?: bigint }).gasPrice ?? undefined;
        }
      } catch (err) {
        spin.fail("Failed to check balance");
        throw new EchoError(ErrorCodes.RPC_ERROR, `RPC error: ${err instanceof Error ? err.message : err}`);
      }

      const feePerGas = freshMaxFeePerGas ?? freshGasPrice ?? 0n;
      const estimatedFee = BigInt(intent.gasLimit) * feePerGas;
      const totalNeeded = BigInt(intent.valueWei) + estimatedFee;

      if (balance < totalNeeded) {
        spin.fail("Insufficient balance");
        throw new EchoError(
          ErrorCodes.INSUFFICIENT_BALANCE,
          "Insufficient balance.",
          `Have: ${formatBalance(balance, 18)} 0G, need: ~${formatBalance(totalNeeded, 18)} 0G`
        );
      }

      // 6. Verify signer matches intent
      const account = privateKeyToAccount(privateKey);
      if (account.address.toLowerCase() !== intent.from.toLowerCase()) {
        spin.fail("Signer mismatch");
        throw new EchoError(
          ErrorCodes.SIGNER_MISMATCH,
          `Keystore address ${account.address} does not match intent from ${intent.from}`,
          "Keystore may have changed since prepare. Run: echoclaw send prepare"
        );
      }

      // 7. Create wallet client and send tx
      const walletClient = getSigningClient(privateKey);

      let txHash: `0x${string}`;
      try {
        txHash = await walletClient.sendTransaction({
          to: intent.to,
          value: BigInt(intent.valueWei),
        });
      } catch (err) {
        spin.fail("Transaction failed");
        throw new EchoError(ErrorCodes.RPC_ERROR, `Transaction error: ${err instanceof Error ? err.message : err}`);
      }

      spin.succeed("Transaction sent");

      // 8. Delete intent (single-use)
      deleteIntent(intentId);

      // 9. Output (include intentId/chainId/to/valueWei for traceability)
      const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;
      const result = {
        txHash,
        explorerUrl,
        status: "pending" as const,
        intentId,
        chainId: cfg.chain.chainId,
        to: intent.to,
        valueWei: intent.valueWei,
        value0G: formatEther(BigInt(intent.valueWei)),
      };

      if (isHeadless()) {
        writeJsonSuccess(result);
      } else {
        successBox(
          "Transaction Sent",
          `Hash: ${colors.info(txHash)}\n` +
            `To: ${colors.address(intent.to)}\n` +
            `Amount: ${colors.value(result.value0G + " 0G")}\n\n` +
            `Explorer: ${colors.muted(explorerUrl)}`
        );
      }
    });

  return send;
}
