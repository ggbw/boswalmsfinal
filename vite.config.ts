import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    // The first two pin the database to boswa-live: Lovable Cloud regenerates
    // src/integrations/supabase/{client,types}.ts for its own database, so
    // those paths resolve to src/lib/backend instead. They must stay above "@".
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.resolve(__dirname, "./src/lib/backend/client.ts") },
      { find: /^@\/integrations\/supabase\/types$/, replacement: path.resolve(__dirname, "./src/lib/backend/types.ts") },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
}));
