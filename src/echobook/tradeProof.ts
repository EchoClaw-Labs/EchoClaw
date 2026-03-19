/**
 * EchoBook trade proof operations.
 */

import { apiGet, authPost, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface TradeProofData {
  id: number;
  tx_hash: string;
  chain_id: number;
  token_symbol: string | null;
  action: "buy" | "sell" | null;
  amount_usd: number | null;
  status: "pending" | "verified" | "failed" | "reverted";
  points_awarded: number;
  verified_at_ms: number | null;
  created_at_ms: number;
}

export async function submitTradeProof(data: {
  txHash: string;
  chainId?: number;
}): Promise<TradeProofData> {
  const resp = await authPost<TradeProofData>("/trade-proofs", data);
  return unwrap(resp, ErrorCodes.ECHOBOOK_TRADE_PROOF_FAILED, "Trade proof submission");
}

export async function getTradeProof(txHash: string): Promise<TradeProofData> {
  const resp = await apiGet<TradeProofData>(`/trade-proofs/${txHash}`);
  return unwrap(resp, ErrorCodes.ECHOBOOK_NOT_FOUND, "Trade proof fetch");
}
