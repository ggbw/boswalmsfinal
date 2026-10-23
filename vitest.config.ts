import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/smoke/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    // Same boswa-live pin as vite.config.ts.
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.resolve(__dirname, "./src/lib/backend/client.ts") },
      { find: /^@\/integrations\/supabase\/types$/, replacement: path.resolve(__dirname, "./src/lib/backend/types.ts") },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
});
