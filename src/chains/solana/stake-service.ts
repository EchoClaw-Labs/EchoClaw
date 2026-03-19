/**
 * Solana staking service — delegate, withdraw, claim MEV.
 * Uses native @solana/web3.js StakeProgram — zero additional deps.
 */

import {
  Keypair,
  PublicKey,
  StakeProgram,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getSolanaConnection } from "./connection.js";
import { signAndSendLegacyTx } from "./tx.js";
import { solanaExplorerUrl, lamportsToSol } from "./validation.js";
import { EchoError, ErrorCodes } from "../../errors.js";

const STAKE_PROGRAM_ID = new PublicKey("Stake11111111111111111111111111111111111111");

export interface StakeAccountInfo {
  address: string;
  balanceSol: number;
  status: "activating" | "active" | "deactivating" | "inactive" | "unknown";
  validator?: string;
  claimableMevSol: number;
}

export async function getStakeAccounts(walletAddress: string): Promise<StakeAccountInfo[]> {
  const connection = getSolanaConnection();
  const walletPubkey = new PublicKey(walletAddress);

  const accounts = await connection.getProgramAccounts(STAKE_PROGRAM_ID, {
    filters: [
      { dataSize: 200 }, // stake account size
      {
        memcmp: {
          offset: 12, // withdrawer authority offset
          bytes: walletPubkey.toBase58(),
        },
      },
    ],
  });

  const epochInfo = await connection.getEpochInfo();
  const results: StakeAccountInfo[] = [];

  for (const { pubkey, account } of accounts) {
    const balanceLamports = account.lamports;
    const balanceSol = lamportsToSol(BigInt(balanceLamports));

    let status: StakeAccountInfo["status"] = "unknown";
    let validator: string | undefined;
    let delegatedLamports = 0;

    try {
      const stakeAccount = await connection.getAccountInfo(pubkey);
      if (stakeAccount && stakeAccount.data.length >= 124) {
        const data = stakeAccount.data;
        // Parse stake state from account data
        const stakeState = data.readUInt32LE(0);
        if (stakeState === 2) {
          // Delegated — read voter pubkey at offset 124
          const voterBytes = data.subarray(124, 156);
          validator = new PublicKey(voterBytes).toBase58();

          // Read activation/deactivation epochs
          const activationEpoch = Number(data.readBigUInt64LE(104));
          const deactivationEpoch = Number(data.readBigUInt64LE(112));

          if (deactivationEpoch < BigInt("0xFFFFFFFFFFFFFFFF") && deactivationEpoch <= epochInfo.epoch) {
            status = "inactive";
          } else if (deactivationEpoch < BigInt("0xFFFFFFFFFFFFFFFF")) {
            status = "deactivating";
          } else if (activationEpoch <= epochInfo.epoch) {
            status = "active";
          } else {
            status = "activating";
          }

          delegatedLamports = Number(data.readBigUInt64LE(72));
        } else if (stakeState === 1) {
          status = "inactive"; // initialized but not delegated
        }
      }
    } catch {
      // Fall back to balance-only info
    }

    // MEV = excess lamports above delegated stake + rent exempt minimum
    const rentExempt = await connection.getMinimumBalanceForRentExemption(200);
    const expectedBalance = delegatedLamports > 0 ? delegatedLamports + rentExempt : rentExempt;
    const claimableMev = Math.max(0, balanceLamports - expectedBalance);

    results.push({
      address: pubkey.toBase58(),
      balanceSol,
      status,
      validator,
      claimableMevSol: lamportsToSol(BigInt(claimableMev)),
    });
  }

  return results;
}

