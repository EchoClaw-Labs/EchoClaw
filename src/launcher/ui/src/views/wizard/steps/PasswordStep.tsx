import { type FC, useState } from "react";
import { postApi } from "../../../api";
import type { StepProps } from "../types";

interface Props extends StepProps {
  onNext: () => void;
}

export const PasswordStep: FC<Props> = ({ busy, onAction, onNext }) => {
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  return (
    <>
      <div>
        <label htmlFor="wizard-password" className="block text-xs text-zinc-400 mb-1">Password (min 8 chars)</label>
        <input id="wizard-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
      </div>
      <div>
        <label htmlFor="wizard-confirm-password" className="block text-xs text-zinc-400 mb-1">Confirm password</label>
        <input id="wizard-confirm-password" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
          className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
      </div>
      <button disabled={busy || password.length < 8 || password !== confirmPw}
        onClick={() => onAction(async () => {
          await postApi("/api/wallet/password", { password });
          onNext();
        })}
        className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
        {busy ? "Saving..." : "Continue"}
      </button>
    </>
  );
};
