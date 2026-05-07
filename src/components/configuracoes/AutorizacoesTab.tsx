import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck, Loader2, History, Plus, Eye, Ban, RotateCcw, Trash2, IdCard } from "lucide-react";
import { toast } from "sonner";
import {
  useAutorizacoesConfig,
  useSalvarAutorizacoesConfig,
  useAutorizacoesLog,
  useAutorizacaoCartoes,
  useSetCartaoAtivo,
  useExcluirCartaoAutorizacao,
  ACAO_LABELS,
  type AutorizacoesConfig,
} from "@/hooks/useAutorizacoes";
import { formatBRL } from "@/lib/mock-data";
import { CartaoAutorizacaoDialog } from "./CartaoAutorizacaoDialog";
import { NovoCartaoAutorizacaoDialog } from "./NovoCartaoAutorizacaoDialog";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import { useConfigEmpresa } from "@/hooks/useConfigEmpresa";

const ACOES: Array<{ key: keyof AutorizacoesConfig; label: string; desc: string }> = [
  { key: "exigir_fechar_caixa_divergencia", label: "Fechar caixa com divergência", desc: "Quando o valor contado difere do esperado." },
  { key: "exigir_fechar_caixa_qualquer", label: "Fechar qualquer caixa", desc: "Mesmo sem divergência." },
  { key: "exigir_remover_item_venda", label: "Remover item da venda", desc: "Antes de finalizar a venda." },
  { key: "exigir_cancelar_venda", label: "Cancelar venda", desc: "Cancelamento após finalização." },
  { key: "exigir_cancelar_compra", label: "Cancelar compra", desc: "Cancelamento de compras de fornecedor." },
  { key: "exigir_excluir_lancamento_financeiro", label: "Excluir lançamento financeiro", desc: "Contas a pagar/receber." },
  { key: "exigir_alterar_valor_confirmado", label: "Alterar valor já confirmado", desc: "Valores em lançamentos pagos/recebidos." },
  { key: "exigir_reabrir_caixa", label: "Reabrir caixa fechado", desc: "Volta caixa para aberto." },
];

const PAPEIS_OPCOES = ["admin", "gerente", "financeiro"] as const;

