import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "edge-runtime",
    server: {
      deps: {
        inline: ["convex-test", "next-intl"],
      },
    },
    exclude: ["node_modules/**", "cypress/**", ".next/**"],
  },
});
