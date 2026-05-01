/**
 * Boot do backend local — só faz algo quando rodando como Desktop em
 * modo "server". Em web, terminal ou unset, é no-op silencioso.
 *
 * Estratégia:
 *  - lê a porta padrão da configuração (default 7400)
 *  - chama o command Tauri `start_local_server`
 *  - se já estiver rodando, o command é idempotente
 *  - quando o papel muda para outro, manda parar
 *
 * Use UMA vez na raiz autenticada (já incluído no DesktopRoleProvider).
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useDesktopRole } from "./DesktopRoleProvider";
import {
  startLocalServer,
  stopLocalServer,
} from "@/integrations/desktop/tauriBridge";

export const DEFAULT_LOCAL_PORT = 7400;

export function useLocalServerBoot() {
  const { isDesktop, role, config } = useDesktopRole();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isDesktop) return;

    // Só inicia o backend quando a máquina for explicitamente o Servidor.
    if (role === "server") {
      const port = config.terminal?.porta ?? DEFAULT_LOCAL_PORT;
      const nome =
        config.serverNome ??
        config.terminal?.terminalNome ??
        "Servidor Gestão Pro";
      const upstreamUrl =
        (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null;
      const upstreamAnonKey =
        (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
        null;
      void startLocalServer({
        port,
        serverName: nome,
        serverId: config.serverId ?? null,
        upstreamUrl,
        upstreamAnonKey,
      })
        .then((st) => {
          if (st.running && !startedRef.current) {
            startedRef.current = true;
            toast.success(
              `Backend local iniciado na porta ${st.port ?? port}.`,
            );
          }
        })
        .catch((err) => {
          toast.error(
            `Não foi possível iniciar o backend local: ${String(err)}`,
          );
        });
    } else if (startedRef.current) {
      // Mudou para outro papel → desliga o servidor.
      void stopLocalServer().catch(() => {});
      startedRef.current = false;
    }
  }, [
    isDesktop,
    role,
    config.terminal?.porta,
    config.serverNome,
    config.serverId,
    config.terminal?.terminalNome,
  ]);
}
