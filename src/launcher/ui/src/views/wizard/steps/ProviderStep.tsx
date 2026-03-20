import type { FC } from "react";
import type { StepProps, WizardProvider } from "../types";

interface Props extends StepProps {
  providers: WizardProvider[];
  selectedProvider: string | null;
  onSelect: (provider: string) => void;
  onNext: () => void;
  onRetry: () => void;
}

export const ProviderStep: FC<Props> = ({ busy, onAction, providers, selectedProvider, onSelect, onNext, onRetry }) => (
  <>
    <div className="space-y-2 max-h-60 overflow-y-auto">
      {providers.map(p => (
        <label key={p.provider} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition ${selectedProvider === p.provider ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]"}`}>
          <input type="radio" name="provider" checked={selectedProvider === p.provider} onChange={() => onSelect(p.provider)} className="accent-neon-blue" />
          <div>
            <div className="text-sm font-medium text-white">{p.model}</div>
            <div className="text-xs text-zinc-500">{p.inputPricePerMTokens} / {p.outputPricePerMTokens} per 1M</div>
          </div>
        </label>
      ))}
      {providers.length === 0 && (
        <div className="py-4 text-center space-y-2">
          <p className="text-sm text-zinc-500">No providers found on the 0G network.</p>
          <p className="text-xs text-zinc-600">Ensure your wallet is funded and the network is reachable.</p>
          <button onClick={() => onAction(async () => { onRetry(); })}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition">
            Retry
          </button>
        </div>
      )}
    </div>
    <button disabled={!selectedProvider} onClick={onNext}
      className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
      Continue
    </button>
  </>
);
