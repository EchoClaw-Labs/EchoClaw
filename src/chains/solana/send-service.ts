/**
 * Jupiter Send service — send tokens to anyone via invite code.
 * Recipients claim via Jupiter Mobile. Self-custodial recovery via clawback.
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import { fetchJson } from "../../utils/http.js";
import { getJupiterBaseUrl, getJupiterHeaders } from "./jupiter-client.js";
import { signAndSendVersionedTx } from "./tx.js";
import { solanaExplorerUrl } from "./validation.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import type { TransferResult } from "../types.js";
import { createHash } from "node:crypto";

const SEND_PROGRAM = "inv1tEtSwRMtM44tbvJGNiTxMvDfPVnX9StyqXfDfks";

function generateInviteCode(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let code = "";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

function deriveKeypairFromCode(code: string): Keypair {
  const hash = createHash("sha256").update(`invite:${code}`).digest();
  return Keypair.fromSeed(hash);
}

export interface PendingInvite {
  invitePDA: string;
  amount: string;
  mint: string;
  createdAt: string;
}

export async function craftSend(
  secretKey: Uint8Array,
  amount: number,
  mint?: string,
): Promise<{ inviteCode: string; signature: string; explorerUrl: string }> {
  const walletKeypair = Keypair.fromSecretKey(secretKey);
  const inviteCode = generateInviteCode();
  const inviteKeypair = deriveKeypairFromCode(inviteCode);

  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const resp = await fetchJson<{ transaction: string }>(
    `${base}/send/v1/craft-send`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        inviteSigner: inviteKeypair.publicKey.toBase58(),
        sender: walletKeypair.publicKey.toBase58(),
        amount,
        ...(mint ? { mint } : {}),
      }),
    },
  );

  // Sign with BOTH sender and invite keypair
  const signature = await signAndSendVersionedTx(resp.transaction, [walletKeypair, inviteKeypair]);

  return {
    inviteCode,
    signature,
    explorerUrl: solanaExplorerUrl(signature),
  };
}

export async function craftClawback(
  secretKey: Uint8Array,
  inviteCode: string,
): Promise<TransferResult> {
  const walletKeypair = Keypair.fromSecretKey(secretKey);
  const inviteKeypair = deriveKeypairFromCode(inviteCode);

  // Derive PDA: seeds ["invite", pubkey] with Send program
  const [invitePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("invite"), inviteKeypair.publicKey.toBuffer()],
    new PublicKey(SEND_PROGRAM),
  );

  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const resp = await fetchJson<{ transaction: string }>(
    `${base}/send/v1/craft-clawback`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        invitePDA: invitePDA.toBase58(),
        sender: walletKeypair.publicKey.toBase58(),
      }),
    },
  );

  const signature = await signAndSendVersionedTx(resp.transaction, [walletKeypair]);
  return { signature, explorerUrl: solanaExplorerUrl(signature) };
}

export async function getPendingInvites(address: string): Promise<PendingInvite[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();

  try {
    // Response is { invites: [...], hasMoreData: boolean }, NOT a raw array
    const result = await fetchJson<{ invites: PendingInvite[]; hasMoreData: boolean }>(
      `${base}/send/v1/pending-invites?address=${address}`,
      { headers },
    );
    return result.invites ?? [];
  } catch {
    return [];
  }
}
