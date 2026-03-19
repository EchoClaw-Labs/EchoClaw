/**
 * Floating widget panel — overlays on top of chat.
 * Draggable title bar, resizable, minimizable, closeable.
 * Used for Trades, Portfolio, Memory views without leaving chat.
 */

import { type FC, type ReactNode, useState, useRef, useCallback } from "react";
import { HugeiconsIcon, Cancel01Icon, Minimize01Icon, Maximize01Icon } from "./icons";
import { cn } from "../utils";

interface FloatingWidgetProps {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  className?: string;
}

export const FloatingWidget: FC<FloatingWidgetProps> = ({
  title, icon, onClose, children,
  defaultWidth = 480, defaultHeight = 400, className,
}) => {
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 60, y: 60 });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPosition({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    };
    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [position]);

  return (
    <div
      className={cn(
        "fixed z-40 flex flex-col rounded-xl border border-border/40 bg-black/70 backdrop-blur-2xl shadow-[0_10px_40px_rgb(0,0,0,0.5)] overflow-hidden",
        minimized && "!h-auto",
        className,
      )}
      style={{
        left: position.x,
        top: position.y,
        width: size.w,
        height: minimized ? "auto" : size.h,
      }}
    >
      {/* Title bar — draggable */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center gap-2 px-3 py-2 border-b border-border cursor-grab active:cursor-grabbing select-none shrink-0"
      >
        {icon}
        <span className="text-xs font-medium text-foreground flex-1">{title}</span>
        <button onClick={() => setMinimized(p => !p)} className="p-1 text-muted-foreground hover:text-foreground transition rounded">
          <HugeiconsIcon icon={minimized ? Maximize01Icon : Minimize01Icon} size={14} />
        </button>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-status-error transition rounded">
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>
      </div>

      {/* Content */}
      {!minimized && (
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      )}

      {/* Resize handle */}
      {!minimized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const origW = size.w;
            const origH = size.h;
            const handleMove = (ev: MouseEvent) => {
              setSize({
                w: Math.max(300, origW + ev.clientX - startX),
                h: Math.max(200, origH + ev.clientY - startY),
              });
            };
            const handleUp = () => {
              document.removeEventListener("mousemove", handleMove);
              document.removeEventListener("mouseup", handleUp);
            };
            document.addEventListener("mousemove", handleMove);
            document.addEventListener("mouseup", handleUp);
          }}
        >
          <svg className="w-3 h-3 text-muted-foreground/40 absolute bottom-1 right-1" viewBox="0 0 12 12">
            <path d="M11 1L1 11M11 5L5 11M11 9L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
};
