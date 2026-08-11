import { useEffect, useState } from "react";
import { SaveBar } from "./SaveBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Printer, RotateCcw, Loader2, AlertTriangle, Tag, Receipt, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  getReceiptPrinter,
  setReceiptPrinter,
  getReceiptWidthMm,
  setReceiptWidthMm,
  getReceiptPrintMode,
  setReceiptPrintMode,
  getLabelPrinter,
  setLabelPrinter,
  getActiveBobinaProfile,
  getBobinaProfiles,
  getPrinterDpi,
  listPrinters,
  printLabelSheet,
  printReceipt,
  setActiveBobinaProfileId,
  type ReceiptPrintMode,
  type PrinterInfo,
} from "@/integrations/desktop/printers";
import { PrinterPickerDialog } from "@/components/desktop/PrinterPickerDialog";
import { BobinaProfileManagerDialog } from "@/components/configuracoes/BobinaProfileManagerDialog";
import { subscribeDesktopConfig } from "@/integrations/desktop/configStore";
import { calcularGrade, formatarResumoPerfil, type PerfilBobina } from "@/lib/etiqueta-layout";
import { desenharConteudoTeste, renderizarFolhas } from "@/lib/etiqueta-render";

/* -------------------------------------------------------------------------- */
/* Helpers de teste de cupom                                                   */
/* -------------------------------------------------------------------------- */

function gerarTesteCupomTexto(width: 58 | 80): string {
  const cols = width === 58 ? 32 : 48;
  const center = (value: string) =>
    " ".repeat(Math.max(0, Math.floor((cols - value.length) / 2))) + value;
  return [
    center("GESTAO PRO"),
    center("TESTE DE IMPRESSAO"),
    "-".repeat(cols),
    `Largura: ${width} mm (${cols} colunas)`,
    "Caracteres: ação, café, você, R$",
    "Esquerda",
    `${" ".repeat(Math.max(1, cols - 7))}Direita`,
    center("CENTRALIZADO"),
    "-".repeat(cols),
    new Date().toLocaleString("pt-BR"),
    center("AVANCO E CORTE AO FINAL"),
  ].join("\n");
}

/** Testa a etiqueta usando o MESMO pipeline da impressão real: perfil → motor de layout → render → print_label_sheet. */
async function imprimirTesteEtiqueta(perfil: PerfilBobina, printerName: string): Promise<number> {
  const dpiInfo = await getPrinterDpi(printerName);
  const grade = calcularGrade(perfil);
  const itens = Array.from({ length: grade.colunas }, (_, i) => i);
  const folhas = await renderizarFolhas({
    perfil,
    itens,
    dpiConsultado: dpiInfo?.x ?? null,
    desenharCelula: (contexto) => desenharConteudoTeste(contexto, perfil),
  });
  await printLabelSheet(
    folhas.map((f) => f.png),
    printerName,
    1,
  );
  return grade.colunas;
}

/* -------------------------------------------------------------------------- */
/* Seção genérica reutilizável                                                 */
/* -------------------------------------------------------------------------- */

interface PrinterSectionProps {
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
  printerAtual: string | null;
  printersInstaladas: PrinterInfo[];
  onSelecionar: (name: string) => void;
  onLimpar: () => void;
  onTestar: () => void | Promise<void>;
  testando: boolean;
  extra?: React.ReactNode;
}

