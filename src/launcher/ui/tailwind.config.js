/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    fontFamily: {
      sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
    },
    extend: {
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      borderRadius: {
        lg: "calc(var(--radius) + 4px)",
        md: "var(--radius)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 8px)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border))",
        "neon-blue": "#60A5FA",
        "brand-blue": "#2563EB",
        "status-ok": "#22c55e",
        "status-warn": "#f59e0b",
        "status-error": "#ef4444",
      },
    },
  },
  plugins: [],
};
