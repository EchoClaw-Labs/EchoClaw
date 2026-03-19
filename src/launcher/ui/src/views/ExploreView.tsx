import { type FC, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { SetupCard } from "../components/SetupCard";
import { WaveSpinner } from "../components/WaveSpinner";
import { getExplore, getAdvanced, type CatalogItem } from "../api";

interface Props { onNavigate: (p: string) => void; mode: "explore" | "advanced" }

export const ExploreView: FC<Props> = ({ onNavigate, mode }) => {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetcher = mode === "explore" ? getExplore : getAdvanced;
    fetcher().then(d => { setItems(d.items); setLoading(false); }).catch(() => setLoading(false));
  }, [mode]);

  if (loading) return <div className="flex justify-center py-20"><WaveSpinner size="lg" /></div>;

  const title = mode === "explore" ? "Explore Echo" : "Advanced";
  const desc = mode === "explore" ? "Safe starter actions for exploring EchoClaw" : "Low-level advanced surfaces";

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <PageHeader title={title} description={desc} onBack={() => onNavigate("/")} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map(item => (
          <SetupCard
            key={item.id}
            title={item.title}
            status="pending"
            summary={item.description}
            detail={item.badge}
          >
            <div className="flex items-center justify-between">
              <code className="font-mono text-xs text-zinc-500 truncate max-w-[70%]">{item.command}</code>
              <button
                onClick={() => navigator.clipboard.writeText(item.command)}
                className="rounded-md bg-zinc-800/80 px-2.5 py-1 text-2xs text-zinc-400 hover:text-zinc-200 transition"
              >
                Copy
              </button>
            </div>
          </SetupCard>
        ))}
      </div>
    </div>
  );
};
