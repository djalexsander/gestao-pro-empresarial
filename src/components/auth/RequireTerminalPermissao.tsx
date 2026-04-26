import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ShieldAlert, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { useTerminais } from "@/hooks/useTerminais";

/**
 * Tipos de área que o terminal pode acessar.
 * Mapeiam diretamente para colunas booleanas em `terminais`.
 */
export type AreaTerminal =
  | "pdv"
  | "erp"
  | "financeiro"
  | "configuracoes"
  | "relatorios"
  | "cadastros";

/**
 * Bloqueia o conteúdo se o terminal atual (selecionado neste dispositivo)
 * não tiver a permissão da área exigida.
 *
 * Se NENHUM terminal foi selecionado neste dispositivo, deixa passar
 * (assumindo que é um navegador "do administrador" sem vínculo a caixa).
 *
 * Se o terminal selecionado não tem a permissão, mostra tela amigável
 * pedindo para o admin liberar em Configurações → Terminais.
 */
export function RequireTerminalPermissao({
  area,
  children,
}: {
  area: AreaTerminal;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { terminal } = useTerminal();
  const { data: terminais = [], isLoading } = useTerminais();

  // Sem terminal vinculado neste dispositivo → considera "máquina admin"
  // e libera. A partir do momento em que o admin vincula um terminal, as
  // restrições passam a valer.
  if (!terminal) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const t = terminais.find((x) => x.id === terminal.id);
  const podeKey = `pode_${area}` as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const podeAcessar = (t as any)?.[podeKey] === true;

  // Servidor principal sempre pode (failsafe)
  const isServidor = t?.papel === "servidor";

  if (!t || (!podeAcessar && !isServidor)) {
    return <BloqueioArea area={area} terminalNome={terminal.nome} />;
  }

  return <>{children}</>;

  // helper inline para evitar usar navigate fora do componente
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _voltar() {
    navigate({ to: "/hub" });
  }
}

function BloqueioArea({
  area,
  terminalNome,
}: {
  area: AreaTerminal;
  terminalNome: string;
}) {
  const navigate = useNavigate();
  const titulos: Record<AreaTerminal, string> = {
    pdv: "PDV / Caixa",
    erp: "ERP",
    financeiro: "Financeiro",
    configuracoes: "Configurações",
    relatorios: "Relatórios",
    cadastros: "Cadastros",
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold">Acesso restrito neste terminal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O terminal <strong>{terminalNome}</strong> não tem permissão para
          acessar a área <strong>{titulos[area]}</strong>.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Peça ao administrador para liberar em{" "}
          <em>Configurações → Terminais → Permissões</em>, ou utilize o
          terminal Servidor principal.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/hub" })}>
            Voltar ao Hub
          </Button>
          <Button onClick={() => navigate({ to: "/pos" })}>
            Ir para o PDV
          </Button>
        </div>
      </Card>
    </div>
  );
}
