/**
 * ============================================================================
 * Vite config — BUILD DESKTOP (Tauri)
 * ============================================================================
 *
 * Esta config é usada APENAS pelos scripts `dev:desktop` / `build:desktop`.
 * O build web (Cloudflare Workers + SSR) continua usando `vite.config.ts`
 * intacto e não é afetado em nada.
 *
 * Diferenças em relação ao build web:
 *  - `cloudflare: false`   → não emite Worker (desktop é file:// puro).
 *  - `tanstackStart.spa`   → ativa modo SPA + prerender de um shell `index.html`
 *                            estático que o Tauri carrega via file://.
 *  - `base: './'`          → caminhos relativos para os assets, exigência
 *                            obrigatória para file:// funcionar no WebView.
 *  - `build.outDir`        → saída isolada em `dist-desktop/` para não colidir
 *                            com a saída do build web.
 *
 * Após `npm run build:desktop`, o Tauri lê `dist-desktop/` (ver tauri.conf.json,
 * campo `frontendDist`).
 */
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Worker da Cloudflare não faz sentido em build desktop.
  cloudflare: false,
  // SPA mode + prerender do shell raiz.
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
    // Assets relativos — obrigatório para file:// no WebView do Tauri.
    base: "./",
    build: {
      outDir: "dist-desktop",
      emptyOutDir: true,
      sourcemap: false,
    },
    // Marca o bundle como build desktop para o runtime detectar via env
    // (opcional — `getRuntimeShell()` também detecta `window.__TAURI__`).
    define: {
      "import.meta.env.VITE_RUNTIME_SHELL": JSON.stringify("desktop"),
    },
  },
});