export async function createAndDelegateStake(
  secretKey: Uint8Array,
  amountSol: number,
  validatorVote?: string,
): Promise<{ stakeAccount: string; signature: string; explorerUrl: string }> {
  const connection = getSolanaConnection();
  const walletKeypair = Keypair.fromSecretKey(secretKey);
  const stakeKeypair = Keypair.generate();
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  const rentExempt = await connection.getMinimumBalanceForRentExemption(200);
  const totalLamports = lamports + rentExempt;

  // Pre-check balance with correct total (stake amount + rent exempt + tx fee)
  const balance = await connection.getBalance(walletKeypair.publicKey);
  if (balance < totalLamports + 5000) {
    throw new EchoError(
      ErrorCodes.SOLANA_INSUFFICIENT_BALANCE,
      `Insufficient balance: have ${lamportsToSol(BigInt(balance))} SOL, need ~${lamportsToSol(BigInt(totalLamports + 5000))} SOL (${amountSol} SOL + rent + fees)`,
    );
  }

  const votePubkey = validatorVote
    ? new PublicKey(validatorVote)
    : new PublicKey("EARNynHRWg6GfyJCmrrizcZxARB3HVzcaasvNa8kBS72"); // Solana Compass default

  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: walletKeypair.publicKey,
      newAccountPubkey: stakeKeypair.publicKey,
      lamports: totalLamports,
      space: 200,
      programId: STAKE_PROGRAM_ID,
    }),
    StakeProgram.initialize({
      stakePubkey: stakeKeypair.publicKey,
      authorized: {
        staker: walletKeypair.publicKey,
        withdrawer: walletKeypair.publicKey,
      },
    }),
    StakeProgram.delegate({
      stakePubkey: stakeKeypair.publicKey,
      authorizedPubkey: walletKeypair.publicKey,
      votePubkey,
    }),
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = walletKeypair.publicKey;
  transaction.sign(walletKeypair, stakeKeypair);

  const signature = await connection.sendRawTransaction(transaction.serialize());
  const { confirmWithPolling } = await import("./tx.js");
  await confirmWithPolling(connection, signature);

  return {
    stakeAccount: stakeKeypair.publicKey.toBase58(),
    signature,
    explorerUrl: solanaExplorerUrl(signature),
  };
}

export async function withdrawStake(
  secretKey: Uint8Array,
  stakeAccountAddress: string,
  amountSol?: number,
  force = false,
): Promise<{ signature: string; explorerUrl: string }> {
  const connection = getSolanaConnection();
  const walletKeypair = Keypair.fromSecretKey(secretKey);
  const stakeAccountPubkey = new PublicKey(stakeAccountAddress);

  const stakeBalance = await connection.getBalance(stakeAccountPubkey);
  const withdrawLamports = amountSol
    ? Math.round(amountSol * LAMPORTS_PER_SOL)
    : stakeBalance;

  const transaction = new Transaction().add(
    StakeProgram.withdraw({
      stakePubkey: stakeAccountPubkey,
      authorizedPubkey: walletKeypair.publicKey,
      toPubkey: walletKeypair.publicKey,
      lamports: withdrawLamports,
    }),
  );

  const signature = await signAndSendLegacyTx(transaction, walletKeypair);
  return { signature, explorerUrl: solanaExplorerUrl(signature) };
}

export async function claimMev(
  secretKey: Uint8Array,
  stakeAccountAddress?: string,
): Promise<Array<{ stakeAccount: string; claimedSol: number; signature: string }>> {
  const walletKeypair = Keypair.fromSecretKey(secretKey);
  const connection = getSolanaConnection();

  const accounts = stakeAccountAddress
    ? [{ address: stakeAccountAddress, claimableMevSol: 0, balanceSol: 0, status: "active" as const }]
    : await getStakeAccounts(walletKeypair.publicKey.toBase58());

  const claimable = stakeAccountAddress
    ? accounts
    : accounts.filter((a) => a.claimableMevSol > 0.000001);

  if (claimable.length === 0) {
    throw new EchoError(
      ErrorCodes.SOLANA_STAKE_FAILED,
      "No claimable MEV found across stake accounts.",
    );
  }

  const results: Array<{ stakeAccount: string; claimedSol: number; signature: string }> = [];

  for (const account of claimable) {
    const stakeAccountPubkey = new PublicKey(account.address);
    const rentExempt = await connection.getMinimumBalanceForRentExemption(200);
    const stakeBalance = await connection.getBalance(stakeAccountPubkey);

    // Read delegated stake from account data to avoid withdrawing principal
    let delegatedLamports = 0;
    try {
      const acctInfo = await connection.getAccountInfo(stakeAccountPubkey);
      if (acctInfo && acctInfo.data.length >= 80) {
        delegatedLamports = Number(acctInfo.data.readBigUInt64LE(72));
      }
    } catch {
      // Can't read delegated amount — skip this account to be safe
      continue;
    }

    const excessLamports = Math.max(0, stakeBalance - delegatedLamports - rentExempt);

    if (excessLamports <= 0) continue;

    // Withdraw only the excess (MEV tips)
    const transaction = new Transaction().add(
      StakeProgram.withdraw({
        stakePubkey: stakeAccountPubkey,
        authorizedPubkey: walletKeypair.publicKey,
        toPubkey: walletKeypair.publicKey,
        lamports: excessLamports,
      }),
    );

    try {
      const signature = await signAndSendLegacyTx(transaction, walletKeypair);
      results.push({
        stakeAccount: account.address,
        claimedSol: lamportsToSol(BigInt(excessLamports)),
        signature,
      });
    } catch {
      // Skip failed claims, continue with others
    }
  }

  return results;
}
