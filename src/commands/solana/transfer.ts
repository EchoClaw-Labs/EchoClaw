/**
 * Solana transfer commands — 2-step prepare/confirm intent flow.
 * Security model identical to 0G: prepare is read-only, confirm requires --yes + password.
 */

import { Command } from "commander";
import { Keypair, PublicKey } from "@solana/web3.js";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import { sendSol, sendSplToken } from "../../chains/solana/transfer-service.js";
import { resolveToken } from "../../chains/solana/token-registry.js";
import { getSolanaConnection } from "../../chains/solana/connection.js";
import {
  validateSolanaAddress,
  parseSolAmount,
  parseSplAmount,
  shortenSolanaAddress,
  lamportsToSol,
} from "../../chains/solana/validation.js";
import { loadConfig } from "../../config/store.js";
import { createIntent, saveIntent, loadIntent, deleteIntent, isIntentExpired } from "../../intents/store.js";
import type { SolanaTransferIntent, SolanaSplTransferIntent, TransferIntent } from "../../intents/types.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, colors, warnBox } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

// --- send prepare ---

export function createTransferSubcommand(): Command {
  const send = new Command("send")
    .description("SOL transfer (2-step: prepare → confirm)")
    .exitOverride();

  send
    .command("prepare")
    .description("Prepare a SOL transfer intent (read-only, no signing)")
    .requiredOption("--to <address>", "Recipient Solana address")
    .requiredOption("--amount <sol>", "Amount of SOL to send")
    .option("--note <text>", "Optional note")
    .action(async (options: { to: string; amount: string; note?: string }) => {
      const cfg = loadConfig();
      const walletAddress = cfg.wallet.solanaAddress;
      if (!walletAddress) {
        throw new EchoError(ErrorCodes.WALLET_NOT_CONFIGURED, "No Solana wallet configured.", "Run: echoclaw wallet create --chain solana");
      }

      const to = validateSolanaAddress(options.to);
      const { lamports, ui: amountSol } = parseSolAmount(options.amount);

      // Read-only balance check (no keystore decrypt)
      const spin = spinner("Checking balance...");
      spin.start();
      const connection = getSolanaConnection();
      const balance = await connection.getBalance(new PublicKey(walletAddress));
      if (BigInt(balance) < lamports) {
        spin.fail("Insufficient balance");
        throw new EchoError(ErrorCodes.SOLANA_INSUFFICIENT_BALANCE, `Have ${lamportsToSol(BigInt(balance))} SOL, need ${amountSol} SOL`);
      }
      spin.succeed("Balance sufficient");

      const intent = createIntent<SolanaTransferIntent>({
        type: "solana-transfer",
        cluster: cfg.solana.cluster,
        from: walletAddress,
        to,
        lamports: lamports.toString(),
        amountSol,
        ...(options.note ? { note: options.note } : {}),
      });

      saveIntent(intent);

      if (isHeadless()) {
        writeJsonSuccess({
          intentId: intent.intentId,
          from: intent.from,
          to: intent.to,
          amountSol: intent.amountSol,
          cluster: intent.cluster,
          expiresAt: intent.expiresAt,
        });
      } else {
        successBox("Transfer Prepared",
          `From: ${colors.address(shortenSolanaAddress(intent.from))}\n` +
          `To: ${colors.address(shortenSolanaAddress(intent.to))}\n` +
          `Amount: ${colors.info(`${intent.amountSol} SOL`)}\n` +
          `Cluster: ${colors.muted(intent.cluster)}\n` +
          `Expires: ${colors.muted(intent.expiresAt)}\n\n` +
          `Confirm: ${colors.info(`echoclaw solana send confirm ${intent.intentId} --yes`)}`);
      }
    });

  send
    .command("confirm <intentId>")
    .description("Confirm and broadcast a prepared SOL transfer")
    .option("--yes", "Required confirmation flag")
    .action(async (intentId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm this transfer.");
      }

      await confirmSolanaIntent(intentId, "solana-transfer");
    });

  return send;
}

// --- send-token prepare ---

