import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Printer,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Tag,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import {
  getReceiptPrinter,
  setReceiptPrinter,
  getReceiptWidthMm,
  setReceiptWidthMm,
  getLabelPrinter,
  setLabelPrinter,
  getLabelFormat,
  setLabelFormat,
  getLabelCustomFormats,
  addLabelCustomFormat,
  listPrinters,
  printPdfBytes,
  printReceiptText,
  type PrinterInfo,
} from "@/integrations/desktop/printers";
import { PrinterPickerDialog } from "@/components/desktop/PrinterPickerDialog";
import { jsPDF } from "jspdf";
import { subscribeDesktopConfig } from "@/integrations/desktop/configStore";

/* -------------------------------------------------------------------------- */
/* Helpers de geração de PDF de teste                                          */
/* -------------------------------------------------------------------------- */

function gerarTesteCupomPdf(): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: [80, 60], orientation: "portrait" });
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.text("GESTAO PRO", 40, 10, { align: "center" });
  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  doc.text("TESTE DE CUPOM", 40, 18, { align: "center" });
  doc.setFontSize(8);
  doc.text(`Data: ${new Date().toLocaleString("pt-BR")}`, 4, 28);
  doc.text("Impressora de CUPOM/PDV OK.", 4, 36);
  doc.setFont("courier", "bold");
  doc.text("---- FIM ----", 40, 52, { align: "center" });
  return new Uint8Array(doc.output("arraybuffer"));
}

function gerarTesteEtiquetaPdf(formato: string): Uint8Array {
  const [w, h] = parseFormato(formato);
  const doc = new jsPDF({
    unit: "mm",
    format: [w, h],
    orientation: w >= h ? "landscape" : "portrait",
  });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("TESTE ETIQUETA", w / 2, 4, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.text(`${w} x ${h} mm`, w / 2, h - 3, { align: "center" });
  doc.text(new Date().toLocaleTimeString("pt-BR"), w / 2, h / 2, { align: "center" });
  return new Uint8Array(doc.output("arraybuffer"));
}

function parseFormato(f: string): [number, number] {
  const m = /^(\d+)x(\d+)$/i.exec(f.trim());
  if (m) return [Number(m[1]), Number(m[2])];
  if (f === "80mm") return [80, 40];
  return [50, 30];
}

const FORMATOS_ETIQUETA = [
  { value: "50x30", label: "50 × 30 mm" },
  { value: "40x30", label: "40 × 30 mm" },
  { value: "50x50", label: "50 × 50 mm" },
  { value: "60x40", label: "60 × 40 mm" },
  { value: "80x40", label: "80 × 40 mm" },
  { value: "80mm", label: "80 mm (cupom)" },
];

function formatLabel(value: string): string {
  const [w, h] = parseFormato(value);
  return `${w} × ${h} mm`;
}

function normalizarFormatoEtiqueta(width: string, height: string): string | null {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < 20 || w > 120 || h < 15 || h > 120) return null;
  return `${Math.round(w)}x${Math.round(h)}`;
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

  const encontrada = printerAtual
    ? printersInstaladas.find((p) => p.name === printerAtual)
    : null;
  const ok =
    !printerAtual || !!encontrada || printersInstaladas.length === 0;

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
                A impressora salva não foi encontrada agora. Verifique se está
                ligada/conectada ou escolha outra.
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
  const [labelP, setLabelP] = useState<string | null>(getLabelPrinter());
  const [labelFmt, setLabelFmt] = useState<string>(getLabelFormat() ?? "50x30");
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [testandoCupom, setTestandoCupom] = useState(false);
  const [testandoEtiqueta, setTestandoEtiqueta] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeDesktopConfig((cfg) => {
      setReceipt(cfg.receiptPrinter ?? cfg.defaultPrinter ?? null);
      setReceiptWidth(cfg.receiptWidthMm === 58 ? 58 : 80);
      setLabelP(cfg.labelPrinter ?? null);
      setLabelFmt(cfg.labelFormat ?? "50x30");
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
      const info = printers.find((p) => p.name === receipt);
      if (info?.is_thermal) {
        // Térmica → ESC/POS RAW (sem Start-Process).
        const texto = [
          "       GESTAO PRO",
          "    TESTE DE IMPRESSAO",
          "",
          new Date().toLocaleString("pt-BR"),
          "",
          "Cupom OK. Se voce esta",
          "lendo isso, a impressora",
          "esta funcionando.",
          "",
          "------- FIM -------",
        ].join("\n");
        const msg = await printReceiptText(texto, receipt, {
          widthMm: receiptWidth,
          cut: true,
        });
        toast.success(msg);
      } else {
        await printPdfBytes(gerarTesteCupomPdf(), receipt);
        toast.success(`Teste enviado para "${receipt}".`);
      }
    } catch (e) {
      toast.error(`Falha no teste: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestandoCupom(false);
    }
  }

  async function testarEtiqueta() {
    if (!labelP) return;
    setTestandoEtiqueta(true);
    try {
      await printPdfBytes(gerarTesteEtiquetaPdf(labelFmt), labelP);
      toast.success(`Teste enviado para "${labelP}".`);
    } catch (e) {
      toast.error(`Falha no teste: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestandoEtiqueta(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Printer className="h-5 w-5" /> Impressoras deste terminal
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void carregar()}
          disabled={loading}
        >
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
          Cada terminal salva sua própria impressora de <b>cupom/PDV</b> e de{" "}
          <b>etiquetas</b>. Assim um caixa nunca imprime na impressora de outro
          caixa, e etiquetas vão direto para a impressora certa sem abrir popup
          do navegador.
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
            descricao="Térmica detectada → impressão ESC/POS direta (RAW). Outras → PDF."
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
                {receipt && (
                  <div className="pt-1">
                    {printers.find((p) => p.name === receipt)?.is_thermal ? (
                      <Badge className="text-[10px]">térmica detectada</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        impressão via PDF
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            }
          />

          <PrinterSection
            icon={<Tag className="h-4 w-4" />}
            titulo="Impressora de etiquetas"
            descricao="Usada para imprimir etiquetas de produto (código de barras / QR)."
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
              <div className="space-y-1.5">
                <Label className="text-xs">Formato padrão</Label>
                <Select
                  value={labelFmt}
                  onValueChange={(v) => {
                    setLabelFmt(v);
                    setLabelFormat(v);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMATOS_ETIQUETA.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <li
                  key={p.name}
                  className="flex items-center justify-between py-1"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.status ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
