import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../utils";

interface ActionModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export const ActionModal: FC<ActionModalProps> = ({ open, onClose, title, children, className }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      document.body.style.overflow = "";
    }

    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center px-4",
        "transition-all duration-200",
        visible ? "bg-black/60 backdrop-blur-sm" : "bg-transparent",
      )}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={cn(
        "w-full max-w-md rounded-2xl border border-white/[0.08] bg-zinc-950 p-6",
        "shadow-2xl shadow-black/40",
        "transition-all duration-200 ease-out",
        visible ? "scale-100 opacity-100 translate-y-0" : "scale-95 opacity-0 translate-y-2",
        className,
      )}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
