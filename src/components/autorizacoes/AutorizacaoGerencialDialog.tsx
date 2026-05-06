import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldAlert, KeyRound, ScanLine, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  ACAO_LABELS,
  validarAutorizacao,
  useAutorizacoesConfig,
  type AutorizacaoAcao,
  type AutorizacaoMetodo,
} from "@/hooks/useAutorizacoes";
import { useFuncionariosAtivos } from "@/hooks/useFuncionarios";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { useOperador } from "@/components/auth/OperadorProvider";
import { formatBRL } from "@/lib/mock-data";

export interface AutorizacaoRequest {
  acao: AutorizacaoAcao;
  contexto: string;
  contexto_dados?: Record<string, unknown>;
  valor_envolvido?: number | null;
  diferenca_caixa?: number | null;
  referencia_tipo?: string | null;
  referencia_id?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: AutorizacaoRequest | null;
  onAutorizado: (info: { autorizador_nome: string | null }) => void;
}

export function AutorizacaoGerencialDialog({ open, onOpenChange, request, onAutorizado }: Props) {
  const { data: cfg } = useAutorizacoesConfig();
  const { data: funcionarios = [] } = useFuncionariosAtivos();
  const { terminal } = useTerminal();
  const { operador } = useOperador();

  const autorizadores = useMemo(() => {
    const papeis = new Set(cfg?.papeis_autorizadores ?? ["admin", "gerente"]);
    return funcionarios.filter((f) => papeis.has(f.role));
  }, [funcionarios, cfg]);

  const metodosDisponiveis: AutorizacaoMetodo[] = [];
  if (cfg?.metodo_pin_habilitado) metodosDisponiveis.push("pin_funcionario");
  if (cfg?.metodo_senha_master_habilitado) metodosDisponiveis.push("senha_master");
  if (cfg?.metodo_codigo_qr_habilitado) metodosDisponiveis.push("codigo_qr");

  const [tab, setTab] = useState<AutorizacaoMetodo>("pin_funcionario");
  const [funcionarioId, setFuncionarioId] = useState("");
  const [pin, setPin] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPin(""); setSenha(""); setCodigo("");
      setFuncionarioId(autorizadores[0]?.id ?? "");
      setTab(metodosDisponiveis[0] ?? "pin_funcionario");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!request) return null;

  async function submeter() {
    if (!request) return;
    setBusy(true);
    try {
      let payload: Record<string, string> = {};
      if (tab === "pin_funcionario") {
        if (!funcionarioId || pin.length < 4) { toast.error("Selecione o gerente e digite o PIN."); return; }
        payload = { funcionario_id: funcionarioId, pin };
      } else if (tab === "senha_master") {
        if (!senha) { toast.error("Digite a senha master."); return; }
        payload = { senha };
      } else {
        if (!codigo) { toast.error("Leia ou digite o código de autorização."); return; }
        payload = { codigo };
      }

      const res = await validarAutorizacao({
        acao: request.acao,
        metodo: tab,
        payload,
        contexto: request.contexto,
        contexto_dados: request.contexto_dados,
        valor_envolvido: request.valor_envolvido ?? null,
        diferenca_caixa: request.diferenca_caixa ?? null,
        referencia_tipo: request.referencia_tipo ?? null,
        referencia_id: request.referencia_id ?? null,
        solicitante_funcionario_id: operador?.id ?? null,
        terminal_id: terminal?.id ?? null,
      });

      if (res.autorizado) {
        toast.success(`Autorizado por ${res.autorizador_nome ?? "gerente"}.`);
        onAutorizado({ autorizador_nome: res.autorizador_nome });
        onOpenChange(false);
      } else {
        toast.error(res.motivo ?? "Autorização negada.");
        setPin(""); setSenha(""); setCodigo("");
      }
    } catch (e) {
      toast.error((e as Error).message ?? "Erro ao validar autorização.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">Autorização gerencial necessária</DialogTitle>
          <DialogDescription className="text-center">
            {ACAO_LABELS[request.acao]}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <p className="font-medium">{request.contexto}</p>
          {request.diferenca_caixa != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Diferença de caixa: <span className="font-mono">{formatBRL(request.diferenca_caixa)}</span>
            </p>
          )}
          {request.valor_envolvido != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Valor: <span className="font-mono">{formatBRL(request.valor_envolvido)}</span>
            </p>
          )}
        </div>

        {metodosDisponiveis.length === 0 ? (
          <p className="text-sm text-destructive">
            Nenhum método de autorização habilitado. Vá em Configurações → Autorizações Gerenciais.
          </p>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as AutorizacaoMetodo)}>
            <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${metodosDisponiveis.length}, 1fr)` }}>
              {metodosDisponiveis.includes("pin_funcionario") && (
                <TabsTrigger value="pin_funcionario"><KeyRound className="mr-1 h-3.5 w-3.5" />PIN</TabsTrigger>
              )}
              {metodosDisponiveis.includes("senha_master") && (
                <TabsTrigger value="senha_master"><Lock className="mr-1 h-3.5 w-3.5" />Senha</TabsTrigger>
              )}
              {metodosDisponiveis.includes("codigo_qr") && (
                <TabsTrigger value="codigo_qr"><ScanLine className="mr-1 h-3.5 w-3.5" />Código</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="pin_funcionario" className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label>Gerente autorizador</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={funcionarioId}
                  onChange={(e) => setFuncionarioId(e.target.value)}
                >
                  <option value="">— Selecione —</option>
                  {autorizadores.map((f) => (
                    <option key={f.id} value={f.id}>{f.nome} ({f.role})</option>
                  ))}
                </select>
                {autorizadores.length === 0 && (
                  <p className="text-xs text-destructive">Nenhum funcionário com papel autorizador cadastrado.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === "Enter") void submeter(); }}
                  placeholder="••••"
                  className="text-center font-mono text-lg tracking-widest"
                />
              </div>
            </TabsContent>

            <TabsContent value="senha_master" className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label>Senha master</Label>
                <Input
                  type="password"
                  autoFocus
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submeter(); }}
                  placeholder="Senha de autorização"
                />
              </div>
            </TabsContent>

            <TabsContent value="codigo_qr" className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label>Código de autorização (leitor ou digitação)</Label>
                <Input
                  autoFocus
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submeter(); }}
                  placeholder="Aproxime o leitor de código de barras/QR"
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  O leitor de código de barras digita o código e pressiona Enter automaticamente.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submeter} disabled={busy || metodosDisponiveis.length === 0}>
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Validando...</> : "Autorizar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
