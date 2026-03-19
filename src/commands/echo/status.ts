import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderName } from "../../providers/types.js";
import { CONFIG_DIR } from "../../config/paths.js";
import { colors, infoBox, printTable, successBox, warnBox } from "../../utils/ui.js";
import { buildDoctorChecks, buildEchoSnapshot, buildSupportReport, type EchoSnapshot } from "./state.js";
import { autoDetectProvider } from "../../providers/registry.js";
import { buildVerifyPayload } from "./assessment.js";
import { PROVIDER_LABELS } from "./catalog.js";
import { writeEchoWorkflow } from "./protocol.js";

export function printHomeSummary(snapshot: EchoSnapshot): void {
  const passwordLine =
    snapshot.wallet.password.status === "ready"
      ? colors.success(`Ready (${snapshot.wallet.password.source})`)
      : snapshot.wallet.password.status === "drift"
        ? colors.warn(`Drift (${snapshot.wallet.password.driftSources.join(", ")})`)
        : snapshot.wallet.password.status === "invalid"
          ? colors.error("Invalid for current keystore")
          : colors.warn("Missing");

  const runtimeLines = Object.entries(snapshot.runtimes.detected)
    .filter(([, value]) => value.detected)
    .map(([key]) => PROVIDER_LABELS[key as ProviderName]);

  // Solana readiness
  const solanaCluster = snapshot.solanaCluster;
  const jupiterKey = snapshot.jupiterApiKeySet;

  infoBox("Echo Launcher", [
    `Recommended runtime: ${colors.info(PROVIDER_LABELS[snapshot.runtimes.recommended])}`,
    `Detected runtimes:   ${runtimeLines.length > 0 ? runtimeLines.join(", ") : colors.muted("none")}`,
    `Wallet (EVM):        ${snapshot.wallet.evmAddress ?? colors.muted("not configured")}`,
    `Wallet (Solana):     ${snapshot.wallet.solanaAddress ?? colors.muted("not configured")}`,
    `Password:            ${passwordLine}`,
    `Solana:              ${solanaCluster ? `${colors.info(solanaCluster)}${jupiterKey ? ` + Jupiter key` : ""}` : colors.muted("default")}`,
    `Claude proxy:        ${snapshot.claude.running ? colors.success(`running on ${snapshot.claude.port}`) : colors.muted("not running")}`,
    `Monitor:             ${snapshot.monitor.running ? colors.success(`running (PID ${snapshot.monitor.pid})`) : colors.muted("not running")}`,
  ].join("\n"));
}

export async function printStatus(json: boolean, fresh = false): Promise<void> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh });
  if (json) {
    writeEchoWorkflow({
      phase: "status",
      status: "ready",
      summary: "Current Echo launcher status snapshot.",
      snapshot,
    });
    return;
  }

  infoBox("Status", JSON.stringify(snapshot, null, 2));
}

export async function printDoctor(json: boolean, fresh = false): Promise<void> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh });
  const checks = await buildDoctorChecks(snapshot);
  if (json) {
    writeEchoWorkflow({
      phase: "doctor",
      status: "ready",
      summary: "Diagnostics completed.",
      checks,
      snapshot,
    });
    return;
  }

  const rows = checks.map((check) => [
    check.ok ? colors.success("OK") : colors.warn("WARN"),
    check.title,
    check.detail,
  ]);

  printTable([
    { header: "Status", width: 10 },
    { header: "Check", width: 24 },
    { header: "Detail", width: 70 },
  ], rows);
}

export async function writeSupportReportToFile(json = false): Promise<void> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true });
  const report = buildSupportReport(snapshot);

  if (json) {
    writeEchoWorkflow({
      phase: "support-report",
      status: "ready",
      summary: "Generated a redacted support report.",
      report,
    });
    return;
  }

  const reportDir = join(CONFIG_DIR, "reports");
  mkdirSync(reportDir, { recursive: true });
  const path = join(reportDir, `support-report-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf-8");
  successBox("Support Report Saved", `Saved to ${path}`);
}

export async function printVerify(json: boolean, runtime = autoDetectProvider().name, fresh = true): Promise<void> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh });
  const payload = buildVerifyPayload(snapshot, runtime);

  if (json) {
    writeEchoWorkflow(payload);
    return;
  }

  const body = [
    payload.summary,
    payload.nextAction ? `Next action: ${payload.nextAction}` : "",
    ...(payload.manualSteps ?? []),
    ...(payload.warnings ?? []),
  ].filter(Boolean).join("\n");

  if (payload.status === "ready") {
    successBox("Verify", body);
  } else if (payload.status === "manual_required") {
    warnBox("Verify", body);
  } else {
    infoBox("Verify", body);
  }
}
