import { type FC, useState } from "react";
import { StatusPill } from "./StatusPill";
import { HugeiconsIcon, ChevronDownIcon } from "./Icons";
import { cn } from "../utils";

type OverallStatus = "ok" | "warn" | "error" | "pending";

interface NavLink {
  label: string;
  path: string;
  description?: string;
}

interface NavSection {
  id: string;
  label: string;
  links: NavLink[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: "setup",
    label: "Setup",
    links: [
      { label: "Connect AI", path: "/connect", description: "Link your AI runtime" },
      { label: "Fund Compute", path: "/fund", description: "Manage ledger & providers" },
      { label: "Wallet & Keys", path: "/wallet", description: "Create, import, backup wallets" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    links: [
      { label: "Bridge", path: "/bridge", description: "Cross-chain via Khalani" },
      { label: "Explore", path: "/explore", description: "Discover EchoClaw capabilities" },
      { label: "Advanced", path: "/advanced", description: "Low-level command surfaces" },
    ],
  },
  {
    id: "manage",
    label: "Manage",
    links: [
      { label: "Claude Proxy", path: "/claude", description: "Config, proxy, settings" },
      { label: "OpenClaw Setup", path: "/openclaw", description: "8-step onboard wizard" },
      { label: "Diagnostics", path: "/manage", description: "Doctor, verify, support" },
    ],
  },
];

interface NavbarProps {
  version: string;
  overallStatus: OverallStatus;
  statusLabel: string;
  onNavigate?: (path: string) => void;
}

export const Navbar: FC<NavbarProps> = ({ version, overallStatus, statusLabel, onNavigate }) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <header className="sticky top-0 z-40 w-full px-4 pt-4">
      <div
        className="relative mx-auto max-w-4xl"
        onMouseLeave={() => { setActiveDropdown(null); setHoveredItem(null); }}
      >
        {/* Main bar */}
        <div className={cn(
          "flex h-14 items-center justify-between px-4 backdrop-blur-xl transition-all duration-300",
          activeDropdown
            ? "rounded-t-2xl border border-b-0 border-white/[0.06] bg-zinc-950/95"
            : "rounded-2xl border border-white/[0.06] bg-zinc-900/40",
        )}>
          {/* Logo */}
          <button
            type="button"
            onClick={() => onNavigate?.("/")}
            className="flex items-center hover:opacity-80 transition-opacity"
          >
            <img src="/echoclaw-logo.png" alt="EchoClaw" className="h-9 w-auto object-contain" />
          </button>

          {/* Nav items */}
          <nav className="flex items-center gap-1">
            {NAV_SECTIONS.map(section => (
              <button
                key={section.id}
                type="button"
                className="relative flex h-9 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
                onMouseEnter={() => { setActiveDropdown(section.id); setHoveredItem(section.id); }}
              >
                {hoveredItem === section.id && (
                  <div className="absolute inset-0 rounded-xl bg-zinc-800/80 transition-all duration-200" />
                )}
                <span className="relative z-10">{section.label}</span>
                <HugeiconsIcon
                  icon={ChevronDownIcon}
                  size={14}
                  className={cn("relative z-10 transition-transform duration-200", hoveredItem === section.id && "rotate-180")}
                />
              </button>
            ))}
          </nav>

          {/* Right: status + version */}
          <div className="flex items-center gap-3">
            <StatusPill status={overallStatus} label={statusLabel} />
            <span className="font-mono text-[10px] text-zinc-600">v{version}</span>
          </div>
        </div>

        {/* Dropdown panel */}
        {activeDropdown && (
          <div className={cn(
            "absolute top-full left-0 z-40 w-full origin-top overflow-hidden",
            "rounded-b-2xl border border-t-0 border-white/[0.06]",
            "bg-gradient-to-b from-zinc-950/95 to-zinc-900/40 backdrop-blur-2xl",
          )}>
            <div className="p-4">
              <div className="grid grid-cols-1 gap-1">
                {NAV_SECTIONS.find(s => s.id === activeDropdown)?.links.map(link => (
                  <button
                    key={link.path}
                    type="button"
                    onClick={() => { setActiveDropdown(null); onNavigate?.(link.path); }}
                    className="group flex w-full items-start gap-3 rounded-xl p-3 text-left transition-all hover:bg-zinc-800/60"
                  >
                    <div>
                      <div className="text-sm font-medium text-zinc-200 group-hover:text-white">{link.label}</div>
                      {link.description && (
                        <div className="text-xs text-zinc-500 group-hover:text-zinc-400 mt-0.5">{link.description}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
