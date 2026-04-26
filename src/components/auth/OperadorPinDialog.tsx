import { useEffect, useState } from "react";
import { Loader2, KeyRound, User as UserIcon, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useFuncionariosAtivos, validarPinOperador, type Funcionario } from "@/hooks/useFuncionarios";
import { useOperador } from "./OperadorProvider";

interface Props {
  /** Quando informado, ao concluir navega para esta rota. */
  onSuccess?: () => void;
}

export function OperadorPinSelector({ onSuccess }: Props) {
  const { setOperador } = useOperador();
  const { data: funcionarios = [], isLoading } = useFuncionariosAtivos();
  const [selecionado, setSelecionado] = useState<Funcionario | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPin("");
  }, [selecionado]);

  async function confirmar() {
    if (!selecionado || pin.length < 4) return;
    setBusy(true);
    try {
      const op = await validarPinOperador(selecionado.id, pin);
      setOperador(op);
      toast.success(`Bem-vindo, ${op.nome}!`);
      onSuccess?.();
    } catch (e) {
      toast.error((e as Error).message || "PIN incorreto.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  // Captura teclado físico (numérico/normal) quando operador já foi selecionado
  useEffect(() => {
    if (!selecionado || busy) return;

    const handler = (e: KeyboardEvent) => {
      // Ignora se o usuário estiver digitando em outro input
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        setPin((prev) => (prev.length < 6 ? prev + e.key : prev));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        void confirmar();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPin("");
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionado, busy, pin]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (funcionarios.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum operador cadastrado. Acesse <strong>Configurações → Funcionários</strong> para
          cadastrar operadores de caixa.
        </p>
      </Card>
    );
  }

  if (!selecionado) {
    return (
      <div className="space-y-3">
        <p className="text-center text-sm text-muted-foreground">
          Selecione o operador
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {funcionarios.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelecionado(f)}
              className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary hover:bg-accent"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                <UserIcon className="h-6 w-6" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">{f.nome}</p>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {f.role}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" />
        </div>
        <p className="text-lg font-semibold">{selecionado.nome}</p>
        <p className="text-xs text-muted-foreground">Digite seu PIN</p>
      </div>

      <div className="flex justify-center gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`h-3 w-3 rounded-full transition-colors ${
              i < pin.length ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>

      <div className="mx-auto grid max-w-xs grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <Button
            key={n}
            type="button"
            variant="outline"
            className="h-14 text-xl font-semibold"
            onClick={() => pin.length < 6 && setPin(pin + String(n))}
            disabled={busy}
          >
            {n}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-14 text-sm"
          onClick={() => setPin("")}
          disabled={busy || !pin.length}
        >
          Limpar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-14 text-xl font-semibold"
          onClick={() => pin.length < 6 && setPin(pin + "0")}
          disabled={busy}
        >
          0
        </Button>
        <Button
          type="button"
          className="h-14 text-sm"
          onClick={confirmar}
          disabled={busy || pin.length < 4}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
        </Button>
      </div>

      <Button
        variant="ghost"
        className="w-full"
        onClick={() => setSelecionado(null)}
        disabled={busy}
      >
        <ArrowLeft className="mr-2 h-4 w-4" /> Trocar operador
      </Button>
    </div>
  );
}
