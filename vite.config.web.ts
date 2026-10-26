/**
 * ============================================================================
 * Vite config — BUILD WEB ESTÁTICO (SPA) para a Vercel
 * ============================================================================
 *
 * Usada APENAS por `npm run build:web`. Não afeta:
 *  - `vite.config.ts`          → build web SSR em Cloudflare Worker (Lovable);
 *  - `vite.config.desktop.ts`  → build desktop (Tauri).
 *
 * Diferenças em relação ao build web atual:
 *  - `cloudflare: false`    → não emite Worker; o app não usa server functions
 *                             e o webhook do Asaas roda na Edge Function do
 *                             Supabase.
 *  - `tanstackStart.spa`    → SPA + prerender de um shell estático (`/`).
 *  - `base: '/'`            → assets absolutos (ao contrário do desktop, que
 *                             usa './' por causa do file://).
 *  - `build.outDir`         → `dist-web/` (saída isolada). O conteúdo servido
 *                             fica em `dist-web/client` (ver vercel.json).
 *
 * As variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são
 * incorporadas no build (o wrapper lê `.env` e `process.env`). Na Vercel,
 * defina-as nas Environment Variables do projeto.
 */
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    spa: {
      enabled: true,
      prerender: {
        enabled: true,
        outputPath: "/",
      },
    },
  },
  vite: {
    base: "/",
    build: {
      outDir: "dist-web",
      emptyOutDir: true,
      sourcemap: false,
    },
  },
});
