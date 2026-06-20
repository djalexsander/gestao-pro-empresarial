import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperador } from "@/components/auth/OperadorProvider";
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
}

const CaixaExitGuardContext = createContext<CaixaExitGuardContextValue | null>(null);

export function CaixaExitGuardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { operador } = useOperador();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [caixaParaFechar, setCaixaParaFechar] = useState<Caixa | null>(null);
  const [hasCaixaAbertoKnown, setHasCaixaAbertoKnown] = useState(false);
  const { data: resumoCaixa } = useCaixaResumo(caixaParaFechar?.id);

  const findCaixaAberto = useCallback(async (): Promise<Caixa | "desktop-known" | null> => {
    const desktopOpen = await hasDesktopCaixaAberto();
    if (!user && !desktopOpen) return null;

    const operadorId = operador?.id ?? null;
    const [caixaOperador, qualquerCaixa] = await Promise.all([
      user && operadorId
        ? dataClient.caixa.aberto({ operador_id: operadorId }).catch(() => null)
        : Promise.resolve(null),
      user
        ? dataClient.caixa.aberto({ qualquer: true }).catch(() => null)
        : Promise.resolve(null),
    ]);

    const caixaAberto = caixaOperador ?? qualquerCaixa ?? (!user && desktopOpen ? "desktop-known" : null);
    setHasCaixaAbertoKnown(!!caixaAberto);
    void setDesktopCaixaExitGuard(!!caixaAberto);
    return caixaAberto;
  }, [operador?.id, user]);

  const blockAndOpenFechamento = useCallback(
    async (message = CAIXA_EXIT_BLOCK_MESSAGE) => {
      toast.error(message);
      const caixaAberto = await findCaixaAberto();

      if (caixaAberto && caixaAberto !== "desktop-known") {
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
    await blockAndOpenFechamento();
    return false;
  }, [blockAndOpenFechamento, findCaixaAberto]);

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
      let alive = true;
      hasDesktopCaixaAberto()
        .then((desktopOpen) => {
          if (!alive) return;
          const hasOpen = !!desktopOpen;
          setHasCaixaAbertoKnown(hasOpen);
          void setDesktopCaixaExitGuard(hasOpen);
        })
        .catch(() => {
          if (!alive) return;
          setHasCaixaAbertoKnown(false);
          void setDesktopCaixaExitGuard(false);
        });
      return () => {
        alive = false;
      };
    }
    let alive = true;
    const refresh = () => {
      findCaixaAberto().catch(() => {
        if (alive) setHasCaixaAbertoKnown(false);
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
  }, [findCaixaAberto, user]);

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
      value={{ ensureCanExit, guardedSignOut, blockAndOpenFechamento }}
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
            setHasCaixaAbertoKnown(false);
            void setDesktopCaixaExitGuard(false);
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
