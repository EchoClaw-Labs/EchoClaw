import { getAddress, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EchoError, ErrorCodes } from "../../errors.js";
import { ERC20_ABI } from "../../constants/chain.js";
import { getKhalaniClient } from "../../khalani/client.js";
import { getChainRpcUrl } from "../../khalani/chains.js";
import { createDynamicPublicClient, createDynamicWalletClient } from "../../khalani/evm-client.js";
import { signAndSendSolanaTransaction } from "../../khalani/solana-signer.js";
import type {
  Approval,
  ContractCallDepositPlan,
  DepositPlan,
  EvmApproval,
  KhalaniChain,
  TransferDepositPlan,
} from "../../khalani/types.js";
import { requireEvmWallet, requireSolanaWallet } from "../../wallet/multi-auth.js";

interface Eip1193TransactionRequest {
  from?: string;
  to?: string;
  data?: string;
  value?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string;
}

export function parseBigintish(value: unknown, field: string): bigint | undefined {
  if (value == null) return undefined;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && value.length > 0) {
    try {
      return BigInt(value);
    } catch {
      throw new EchoError(ErrorCodes.KHALANI_DEPOSIT_FAILED, `Invalid bigint field in ${field}: ${value}`);
    }
  }
  throw new EchoError(ErrorCodes.KHALANI_DEPOSIT_FAILED, `Unsupported value for ${field}.`);
}

function parseNumberish(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.length > 0) {
    const parsed = value.startsWith("0x") ? Number.parseInt(value.slice(2), 16) : Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  throw new EchoError(ErrorCodes.KHALANI_DEPOSIT_FAILED, `Unsupported numeric value for ${field}.`);
}

function parseChainIdValue(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (value.startsWith("0x")) return Number.parseInt(value.slice(2), 16);
  return Number(value);
}

function assertEvmApproval(approval: Approval): asserts approval is EvmApproval {
  if (approval.type !== "eip1193_request") {
    throw new EchoError(
      ErrorCodes.KHALANI_DEPOSIT_FAILED,
      `Unexpected approval type ${approval.type}; expected eip1193_request.`,
    );
  }
}

function assertSolanaApproval(approval: Approval): asserts approval is Extract<Approval, { type: "solana_sendTransaction" }> {
  if (approval.type !== "solana_sendTransaction") {
    throw new EchoError(
      ErrorCodes.KHALANI_DEPOSIT_FAILED,
      `Unexpected approval type ${approval.type}; expected solana_sendTransaction.`,
    );
  }
}

function isNativeTransferToken(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  return normalized === "native"
    || normalized === "0x0000000000000000000000000000000000000000"
    || normalized === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
}

async function executeEvmApproval(
  approval: EvmApproval,
  chain: KhalaniChain,
  chains: KhalaniChain[],
  privateKey: Hex,
  expectedAddress: Address,
): Promise<Hash | null> {
  const walletClient = createDynamicWalletClient(chain, chains, privateKey);
  const publicClient = createDynamicPublicClient(chain, chains);

  if (approval.request.method === "wallet_switchEthereumChain") {
    const requestedChainId = parseChainIdValue(
      Array.isArray(approval.request.params)
        ? (approval.request.params[0] as { chainId?: unknown } | undefined)?.chainId
        : undefined,
    );
    if (requestedChainId != null && requestedChainId !== chain.id) {
      throw new EchoError(
        ErrorCodes.CHAIN_MISMATCH,
        `Khalani requested chain switch to ${requestedChainId}, but the selected route uses ${chain.id}.`,
      );
    }
    return null;
  }

  if (approval.request.method !== "eth_sendTransaction") {
    throw new EchoError(
      ErrorCodes.KHALANI_DEPOSIT_FAILED,
      `Unsupported EVM approval method: ${approval.request.method}`,
    );
  }

  const txRequest = Array.isArray(approval.request.params)
    ? approval.request.params[0] as Eip1193TransactionRequest | undefined
    : undefined;
  if (!txRequest?.to) {
    throw new EchoError(ErrorCodes.KHALANI_DEPOSIT_FAILED, "Khalani did not provide an EVM transaction target.");
  }

  if (txRequest.from && getAddress(txRequest.from) !== expectedAddress) {
    throw new EchoError(
      ErrorCodes.KHALANI_ADDRESS_MISMATCH,
      `Approval sender ${txRequest.from} does not match the configured EVM wallet.`,
    );
  }

  const gasPrice = parseBigintish(txRequest.gasPrice, "tx.gasPrice");
  const maxFeePerGas = parseBigintish(txRequest.maxFeePerGas, "tx.maxFeePerGas");
  const maxPriorityFeePerGas = parseBigintish(txRequest.maxPriorityFeePerGas, "tx.maxPriorityFeePerGas");

  const hash = await walletClient.sendTransaction({
    to: getAddress(txRequest.to),
    ...(txRequest.data ? { data: txRequest.data as Hex } : {}),
    ...(txRequest.value ? { value: parseBigintish(txRequest.value, "tx.value") } : {}),
    ...(txRequest.gas ? { gas: parseBigintish(txRequest.gas, "tx.gas") } : {}),
    ...(txRequest.nonce ? { nonce: parseNumberish(txRequest.nonce, "tx.nonce") } : {}),
    ...(gasPrice !== undefined
      ? { gasPrice }
      : {
          ...(maxFeePerGas !== undefined ? { maxFeePerGas } : {}),
          ...(maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas } : {}),
        }),
  });

  if (approval.waitForReceipt) {
    await publicClient.waitForTransactionReceipt({ hash });
  }

  return hash;
}

