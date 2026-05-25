/**
 * useDesktopBootstrap — Wave 2 (LOCAL-FIRST)
 *
 * Após o login no desktop, garante que o SQLite local foi populado pelo
 * menos uma vez com os dados essenciais (funcionários, produtos, clientes,
 * fornecedores, estoque, financeiro, terminais).
 *
 * Comportamento:
 *  - Roda apenas em desktop (Tauri) e em roles que usam servidor local
 *    (server / unset). Em terminal, o servidor da LAN central já cuida.
 *  - Marca conclusão em localStorage por (user_id + versão do schema) para
 *    não reexecutar a cada montagem.
 *  - Idempotente: pode rodar de novo manualmente sem efeitos colaterais.
 *  - Não bloqueia a UI; mostra toasts informativos.
 *
 * Após o bootstrap o frontend consome `dataClient.*` normalmente — os
 * adapters em modo local-server leem do SQLite local servido por axum.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { DEFAULT_LOCAL_PORT } from "@/components/desktop/useLocalServerBoot";
import {
  fetchOfflineStatus,
  runSyncInicial,
} from "@/integrations/desktop/serverConnection";
import { supabase } from "@/integrations/supabase/client";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

const BOOTSTRAP_KEY_PREFIX = "gp.desktop.bootstrap.v2.";
const BOOTSTRAP_SCHEMA = "wave2-funcionarios";

function bootstrapStorageKey(userId: string): string {
  return `${BOOTSTRAP_KEY_PREFIX}${BOOTSTRAP_SCHEMA}.${userId}`;
}

function readBootstrapDone(userId: string): boolean {
  try {
    return window.localStorage.getItem(bootstrapStorageKey(userId)) === "1";
  } catch {
    return false;
  }
}

function writeBootstrapDone(userId: string): void {
  try {
    window.localStorage.setItem(bootstrapStorageKey(userId), "1");
    window.localStorage.setItem(
      `${bootstrapStorageKey(userId)}.at`,
      String(Date.now()),
    );
  } catch {
    // ignore
  }
}

function buildLocalCfg(porta: number | undefined): TerminalConexaoConfig {
  return {
    host: "127.0.0.1",
    porta: porta ?? DEFAULT_LOCAL_PORT,
    terminalId: "local-server",
    terminalNome: "Servidor local",
  };
}

async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Tenta carregar status; útil pra decidir se basta marcar bootstrap done
 * (caso o cache já esteja completo de execuções anteriores).
 */
async function jaTemDadosLocais(
  cfg: TerminalConexaoConfig,
  token: string | null,
): Promise<boolean> {
  const st = await fetchOfflineStatus(cfg, token);
  if (!st) return false;
  // Se o servidor local já indica `ready`, o cache está populado.
  if (st.ready) return true;
  // Heurística: pelo menos funcionários e produtos têm linhas.
  const essenciais = ["funcionarios_remote", "produtos"];
  const ok = essenciais.every((dom) => {
    const d = st.domains?.find((x) => x.domain === dom);
    return d ? d.row_count > 0 : false;
  });
  return ok;
}

export function useDesktopBootstrap(): void {
  const { user } = useAuth();
  const { isDesktop: desk, role, config } = useDesktopRole();
  const { online } = useNetworkStatus();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!desk) return;
    if (!user?.id) return;
    if (role === "terminal") return; // terminal fala com servidor da LAN
    if (startedRef.current) return;
    if (readBootstrapDone(user.id)) return;

    startedRef.current = true;
    const cfg = buildLocalCfg(config.terminal?.porta);

    void (async () => {
      // Pequeno respiro pro servidor local subir.
      await new Promise((r) => setTimeout(r, 1500));

      const token = await getAuthToken();
      if (!token) {
        console.warn("[BOOTSTRAP] sem token Supabase — adiando bootstrap");
        startedRef.current = false;
        return;
      }

      // Se já temos dados locais (instalação anterior), marca pronto e sai.
      if (await jaTemDadosLocais(cfg, token)) {
        console.info("[BOOTSTRAP] cache local já populado — marcando done");
        writeBootstrapDone(user.id);
        return;
      }

      if (!online) {
        console.warn(
          "[BOOTSTRAP] sem internet — bootstrap inicial requer rede; reagendado",
        );
        startedRef.current = false;
        return;
      }

      const toastId = toast.loading(
        "Preparando uso offline (funcionários, produtos, estoque)…",
        { duration: Infinity },
      );
      try {
        const r = await runSyncInicial(cfg, token);
        if ("results" in r && r.ok) {
          const total = r.results.reduce((a, d) => a + d.row_count, 0);
          writeBootstrapDone(user.id);
          toast.success(
            `Dados locais prontos (${total} registros). Desktop agora funciona offline.`,
            { id: toastId },
          );
          console.info("[BOOTSTRAP] concluído", r);
        } else {
          const errMsg =
            "error" in r
              ? r.error
              : "Alguns domínios não foram sincronizados.";
          toast.error(`Bootstrap incompleto: ${errMsg}`, { id: toastId });
          console.warn("[BOOTSTRAP] falha", r);
          // Permite nova tentativa em próximo mount.
          startedRef.current = false;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Bootstrap falhou: ${msg}`, { id: toastId });
        startedRef.current = false;
      }
    })();
  }, [desk, user?.id, role, config.terminal?.porta, online]);
}
