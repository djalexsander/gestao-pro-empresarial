import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  CircleDashed,
  Download,
  FileImage,
  FileText,
  PlayCircle,
  Flag,
  History,
  ExternalLink,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  calcularResumoQa,
  uploadQaEvidencia,
  getQaEvidenciaSignedUrl,
  useCriarValidacao,
  useFinalizarValidacao,
  useQaAvaliacoes,
  useQaItens,
  useQaModulos,
  useQaValidacaoAtiva,
  useQaValidacoes,
  useSalvarAvaliacao,
  type QaItem,
  type QaResumoStatus,
  type QaStatusAvaliacao,
} from "@/hooks/useQa";
import { exportarRelatorioQaPDF, exportarRelatorioQaPNG } from "@/lib/export-qa";

export const Route = createFileRoute("/admin/qa")({
  head: () => ({
    meta: [
      { title: "QA do Sistema — Master" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QaPage,
});

const STATUS_OPTIONS: { value: QaStatusAvaliacao; label: string; tone: string }[] = [
  { value: "nao_testado", label: "Não testado", tone: "text-muted-foreground" },
  { value: "ok", label: "OK", tone: "text-success" },
  { value: "leve", label: "Problema leve", tone: "text-warning" },
  { value: "medio", label: "Problema médio", tone: "text-warning" },
  { value: "critico", label: "Problema crítico", tone: "text-destructive" },
];

function statusBadge(s: QaResumoStatus["statusLancamento"]) {
  if (s === "pronto")
    return (
      <Badge className="gap-1 bg-success text-success-foreground">
        <CheckCircle2 className="h-3.5 w-3.5" /> Pronto para lançamento
      </Badge>
    );
  if (s === "ressalvas")
    return (
      <Badge className="gap-1 bg-warning text-warning-foreground">
        <AlertTriangle className="h-3.5 w-3.5" /> Pronto com ressalvas
      </Badge>
    );
  if (s === "nao_recomendado")
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldAlert className="h-3.5 w-3.5" /> Não recomendado
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <CircleDashed className="h-3.5 w-3.5" /> Indefinido
    </Badge>
  );
}

function QaPage() {
  const { data: modulos = [] } = useQaModulos();
  const { data: itens = [] } = useQaItens();
  const { data: validacoes = [] } = useQaValidacoes();
  const { data: ativa } = useQaValidacaoAtiva();
  const { data: avaliacoes = [] } = useQaAvaliacoes(ativa?.id);

  const criar = useCriarValidacao();
  const finalizar = useFinalizarValidacao();

  const [criandoOpen, setCriandoOpen] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [finalizarOpen, setFinalizarOpen] = useState(false);
  const [obsFinal, setObsFinal] = useState("");


  const resumo = useMemo(() => calcularResumoQa(itens, avaliacoes), [itens, avaliacoes]);

  const itensCriticos = useMemo(() => itens.filter((i) => i.critico), [itens]);
  const resumoCriticos = useMemo(
    () => calcularResumoQa(itensCriticos, avaliacoes),
    [itensCriticos, avaliacoes],
  );

  const onPDF = () => {
    if (!ativa) return toast.error("Inicie uma rodada de validação.");
    exportarRelatorioQaPDF({
      validacao: ativa,
      modulos,
      itens,
      avaliacoes,
      resumo,
    });
  };
  const onPNG = async () => {
    if (!ativa) return toast.error("Inicie uma rodada de validação.");
    await exportarRelatorioQaPNG({ validacao: ativa, modulos, itens, avaliacoes, resumo });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="QA do Sistema"
        description="Validação de lançamento — checklist de prontidão para uso comercial."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ativa ? (
              <>
                <Badge variant="outline" className="gap-1.5">
                  <PlayCircle className="h-3.5 w-3.5" /> Rodada ativa: {ativa.titulo}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setObsFinal("");
                    setFinalizarOpen(true);
                  }}
                >
                  <Flag className="mr-1.5 h-4 w-4" /> Finalizar rodada
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setCriandoOpen(true)}>
                <PlayCircle className="mr-1.5 h-4 w-4" /> Iniciar nova validação
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!ativa}>
                  <Download className="mr-1.5 h-4 w-4" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onPDF} className="gap-2">
                  <FileText className="h-4 w-4" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onPNG} className="gap-2">
                  <FileImage className="h-4 w-4" /> PNG
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div ref={reportRef} className="space-y-6">
        {/* Visão geral */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Conclusão" value={`${resumo.pctConcluido}%`} progress={resumo.pctConcluido} />
          <KpiCard label="OK" value={String(resumo.ok)} tone="success" />
          <KpiCard
            label="Problemas"
            value={String(resumo.leve + resumo.medio + resumo.critico)}
            tone="warning"
          />
          <KpiCard label="Não testados" value={String(resumo.naoTestado)} tone="muted" />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Status final de lançamento</span>
              {statusBadge(resumo.statusLancamento)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <SubBox titulo="Geral" resumo={resumo} />
              <SubBox titulo="Apenas testes críticos" resumo={resumoCriticos} destacarCriticos />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Última atividade:{" "}
              {ativa
                ? new Date(ativa.iniciada_em).toLocaleString("pt-BR")
                : "—"}{" "}
              · Responsável: {ativa?.responsavel_nome ?? "—"}
            </p>
          </CardContent>
        </Card>

        <Tabs defaultValue="checklist" className="space-y-4">
          <TabsList>
            <TabsTrigger value="checklist">Checklist por módulo</TabsTrigger>
            <TabsTrigger value="criticos">Testes críticos</TabsTrigger>
            <TabsTrigger value="historico">
              <History className="mr-1.5 h-3.5 w-3.5" /> Histórico
            </TabsTrigger>
          </TabsList>

          <TabsContent value="checklist" className="space-y-4">
            {!ativa && (
              <EmptyAtiva onIniciar={() => setCriandoOpen(true)} />
            )}
            {ativa &&
              modulos.map((mod) => {
                const itensMod = itens.filter((i) => i.modulo_id === mod.id);
                if (itensMod.length === 0) return null;
                return (
                  <ModuloBloco
                    key={mod.id}
                    nome={mod.nome}
                    descricao={mod.descricao}
                    itens={itensMod}
                    avaliacoes={avaliacoes}
                    validacaoId={ativa.id}
                  />
                );
              })}
          </TabsContent>

          <TabsContent value="criticos">
            {!ativa ? (
              <EmptyAtiva onIniciar={() => setCriandoOpen(true)} />
            ) : (
              <ModuloBloco
                nome="Testes críticos para lançamento"
                descricao="Bloqueiam o lançamento se não estiverem OK."
                itens={itensCriticos}
                avaliacoes={avaliacoes}
                validacaoId={ativa.id}
              />
            )}
          </TabsContent>

          <TabsContent value="historico">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Validações anteriores</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      <TableHead>Responsável</TableHead>
                      <TableHead>Início</TableHead>
                      <TableHead>Fim</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validacoes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                          Nenhuma rodada registrada.
                        </TableCell>
                      </TableRow>
                    ) : (
                      validacoes.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="font-medium">{v.titulo}</TableCell>
                          <TableCell>{v.responsavel_nome ?? "—"}</TableCell>
                          <TableCell>{new Date(v.iniciada_em).toLocaleString("pt-BR")}</TableCell>
                          <TableCell>
                            {v.finalizada_em
                              ? new Date(v.finalizada_em).toLocaleString("pt-BR")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {v.status === "em_andamento" ? (
                              <Badge variant="outline">Em andamento</Badge>
                            ) : (
                              <Badge>Finalizada</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Diálogo: nova rodada */}
      <Dialog open={criandoOpen} onOpenChange={setCriandoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Iniciar nova rodada de validação</DialogTitle>
            <DialogDescription>
              Cada rodada salva um snapshot independente das avaliações.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Título</label>
            <Input
              value={novoTitulo}
              onChange={(e) => setNovoTitulo(e.target.value)}
              placeholder={`QA ${new Date().toLocaleDateString("pt-BR")}`}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCriandoOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                const titulo = novoTitulo.trim() || `QA ${new Date().toLocaleDateString("pt-BR")}`;
                await criar.mutateAsync({ titulo });
                setNovoTitulo("");
                setCriandoOpen(false);
              }}
              disabled={criar.isPending}
            >
              Iniciar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: finalizar */}
      <Dialog open={finalizarOpen} onOpenChange={setFinalizarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar rodada</DialogTitle>
            <DialogDescription>
              Status final: {statusBadge(resumo.statusLancamento)}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Observação final (opcional)…"
            value={obsFinal}
            onChange={(e) => setObsFinal(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizarOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!ativa) return;
                await finalizar.mutateAsync({
                  id: ativa.id,
                  observacao: obsFinal || undefined,
                  resumo: resumo as unknown as Record<string, unknown>,
                });
                setFinalizarOpen(false);
              }}
              disabled={finalizar.isPending}
            >
              Finalizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================== Sub-componentes ============================== */

function KpiCard({
  label,
  value,
  tone,
  progress,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "muted";
  progress?: number;
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "muted"
          ? "text-muted-foreground"
          : "";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 font-mono text-2xl font-semibold tabular-nums", toneCls)}>{value}</p>
        {typeof progress === "number" && <Progress value={progress} className="mt-2 h-1.5" />}
      </CardContent>
    </Card>
  );
}

function SubBox({
  titulo,
  resumo,
  destacarCriticos,
}: {
  titulo: string;
  resumo: QaResumoStatus;
  destacarCriticos?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <Pill label="OK" valor={resumo.ok} tone="success" />
        <Pill label="Leve" valor={resumo.leve} tone="warning" />
        <Pill label="Médio" valor={resumo.medio} tone="warning" />
        <Pill label="Crítico" valor={resumo.critico} tone="danger" forte={destacarCriticos} />
        <Pill label="N/T" valor={resumo.naoTestado} tone="muted" />
        <Pill label="Total" valor={resumo.total} tone="muted" />
      </div>
      <Progress value={resumo.pctConcluido} className="mt-3 h-1.5" />
    </div>
  );
}

function Pill({
  label,
  valor,
  tone,
  forte,
}: {
  label: string;
  valor: number;
  tone: "success" | "warning" | "danger" | "muted";
  forte?: boolean;
}) {
  const cls = {
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    danger: forte && valor > 0 ? "bg-destructive text-destructive-foreground" : "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <div className={cn("flex items-center justify-between rounded px-2 py-1 font-medium", cls)}>
      <span>{label}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  );
}

function EmptyAtiva({ onIniciar }: { onIniciar: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <CircleDashed className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Nenhuma rodada de validação em andamento.
        </p>
        <Button onClick={onIniciar}>
          <PlayCircle className="mr-1.5 h-4 w-4" /> Iniciar agora
        </Button>
      </CardContent>
    </Card>
  );
}

function ModuloBloco({
  nome,
  descricao,
  itens,
  avaliacoes,
  validacaoId,
}: {
  nome: string;
  descricao: string | null;
  itens: QaItem[];
  avaliacoes: ReturnType<typeof useQaAvaliacoes>["data"] extends infer T
    ? T extends Array<infer U>
      ? U[]
      : never
    : never;
  validacaoId: string;
}) {
  const mapAv = useMemo(
    () => new Map(avaliacoes.map((a) => [a.item_id, a])),
    [avaliacoes],
  );
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{nome}</CardTitle>
        {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {itens.map((it) => (
          <ItemLinha
            key={it.id}
            item={it}
            avaliacao={mapAv.get(it.id) ?? null}
            validacaoId={validacaoId}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ItemLinha({
  item,
  avaliacao,
  validacaoId,
}: {
  item: QaItem;
  avaliacao: ReturnType<typeof useQaAvaliacoes>["data"] extends infer T
    ? T extends Array<infer U>
      ? U | null
      : null
    : null;
  validacaoId: string;
}) {
  const salvar = useSalvarAvaliacao();
  const [obs, setObs] = useState(avaliacao?.observacao ?? "");
  const [evidencia, setEvidencia] = useState<string | null>(avaliacao?.evidencia_url ?? null);
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const status = (avaliacao?.status ?? "nao_testado") as QaStatusAvaliacao;
  const opt = STATUS_OPTIONS.find((o) => o.value === status)!;

  const onChangeStatus = async (next: QaStatusAvaliacao) => {
    await salvar.mutateAsync({
      validacao_id: validacaoId,
      item_id: item.id,
      status: next,
      observacao: obs || null,
      evidencia_url: evidencia,
    });
  };

  const onChangeObs = async () => {
    await salvar.mutateAsync({
      validacao_id: validacaoId,
      item_id: item.id,
      status,
      observacao: obs || null,
      evidencia_url: evidencia,
    });
  };

  const onUpload = async (file: File) => {
    try {
      setEnviando(true);
      const path = await uploadQaEvidencia(file, validacaoId);
      setEvidencia(path);
      await salvar.mutateAsync({
        validacao_id: validacaoId,
        item_id: item.id,
        status,
        observacao: obs || null,
        evidencia_url: path,
      });
      toast.success("Evidência anexada.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const onAbrirEvidencia = async () => {
    if (!evidencia) return;
    const url = await getQaEvidenciaSignedUrl(evidencia);
    if (url) window.open(url, "_blank");
    else toast.error("Não foi possível abrir a evidência.");
  };

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{item.titulo}</p>
            {item.critico && (
              <Badge variant="outline" className="border-destructive/50 text-destructive">
                Crítico
              </Badge>
            )}
            <Badge variant="secondary" className="capitalize">
              {item.severidade === "critico" ? "Severidade alta" : item.severidade === "medio" ? "Severidade média" : "Severidade baixa"}
            </Badge>
            {item.rota_link && (
              <Link
                to={item.rota_link}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Abrir tela <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
          {item.descricao && (
            <p className="mt-1 text-xs text-muted-foreground">{item.descricao}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-medium", opt.tone)}>{opt.label}</span>
          <Select value={status} onValueChange={(v) => onChangeStatus(v as QaStatusAvaliacao)}>
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
        <Textarea
          placeholder="Observação / evidência textual…"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          onBlur={() => {
            if ((avaliacao?.observacao ?? "") !== obs) void onChangeObs();
          }}
          rows={2}
          className="text-sm"
        />
        <div className="flex flex-col items-stretch gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={enviando}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {enviando ? "Enviando…" : evidencia ? "Trocar print" : "Anexar print"}
          </Button>
          {evidencia && (
            <Button variant="ghost" size="sm" onClick={onAbrirEvidencia}>
              <FileImage className="mr-1.5 h-3.5 w-3.5" /> Ver
            </Button>
          )}
        </div>
      </div>

      {avaliacao?.testado_por_nome && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Por {avaliacao.testado_por_nome} ·{" "}
          {avaliacao.testado_em ? new Date(avaliacao.testado_em).toLocaleString("pt-BR") : "—"}
        </p>
      )}
    </div>
  );
}
