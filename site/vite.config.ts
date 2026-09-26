import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// in development, /data is proxied to the live site data when KEYS_DATA_ORIGIN is set in site/.env.local
// (gitignored); in production the files sit next to the app on the same origin
export default defineConfig(({ mode }) => {
  const origin = loadEnv(mode, process.cwd(), "").KEYS_DATA_ORIGIN;
  return {
    plugins: [react()],
    server: origin ? { proxy: { "/data": { target: origin, changeOrigin: true } } } : undefined,
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
});
