import { type FC, useState } from "react";

interface CopyFieldProps {
  label: string;
  value: string;
}

export const CopyField: FC<CopyFieldProps> = ({ label, value }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* clipboard unavailable */ });
  };

  return (
    <div className="space-y-1">
      <label className="block text-xs text-zinc-400">{label}</label>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-zinc-900 px-3 py-2">
        <code className="flex-1 text-xs text-white font-mono break-all">{value}</code>
        <button onClick={handleCopy}
          className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
};
