/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    fontFamily: {
      sans: ["Poppins", "system-ui", "sans-serif"],
      mono: ["JetBrains Mono", "Menlo", "monospace"],
    },
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        border: "hsl(var(--border))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        "bubble-sent": "#00bbff",
        "bubble-received": "hsl(var(--card))",
        "status-ok": "#22c55e",
        "status-warn": "#f59e0b",
        "status-error": "#ef4444",
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "vortex-spin": {
          "0%": { transform: "rotate(0deg) scale(1)", filter: "hue-rotate(0deg) brightness(1)" },
          "50%": { transform: "rotate(180deg) scale(0.6)", filter: "hue-rotate(90deg) brightness(1.5)" },
          "100%": { transform: "rotate(360deg) scale(1)", filter: "hue-rotate(0deg) brightness(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "shimmer": "shimmer 3s infinite linear",
        "blink": "blink 1s step-end infinite",
        "vortex": "vortex-spin 3s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [],
};
