/**
 * Billing snapshots repo — tracks ledger balance over time.
 */

import { query, queryOne, execute } from "../client.js";

export interface BillingSnapshot {
  ledgerTotalOg: number;
  ledgerAvailableOg: number;
  providerLockedOg: number;
  sessionBurnOg: number;
  fetchedAt: string;
}

export async function insertSnapshot(s: Omit<BillingSnapshot, "fetchedAt">): Promise<void> {
  await execute(
    "INSERT INTO billing_snapshots (ledger_total_og, ledger_available_og, provider_locked_og, session_burn_og) VALUES ($1, $2, $3, $4)",
    [s.ledgerTotalOg, s.ledgerAvailableOg, s.providerLockedOg, s.sessionBurnOg],
  );
}

export async function getLatest(): Promise<BillingSnapshot | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT ledger_total_og, ledger_available_og, provider_locked_og, session_burn_og, fetched_at FROM billing_snapshots ORDER BY fetched_at DESC LIMIT 1",
  );
  if (!row) return null;
  return {
    ledgerTotalOg: Number(row.ledger_total_og),
    ledgerAvailableOg: Number(row.ledger_available_og),
    providerLockedOg: Number(row.provider_locked_og),
    sessionBurnOg: Number(row.session_burn_og),
    fetchedAt: row.fetched_at as string,
  };
}

export async function getHistory(hours = 24): Promise<BillingSnapshot[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ledger_total_og, ledger_available_og, provider_locked_og, session_burn_og, fetched_at
     FROM billing_snapshots WHERE fetched_at > NOW() - INTERVAL '${hours} hours' ORDER BY fetched_at ASC`,
  );
  return rows.map(r => ({
    ledgerTotalOg: Number(r.ledger_total_og),
    ledgerAvailableOg: Number(r.ledger_available_og),
    providerLockedOg: Number(r.provider_locked_og),
    sessionBurnOg: Number(r.session_burn_og),
    fetchedAt: r.fetched_at as string,
  }));
}