export function AutorizacoesTab() {
  const { data: cfg, isLoading } = useAutorizacoesConfig();
  const salvar = useSalvarAutorizacoesConfig();
  const { data: logs = [] } = useAutorizacoesLog(50);
  const { papel, empresaAtual } = useEmpresaAtual();
  const { data: empresaCfg } = useConfigEmpresa();

  const podeGerenciarCartao = papel === "owner" || papel === "admin";
  const empresaNome =
    empresaCfg?.nome_fantasia || empresaCfg?.razao_social || empresaAtual?.nome || "";

  const [local, setLocal] = useState<Partial<AutorizacoesConfig>>({});
  const [senhaNova, setSenhaNova] = useState("");
  const [codigoNovo, setCodigoNovo] = useState("");
  const [labelQR, setLabelQR] = useState("");
  const [codigoGerado, setCodigoGerado] = useState<string | null>(null);
  const [showCartao, setShowCartao] = useState(false);

  useEffect(() => {
    if (cfg) {
      setLocal(cfg);
      setLabelQR(cfg.codigo_qr_label ?? "");
    }
  }, [cfg]);

  if (isLoading || !cfg) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const set = <K extends keyof AutorizacoesConfig>(k: K, v: AutorizacoesConfig[K]) =>
    setLocal((p) => ({ ...p, [k]: v }));

  const togglePapel = (p: string, on: boolean) => {
    const atuais = new Set((local.papeis_autorizadores ?? []) as string[]);
    if (on) atuais.add(p); else atuais.delete(p);
    set("papeis_autorizadores", Array.from(atuais) as AutorizacoesConfig["papeis_autorizadores"]);
  };

  function handleGerarCodigo() {
    if (!podeGerenciarCartao) {
      toast.error("Apenas dono ou admin pode gerar o cartão.");
      return;
    }
    const novo = gerarCodigoSeguro();
    setCodigoGerado(novo);
    setCodigoNovo(novo);
    setShowCartao(true);
    toast.success("Código gerado. Salve as configurações para ativá-lo.");
  }

  async function handleSalvar() {
    const payload: Record<string, unknown> = { ...local, codigo_qr_label: labelQR };
    if (senhaNova) payload.senha_master_nova = senhaNova;
    if (codigoNovo) payload.codigo_qr_novo = codigoNovo;
    const codigoAlterado = !!codigoNovo;
    try {
      await salvar.mutateAsync(payload);
      setSenhaNova(""); setCodigoNovo("");
      toast.success("Autorizações atualizadas.");
      if (codigoAlterado) {
        try {
          const { data: u } = await supabase.auth.getUser();
          await supabase.from("audit_logs").insert({
            actor_id: u.user?.id ?? null,
            actor_email: u.user?.email ?? null,
            action: "autorizacoes.codigo_qr.alterado",
            target_type: "autorizacoes_config",
            metadata: { label: labelQR, empresa: empresaNome },
          });
        } catch {/* noop */}
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Autorizações Gerenciais
          </CardTitle>
          <CardDescription>
            Defina quais ações críticas exigem autorização de gerente/admin/dono e como autorizar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Métodos de autorização</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <ToggleCard label="PIN do gerente" desc="Funcionário autorizador digita o PIN."
                checked={!!local.metodo_pin_habilitado}
                onChange={(v) => set("metodo_pin_habilitado", v)} />
              <ToggleCard label="Senha master" desc="Senha única definida pelo dono."
                checked={!!local.metodo_senha_master_habilitado}
                onChange={(v) => set("metodo_senha_master_habilitado", v)} />
              <ToggleCard label="Código de barras / QR" desc="Cartão impresso lido pelo scanner."
                checked={!!local.metodo_codigo_qr_habilitado}
                onChange={(v) => set("metodo_codigo_qr_habilitado", v)} />
            </div>

            {local.metodo_senha_master_habilitado && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <Label className="text-xs">Senha master {cfg.senha_master_hash && <Badge variant="secondary" className="ml-1 text-[10px]">já definida</Badge>}</Label>
                <Input type="password" value={senhaNova} onChange={(e) => setSenhaNova(e.target.value)}
                  placeholder={cfg.senha_master_hash ? "Deixe em branco para manter atual" : "Defina uma senha"} className="mt-1" />
              </div>
            )}
            {local.metodo_codigo_qr_habilitado && (
              <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Rótulo do código (ex: "Cartão Gerente")</Label>
                    <Input value={labelQR} onChange={(e) => setLabelQR(e.target.value)} className="mt-1" disabled={!podeGerenciarCartao} />
                  </div>
                  <div>
                    <Label className="text-xs">
                      Código de autorização{" "}
                      {(cfg.codigo_qr_hash || codigoNovo) && (
                        <Badge variant="secondary" className="ml-1 text-[10px]">já definido</Badge>
                      )}
                    </Label>
                    <Input
                      value={codigoNovo}
                      onChange={(e) => setCodigoNovo(e.target.value)}
                      placeholder={cfg.codigo_qr_hash ? "Use 'Gerar código' ou cole um novo" : "Gere ou cole um código"}
                      className="mt-1 font-mono"
                      disabled={!podeGerenciarCartao}
                      type={codigoNovo ? "text" : "text"}
                    />
                  </div>
                </div>
                {podeGerenciarCartao ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={handleGerarCodigo}>
                      <KeyRound className="mr-2 h-4 w-4" /> Gerar código
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!codigoNovo && !codigoGerado}
                      onClick={() => setShowCartao(true)}
                      title={!codigoNovo && !codigoGerado ? "Gere um código primeiro" : undefined}
                    >
                      <Eye className="mr-2 h-4 w-4" /> Visualizar cartão
                    </Button>
                    <p className="w-full text-[11px] text-muted-foreground">
                      Após salvar, o código fica armazenado de forma segura (hash) e não pode ser visualizado novamente — apenas regerado.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Apenas dono ou admin pode gerar, visualizar ou imprimir o cartão de autorização.
                  </p>
                )}
              </div>
            )}
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Papéis que podem autorizar</h3>
            <div className="flex flex-wrap gap-3">
              {PAPEIS_OPCOES.map((p) => {
                const on = ((local.papeis_autorizadores ?? []) as string[]).includes(p);
                return (
                  <label key={p} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <Switch checked={on} onCheckedChange={(v) => togglePapel(p, v)} />
                    <span className="capitalize">{p}</span>
                  </label>
                );
              })}
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ações que exigem autorização</h3>
            <div className="grid gap-2">
              {ACOES.map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <Switch
                    checked={!!(local as any)[key]}
                    onCheckedChange={(v) => set(key, v as never)}
                  />
                </div>
              ))}
            </div>
          </section>

          <div className="flex justify-end">
            <Button onClick={handleSalvar} disabled={salvar.isPending}>
              {salvar.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...</> : "Salvar configurações"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" /> Histórico de autorizações
          </CardTitle>
          <CardDescription>Últimos {logs.length} registros.</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma autorização registrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={l.status === "autorizado" ? "default" : "destructive"} className="text-[10px]">
                        {l.status}
                      </Badge>
                      <span className="font-medium">{ACAO_LABELS[l.acao]}</span>
                      <span className="text-xs text-muted-foreground">via {l.metodo}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{l.contexto}</p>
                    {l.motivo_negacao && <p className="mt-1 text-xs text-destructive">Motivo: {l.motivo_negacao}</p>}
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    {l.autorizador_nome && <p className="font-medium text-foreground">{l.autorizador_nome}</p>}
                    {l.diferenca_caixa != null && <p>Dif: {formatBRL(l.diferenca_caixa)}</p>}
                    <p>{new Date(l.created_at).toLocaleString("pt-BR")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CartaoAutorizacaoDialog
        open={showCartao}
        onOpenChange={setShowCartao}
        codigo={codigoGerado ?? codigoNovo}
        label={labelQR || "Cartão Gerente"}
        empresaNome={empresaNome}
      />
    </div>
  );
}

function ToggleCard({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
