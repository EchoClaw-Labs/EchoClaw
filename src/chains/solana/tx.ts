/**
 * Solana transaction helpers — composable primitives with multi-signer support.
 *
 * Three primitives: deserialize → sign(signers[]) → send
 * Convenience wrapper: signAndSendVersionedTx(bytes, signers[])
 * Legacy path: signAndSendLegacyTx(transaction, keypair)
 *
 * Multi-signer enables both:
 * - Single-sign: Jupiter swap, PumpPortal buy/sell → [walletKeypair]
 * - Multi-sign: PumpPortal create → [mintKeypair, walletKeypair]
 */

import {
  type Connection,
  Keypair,
  type SendOptions,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { getSolanaConnection } from "./connection.js";
import { solanaExplorerUrl } from "./validation.js";

const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;
const CONFIRM_POLL_INTERVAL_MS = 2_000;
const MAX_RETRIES = 3;

// --- Composable primitives ---

/** Deserialize a VersionedTransaction from raw bytes or base64 string. */
export function deserializeVersionedTx(input: Uint8Array | string): VersionedTransaction {
  try {
    const bytes = typeof input === "string"
      ? Buffer.from(input, "base64")
      : input;
    return VersionedTransaction.deserialize(bytes);
  } catch (err) {
    throw new EchoError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to deserialize transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Sign a VersionedTransaction with one or more keypairs. */
export function signVersionedTx(
  tx: VersionedTransaction,
  signers: Keypair[],
): VersionedTransaction {
  try {
    tx.sign(signers);
    return tx;
  } catch (err) {
    throw new EchoError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to sign transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Send a signed transaction and confirm with polling. */
export async function sendSignedTx(
  connection: Connection,
  tx: VersionedTransaction,
  opts?: { skipPreflight?: boolean },
): Promise<string> {
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: opts?.skipPreflight ?? false,
    maxRetries: 2,
  });

  await confirmWithPolling(connection, signature);
  return signature;
}

// --- Convenience wrappers ---

/**
 * Deserialize + sign + send a VersionedTransaction.
 * Accepts raw bytes (PumpPortal) or base64 string (Jupiter).
 *
 * Note: retry only helps for transient network errors (429, timeout).
 * For BlockheightExceeded the embedded blockhash is stale and a new tx
 * must be fetched from the API — retry with the same payload won't help.
 */
export async function signAndSendVersionedTx(
  txInput: Uint8Array | string,
  signers: Keypair[],
  opts?: { skipPreflight?: boolean; connection?: Connection },
): Promise<string> {
  const connection = opts?.connection ?? getSolanaConnection();

  const tx = deserializeVersionedTx(txInput);
  signVersionedTx(tx, signers);

  // Retry only the send step (same signed tx, new network attempt)
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await sendSignedTx(connection, tx, opts);
    } catch (err) {
      lastError = err;
      if (err instanceof EchoError && err.retryable && attempt < MAX_RETRIES) {
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Sign and send a legacy Transaction (SystemProgram.transfer, StakeProgram).
 */
export async function signAndSendLegacyTx(
  transaction: Transaction,
  keypair: Keypair,
  opts?: { connection?: Connection },
): Promise<string> {
  const connection = opts?.connection ?? getSolanaConnection();

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = keypair.publicKey;
  transaction.sign(keypair);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 2,
  });

  await confirmWithPolling(connection, signature);
  return signature;
}

// --- Confirmation ---

export async function confirmWithPolling(
  connection: Connection,
  signature: string,
  timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];

    if (status) {
      if (status.err) {
        const error = new EchoError(
          ErrorCodes.SOLANA_TX_FAILED,
          `Transaction failed: ${JSON.stringify(status.err)}`,
          `Explorer: ${solanaExplorerUrl(signature)}`,
        );
        throw error;
      }

      if (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      ) {
        return;
      }
    }

    await new Promise((r) => setTimeout(r, CONFIRM_POLL_INTERVAL_MS));
  }

  const error = new EchoError(
    ErrorCodes.SOLANA_TX_TIMEOUT,
    `Transaction confirmation timed out after ${timeoutMs}ms`,
    `Signature: ${signature}\nExplorer: ${solanaExplorerUrl(signature)}`,
  );
  error.retryable = true;
  throw error;
}

// --- Helpers ---

export function keypairFromSecretKey(secretKey: Uint8Array): Keypair {
  return Keypair.fromSecretKey(secretKey);
}
