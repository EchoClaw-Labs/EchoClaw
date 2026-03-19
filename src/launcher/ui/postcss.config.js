import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: resolve(__dirname, "tailwind.config.js") },
    autoprefixer: {},
  },
};
