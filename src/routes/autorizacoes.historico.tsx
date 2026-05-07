import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Loader2, Filter as FilterIcon, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACAO_LABELS,
  useAutorizacoesLog,
  type AutorizacaoAcao,
  type AutorizacaoMetodo,
} from "@/hooks/useAutorizacoes";
import { useFuncionariosAtivos } from "@/hooks/useFuncionarios";
import { formatBRL } from "@/lib/mock-data";

export const Route = createFileRoute("/autorizacoes/historico")({
  component: HistoricoAutorizacoesPage,
  head: () => ({
    meta: [{ title: "Histórico de autorizações" }],
  }),
});

const METODO_LABEL: Record<AutorizacaoMetodo, string> = {
  pin_funcionario: "PIN do gerente",
  senha_master: "Senha master",
  codigo_qr: "Cartão / QR",
};

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function HistoricoAutorizacoesPage() {
  const { data: funcionarios = [] } = useFuncionariosAtivos();

  const [inicio, setInicio] = useState(todayISO(-30));
  const [fim, setFim] = useState(todayISO(0));
  const [acao, setAcao] = useState<string>("todas");
  const [status, setStatus] = useState<string>("todos");
  const [metodo, setMetodo] = useState<string>("todos");
  const [autorizadorId, setAutorizadorId] = useState<string>("todos");
  const [solicitanteId, setSolicitanteId] = useState<string>("todos");
  const [texto, setTexto] = useState("");
  const [limit, setLimit] = useState(200);

  const filtro = useMemo(
    () => ({
      inicio: inicio ? new Date(inicio + "T00:00:00").toISOString() : null,
      fim: fim ? new Date(fim + "T23:59:59").toISOString() : null,
      acao: acao === "todas" ? null : (acao as AutorizacaoAcao),
      status: status === "todos" ? null : (status as "autorizado" | "negado"),
      metodo: metodo === "todos" ? null : (metodo as AutorizacaoMetodo),
      autorizador_funcionario_id: autorizadorId === "todos" ? null : autorizadorId,
      solicitante_funcionario_id: solicitanteId === "todos" ? null : solicitanteId,
      texto: texto.trim() || null,
      limit,
    }),
    [inicio, fim, acao, status, metodo, autorizadorId, solicitanteId, texto, limit],
  );

  const { data: logs = [], isLoading, refetch, isFetching } = useAutorizacoesLog(filtro);

  const totais = useMemo(() => {
    let aut = 0,
      neg = 0;
    for (const l of logs) {
      if (l.status === "autorizado") aut++;
      else neg++;
    }
    return { aut, neg, total: logs.length };
  }, [logs]);

  function exportarCSV() {
    const header = [
      "Data/Hora",
      "Status",
      "Ação",
      "Método",
      "Autorizador",
      "Solicitante",
      "Contexto",
      "Valor",
      "Diferença caixa",
      "Referência",
      "Motivo negação",
    ];
    const rows = logs.map((l) => [
      new Date(l.created_at).toLocaleString("pt-BR"),
      l.status,
      ACAO_LABELS[l.acao],
      METODO_LABEL[l.metodo],
      l.autorizador_nome ?? "",
      l.solicitante_nome ?? l.solicitante_funcionario_id ?? "",
      l.contexto.replace(/[\r\n;]/g, " "),
      l.valor_envolvido ?? "",
      l.diferenca_caixa ?? "",
      [l.referencia_tipo, l.referencia_id].filter(Boolean).join(":"),
      (l.motivo_negacao ?? "").replace(/[\r\n;]/g, " "),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autorizacoes-${inicio}_a_${fim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Histórico de autorizações"
        description="Quem autorizou, quem solicitou e o contexto de cada ação crítica."
        actions={
          <Button variant="outline" onClick={exportarCSV} disabled={logs.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FilterIcon className="h-4 w-4" /> Filtros
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Início</Label>
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fim</Label>
              <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="autorizado">Autorizado</SelectItem>
                  <SelectItem value="negado">Negado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Método</Label>
              <Select value={metodo} onValueChange={setMetodo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pin_funcionario">PIN do gerente</SelectItem>
                  <SelectItem value="senha_master">Senha master</SelectItem>
                  <SelectItem value="codigo_qr">Cartão / QR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ação</Label>
              <Select value={acao} onValueChange={setAcao}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {Object.entries(ACAO_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Autorizador</Label>
              <Select value={autorizadorId} onValueChange={setAutorizadorId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {funcionarios.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Solicitante</Label>
              <Select value={solicitanteId} onValueChange={setSolicitanteId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {funcionarios.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Buscar no contexto</Label>
              <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: venda 1234" />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="default">{totais.aut} autorizadas</Badge>
              <Badge variant="destructive">{totais.neg} negadas</Badge>
              <span>· total exibido: {totais.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Limite</Label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                  <SelectItem value="1000">1000</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma autorização encontrada para os filtros selecionados.
            </p>
          ) : (
            <div className="space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={l.status === "autorizado" ? "default" : "destructive"} className="text-[10px]">
                          {l.status}
                        </Badge>
                        <span className="font-medium">{ACAO_LABELS[l.acao]}</span>
                        <span className="text-xs text-muted-foreground">via {METODO_LABEL[l.metodo]}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{l.contexto}</p>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        {l.solicitante_nome && (
                          <span>Solicitante: <span className="text-foreground">{l.solicitante_nome}</span></span>
                        )}
                        {l.referencia_tipo && (
                          <span>Ref: {l.referencia_tipo}{l.referencia_id ? ` #${l.referencia_id}` : ""}</span>
                        )}
                        {l.valor_envolvido != null && <span>Valor: {formatBRL(l.valor_envolvido)}</span>}
                        {l.diferenca_caixa != null && <span>Dif: {formatBRL(l.diferenca_caixa)}</span>}
                      </div>
                      {l.motivo_negacao && (
                        <p className="mt-1 text-xs text-destructive">Motivo: {l.motivo_negacao}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      {l.autorizador_nome && (
                        <p className="font-medium text-foreground">{l.autorizador_nome}</p>
                      )}
                      <p>{new Date(l.created_at).toLocaleString("pt-BR")}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
