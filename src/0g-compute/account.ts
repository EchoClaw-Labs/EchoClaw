/**
 * Helpers for normalizing 0G SDK account structs.
 *
 * The SDK's `AccountStructOutput` exposes both indexed (tuple) and named
 * properties.  We normalise to a simple object with OG-denominated values
 * so the rest of the codebase doesn't have to know about either format.
 */

import { formatUnits } from "ethers";

// ── Types ────────────────────────────────────────────────────────────

export interface NormalizedLedger {
  availableOg: number;
  totalOg: number;
  reservedOg: number;  // total - available (locked in sub-accounts)
}

export interface NormalizedSubAccount {
  totalOg: number;
  pendingRefundOg: number;
  lockedOg: number;
  rawBalance: string;       // bigint as string (neuron)
  rawPendingRefund: string; // bigint as string (neuron)
}

// ── normalizeSubAccount ──────────────────────────────────────────────

/**
 * Normalise an SDK `AccountStructOutput` (or similar tuple/object) into
 * a simple `NormalizedSubAccount`.
 *
 * Supports:
 * - Named properties: `account.balance`, `account.pendingRefund`
 * - Indexed tuple:    `account[3]` (balance), `account[4]` (pendingRefund)
 */
export function normalizeSubAccount(account: unknown): NormalizedSubAccount {
  let balance: bigint;
  let pendingRefund: bigint;

  const acc = account as Record<string, unknown>;

  // Named properties first (preferred)
  if (typeof acc.balance === "bigint") {
    balance = acc.balance;
  } else if (typeof acc[3] === "bigint") {
    balance = acc[3];
  } else {
    balance = 0n;
  }

  if (typeof acc.pendingRefund === "bigint") {
    pendingRefund = acc.pendingRefund;
  } else if (typeof acc[4] === "bigint") {
    pendingRefund = acc[4];
  } else {
    pendingRefund = 0n;
  }

  const totalOg = parseFloat(formatUnits(balance, 18));
  const pendingRefundOg = parseFloat(formatUnits(pendingRefund, 18));
  const lockedOg = totalOg - pendingRefundOg;

  return {
    totalOg,
    pendingRefundOg,
    lockedOg,
    rawBalance: balance.toString(),
    rawPendingRefund: pendingRefund.toString(),
  };
}

// ── normalizeLedger ─────────────────────────────────────────────────

/**
 * Normalise an SDK `LedgerStructOutput` into a simple `NormalizedLedger`.
 *
 * Supports:
 * - Named properties: `ledger.availableBalance`, `ledger.totalBalance`
 * - Indexed tuple:    `ledger[1]` (availableBalance), `ledger[2]` (totalBalance)
 */
export function normalizeLedger(ledger: unknown): NormalizedLedger {
  let available: bigint;
  let total: bigint;

  const l = ledger as Record<string, unknown>;

  if (typeof l.availableBalance === "bigint") {
    available = l.availableBalance;
  } else if (typeof l[1] === "bigint") {
    available = l[1];
  } else {
    available = 0n;
  }

  if (typeof l.totalBalance === "bigint") {
    total = l.totalBalance;
  } else if (typeof l[2] === "bigint") {
    total = l[2];
  } else {
    total = 0n;
  }

  const availableOg = parseFloat(formatUnits(available, 18));
  const totalOg = parseFloat(formatUnits(total, 18));
  const reservedOg = totalOg - availableOg;

  return { availableOg, totalOg, reservedOg };
}

// ── normalizeLedgerDetail ────────────────────────────────────────────

/**
 * Normalise the `ledgerInfo` array from `getLedgerWithDetail()`.
 *
 * SDK layout: `[totalBalance, reserved, availableBalance]` (indices 0, 1, 2).
 * This is DIFFERENT from `LedgerStructOutput` used by `getLedger()`.
 */
export function normalizeLedgerDetail(info: unknown): NormalizedLedger {
  const arr = info as bigint[];

  const total = typeof arr?.[0] === "bigint" ? arr[0] : 0n;
  // arr[1] = reserved (total - available), but we derive it to avoid drift
  const available = typeof arr?.[2] === "bigint" ? arr[2] : 0n;

  const availableOg = parseFloat(formatUnits(available, 18));
  const totalOg = parseFloat(formatUnits(total, 18));
  const reservedOg = totalOg - availableOg;

  return { availableOg, totalOg, reservedOg };
}

// ── normalizeInferTuple ──────────────────────────────────────────────

/**
 * Normalise a tuple from `getLedgerWithDetail().infers`.
 * Each entry is `[providerAddress, balance, pendingRefund]`.
 */
export function normalizeInferTuple(
  tuple: [string, bigint, bigint],
): { provider: string } & NormalizedSubAccount {
  const [provider, balance, pendingRefund] = tuple;

  const totalOg = parseFloat(formatUnits(balance, 18));
  const pendingRefundOg = parseFloat(formatUnits(pendingRefund, 18));
  const lockedOg = totalOg - pendingRefundOg;

  return {
    provider,
    totalOg,
    pendingRefundOg,
    lockedOg,
    rawBalance: balance.toString(),
    rawPendingRefund: pendingRefund.toString(),
  };
}

// ── serializeSubAccount ──────────────────────────────────────────────

/**
 * Convert a `NormalizedSubAccount` to a plain object safe for JSON
 * serialization (bigint strings already handled by normalise helpers).
 */
export function serializeSubAccount(
  sa: NormalizedSubAccount,
): Record<string, unknown> {
  return {
    totalOg: sa.totalOg,
    pendingRefundOg: sa.pendingRefundOg,
    lockedOg: sa.lockedOg,
    rawBalance: sa.rawBalance,
    rawPendingRefund: sa.rawPendingRefund,
  };
}
