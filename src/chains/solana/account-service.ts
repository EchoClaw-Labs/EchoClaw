/**
 * Solana SPL account management — burn tokens, close empty accounts.
 */

import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createBurnInstruction,
  createCloseAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { getSolanaConnection } from "./connection.js";
import { signAndSendLegacyTx } from "./tx.js";
import { solanaExplorerUrl, lamportsToSol } from "./validation.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import type { TransferResult } from "../types.js";

export async function burnSplToken(
  secretKey: Uint8Array,
  mint: string,
  amount?: bigint,
): Promise<TransferResult> {
  const connection = getSolanaConnection();
  const keypair = Keypair.fromSecretKey(secretKey);
  const mintPubkey = new PublicKey(mint);

  // Find the token account
  const tokenAccounts = await connection.getTokenAccountsByOwner(keypair.publicKey, {
    mint: mintPubkey,
  });

  if (tokenAccounts.value.length === 0) {
    throw new EchoError(
      ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
      `No token account found for mint ${mint}`,
    );
  }

  const tokenAccountPubkey = tokenAccounts.value[0].pubkey;
  const accountInfo = await getAccount(connection, tokenAccountPubkey);
  const burnAmount = amount ?? accountInfo.amount;

  if (burnAmount === BigInt(0)) {
    throw new EchoError(
      ErrorCodes.SOLANA_INSUFFICIENT_BALANCE,
      "Token balance is zero, nothing to burn.",
    );
  }

  const transaction = new Transaction().add(
    createBurnInstruction(
      tokenAccountPubkey,
      mintPubkey,
      keypair.publicKey,
      burnAmount,
    ),
  );

  const signature = await signAndSendLegacyTx(transaction, keypair);
  return { signature, explorerUrl: solanaExplorerUrl(signature) };
}

export async function closeEmptyAccounts(
  secretKey: Uint8Array,
): Promise<{ closed: number; failed: number; rentReclaimedSol: number; signatures: string[] }> {
  const connection = getSolanaConnection();
  const keypair = Keypair.fromSecretKey(secretKey);

  const tokenAccounts = await connection.getTokenAccountsByOwner(
    keypair.publicKey,
    { programId: TOKEN_PROGRAM_ID },
    "confirmed",
  );

  const emptyAccounts: PublicKey[] = [];
  for (const { pubkey, account } of tokenAccounts.value) {
    try {
      const info = await getAccount(connection, pubkey);
      if (info.amount === BigInt(0)) {
        emptyAccounts.push(pubkey);
      }
    } catch {
      // Skip accounts that can't be parsed
    }
  }

  if (emptyAccounts.length === 0) {
    return { closed: 0, failed: 0, rentReclaimedSol: 0, signatures: [] };
  }

  const signatures: string[] = [];
  let actualClosed = 0;
  let actualRentReclaimed = 0;

  // Close in batches of 10 per transaction (avoid tx size limit)
  const batchSize = 10;
  for (let i = 0; i < emptyAccounts.length; i += batchSize) {
    const batch = emptyAccounts.slice(i, i + batchSize);
    const transaction = new Transaction();

    let batchRent = 0;
    for (const accountPubkey of batch) {
      const rentLamports = await connection.getBalance(accountPubkey);
      batchRent += rentLamports;

      transaction.add(
        createCloseAccountInstruction(
          accountPubkey,
          keypair.publicKey, // destination for rent
          keypair.publicKey, // owner
        ),
      );
    }

    try {
      const sig = await signAndSendLegacyTx(transaction, keypair);
      signatures.push(sig);
      actualClosed += batch.length;
      actualRentReclaimed += batchRent;
    } catch {
      // Batch failed — don't count these as closed
    }
  }

  return {
    closed: actualClosed,
    failed: emptyAccounts.length - actualClosed,
    rentReclaimedSol: lamportsToSol(BigInt(actualRentReclaimed)),
    signatures,
  };
}
