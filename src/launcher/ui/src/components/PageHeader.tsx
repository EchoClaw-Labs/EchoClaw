import type { FC } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  onBack?: () => void;
}

export const PageHeader: FC<PageHeaderProps> = ({ title, description, onBack }) => {
  return (
    <div className="mb-8">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-3 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <span>←</span>
          <span>Back to Dashboard</span>
        </button>
      )}
      <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
      {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
    </div>
  );
};
