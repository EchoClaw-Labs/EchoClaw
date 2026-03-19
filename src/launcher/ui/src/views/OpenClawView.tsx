import { type FC, useEffect, useState, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { ActionModal } from "../components/ActionModal";
import { WaveSpinner } from "../components/WaveSpinner";
import { cn } from "../utils";
import { postApi } from "../api";

interface StepStatus { configured: boolean; summary: string; warning?: string }
interface StepInfo { key: string; name: string; description: string; status: StepStatus }

interface Provider { provider: string; model: string; inputPricePerMTokens: string; outputPricePerMTokens: string }

// Per-step form field definitions
const STEP_FIELDS: Record<string, Array<{ key: string; label: string; type: "text" | "password" | "select"; options?: string[]; defaultValue?: string; required?: boolean }>> = {
  password: [
    { key: "password", label: "Password (min 8 chars)", type: "password", required: true },
    { key: "autoUpdate", label: "Enable auto-update checks", type: "select", options: ["true", "false"], defaultValue: "true" },
  ],
  webhooks: [
    { key: "baseUrl", label: "Gateway base URL", type: "text", defaultValue: "http://127.0.0.1:18789" },
    { key: "agentId", label: "Agent ID (optional)", type: "text" },
    { key: "channel", label: "Channel (optional)", type: "text" },
    { key: "to", label: "Recipient (optional)", type: "text" },
  ],
  wallet: [
    { key: "mode", label: "Mode", type: "select", options: ["create", "import"], defaultValue: "create" },
    { key: "chain", label: "Chain", type: "select", options: ["evm", "solana"], defaultValue: "evm" },
    { key: "privateKey", label: "Private key (for import)", type: "password" },
  ],
  // gateway fields are dynamically populated — see loadGatewayMethods()
  gateway: [],
};

// Steps with custom rendering
const CUSTOM_STEPS = new Set(["compute", "wallet", "gateway"]);
// Steps that need no user input — just a confirm button
const AUTO_STEPS = new Set(["config", "openclaw", "monitor"]);

interface Props { onNavigate: (p: string) => void }

export const OpenClawView: FC<Props> = ({ onNavigate }) => {
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [computeProvider, setComputeProvider] = useState<string | null>(null);
  const [computeDeposit, setComputeDeposit] = useState("1.0");
  const [computeFund, setComputeFund] = useState("1.0");
  const [gatewayMethods, setGatewayMethods] = useState<string[]>(["skip"]);
  const [gatewayInfo, setGatewayInfo] = useState<{ isContainer: boolean; composePath: string | null } | null>(null);

  // Overwrite confirmation flow
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<{ key: string; endpoint: string; body: Record<string, unknown> } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/openclaw/status");
      const data = await res.json() as { steps: StepInfo[] };
      setSteps(data.steps ?? []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const confirmOverwrite = async () => {
    if (!pendingAction) return;
    const { key, endpoint, body } = pendingAction;
    setPendingAction(null);
    setShowConfirm(false);
    setBusy(key);
    try {
      const r = await postApi<Record<string, unknown>>(endpoint, body);
      showToast(`${key}: ${(r.message as string) ?? (r.summary as string) ?? (r.action as string) ?? "done"}`);
      setExpandedStep(null);
      await refresh();
    } catch { showToast(`${key} failed`); }
    finally { setBusy(null); }
  };

  const getFormValue = (stepKey: string, fieldKey: string, defaultValue = ""): string => {
    return formData[stepKey]?.[fieldKey] ?? defaultValue;
  };

  const setFormValue = (stepKey: string, fieldKey: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [stepKey]: { ...(prev[stepKey] ?? {}), [fieldKey]: value },
    }));
  };

  const loadGatewayMethods = async () => {
    try {
      const res = await fetch("/api/openclaw/gateway-methods");
      const data = await res.json() as { availableMethods: string[]; isContainer: boolean; composePath: string | null };
      setGatewayMethods(data.availableMethods);
      setGatewayInfo({ isContainer: data.isContainer, composePath: data.composePath });
      // Pre-fill gateway form with defaults
      if (data.availableMethods.length > 0) {
        setFormValue("gateway", "method", data.availableMethods[0]);
      }
      if (data.composePath) {
        setFormValue("gateway", "composePath", data.composePath);
      }
    } catch { /* ignore */ }
  };

  const loadProviders = async () => {
    try {
      const res = await fetch("/api/fund/providers");
      const data = await res.json() as { providers: Provider[] };
      setProviders(data.providers ?? []);
    } catch { /* ignore */ }
  };

  const runStep = async (key: string) => {
    setBusy(key);
    try {
      let body: Record<string, unknown> = { ...(formData[key] ?? {}) };

      // Merge default values for fields that weren't touched
      const fields = STEP_FIELDS[key] ?? [];
      for (const field of fields) {
        if (!(field.key in body) && field.defaultValue) {
          body[field.key] = field.defaultValue;
        }
      }

      // Wallet: route to create or import endpoint based on mode
      if (key === "wallet") {
        const mode = body.mode as string ?? "create";
        const chain = body.chain as string ?? "evm";
        if (mode === "import") {
          const privateKey = body.privateKey as string;
          if (!privateKey) { showToast("Private key is required for import"); setBusy(null); return; }
          const r = await postApi<Record<string, unknown>>("/api/wallet/import", { chain, privateKey, force: false });
          if (r.status === "confirm_required") {
            setPendingAction({ key, endpoint: "/api/wallet/import", body: { chain, privateKey, force: true } });
            setConfirmMessage((r.message as string) ?? "A keystore already exists. Proceeding will overwrite it.");
            setShowConfirm(true);
            setBusy(null);
            return;
          }
          showToast((r.summary as string) ?? "Wallet imported");
          setExpandedStep(null); await refresh(); setBusy(null); return;
        }
        // create mode — use openclaw step endpoint
        body = { chain };
      }

      // Compute: use dedicated compute endpoint with provider + amounts
      if (key === "compute") {
        if (!computeProvider) { showToast("Select a provider first"); setBusy(null); return; }
        body = { provider: computeProvider, depositAmount: computeDeposit, fundAmount: computeFund };
      }

      const r = await postApi<Record<string, unknown>>(`/api/openclaw/step/${key}`, body);
      // Backend returns confirm_required when a keystore already exists
      if (r.status === "confirm_required") {
        setPendingAction({ key, endpoint: `/api/openclaw/step/${key}`, body: { ...body, force: true } });
        setConfirmMessage((r.message as string) ?? "A keystore already exists. Proceeding will overwrite it.");
        setShowConfirm(true);
        setBusy(null);
        return;
      }
      if (r.error) {
        showToast(`${key}: ${(r.error as { message?: string })?.message ?? "failed"}`);
      } else {
        showToast(`${key}: ${(r.message as string) ?? (r.action as string) ?? "done"}`);
      }
      setExpandedStep(null);
      await refresh();
    } catch { showToast(`${key} failed`); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;

  const doneCount = steps.filter(s => s.status.configured).length;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <PageHeader title="EchoClaw Setup" description={`${doneCount}/${steps.length} steps complete`} onBack={() => onNavigate("/")} />

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-white/[0.1] bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-lg">{toast}</div>}

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {steps.map(s => (
          <div key={s.key} className={`h-2 w-2 rounded-full transition-colors ${s.status.configured ? "bg-status-ok" : "bg-zinc-700"}`} />
        ))}
      </div>

      <div className="space-y-3">
        {steps.map((s, i) => {
          const isExpanded = expandedStep === s.key;
          const fields = STEP_FIELDS[s.key] ?? [];
          const isAuto = AUTO_STEPS.has(s.key);
          const isCustom = CUSTOM_STEPS.has(s.key);

          return (
            <div key={s.key} className="rounded-2xl border border-white/[0.06] bg-zinc-950/50 p-5 transition-all hover:border-white/[0.12]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-semibold ${s.status.configured ? "text-status-ok" : "text-zinc-400"}`}>
                      {s.status.configured ? "✓" : `${i + 1}.`}
                    </span>
                    <h3 className="text-sm font-semibold text-white">{s.name}</h3>
                  </div>
                  <p className="text-xs text-zinc-500 mb-1">{s.description}</p>
                  <p className={`text-xs ${s.status.configured ? "text-status-ok" : "text-zinc-400"}`}>{s.status.summary}</p>
                  {s.status.warning && <p className="text-xs text-status-warn mt-1">{s.status.warning}</p>}
                </div>

                {isAuto ? (
                  <button
                    disabled={busy === s.key}
                    onClick={() => runStep(s.key)}
                    className={cn(
                      "flex-shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-40",
                      s.status.configured
                        ? "bg-zinc-800/50 text-zinc-500 hover:text-zinc-300"
                        : "bg-neon-blue/15 text-neon-blue hover:bg-neon-blue/25",
                    )}
                  >
                    {busy === s.key ? "..." : s.status.configured ? "Reconfig" : "Setup"}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setExpandedStep(isExpanded ? null : s.key);
                      if (s.key === "compute" && !isExpanded) loadProviders();
                      if (s.key === "gateway" && !isExpanded) loadGatewayMethods();
                    }}
                    className={cn(
                      "flex-shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-medium transition",
                      isExpanded ? "bg-zinc-700 text-zinc-200" :
                      s.status.configured
                        ? "bg-zinc-800/50 text-zinc-500 hover:text-zinc-300"
                        : "bg-neon-blue/15 text-neon-blue hover:bg-neon-blue/25",
                    )}
                  >
                    {isExpanded ? "Close" : s.status.configured ? "Reconfig" : "Setup"}
                  </button>
                )}
              </div>

              {/* Compute step: inline provider picker + fund flow */}
              {isExpanded && s.key === "compute" && (
                <div className="mt-4 border-t border-white/[0.04] pt-4 space-y-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-2">Select Provider</label>
                    {providers.length === 0 ? (
                      <button onClick={loadProviders} className="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition">
                        Load Providers
                      </button>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {providers.map(p => (
                          <label key={p.provider} className={cn(
                            "flex items-center gap-2 rounded-lg border p-2 cursor-pointer text-sm transition",
                            computeProvider === p.provider ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]",
                          )}>
                            <input type="radio" name="computeProvider" checked={computeProvider === p.provider}
                              onChange={() => setComputeProvider(p.provider)} className="accent-neon-blue" />
                            <div>
                              <span className="text-white font-medium">{p.model}</span>
                              <span className="text-zinc-500 ml-2 text-xs">{p.inputPricePerMTokens}/{p.outputPricePerMTokens} per 1M</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Deposit (0G)</label>
                      <input type="text" value={computeDeposit} onChange={e => setComputeDeposit(e.target.value)}
                        className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Fund provider (0G)</label>
                      <input type="text" value={computeFund} onChange={e => setComputeFund(e.target.value)}
                        className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">Will: deposit → fund → ACK → create API key → patch OpenClaw config</p>
                  <button disabled={busy === s.key || !computeProvider}
                    onClick={() => runStep(s.key)}
                    className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
                    {busy === s.key ? "Setting up compute..." : "Setup Compute"}
                  </button>
                </div>
              )}

              {/* Gateway step: dynamic method options from environment detection */}
              {isExpanded && s.key === "gateway" && (
                <div className="mt-4 border-t border-white/[0.04] pt-4 space-y-3">
                  {gatewayInfo?.isContainer && (
                    <div className="rounded-lg bg-status-warn/10 border border-status-warn/30 px-3 py-2 text-xs text-status-warn">
                      Running inside container — restart from host after onboarding.
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-zinc-400 mb-2">Restart method</label>
                    <div className="space-y-1">
                      {gatewayMethods.map(m => (
                        <label key={m} className={cn(
                          "flex items-center gap-2 rounded-lg border p-2 cursor-pointer text-sm transition",
                          getFormValue("gateway", "method", gatewayMethods[0]) === m ? "border-neon-blue/50 bg-neon-blue/5" : "border-white/[0.06]",
                        )}>
                          <input type="radio" name="gatewayMethod" checked={getFormValue("gateway", "method", gatewayMethods[0]) === m}
                            onChange={() => setFormValue("gateway", "method", m)} className="accent-neon-blue" />
                          <span className="text-white">{m === "cli" ? "CLI (openclaw gateway restart)" : m === "docker" ? "Docker Compose" : "Skip (restart manually)"}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {getFormValue("gateway", "method") === "docker" && (
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Docker Compose path</label>
                      <input type="text" value={getFormValue("gateway", "composePath", gatewayInfo?.composePath ?? "")}
                        onChange={e => setFormValue("gateway", "composePath", e.target.value)}
                        className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
                    </div>
                  )}
                  <button disabled={busy === s.key} onClick={() => runStep(s.key)}
                    className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
                    {busy === s.key ? "Restarting..." : "Apply"}
                  </button>
                </div>
              )}

              {/* Inline form for interactive steps (password, webhooks) */}
              {isExpanded && !CUSTOM_STEPS.has(s.key) && s.key !== "gateway" && fields.length > 0 && (
                <div className="mt-4 border-t border-white/[0.04] pt-4 space-y-3">
                  {fields.map(field => (
                    <div key={field.key}>
                      <label className="block text-xs text-zinc-400 mb-1">{field.label}</label>
                      {field.type === "select" ? (
                        <select
                          value={getFormValue(s.key, field.key, field.defaultValue)}
                          onChange={e => setFormValue(s.key, field.key, e.target.value)}
                          className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none"
                        >
                          {field.options?.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type}
                          placeholder={field.defaultValue ?? ""}
                          value={getFormValue(s.key, field.key, "")}
                          onChange={e => setFormValue(s.key, field.key, e.target.value)}
                          className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none"
                        />
                      )}
                    </div>
                  ))}
                  <button
                    disabled={busy === s.key}
                    onClick={() => runStep(s.key)}
                    className="w-full rounded-lg bg-neon-blue/20 py-2 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40"
                  >
                    {busy === s.key ? "Processing..." : "Apply"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex gap-3">
        <button onClick={() => refresh()} className="rounded-lg bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition">
          Refresh Status
        </button>
      </div>

      {/* Overwrite confirmation modal */}
      <ActionModal open={showConfirm} onClose={() => { setShowConfirm(false); setPendingAction(null); }} title="Overwrite existing wallet?">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">{confirmMessage}</p>
          <div className="flex gap-3">
            <button onClick={() => { setShowConfirm(false); setPendingAction(null); }}
              className="flex-1 rounded-lg bg-zinc-800 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition">
              Cancel
            </button>
            <button disabled={busy !== null} onClick={confirmOverwrite}
              className="flex-1 rounded-lg bg-status-warn/20 py-2 text-sm font-medium text-status-warn hover:bg-status-warn/30 transition disabled:opacity-40">
              {busy !== null ? "Overwriting..." : "Overwrite"}
            </button>
          </div>
        </div>
      </ActionModal>
    </div>
  );
};
