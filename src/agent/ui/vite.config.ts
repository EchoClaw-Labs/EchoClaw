import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname),
  publicDir: resolve(__dirname, "public"),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "../../../dist/agent-ui"),
    emptyOutDir: true,
  },
  server: {
    port: 4202,
    proxy: {
      "/api": "http://127.0.0.1:4201",
    },
  },
});
