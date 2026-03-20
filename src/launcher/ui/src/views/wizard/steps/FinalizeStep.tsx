import type { FC } from "react";
import { WaveSpinner } from "../../../components/WaveSpinner";
import { postApi, startAgent as launchAgent, startDaemon } from "../../../api";
import type { StepProps, WizardPath } from "../types";

interface Props extends StepProps {
  path: WizardPath;
  runtime: string;
  selectedProvider: string | null;
  onDone: () => void;
  onDoneWithWarning: (msg: string) => void;
}

export const FinalizeStep: FC<Props> = ({ busy, onAction, path, runtime, selectedProvider, onDone, onDoneWithWarning }) => {
  const isAgent = path === "echoclaw-agent";

  const handleFinalize = async () => {
    if (selectedProvider) {
      await postApi("/api/fund/ack", { provider: selectedProvider });

      const isClaude = !isAgent && runtime === "claude-code";
      await postApi("/api/fund/api-key", {
        provider: selectedProvider,
        tokenId: 0,
        saveClaudeToken: isClaude,
        patchOpenclaw: !isAgent && runtime === "openclaw",
      });
    }

    if (isAgent) {
      // EchoClaw Agent: start Docker agent + balance monitor. No skill linking.
      try {
        await launchAgent();
      } catch (e) {
        onDoneWithWarning(
          `Setup complete but agent failed to start: ${e instanceof Error ? e.message : "Check Docker"}. You can start it later from the dashboard.`,
        );
        return;
      }
      try { await startDaemon("monitor"); } catch { /* non-fatal */ }
    } else {
      // External runtime: link EchoClaw skill.
      await postApi("/api/connect/apply", {
        runtime,
        allowWalletMutation: false,
        ...(runtime === "claude-code" ? { claudeScope: "project-local", startProxy: true } : {}),
      });
    }

    onDone();
  };

  return (
    <>
      <div className="text-center py-4">
        {busy ? <WaveSpinner size="md" /> : <p className="text-sm text-zinc-400">Finalizing setup...</p>}
      </div>
      <button disabled={busy}
        onClick={() => onAction(handleFinalize)}
        className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
        {busy ? "Finalizing..." : "Complete Setup"}
      </button>
    </>
  );
};
