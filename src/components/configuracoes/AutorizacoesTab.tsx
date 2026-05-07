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
  const { papel } = useEmpresaAtual();
  const { data: empresaCfg } = useConfigEmpresa();
  const { data: cartoes = [], isLoading: loadingCartoes } = useAutorizacaoCartoes();
  const setAtivo = useSetCartaoAtivo();
  const excluirCartao = useExcluirCartaoAutorizacao();

  const podeGerenciarCartao = papel === "owner" || papel === "admin";
  const empresaNome =
    empresaCfg?.nome_fantasia || empresaCfg?.razao_social || "";

  const [local, setLocal] = useState<Partial<AutorizacoesConfig>>({});
  const [senhaNova, setSenhaNova] = useState("");
  const [showNovoCartao, setShowNovoCartao] = useState(false);
  const [cartaoRecemCriado, setCartaoRecemCriado] = useState<{ codigo: string; rotulo: string } | null>(null);

  useEffect(() => {
    if (cfg) setLocal(cfg);
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

  async function handleSalvar() {
    const payload: Record<string, unknown> = { ...local };
    if (senhaNova) payload.senha_master_nova = senhaNova;
    try {
      await salvar.mutateAsync(payload);
      setSenhaNova("");
      toast.success("Autorizações atualizadas.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleRevogar(id: string, ativo: boolean) {
    try {
      await setAtivo.mutateAsync({ id, ativo: !ativo });
      toast.success(ativo ? "Cartão revogado." : "Cartão reativado.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleExcluirCartao(id: string) {
    if (!confirm("Excluir cartão definitivamente? Essa ação não pode ser desfeita.")) return;
    try {
      await excluirCartao.mutateAsync(id);
      toast.success("Cartão excluído.");
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
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2">
                      <IdCard className="h-4 w-4" /> Cartões de autorização
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Cada cartão tem código único vinculado a um autorizador específico. O código completo só é exibido uma vez.
                    </p>
                  </div>
                  {podeGerenciarCartao && (
                    <Button type="button" size="sm" onClick={() => setShowNovoCartao(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Novo cartão
                    </Button>
                  )}
                </div>

                {loadingCartoes ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : cartoes.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">Nenhum cartão cadastrado ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {cartoes.map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background p-2 text-sm">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.rotulo}</span>
                            {c.ativo ? (
                              <Badge variant="default" className="text-[10px]">ativo</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">revogado</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {c.funcionario_nome
                              ? `Funcionário: ${c.funcionario_nome}`
                              : c.user_id
                              ? "Membro vinculado"
                              : "Genérico (sem vínculo)"}
                            {c.funcao && ` · ${c.funcao}`}
                            {" · criado em "}
                            {new Date(c.created_at).toLocaleDateString("pt-BR")}
                            {c.usado_em && ` · último uso ${new Date(c.usado_em).toLocaleDateString("pt-BR")}`}
                          </p>
                        </div>
                        {podeGerenciarCartao && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => handleRevogar(c.id, c.ativo)} title={c.ativo ? "Revogar" : "Reativar"}>
                              {c.ativo ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleExcluirCartao(c.id)} title="Excluir">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!podeGerenciarCartao && (
                  <p className="text-[11px] text-muted-foreground">
                    Apenas dono ou admin pode gerenciar cartões de autorização.
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

      <NovoCartaoAutorizacaoDialog
        open={showNovoCartao}
        onOpenChange={setShowNovoCartao}
        onCriado={(d) => setCartaoRecemCriado(d)}
      />

      <CartaoAutorizacaoDialog
        open={!!cartaoRecemCriado}
        onOpenChange={(v) => { if (!v) setCartaoRecemCriado(null); }}
        codigo={cartaoRecemCriado?.codigo ?? ""}
        label={cartaoRecemCriado?.rotulo ?? "Cartão"}
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
