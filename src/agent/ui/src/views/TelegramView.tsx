/**
 * Telegram integration view — onboarding wizard + management panel.
 *
 * State A (not configured): step-by-step instructions + config form.
 * State B (configured): status, controls, test message.
 */

import { type FC, useState, useEffect, useCallback } from "react";
import {
  getTelegramStatus, configureTelegram, enableTelegram,
  disableTelegram, testTelegram, disconnectTelegram,
} from "../api";
import type { TelegramStatus } from "../types";
import { cn } from "../utils";

interface TelegramViewProps {
  onBack: () => void;
}

export const TelegramView: FC<TelegramViewProps> = () => {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Config form state
  const [botToken, setBotToken] = useState("");
  const [chatIdInput, setChatIdInput] = useState("");
  const [chatIds, setChatIds] = useState<number[]>([]);
  const [loopMode, setLoopMode] = useState("restricted");
  const [showToken, setShowToken] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const s = await getTelegramStatus();
      setStatus(s);
      if (s.authorizedChatIds.length > 0) setChatIds(s.authorizedChatIds);
      if (s.loopMode) setLoopMode(s.loopMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const isConfigured = status?.configured ?? false;

  const handleConnect = async () => {
    if (!botToken.trim() || chatIds.length === 0) {
      setError("Bot token and at least one Chat ID are required");
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      await configureTelegram({ botToken: botToken.trim(), chatIds, loopMode });
      setBotToken("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddChatId = () => {
    const id = parseInt(chatIdInput.trim(), 10);
    if (isNaN(id)) { setError("Chat ID must be a number"); return; }
    if (chatIds.includes(id)) { setError("Chat ID already added"); return; }
    setChatIds(prev => [...prev, id]);
    setChatIdInput("");
    setError(null);
  };

  const handleRemoveChatId = (id: number) => {
    setChatIds(prev => prev.filter(c => c !== id));
  };

  const handleToggle = async () => {
    setActionLoading(true);
    setError(null);
    try {
      if (status?.enabled) {
        await disableTelegram();
      } else {
        await enableTelegram();
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleTest = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await testTelegram();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await disconnectTelegram();
      setBotToken("");
      setChatIds([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto text-sm">
      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {status?.decryptionFailed && (
        <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
          Saved token could not be decrypted (encryption key may have changed after restart). Please reconfigure.
        </div>
      )}

      {isConfigured ? (
        /* ── State B: Configured (management) ── */
        <>
          {/* Status */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
            <div className={cn(
              "h-2.5 w-2.5 rounded-full shrink-0",
              status?.connected
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                : status?.enabled
                  ? "bg-amber-400"
                  : "bg-red-400",
            )} />
            <div className="min-w-0">
              <div className="text-foreground font-medium truncate">
                {status?.connected
                  ? `Connected as @${status.botUsername}`
                  : status?.enabled
                    ? "Connecting..."
                    : "Disabled"}
              </div>
              <div className="text-muted-foreground text-xs mt-0.5">
                Mode: {status?.loopMode} &middot; {status?.authorizedChatIds.length} authorized chat{status?.authorizedChatIds.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>

          {/* Chat IDs */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Authorized Chat IDs</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {status?.authorizedChatIds.map(id => (
                <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 text-xs font-mono">
                  {id}
                </span>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleToggle}
              disabled={actionLoading}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                status?.enabled
                  ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                  : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30",
              )}
            >
              {status?.enabled ? "Disable" : "Enable"}
            </button>
            <button
              onClick={handleTest}
              disabled={actionLoading || !status?.connected}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-40"
            >
              Send Test
            </button>
            <button
              onClick={handleDisconnect}
              disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        /* ── State A: Not configured (onboarding) ── */
        <>
          <div className="text-foreground font-medium text-base">Connect Telegram</div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Chat with your EchoClaw agent directly from Telegram. Follow these steps to set up the connection.
          </p>

          {/* Step-by-step instructions */}
          <div className="space-y-3">
            <Step number={1} title="Create a Telegram Bot">
              Open Telegram, search for <Mono>@BotFather</Mono>, and send <Mono>/newbot</Mono>.
              Follow the prompts to choose a name and username (must end in <Mono>bot</Mono>).
            </Step>
            <Step number={2} title="Copy the Bot Token">
              BotFather will reply with your API token. It looks like: <Mono>123456:ABC-DEF...</Mono>
            </Step>
            <Step number={3} title="Get your Chat ID">
              Send any message to <Mono>@userinfobot</Mono> or <Mono>@RawDataBot</Mono> in Telegram.
              They will reply with your numeric Chat ID.
            </Step>
            <Step number={4} title="Paste below and connect">
              Enter your bot token and Chat ID, then click Connect.
            </Step>
          </div>

          {/* Config form */}
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Bot Token</label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={botToken}
                  onChange={e => setBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v..."
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-foreground text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:border-accent/50 pr-12"
                />
                <button
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs px-1"
                >
                  {showToken ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Chat ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatIdInput}
                  onChange={e => setChatIdInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleAddChatId(); }}
                  placeholder="e.g. 123456789"
                  className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-foreground text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:border-accent/50"
                />
                <button
                  onClick={handleAddChatId}
                  className="px-3 py-2 rounded-lg bg-white/10 text-foreground text-xs font-medium hover:bg-white/15 transition-colors"
                >
                  Add
                </button>
              </div>
              {chatIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {chatIds.map(id => (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 text-xs font-mono">
                      {id}
                      <button onClick={() => handleRemoveChatId(id)} className="text-muted-foreground hover:text-red-400 ml-0.5">&times;</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Approval Mode</label>
              <select
                value={loopMode}
                onChange={e => setLoopMode(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-foreground text-xs focus:outline-none focus:border-accent/50"
              >
                <option value="restricted">Restricted (approve mutations)</option>
                <option value="full">Full (auto-approve all)</option>
                <option value="off">Off (read-only)</option>
              </select>
            </div>

            <button
              onClick={handleConnect}
              disabled={actionLoading || !botToken.trim() || chatIds.length === 0}
              className="w-full py-2.5 rounded-lg bg-accent/80 text-white text-sm font-medium hover:bg-accent transition-colors disabled:opacity-40"
            >
              {actionLoading ? "Connecting..." : "Connect"}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// ── Helper components ────────────────────────────────────────────────

const Step: FC<{ number: number; title: string; children: React.ReactNode }> = ({ number, title, children }) => (
  <div className="flex gap-3">
    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold shrink-0 mt-0.5">
      {number}
    </div>
    <div className="min-w-0">
      <div className="text-foreground font-medium text-xs">{title}</div>
      <div className="text-muted-foreground text-xs mt-0.5 leading-relaxed">{children}</div>
    </div>
  </div>
);

const Mono: FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="px-1 py-0.5 rounded bg-white/10 text-foreground/80 text-[11px] font-mono">{children}</code>
);
