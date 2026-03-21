import { type FC, useState } from "react";
import { postApi } from "../../../api";
import { CopyField } from "../../../components/CopyField";
import type { StepProps, WalletAddresses } from "../types";

interface Props extends StepProps {
  walletAddresses: WalletAddresses | null;
  selectedProvider: string | null;
  initialDeposit: string;
  initialFund: string;
  onNext: () => void;
}

export const FundStep: FC<Props> = ({ busy, onAction, walletAddresses, selectedProvider, initialDeposit, initialFund, onNext }) => {
  const [depositAmount, setDepositAmount] = useState(initialDeposit);
  const [fundAmount, setFundAmount] = useState(initialFund);

  const isValid = depositAmount && !isNaN(Number(depositAmount)) && Number(depositAmount) > 0
    && fundAmount && !isNaN(Number(fundAmount)) && Number(fundAmount) > 0;

  return (
    <>
      {walletAddresses?.evm && <CopyField label="Your Wallet Address" value={walletAddresses.evm} />}

      <p className="text-xs text-zinc-500">Minimum 3 0G required to create a compute ledger</p>

      <div>
        <label htmlFor="wizard-deposit" className="block text-xs text-zinc-400 mb-1">Deposit to ledger (0G)</label>
        <input id="wizard-deposit" type="number" min="0" step="0.1" value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
          className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
      </div>
      <div>
        <label htmlFor="wizard-fund" className="block text-xs text-zinc-400 mb-1">Fund provider (0G)</label>
        <input id="wizard-fund" type="number" min="0" step="0.1" value={fundAmount} onChange={e => setFundAmount(e.target.value)}
          className="w-full rounded-lg border border-white/[0.1] bg-zinc-900 px-3 py-2 text-sm text-white focus:border-neon-blue focus:outline-none" />
      </div>
      <button disabled={busy || !isValid}
        onClick={() => onAction(async () => {
          await postApi("/api/fund/deposit", { amount: depositAmount });
          if (selectedProvider) await postApi("/api/fund/provider", { provider: selectedProvider, amount: fundAmount });
          onNext();
        })}
        className="w-full rounded-lg bg-neon-blue/20 py-2.5 text-sm font-medium text-neon-blue hover:bg-neon-blue/30 transition disabled:opacity-40">
        {busy ? "Funding..." : "Deposit & Fund"}
      </button>
    </>
  );
};
