import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * BASE_PATH lets the same source serve from a domain root (the local deploy)
 * and from a repository subpath (GitHub Pages) without a second build config.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  test: { globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
