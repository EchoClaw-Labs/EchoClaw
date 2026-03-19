/**
 * Solana transfer service — SOL and SPL token transfers.
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  getAccount,
  createTransferCheckedInstruction,
  getMint,
} from "@solana/spl-token";
import { EchoError, ErrorCodes } from "../../errors.js";
import { getSolanaConnection } from "./connection.js";
import { signAndSendLegacyTx } from "./tx.js";
import { solanaExplorerUrl, lamportsToSol } from "./validation.js";
import type { TransferResult } from "../types.js";

export interface SendSolParams {
  from: Keypair;
  to: string;
  lamports: bigint;
}

export async function sendSol(params: SendSolParams): Promise<TransferResult> {
  const connection = getSolanaConnection();
  const toPubkey = new PublicKey(params.to);

  // Pre-check balance
  const balance = await connection.getBalance(params.from.publicKey);
  if (BigInt(balance) < params.lamports) {
    throw new EchoError(
      ErrorCodes.SOLANA_INSUFFICIENT_BALANCE,
      `Insufficient SOL balance: have ${lamportsToSol(BigInt(balance))} SOL, need ${lamportsToSol(params.lamports)} SOL`,
      "Check balance with: echoclaw wallet balances --wallet solana",
    );
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: params.from.publicKey,
      toPubkey,
      lamports: params.lamports,
    }),
  );

  const signature = await signAndSendLegacyTx(transaction, params.from);

  return {
    signature,
    explorerUrl: solanaExplorerUrl(signature),
  };
}

export interface SendSplTokenParams {
  from: Keypair;
  to: string;
  mint: string;
  amount: bigint;
  decimals: number;
}

export async function sendSplToken(params: SendSplTokenParams): Promise<TransferResult> {
  const connection = getSolanaConnection();
  const mintPubkey = new PublicKey(params.mint);
  const toPubkey = new PublicKey(params.to);

  // Get or create the recipient's associated token account
  let destinationAta;
  try {
    destinationAta = await getOrCreateAssociatedTokenAccount(
      connection,
      params.from, // payer
      mintPubkey,
      toPubkey,
    );
  } catch (err) {
    throw new EchoError(
      ErrorCodes.SOLANA_TRANSFER_FAILED,
      `Failed to get/create recipient token account: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Read-only lookup of source ATA — do NOT create (avoids rent side-effect)
  let sourceAtaAddress;
  let sourceBalance: bigint;
  try {
    sourceAtaAddress = await getAssociatedTokenAddress(mintPubkey, params.from.publicKey);
    const sourceAccount = await getAccount(connection, sourceAtaAddress);
    sourceBalance = sourceAccount.amount;
  } catch {
    throw new EchoError(
      ErrorCodes.SOLANA_INSUFFICIENT_BALANCE,
      `You don't hold token ${params.mint}`,
      "Check balance with: echoclaw wallet balances --wallet solana",
    );
  }

  // Pre-check token balance
  if (sourceBalance < params.amount) {
    throw new EchoError(
      ErrorCodes.SOLANA_INSUFFICIENT_BALANCE,
      `Insufficient token balance for mint ${params.mint}`,
      "Check balance with: echoclaw wallet balances --wallet solana",
    );
  }

  // Resolve decimals from on-chain if not provided
  const mintInfo = await getMint(connection, mintPubkey);
  const decimals = params.decimals || mintInfo.decimals;

  const transaction = new Transaction().add(
    createTransferCheckedInstruction(
      sourceAtaAddress,
      mintPubkey,
      destinationAta.address,
      params.from.publicKey,
      params.amount,
      decimals,
    ),
  );

  const signature = await signAndSendLegacyTx(transaction, params.from);

  return {
    signature,
    explorerUrl: solanaExplorerUrl(signature),
  };
}