function PrinterSection(props: PrinterSectionProps) {
  const {
    icon,
    titulo,
    descricao,
    printerAtual,
    printersInstaladas,
    onSelecionar,
    onLimpar,
    onTestar,
    testando,
    extra,
  } = props;

  const [pickerOpen, setPickerOpen] = useState(false);

  const encontrada = printerAtual ? printersInstaladas.find((p) => p.name === printerAtual) : null;
  const ok = !printerAtual || !!encontrada || printersInstaladas.length === 0;

  return (
    <>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          {icon}
          <div className="font-medium">{titulo}</div>
        </div>
        <p className="text-xs text-muted-foreground">{descricao}</p>

        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Padrão atual
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            {printerAtual ? (
              <>
                <span className="font-medium">{printerAtual}</span>
                {encontrada?.is_default && (
                  <Badge variant="secondary" className="text-[10px]">
                    padrão SO
                  </Badge>
                )}
                {!ok && (
                  <Badge variant="destructive" className="text-[10px]">
                    indisponível
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">
                Nenhuma — será solicitada na primeira impressão.
              </span>
            )}
          </div>
          {!ok && (
            <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                A impressora salva não foi encontrada agora. Verifique se está ligada/conectada ou
                escolha outra.
              </span>
            </div>
          )}
        </div>

        {extra}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPickerOpen(true)} variant="default" size="sm">
            {printerAtual ? "Trocar" : "Escolher"}
          </Button>
          <Button
            onClick={() => void onTestar()}
            variant="outline"
            size="sm"
            disabled={!printerAtual || testando}
          >
            {testando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Imprimir teste
          </Button>
          {printerAtual && (
            <Button onClick={onLimpar} variant="ghost" size="sm">
              Remover padrão
            </Button>
          )}
        </div>
      </div>

      <PrinterPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentName={printerAtual}
        onSelect={(name) => onSelecionar(name)}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Card principal                                                              */
/* -------------------------------------------------------------------------- */

export function ImpressoraConfigCard() {
  const [receipt, setReceipt] = useState<string | null>(getReceiptPrinter());
  const [receiptWidth, setReceiptWidth] = useState<58 | 80>(getReceiptWidthMm());
  const [receiptMode, setReceiptMode] = useState<ReceiptPrintMode>(getReceiptPrintMode());
  const [labelP, setLabelP] = useState<string | null>(getLabelPrinter());
  const [perfis, setPerfis] = useState<PerfilBobina[]>(getBobinaProfiles());
  const [perfilAtivoId, setPerfilAtivoId] = useState<string | null>(
    getActiveBobinaProfile()?.id ?? null,
  );
  const [gerenciarPerfisAberto, setGerenciarPerfisAberto] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [testandoCupom, setTestandoCupom] = useState(false);
  const [testandoEtiqueta, setTestandoEtiqueta] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recarregarPerfis = () => {
    setPerfis(getBobinaProfiles());
    setPerfilAtivoId(getActiveBobinaProfile()?.id ?? null);
  };

  useEffect(() => {
    return subscribeDesktopConfig((cfg) => {
      setReceipt(cfg.receiptPrinter ?? cfg.defaultPrinter ?? null);
      setReceiptWidth(cfg.receiptWidthMm === 58 ? 58 : 80);
      setReceiptMode(
        cfg.receiptPrintMode === "raw" || cfg.receiptPrintMode === "driver"
          ? cfg.receiptPrintMode
          : "auto",
      );
      setLabelP(cfg.labelPrinter ?? null);
      recarregarPerfis();
    });
  }, []);

  const carregar = async () => {
    setLoading(true);
    setError(null);
    try {
      setPrinters(await listPrinters());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao listar impressoras.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  async function testarCupom() {
    if (!receipt) return;
    setTestandoCupom(true);
    try {
      const result = await printReceipt(gerarTesteCupomTexto(receiptWidth), receipt, {
        mode: receiptMode,
        widthMm: receiptWidth,
        cut: true,
      });
      const modoUsado = result.mode === "raw" ? "ESC/POS RAW" : "Driver do Windows";
      toast.success(`Teste enviado para "${receipt}" via ${modoUsado}.`);
    } catch (e) {
      console.error("[printers] detalhe tecnico do teste de cupom", e);
      toast.error(`Não foi possível imprimir na "${receipt}" usando o modo selecionado.`);
    } finally {
      setTestandoCupom(false);
    }
  }

  async function testarEtiqueta() {
    if (!labelP) return;
    const perfil = getActiveBobinaProfile();
    if (!perfil) {
      toast.error('Nenhum perfil de bobina configurado. Abra "Gerenciar perfis" para criar um.');
      return;
    }
    setTestandoEtiqueta(true);
    try {
      const colunas = await imprimirTesteEtiqueta(perfil, labelP);
      toast.success(
        `Teste enviado para "${labelP}" (perfil "${perfil.nome}", ${colunas} coluna${colunas > 1 ? "s" : ""}).`,
      );
    } catch (e) {
      toast.error(`Falha no teste: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestandoEtiqueta(false);
    }
  }

  const perfilAtivo = perfis.find((p) => p.id === perfilAtivoId) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" /> Impressoras deste terminal
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => void carregar()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Atualizar lista
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Cada terminal salva sua própria impressora de <b>cupom/PDV</b> e de <b>etiquetas</b>.
            Assim um caixa nunca imprime na impressora de outro caixa, e etiquetas vão direto para a
            impressora certa sem abrir popup do navegador.
          </p>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
              {error}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <PrinterSection
              icon={<Receipt className="h-4 w-4" />}
              titulo="Impressora de cupom (PDV)"
              descricao="Cupons usam ESC/POS direto ou o driver nativo do Windows. PDF fica reservado a documentos e exportações."
              printerAtual={receipt}
              printersInstaladas={printers}
              onSelecionar={(name) => {
                setReceiptPrinter(name);
                const info = printers.find((p) => p.name === name);
                toast.success(
                  info?.is_thermal
                    ? `Cupom (térmica): "${name}" salva.`
                    : `Cupom: "${name}" salva como padrão.`,
                );
              }}
              onLimpar={() => {
                setReceiptPrinter(null);
                toast.success("Impressora de cupom removida.");
              }}
              onTestar={testarCupom}
              testando={testandoCupom}
              extra={
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Modo de impressão</Label>
                    <Select
                      value={receiptMode}
                      onValueChange={(value) => {
                        const mode = value as ReceiptPrintMode;
                        setReceiptMode(mode);
                        setReceiptPrintMode(mode);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automático</SelectItem>
                        <SelectItem value="raw">ESC/POS RAW</SelectItem>
                        <SelectItem value="driver">Driver do Windows</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Automático tenta RAW apenas quando há evidência de ESC/POS e usa o driver como
                      fallback.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Largura da bobina térmica</Label>
                    <Select
                      value={String(receiptWidth)}
                      onValueChange={(v) => {
                        const w = v === "58" ? 58 : 80;
                        setReceiptWidth(w);
                        setReceiptWidthMm(w);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="58">58 mm (32 colunas)</SelectItem>
                        <SelectItem value="80">80 mm (48 colunas)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {receipt && (
                    <div className="pt-1">
                      <Badge variant="outline" className="text-[10px]">
                        {receiptMode === "raw"
                          ? "ESC/POS RAW forçado"
                          : receiptMode === "driver"
                            ? "Driver do Windows forçado"
                            : printers.find((p) => p.name === receipt)?.escpos_support === "likely"
                              ? "Automático: RAW → Driver"
                              : "Automático: Driver do Windows"}
                      </Badge>
                    </div>
                  )}
                </div>
              }
            />

            <PrinterSection
              icon={<Tag className="h-4 w-4" />}
              titulo="Impressora de etiquetas"
              descricao="Usada para imprimir etiquetas de produto (código de barras / QR), de acordo com o perfil de bobina selecionado."
              printerAtual={labelP}
              printersInstaladas={printers}
              onSelecionar={(name) => {
                setLabelPrinter(name);
                toast.success(`Etiquetas: "${name}" salva como padrão.`);
              }}
              onLimpar={() => {
                setLabelPrinter(null);
                toast.success("Impressora de etiquetas removida.");
              }}
              onTestar={testarEtiqueta}
              testando={testandoEtiqueta}
              extra={
                <div className="space-y-2">
                  <Label className="text-xs">Perfil de bobina</Label>
                  <Select
                    value={perfilAtivoId ?? undefined}
                    onValueChange={(v) => {
                      setActiveBobinaProfileId(v);
                      setPerfilAtivoId(v);
                      const p = perfis.find((x) => x.id === v);
                      if (p) toast.success(`Perfil "${p.nome}" selecionado para este terminal.`);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione um perfil" />
                    </SelectTrigger>
                    <SelectContent>
                      {perfis.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nome} — {formatarResumoPerfil(p)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {perfilAtivo && (
                    <p className="text-[11px] text-muted-foreground">
                      {formatarResumoPerfil(perfilAtivo)} · mídia {perfilAtivo.larguraMidiaMm} mm
                    </p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full gap-1.5"
                    onClick={() => setGerenciarPerfisAberto(true)}
                  >
                    <Settings2 className="h-3.5 w-3.5" /> Gerenciar perfis…
                  </Button>
                </div>
              }
            />
          </div>

          {printers.length > 0 && (
            <div className="space-y-1 rounded-md border border-border bg-card p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Detectadas neste computador ({printers.length})
              </div>
              <ul className="text-sm">
                {printers.map((p) => (
                  <li key={p.name} className="flex items-center justify-between py-1">
                    <span className="truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.status ?? ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <SaveBar hint="Impressoras configuradas neste terminal." />

      <BobinaProfileManagerDialog
        open={gerenciarPerfisAberto}
        onOpenChange={setGerenciarPerfisAberto}
        printerName={labelP}
        onChanged={recarregarPerfis}
      />
    </div>
  );
}
