import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  getDefaultPrinter,
  setDefaultPrinter,
  listPrinters,
  printPdfBytes,
  getPrintIntensity,
  setPrintIntensity,
  type PrinterInfo,
} from "@/integrations/desktop/printers";
import type { PrintIntensity } from "@/integrations/desktop/types";
import { PrinterPickerDialog } from "@/components/desktop/PrinterPickerDialog";
import { jsPDF } from "jspdf";
import { subscribeDesktopConfig } from "@/integrations/desktop/configStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function gerarTesteImpressaoPdf(): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: [80, 60], orientation: "portrait" });
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.text("GESTAO PRO", 40, 10, { align: "center" });
  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  doc.text("TESTE DE IMPRESSAO", 40, 18, { align: "center" });
  doc.setFontSize(8);
  doc.text(
    `Data: ${new Date().toLocaleString("pt-BR")}`,
    4,
    28,
  );
  doc.text("Se voce esta lendo isso,", 4, 36);
  doc.text("a impressora esta OK.", 4, 42);
  doc.setFont("courier", "bold");
  doc.text("---- FIM ----", 40, 52, { align: "center" });
  return new Uint8Array(doc.output("arraybuffer"));
}

export function ImpressoraConfigCard() {
  const [defaultPrinter, setDefault] = useState<string | null>(getDefaultPrinter());
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testando, setTestando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeDesktopConfig((cfg) => setDefault(cfg.defaultPrinter ?? null));
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

  const padraoEncontrado = defaultPrinter
    ? printers.find((p) => p.name === defaultPrinter)
    : null;
  const padraoOk = !defaultPrinter || !!padraoEncontrado || printers.length === 0;

  async function testar() {
    if (!defaultPrinter) {
      toast.error("Nenhuma impressora padrão configurada.");
      return;
    }
    setTestando(true);
    try {
      const pdf = gerarTesteImpressaoPdf();
      await printPdfBytes(pdf, defaultPrinter);
      toast.success(`Teste enviado para "${defaultPrinter}".`);
    } catch (e) {
      toast.error(
        `Falha no teste: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setTestando(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" /> Impressora padrão deste terminal
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
            Cada terminal tem sua própria impressora padrão. As vendas deste
            terminal serão sempre enviadas para a impressora abaixo, evitando
            que um caixa imprima na impressora de outro caixa.
          </p>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Padrão atual
            </div>
            <div className="mt-1 flex items-center gap-2">
              {defaultPrinter ? (
                <>
                  <span className="font-medium">{defaultPrinter}</span>
                  {padraoEncontrado?.is_default && (
                    <Badge variant="secondary" className="text-[10px]">
                      padrão SO
                    </Badge>
                  )}
                  {!padraoOk && (
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
            {!padraoOk && (
              <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  A impressora salva não foi encontrada agora. Verifique se está
                  ligada/conectada ou escolha outra.
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setPickerOpen(true)} variant="default">
              {defaultPrinter ? "Trocar impressora" : "Escolher impressora"}
            </Button>
            <Button
              onClick={() => void testar()}
              variant="outline"
              disabled={!defaultPrinter || testando}
            >
              {testando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Imprimir teste
            </Button>
            {defaultPrinter && (
              <Button
                onClick={() => {
                  setDefaultPrinter(null);
                  toast.success("Impressora padrão removida.");
                }}
                variant="ghost"
              >
                Remover padrão
              </Button>
            )}
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

      <PrinterPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentName={defaultPrinter}
        onSelect={(name) => {
          setDefaultPrinter(name);
          toast.success(`Impressora "${name}" salva como padrão.`);
        }}
      />
    </>
  );
}
