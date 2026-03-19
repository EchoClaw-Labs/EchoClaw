/**
 * Status and usage handlers (Postgres-backed, reads real loop state).
 */

import { registerRoute, jsonResponse } from "../routes.js";
import * as soulRepo from "../db/repos/soul.js";
import * as memoryRepo from "../db/repos/memory.js";
import * as knowledgeRepo from "../db/repos/knowledge.js";
import * as usageRepo from "../db/repos/usage.js";
import * as approvalsRepo from "../db/repos/approvals.js";
import * as sessionsRepo from "../db/repos/sessions.js";
import * as loopRepo from "../db/repos/loop.js";
import * as backupRepo from "../db/repos/backup.js";
import { loadComputeState } from "../../0g-compute/readiness.js";
import type { AgentStatus } from "../types.js";

export function registerStatusRoutes(): void {
  registerRoute("GET", "/api/agent/status", async (_req, res) => {
    const computeState = loadComputeState();
    const [usage, pendingApprovals, sessions, loop, lastBackup] = await Promise.all([
      usageRepo.getUsageStats(),
      approvalsRepo.getPendingCount(),
      sessionsRepo.listSessions(1),
      loopRepo.getLoopState(),
      backupRepo.getLastBackup(),
    ]);
    const latestSession = sessions[0];

    const status: AgentStatus = {
      running: true,
      model: computeState?.model ?? null,
      provider: computeState?.activeProvider ?? null,
      hasSoul: await soulRepo.hasSoul(),
      memorySize: await memoryRepo.getMemorySize(),
      knowledgeFileCount: await knowledgeRepo.fileCount(),
      sessionId: latestSession?.id ?? null,
      sessionMessageCount: latestSession?.message_count ?? 0,
      usage: { ...usage, lastBackupAt: lastBackup?.createdAt ?? null },
      loop,
      pendingApprovals,
    };

    jsonResponse(res, 200, status);
  });

  registerRoute("GET", "/api/agent/usage", async (_req, res) => {
    const usage = await usageRepo.getUsageStats();
    jsonResponse(res, 200, usage);
  });
}
