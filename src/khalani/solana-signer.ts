import { Buffer } from "node:buffer";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { EchoError, ErrorCodes } from "../errors.js";

export function signSolanaTransaction(secretKey: Uint8Array, base64Tx: string): string {
  try {
    const txBytes = Buffer.from(base64Tx, "base64");
    const transaction = VersionedTransaction.deserialize(txBytes);
    const keypair = Keypair.fromSecretKey(secretKey);
    transaction.sign([keypair]);
    return Buffer.from(transaction.serialize()).toString("base64");
  } catch (err) {
    throw new EchoError(
      ErrorCodes.KHALANI_SOLANA_SIGN_FAILED,
      `Failed to sign Solana transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function signAndSendSolanaTransaction(
  rpcUrl: string,
  secretKey: Uint8Array,
  base64Tx: string,
): Promise<string> {
  try {
    const signedBase64 = signSolanaTransaction(secretKey, base64Tx);
    const connection = new Connection(rpcUrl, "confirmed");
    const signature = await connection.sendRawTransaction(Buffer.from(signedBase64, "base64"));
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
  } catch (err) {
    if (err instanceof EchoError) {
      throw err;
    }
    throw new EchoError(
      ErrorCodes.KHALANI_BROADCAST_FAILED,
      `Failed to broadcast Solana transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
