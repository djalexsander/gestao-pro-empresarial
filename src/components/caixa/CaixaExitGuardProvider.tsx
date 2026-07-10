import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperador } from "@/components/auth/OperadorProvider";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { FecharCaixaDialog } from "@/components/caixa/FecharCaixaDialog";
import {
  useCaixaResumo,
  type Caixa,
} from "@/hooks/useCaixa";
import { dataClient } from "@/integrations/data";
import {
  hasDesktopCaixaAberto,
  listenDesktopCaixaCloseBlocked,
  setDesktopCaixaExitGuard,
} from "@/integrations/desktop/tauriBridge";

export const CAIXA_EXIT_BLOCK_MESSAGE =
  "Existe um caixa aberto. Feche o caixa antes de encerrar o aplicativo.";

interface CaixaExitGuardContextValue {
  ensureCanExit: () => Promise<boolean>;
  guardedSignOut: (signOut: () => Promise<void>) => Promise<void>;
  blockAndOpenFechamento: (message?: string) => Promise<void>;
  markCaixaAberto: () => void;
  markCaixaFechado: () => void;
}

const CaixaExitGuardContext = createContext<CaixaExitGuardContextValue | null>(null);

export function CaixaExitGuardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { operador } = useOperador();
  const { terminal } = useTerminal();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [caixaParaFechar, setCaixaParaFechar] = useState<Caixa | null>(null);
  const [hasCaixaAbertoKnown, setHasCaixaAbertoKnown] = useState(false);
  const hasCaixaAbertoKnownRef = useRef(false);
  const { data: resumoCaixa } = useCaixaResumo(caixaParaFechar?.id);

  const setCaixaAbertoKnown = useCallback((value: boolean, caixa?: Caixa | null, source = "unknown") => {
    hasCaixaAbertoKnownRef.current = value;
    setHasCaixaAbertoKnown(value);
    void setDesktopCaixaExitGuard({
      hasCaixaAberto: value,
      caixaId: caixa?.id ?? null,
      ownerId: caixa?.owner_id ?? user?.id ?? null,
      operadorId: caixa?.operador_id ?? operador?.id ?? null,
      terminalId: caixa?.terminal_id ?? terminal?.id ?? null,
      source,
    });
  }, [operador?.id, terminal?.id, user?.id]);

  const markCaixaAberto = useCallback(() => {
    setCaixaAbertoKnown(true, null, "markCaixaAberto");
  }, [setCaixaAbertoKnown]);

  const markCaixaFechado = useCallback(() => {
    setCaixaParaFechar(null);
    setCaixaAbertoKnown(false, null, "markCaixaFechado");
  }, [setCaixaAbertoKnown]);

  const findCaixaAberto = useCallback(async (): Promise<Caixa | null> => {
    if (!user) {
      setCaixaAbertoKnown(false, null, "sem-usuario");
      console.info("[CaixaExitGuard] liberado: sem usuario autenticado");
      return null;
    }

    const operadorId = operador?.id ?? null;
    const terminalId = terminal?.id ?? null;
    const [caixaAberto, desktopOpen] = await Promise.all([
      dataClient.caixa.aberto({ qualquer: true }).catch((error): null => {
        console.warn("[CaixaExitGuard] falha ao consultar fonte canonica da tela Caixa", error);
        return null;
      }) as Promise<Caixa | null>,
      hasDesktopCaixaAberto({
        ownerId: user.id,
        operadorId,
        terminalId,
      }),
    ]);

    if (caixaAberto) {
      console.info("[CaixaExitGuard] bloqueio: fonte canonica encontrou caixa aberto", {
        id: caixaAberto.id,
        owner_id: caixaAberto.owner_id ?? user.id,
        operador_id: caixaAberto.operador_id ?? null,
        terminal_id: caixaAberto.terminal_id ?? null,
        status: caixaAberto.status,
        desktop_backend_aberto: desktopOpen,
      });
      setCaixaAbertoKnown(true, caixaAberto, "dataClient.caixa.aberto({qualquer:true})");
      return caixaAberto;
    }

    console.info("[CaixaExitGuard] liberado: tela Caixa/fonte canonica nao encontrou caixa aberto", {
      owner_id: user.id,
      operador_id: operadorId,
      terminal_id: terminalId,
      desktop_backend_aberto: desktopOpen,
      estado_anterior_react: hasCaixaAbertoKnownRef.current,
    });
    setCaixaAbertoKnown(false, null, "dataClient.caixa.aberto({qualquer:true})");
    return null;
  }, [operador?.id, setCaixaAbertoKnown, terminal?.id, user]);

  const blockAndOpenFechamento = useCallback(
    async (message = CAIXA_EXIT_BLOCK_MESSAGE) => {
      toast.error(message);
      const caixaAberto = await findCaixaAberto();

      if (caixaAberto) {
        setCaixaParaFechar(caixaAberto);
        if (operador?.id && caixaAberto.operador_id === operador.id) {
          navigate({ to: "/pdv" });
        } else {
          navigate({ to: "/caixa" });
        }
        return;
      }

      navigate({ to: operador?.id ? "/pos" : "/caixa" });
    },
    [findCaixaAberto, navigate, operador?.id],
  );

  const ensureCanExit = useCallback(async () => {
    const caixaAberto = await findCaixaAberto();
    if (!caixaAberto) return true;
    console.warn("[CaixaExitGuard] ensureCanExit bloqueado", {
      motivo: CAIXA_EXIT_BLOCK_MESSAGE,
      id: caixaAberto.id,
      owner_id: caixaAberto.owner_id ?? user?.id ?? null,
      operador_id: caixaAberto.operador_id ?? null,
      terminal_id: caixaAberto.terminal_id ?? null,
    });
    await blockAndOpenFechamento();
    return false;
  }, [blockAndOpenFechamento, findCaixaAberto, user?.id]);

  const guardedSignOut = useCallback(
    async (signOut: () => Promise<void>) => {
      const canExit = await ensureCanExit();
      if (!canExit) return;
      await signOut();
    },
    [ensureCanExit],
  );

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasCaixaAbertoKnown && !caixaParaFechar) return;
      event.preventDefault();
      event.returnValue = CAIXA_EXIT_BLOCK_MESSAGE;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [caixaParaFechar, hasCaixaAbertoKnown]);

  useEffect(() => {
    if (!user) {
      setCaixaAbertoKnown(false, null, "effect-sem-usuario");
      return;
    }
    let alive = true;
    const refresh = () => {
      findCaixaAberto().catch(() => {
        if (!alive) return;
        console.warn("[CaixaExitGuard] falha ao atualizar trava de caixa");
        setCaixaAbertoKnown(false, null, "refresh-error");
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [findCaixaAberto, setCaixaAbertoKnown, user]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    listenDesktopCaixaCloseBlocked(async (message) => {
      await blockAndOpenFechamento(message);
    }).then((off) => {
      if (disposed) {
        off?.();
      } else {
        unlisten = off;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [blockAndOpenFechamento]);

  return (
    <CaixaExitGuardContext.Provider
      value={{
        ensureCanExit,
        guardedSignOut,
        blockAndOpenFechamento,
        markCaixaAberto,
        markCaixaFechado,
      }}
    >
      {children}
      {caixaParaFechar && (
        <FecharCaixaDialog
          open={!!caixaParaFechar}
          onOpenChange={(open) => {
            if (!open) {
              setCaixaParaFechar(null);
              queryClient.invalidateQueries({ queryKey: ["caixa"] });
              window.setTimeout(() => {
                void findCaixaAberto();
              }, 250);
            }
          }}
          caixaId={caixaParaFechar.id}
          resumo={resumoCaixa ?? null}
          onFechado={() => {
            markCaixaFechado();
          }}
        />
      )}
    </CaixaExitGuardContext.Provider>
  );
}

export function useCaixaExitGuard() {
  const ctx = useContext(CaixaExitGuardContext);
  if (!ctx) {
    throw new Error("useCaixaExitGuard deve ser usado dentro de <CaixaExitGuardProvider>");
  }
  return ctx;
}
