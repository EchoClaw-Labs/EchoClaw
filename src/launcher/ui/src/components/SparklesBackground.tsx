import { type FC, useEffect, useRef } from "react";

/**
 * Lightweight canvas sparkles — floating neon-blue dots.
 * Inspired by echo-fe SparklesCore but without tsParticles dependency.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  opacityDir: number;
}

interface SparklesBackgroundProps {
  density?: number;
  color?: string;
  speed?: number;
  className?: string;
}

export const SparklesBackground: FC<SparklesBackgroundProps> = ({
  density = 60,
  color = "#60A5FA",
  speed = 0.3,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let particles: Particle[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement?.getBoundingClientRect() ?? { width: window.innerWidth, height: window.innerHeight };
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(dpr, dpr);

      // Regenerate particles on resize
      const count = Math.floor((rect.width * rect.height) / (400 * 400) * density);
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * rect.width,
        y: Math.random() * rect.height,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        size: 0.5 + Math.random() * 1.2,
        opacity: 0.1 + Math.random() * 0.4,
        opacityDir: (Math.random() > 0.5 ? 1 : -1) * (0.002 + Math.random() * 0.005),
      }));
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement ?? canvas);

    const render = () => {
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.opacity += p.opacityDir;

        if (p.opacity <= 0.05 || p.opacity >= 0.5) p.opacityDir *= -1;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = p.opacity;
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(render);
    };

    // Respect reduced motion
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!prefersReducedMotion) {
      render();
    }

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, [density, color, speed]);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${className ?? ""}`}
      style={{ position: "fixed", inset: 0, zIndex: 0 }}
    />
  );
};
