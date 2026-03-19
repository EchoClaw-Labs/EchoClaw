import { type FC, useEffect, useRef, useState } from "react";
import { cn } from "../utils";

export interface AgentAvatarProps {
  seed: string;
  size?: number;
  animated?: boolean;
  pfpUrl?: string;
  name?: string;
  model?: string;
  className?: string;
}

const G = 6; // grid size
const P = { speed: 0.002, amp: 22 }; // pulse
const B = { speed: 0.001, amp: 10 }; // breathe
const W = { speed: 0.0015, amp: 15, len: 3 }; // wave
const S = { speed: 0.004, thresh: 0.92, boost: 25 }; // sparkle
const SC = { speed: 0.0008, amt: 0.03 }; // scale pulse
const HUE_SPREAD = 45;
const GLOW_R = 0.25;

const hashSeed = (str: string): number => {
  let hash = 0;
  for (const char of str) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
};

const createRng = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

type HSL = [hue: number, saturation: number, lightness: number];

const generatePalette = (hash: number): [HSL, HSL, HSL] => {
  const rng = createRng(hash);
  const baseHue = rng() * 360;
  const sat = 75 + rng() * 20;
  return [
    [baseHue, sat, 55 + rng() * 10],
    [(baseHue - HUE_SPREAD + rng() * HUE_SPREAD * 2) % 360, sat - 5 + rng() * 10, 40 + rng() * 15],
    [(baseHue - HUE_SPREAD + rng() * HUE_SPREAD * 2) % 360, sat - 10 + rng() * 15, 60 + rng() * 15],
  ];
};

type Cell = { colorIndex: number; phase: number; brightness: number; sparklePhase: number };

const generateGrid = (hash: number): Cell[][] => {
  const rng = createRng(hash + 1);
  return Array.from({ length: G }, () =>
    Array.from({ length: G }, () => ({
      colorIndex: Math.floor(rng() * 3), phase: rng() * Math.PI * 2,
      brightness: 0.3 + rng() * 0.7, sparklePhase: rng() * Math.PI * 2,
    })),
  );
};

/** Tooltip wrapper */
const Tooltip: FC<{ name?: string; model?: string; children: React.ReactNode }> = ({ name, model, children }) => {
  const [show, setShow] = useState(false);
  if (!name && !model) return <>{children}</>;

  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 rounded-lg border border-border bg-card px-3 py-1.5 shadow-lg text-xs whitespace-nowrap animate-fade-in z-50">
          {name && <div className="font-medium text-foreground">{name}</div>}
          {model && <div className="text-muted-foreground font-mono text-2xs">{model}</div>}
        </div>
      )}
    </div>
  );
};

export const AgentAvatar: FC<AgentAvatarProps> = ({ seed, size = 64, animated = true, pfpUrl, name, model, className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  if (pfpUrl) {
    return (
      <Tooltip name={name} model={model}>
        <img src={pfpUrl} alt={name ?? `Avatar for ${seed}`}
          className={cn("rounded-full object-cover", className)} style={{ width: size, height: size }} />
      </Tooltip>
    );
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const hash = hashSeed(seed);
    const palette = generatePalette(hash);
    const grid = generateGrid(hash);
    const cellSize = size / G;
    const half = size / 2;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let shouldAnimate = animated && !motionQuery.matches;

    const draw = (time: number) => {
      ctx.clearRect(0, 0, size, size);
      const scale = shouldAnimate ? 1 + Math.sin(time * SC.speed) * SC.amt : 1;

      ctx.save();
      ctx.translate(half, half);
      ctx.scale(scale, scale);
      ctx.translate(-half, -half);
      ctx.beginPath();
      ctx.arc(half, half, half, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#08080f";
      ctx.fillRect(0, 0, size, size);

      const breatheOffset = shouldAnimate ? Math.sin(time * B.speed) * B.amp : 0;

      for (let y = 0; y < G; y++) {
        for (let x = 0; x < G; x++) {
          const cell = grid[y][x];
          const [h, s, l] = palette[cell.colorIndex];
          const pulse = shouldAnimate ? Math.sin(time * P.speed + cell.phase) * P.amp : 0;
          const wave = shouldAnimate ? Math.sin(time * W.speed + (x + y) / W.len) * W.amp : 0;
          const sv = shouldAnimate ? Math.sin(time * S.speed + cell.sparklePhase) : 0;
          const sparkle = sv > S.thresh ? ((sv - S.thresh) / (1 - S.thresh)) * S.boost : 0;
          const finalLight = Math.min(90, Math.max(20, (l + pulse + breatheOffset + wave + sparkle) * cell.brightness));
          const finalSat = Math.min(100, s + 5);

          ctx.shadowColor = `hsl(${h}, ${finalSat}%, ${finalLight}%)`;
          ctx.shadowBlur = cellSize * 0.45;
          ctx.fillStyle = `hsl(${h}, ${finalSat}%, ${finalLight}%)`;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }

      ctx.shadowBlur = 0;
      ctx.restore();

      const [gh, gs, gl] = palette[0];
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.shadowColor = `hsla(${gh}, ${gs}%, ${gl}%, 0.6)`;
      ctx.shadowBlur = size * GLOW_R;
      ctx.beginPath();
      ctx.arc(half, half, half - 1, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${gh}, ${gs}%, ${gl}%, 0.15)`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      if (shouldAnimate) rafRef.current = requestAnimationFrame(draw);
    };

    const handleMotionChange = () => {
      cancelAnimationFrame(rafRef.current);
      shouldAnimate = animated && !motionQuery.matches;
      if (shouldAnimate) rafRef.current = requestAnimationFrame(draw);
      else draw(0);
    };

    motionQuery.addEventListener("change", handleMotionChange);
    if (shouldAnimate) rafRef.current = requestAnimationFrame(draw);
    else draw(0);

    return () => {
      cancelAnimationFrame(rafRef.current);
      motionQuery.removeEventListener("change", handleMotionChange);
    };
  }, [seed, size, animated]);

  return (
    <Tooltip name={name} model={model}>
      <canvas
        aria-label={name ?? `Avatar for ${seed}`}
        className={cn("rounded-full", className)}
        ref={canvasRef}
        role="img"
        style={{ width: size, height: size }}
      />
    </Tooltip>
  );
};
