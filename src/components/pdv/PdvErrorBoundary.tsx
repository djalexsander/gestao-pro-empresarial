import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Boundary específico do PDV.
 *
 * Captura qualquer erro de render dentro do ambiente do caixa e mostra uma
 * tela de erro **dentro do próprio PDV**. NUNCA redireciona para o ERP.
 *
 * O operador pode:
 *  - tentar novamente (reset do boundary)
 *  - recarregar o app (mantém a sessão de caixa)
 *
 * Para sair do PDV é obrigatório fechar o caixa primeiro — esse fluxo é
 * controlado pelo header do PDV, não por este componente.
 */
export class PdvErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[PDV] erro capturado pelo boundary", error, info);
  }

  reset = () => this.setState({ error: null });

  reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <Card className="w-full max-w-md p-6">
            <div className="mb-4 flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h1 className="text-lg font-bold">Ocorreu um erro no PDV</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                O caixa continua aberto. Tente novamente ou recarregue a tela.
                Você não será enviado para fora do ambiente do PDV.
              </p>
            </div>

            <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted/50 p-2 text-[11px] text-muted-foreground">
              {this.state.error.message}
            </pre>

            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={this.reload}>
                <RefreshCw className="mr-1 h-4 w-4" /> Recarregar
              </Button>
              <Button className="flex-1" onClick={this.reset}>
                Tentar novamente
              </Button>
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
