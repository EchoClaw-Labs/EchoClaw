import type { FC } from "react";
import { cn } from "../utils";

const DELAYS = [0, 0.12, 0.24, 0.12, 0.24, 0.36, 0.24, 0.36, 0.48];

const SIZE_VARS: Record<string, { dot: string; gap: string }> = {
  sm: { dot: "4px", gap: "1.5px" },
  md: { dot: "6px", gap: "2px" },
  lg: { dot: "8px", gap: "3px" },
  xl: { dot: "10px", gap: "4px" },
};

interface WaveSpinnerProps {
  size?: "sm" | "md" | "lg" | "xl";
  color?: string;
  className?: string;
}

export const WaveSpinner: FC<WaveSpinnerProps> = ({
  size = "md",
  color = "#60A5FA",
  className,
}) => {
  const { dot, gap } = SIZE_VARS[size];

  return (
    <div
      className={cn("flex items-center justify-center", className)}
      role="status"
      aria-label="Loading"
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(3, ${dot})`,
          gap,
        }}
      >
        {DELAYS.map((delay, i) => (
          <div
            key={i}
            style={{
              width: dot,
              height: dot,
              backgroundColor: color,
              animation: `waveSpinnerPulse 0.7s ease-out infinite`,
              animationDelay: `${delay}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};