export async function executeEvmContractCallPlan(
  plan: ContractCallDepositPlan,
  chain: KhalaniChain,
  chains: KhalaniChain[],
  quoteId: string,
  routeId: string,
): Promise<{ orderId: string; txHash: string }> {
  const wallet = requireEvmWallet();
  let depositTxHash: Hash | null = null;
  let hasDepositAction = false;

  for (const approval of plan.approvals) {
    assertEvmApproval(approval);
    const hash = await executeEvmApproval(approval, chain, chains, wallet.privateKey, wallet.address);
    if (approval.deposit) {
      hasDepositAction = true;
    }
    if (approval.deposit && hash) {
      depositTxHash = hash;
    }
  }

  if (!hasDepositAction) {
    throw new EchoError(ErrorCodes.KHALANI_DEPOSIT_FAILED, "Khalani did not mark any EVM action with deposit=true.");
  }

  if (!depositTxHash) {
    throw new EchoError(ErrorCodes.KHALANI_DEPOSIT_FAILED, "Khalani did not yield a deposit transaction hash.");
  }

  const submitted = await getKhalaniClient().submitDeposit({ quoteId, routeId, txHash: depositTxHash });
  return { orderId: submitted.orderId, txHash: submitted.txHash };
}

export async function executeSolanaContractCallPlan(
  plan: ContractCallDepositPlan,
  chain: KhalaniChain,
  chains: KhalaniChain[],
  quoteId: string,
  routeId: string,
): Promise<{ orderId: string; txHash: string }> {
  const wallet = requireSolanaWallet();
  const rpcUrl = getChainRpcUrl(chain.id, chains);
  let depositTxHash: string | null = null;
  let hasDepositAction = false;

  for (const approval of plan.approvals) {
    assertSolanaApproval(approval);
    const hash = await signAndSendSolanaTransaction(rpcUrl, wallet.secretKey, approval.transaction);
    if (approval.deposit) {
      hasDepositAction = true;
      depositTxHash = hash;
    }
  }

  if (!hasDepositAction) {
    throw new EchoError(ErrorCodes.KHALANI_DEPOSIT_FAILED, "Khalani did not mark any Solana action with deposit=true.");
  }

  if (!depositTxHash) {
    throw new EchoError(ErrorCodes.KHALANI_DEPOSIT_FAILED, "Khalani did not yield a Solana deposit transaction hash.");
  }

  const submitted = await getKhalaniClient().submitDeposit({ quoteId, routeId, txHash: depositTxHash });
  return { orderId: submitted.orderId, txHash: submitted.txHash };
}

export async function executeTransferPlan(
  plan: TransferDepositPlan,
  chain: KhalaniChain,
  chains: KhalaniChain[],
  quoteId: string,
  routeId: string,
): Promise<{ orderId: string; txHash: string }> {
  if (chain.type !== "eip155") {
    throw new EchoError(
      ErrorCodes.KHALANI_DEPOSIT_FAILED,
      "Solana TRANSFER deposits are not implemented in v1.",
      "Retry with --deposit-method CONTRACT_CALL.",
    );
  }

  const wallet = requireEvmWallet();
  const account = privateKeyToAccount(wallet.privateKey);
  const walletClient = createDynamicWalletClient(chain, chains, wallet.privateKey);
  const publicClient = createDynamicPublicClient(chain, chains);

  const txHash = isNativeTransferToken(plan.token)
    ? await walletClient.sendTransaction({
        account,
        to: getAddress(plan.depositAddress),
        value: BigInt(plan.amount),
      })
    : await walletClient.writeContract({
        account,
        address: getAddress(plan.token),
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [getAddress(plan.depositAddress), BigInt(plan.amount)],
      });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  const submitted = await getKhalaniClient().submitDeposit({ quoteId, routeId, txHash });
  return { orderId: submitted.orderId, txHash: submitted.txHash };
}

export async function executeDepositPlan(
  plan: DepositPlan,
  sourceChain: KhalaniChain,
  chains: KhalaniChain[],
  quoteId: string,
  routeId: string,
): Promise<{ orderId: string; txHash: string }> {
  if (plan.kind === "PERMIT2") {
    throw new EchoError(
      ErrorCodes.KHALANI_PERMIT2_BLOCKED,
      "PERMIT2 live execution is intentionally blocked in v1.",
      "Use --dry-run to inspect the permit payload or retry with --deposit-method CONTRACT_CALL.",
    );
  }

  if (plan.kind === "TRANSFER") {
    return executeTransferPlan(plan, sourceChain, chains, quoteId, routeId);
  }

  return sourceChain.type === "solana"
    ? executeSolanaContractCallPlan(plan, sourceChain, chains, quoteId, routeId)
    : executeEvmContractCallPlan(plan, sourceChain, chains, quoteId, routeId);
}