export function createSendTokenSubcommand(): Command {
  const sendToken = new Command("send-token")
    .description("SPL token transfer (2-step: prepare → confirm)")
    .exitOverride();

  sendToken
    .command("prepare")
    .description("Prepare a SPL token transfer intent (read-only)")
    .requiredOption("--to <address>", "Recipient Solana address")
    .requiredOption("--token <symbol_or_mint>", "Token symbol or mint address")
    .requiredOption("--amount <amount>", "Amount of tokens to send")
    .option("--note <text>", "Optional note")
    .action(async (options: { to: string; token: string; amount: string; note?: string }) => {
      const cfg = loadConfig();
      const walletAddress = cfg.wallet.solanaAddress;
      if (!walletAddress) {
        throw new EchoError(ErrorCodes.WALLET_NOT_CONFIGURED, "No Solana wallet configured.");
      }

      const to = validateSolanaAddress(options.to);

      const spin = spinner(`Resolving token ${options.token}...`);
      spin.start();
      const tokenMeta = await resolveToken(options.token);
      if (!tokenMeta) {
        spin.fail("Token not found");
        throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${options.token}`);
      }
      spin.succeed(`Resolved: ${tokenMeta.symbol}`);

      const { atomic: amount, ui: amountUi } = parseSplAmount(options.amount, tokenMeta.decimals);

      const intent = createIntent<SolanaSplTransferIntent>({
        type: "solana-spl-transfer",
        cluster: cfg.solana.cluster,
        from: walletAddress,
        to,
        mint: tokenMeta.address,
        amount: amount.toString(),
        amountUi,
        decimals: tokenMeta.decimals,
        symbol: tokenMeta.symbol,
        ...(options.note ? { note: options.note } : {}),
      });

      saveIntent(intent);

      if (isHeadless()) {
        writeJsonSuccess({
          intentId: intent.intentId,
          from: intent.from,
          to: intent.to,
          amount: intent.amountUi,
          token: intent.symbol,
          mint: intent.mint,
          cluster: intent.cluster,
          expiresAt: intent.expiresAt,
        });
      } else {
        successBox("Token Transfer Prepared",
          `From: ${colors.address(shortenSolanaAddress(intent.from))}\n` +
          `To: ${colors.address(shortenSolanaAddress(intent.to))}\n` +
          `Amount: ${colors.info(`${intent.amountUi} ${intent.symbol}`)}\n` +
          `Mint: ${colors.muted(intent.mint)}\n` +
          `Cluster: ${colors.muted(intent.cluster)}\n` +
          `Expires: ${colors.muted(intent.expiresAt)}\n\n` +
          `Confirm: ${colors.info(`echoclaw solana send-token confirm ${intent.intentId} --yes`)}`);
      }
    });

  sendToken
    .command("confirm <intentId>")
    .description("Confirm and broadcast a prepared SPL token transfer")
    .option("--yes", "Required confirmation flag")
    .action(async (intentId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm this transfer.");
      }

      await confirmSolanaIntent(intentId, "solana-spl-transfer");
    });

  return sendToken;
}

// --- shared confirm logic ---

async function confirmSolanaIntent(
  intentId: string,
  expectedType: "solana-transfer" | "solana-spl-transfer",
): Promise<void> {
  // Load intent
  const intent = loadIntent<TransferIntent>(intentId);
  if (!intent) {
    throw new EchoError(ErrorCodes.INTENT_NOT_FOUND, `Intent not found: ${intentId}`);
  }

  // Check expiry
  if (isIntentExpired(intent)) {
    deleteIntent(intentId);
    throw new EchoError(ErrorCodes.INTENT_EXPIRED, "Intent expired (10 minute TTL).", "Run prepare again.");
  }

  // Type check
  if (intent.type !== expectedType) {
    throw new EchoError(ErrorCodes.CHAIN_MISMATCH, `Intent type mismatch: expected ${expectedType}, got ${intent.type}`);
  }

  // Cluster verification
  const cfg = loadConfig();
  if (intent.cluster !== cfg.solana.cluster) {
    throw new EchoError(ErrorCodes.CHAIN_MISMATCH,
      `Cluster mismatch: intent was prepared for ${intent.cluster}, but current config is ${cfg.solana.cluster}`);
  }

  // Decrypt keystore (this is the security boundary)
  const wallet = requireSolanaWallet();

  // Signer verification
  if (wallet.address !== intent.from) {
    throw new EchoError(ErrorCodes.SIGNER_MISMATCH,
      `Wallet address ${wallet.address} does not match intent from ${intent.from}`);
  }

  if (cfg.solana.cluster !== "mainnet-beta" && !isHeadless()) {
    warnBox("Network Warning", `You are on ${colors.info(cfg.solana.cluster)}, not mainnet.`);
  }

  const spin = spinner("Broadcasting transaction...");
  spin.start();

  try {
    const keypair = Keypair.fromSecretKey(wallet.secretKey);

    if (intent.type === "solana-transfer") {
      const solIntent = intent as SolanaTransferIntent;

      // Fresh balance re-check
      const connection = getSolanaConnection();
      const balance = await connection.getBalance(new PublicKey(wallet.address));
      if (BigInt(balance) < BigInt(solIntent.lamports)) {
        spin.fail("Insufficient balance at confirm time");
        deleteIntent(intentId);
        throw new EchoError(ErrorCodes.SOLANA_INSUFFICIENT_BALANCE, "Balance changed since prepare.");
      }

      const result = await sendSol({
        from: keypair,
        to: solIntent.to,
        lamports: BigInt(solIntent.lamports),
      });

      deleteIntent(intentId);
      spin.succeed("SOL sent");

      if (isHeadless()) {
        writeJsonSuccess({
          signature: result.signature,
          explorerUrl: result.explorerUrl,
          from: solIntent.from,
          to: solIntent.to,
          amountSol: solIntent.amountSol,
          intentId,
        });
      } else {
        successBox("Transfer Complete",
          `Sent ${colors.info(`${solIntent.amountSol} SOL`)} to ${colors.address(shortenSolanaAddress(solIntent.to))}\n` +
          `Signature: ${colors.muted(result.signature)}\n` +
          `Explorer: ${colors.muted(result.explorerUrl)}`);
      }
    } else {
      const splIntent = intent as SolanaSplTransferIntent;

      const result = await sendSplToken({
        from: keypair,
        to: splIntent.to,
        mint: splIntent.mint,
        amount: BigInt(splIntent.amount),
        decimals: splIntent.decimals,
      });

      deleteIntent(intentId);
      spin.succeed("Token sent");

      if (isHeadless()) {
        writeJsonSuccess({
          signature: result.signature,
          explorerUrl: result.explorerUrl,
          from: splIntent.from,
          to: splIntent.to,
          amount: splIntent.amountUi,
          token: splIntent.symbol,
          mint: splIntent.mint,
          intentId,
        });
      } else {
        successBox("Transfer Complete",
          `Sent ${colors.info(`${splIntent.amountUi} ${splIntent.symbol}`)} to ${colors.address(shortenSolanaAddress(splIntent.to))}\n` +
          `Signature: ${colors.muted(result.signature)}\n` +
          `Explorer: ${colors.muted(result.explorerUrl)}`);
      }
    }
  } catch (err) {
    spin.fail("Transfer failed");
    throw err;
  }
}
