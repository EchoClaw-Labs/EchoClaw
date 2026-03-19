import type { Address, Hex } from "viem";
import { maxUint256, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC20_EXTENDED_ABI } from "./abi/erc20.js";
import { getPublicClient } from "../wallet/client.js";
import { getSigningClient } from "../wallet/signingClient.js";
import { loadConfig } from "../config/store.js";
import { EchoError, ErrorCodes } from "../errors.js";
import logger from "../utils/logger.js";

/**
 * Allowed spenders - only these addresses can be approved
 */
export function getAllowedSpenders(): Record<string, Address> {
  const cfg = loadConfig();
  return {
    router: cfg.protocol.jaineRouter,
    nft: cfg.protocol.nftPositionManager,
  };
}

export type SpenderType = "router" | "nft";

/**
 * Validate that spender is in the allowlist
 */
export function validateSpender(spender: Address): void {
  const allowed = getAllowedSpenders();
  const isAllowed = Object.values(allowed).some(
    (addr) => getAddress(addr) === getAddress(spender)
  );

  if (!isAllowed) {
    throw new EchoError(
      ErrorCodes.INVALID_SPENDER,
      `Spender ${spender} is not in allowlist`,
      `Allowed spenders: router (${allowed.router}), nft (${allowed.nft})`
    );
  }
}

/**
 * Get spender address by type
 */
export function getSpenderAddress(spenderType: SpenderType): Address {
  const allowed = getAllowedSpenders();
  return allowed[spenderType];
}

/**
 * Get current allowance for a token
 */
export async function getAllowance(
  token: Address,
  owner: Address,
  spender: Address
): Promise<bigint> {
  const client = getPublicClient();

  const allowance = await client.readContract({
    address: token,
    abi: ERC20_EXTENDED_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });

  return allowance;
}

/**
 * Get allowances for both spenders
 */
export async function getAllAllowances(
  token: Address,
  owner: Address
): Promise<Record<SpenderType, bigint>> {
  const allowed = getAllowedSpenders();
  const client = getPublicClient();

  const [routerAllowance, nftAllowance] = await Promise.all([
    client.readContract({
      address: token,
      abi: ERC20_EXTENDED_ABI,
      functionName: "allowance",
      args: [owner, allowed.router],
    }),
    client.readContract({
      address: token,
      abi: ERC20_EXTENDED_ABI,
      functionName: "allowance",
      args: [owner, allowed.nft],
    }),
  ]);

  return {
    router: routerAllowance,
    nft: nftAllowance,
  };
}

export interface ApproveResult {
  txHash: Hex;
  resetTxHash?: Hex; // If USDT-style reset was needed
}

/**
 * Safe approve with USDT-style reset handling
 *
 * Some tokens (like USDT) require setting allowance to 0 before
 * setting a new non-zero allowance if current allowance is non-zero.
 *
 * @param token - Token address
 * @param spender - Spender address (must be in allowlist)
 * @param amount - Amount to approve (use maxUint256 for unlimited)
 * @param privateKey - Private key for signing
 * @returns Transaction hash(es)
 */
export async function safeApprove(
  token: Address,
  spender: Address,
  amount: bigint,
  privateKey: Hex
): Promise<ApproveResult> {
  // Validate spender is in allowlist
  validateSpender(spender);

  const client = getPublicClient();
  const account = privateKeyToAccount(privateKey);
  const walletClient = getSigningClient(privateKey);

  // Check current allowance
  const currentAllowance = await getAllowance(token, account.address, spender);

  // If current allowance is sufficient, no action needed
  if (currentAllowance >= amount) {
    logger.debug(`Allowance already sufficient: ${currentAllowance} >= ${amount}`);
    return { txHash: "0x0" as Hex }; // No-op
  }

  let resetTxHash: Hex | undefined;

  // If current allowance > 0 and < amount, reset to 0 first (USDT-style)
  if (currentAllowance > 0n && currentAllowance < amount) {
    logger.debug("Resetting allowance to 0 (USDT-style)");

    try {
      resetTxHash = await walletClient.writeContract({
        address: token,
        abi: ERC20_EXTENDED_ABI,
        functionName: "approve",
        args: [spender, 0n],
      });

      // Wait for reset tx to confirm
      await client.waitForTransactionReceipt({ hash: resetTxHash });
    } catch (err) {
      throw new EchoError(
        ErrorCodes.APPROVAL_FAILED,
        `Failed to reset allowance: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  // Approve the target amount
  try {
    const txHash = await walletClient.writeContract({
      address: token,
      abi: ERC20_EXTENDED_ABI,
      functionName: "approve",
      args: [spender, amount],
    });

    // Wait for approve tx to confirm before returning
    await client.waitForTransactionReceipt({ hash: txHash });

    return { txHash, resetTxHash };
  } catch (err) {
    throw new EchoError(
      ErrorCodes.APPROVAL_FAILED,
      `Failed to approve: ${err instanceof Error ? err.message : err}`
    );
  }
}

/**
 * Revoke approval (set to 0)
 */
export async function revokeApproval(
  token: Address,
  spender: Address,
  privateKey: Hex
): Promise<Hex> {
  // Validate spender is in allowlist
  validateSpender(spender);

  const walletClient = getSigningClient(privateKey);

  try {
    const txHash = await walletClient.writeContract({
      address: token,
      abi: ERC20_EXTENDED_ABI,
      functionName: "approve",
      args: [spender, 0n],
    });

    return txHash;
  } catch (err) {
    throw new EchoError(
      ErrorCodes.APPROVAL_FAILED,
      `Failed to revoke approval: ${err instanceof Error ? err.message : err}`
    );
  }
}

/**
 * Ensure allowance is sufficient, approve if needed
 */
export async function ensureAllowance(
  token: Address,
  spender: Address,
  requiredAmount: bigint,
  privateKey: Hex,
  approveExact: boolean = false
): Promise<ApproveResult | null> {
  const account = privateKeyToAccount(privateKey);
  const currentAllowance = await getAllowance(token, account.address, spender);

  if (currentAllowance >= requiredAmount) {
    return null; // No approval needed
  }

  const approveAmount = approveExact ? requiredAmount : maxUint256;
  return safeApprove(token, spender, approveAmount, privateKey);
}
