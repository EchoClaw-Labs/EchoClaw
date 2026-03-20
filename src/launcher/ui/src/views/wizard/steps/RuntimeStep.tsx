import type { FC } from "react";
import { RUNTIME_OPTIONS } from "../../../utils/runtime-meta";
import type { StepProps, WizardPath, WizardProvider } from "../types";

interface Props extends StepProps {
  path: WizardPath;
  runtime: string;
  onSelectRuntime: (runtime: string) => void;
  onSelectAgent: () => void;
  onNext: (providers: WizardProvider[]) => void;
}

export const RuntimeStep: FC<Props> = ({ busy, onAction, path, runtime, onSelectRuntime, onSelectAgent, onNext }) => {
  const isAgent = path === "echoclaw-agent";

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left column — External Runtimes */}
        <div className="space-y-2">
          {RUNTIME_OPTIONS.map(opt => (
            <label key={opt.key} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition ${!isAgent && runtime === opt.key ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
              <input type="radio" name="runtime" checked={!isAgent && runtime === opt.key}
                onChange={() => onSelectRuntime(opt.key)}
                className="accent-neon-blue" />
              <div>
                <span className="text-sm text-white">{opt.label}</span>
                <p className="text-xs text-zinc-500">{opt.description}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Right column — EchoClaw Agent */}
        <button type="button" onClick={onSelectAgent}
          className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-5 cursor-pointer transition text-left
            ${isAgent
              ? "border-neon-blue bg-neon-blue/5 shadow-[0_0_20px_rgba(56,189,248,0.15)]"
              : "border-white/[0.06] hover:border-white/[0.12]"}`}>
          <img src="/echoclaw-logo.png" alt="EchoClaw Agent" className="w-16 h-16 rounded-xl object-contain" />
          <div className="text-center">
            <div className="text-sm font-semibold text-white">EchoClaw Agent</div>
            <span className="inline-block mt-1 rounded-full bg-neon-blue/20 px-2 py-0.5 text-[10px] font-medium text-neon-blue">
              Recommended
            </span>
            <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
              AI Trading Assistant powered by 0G Compute. Run locally in Docker.
            </p>
          </div>
        </button>
      </div>

      <button onClick={() => onAction(async () => {
        const res = await fetch("/api/fund/providers");
        const data = await res.json() as { providers?: WizardProvider[]; error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message ?? "Failed to load providers.");
        onNext(data.providers ?? []);
      })} className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition">
        Continue
      </button>
    </>
  );
};
