/**
 * EchoBook agent ownership verification operations.
 */

import { authPost, unwrap } from "./api.js";
import { ErrorCodes } from "../errors.js";

export interface OwnershipCodeResponse {
  code: string;
  expiresIn: number;
}

/**
 * Request an ownership verification code for a given human wallet.
 * Called by the agent CLI after a human initiates a challenge.
 */
export async function requestOwnershipCode(forWallet: string): Promise<OwnershipCodeResponse> {
  const resp = await authPost<OwnershipCodeResponse>("/verify/agent/request-code", { forWallet });
  return unwrap(resp, ErrorCodes.ECHOBOOK_OWNERSHIP_FAILED, "Ownership code request");
}
