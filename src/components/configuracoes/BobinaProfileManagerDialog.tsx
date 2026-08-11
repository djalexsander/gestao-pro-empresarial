import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  Copy,
  Loader2,
  MoreVertical,
  Plus,
  Printer,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  calcularGrade,
  calcularLarguraNecessariaMm,
  criarPerfil,
  formatarResumoPerfil,
  validarPerfil,
  type ModoDpi,
  type OrientacaoEtiqueta,
  type PerfilBobina,
} from "@/lib/etiqueta-layout";
import { desenharConteudoTeste, renderizarFolhas } from "@/lib/etiqueta-render";
import {
  deleteBobinaProfile,
  duplicateBobinaProfile,
  getActiveBobinaProfile,
  getBobinaProfiles,
  getPrinterDpi,
  printLabelSheet,
  saveBobinaProfile,
  setActiveBobinaProfileId,
  setDefaultBobinaProfile,
} from "@/integrations/desktop/printers";

interface BobinaProfileManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Impressora de etiquetas selecionada neste terminal (para o teste de impressão). */
  printerName: string | null;
  /** Disparado sempre que a lista/seleção de perfis muda (o card pai releitura o estado). */
  onChanged?: () => void;
}

function campoNumero(valor: number): string {
  return Number.isFinite(valor) ? String(valor) : "";
}

export function BobinaProfileManagerDialog({
  open,
  onOpenChange,
  printerName,
  onChanged,
}: BobinaProfileManagerDialogProps) {
  const [perfis, setPerfis] = useState<PerfilBobina[]>([]);
  const [ativoId, setAtivoId] = useState<string | null>(null);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<PerfilBobina | null>(null);
  const [imprimindoTeste, setImprimindoTeste] = useState(false);
  const [dpiConsultado, setDpiConsultado] = useState<number | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const recarregar = useCallback(() => {
    const lista = getBobinaProfiles();
    setPerfis(lista);
    setAtivoId(getActiveBobinaProfile()?.id ?? null);
    onChanged?.();
    return lista;
  }, [onChanged]);

  useEffect(() => {
    if (!open) return;
    const lista = recarregar();
    const ativo = getActiveBobinaProfile();
    const alvo = lista.find((p) => p.id === ativo?.id) ?? lista[0] ?? null;
    setSelecionadoId(alvo?.id ?? null);
    setRascunho(alvo ? { ...alvo } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !printerName) {
      setDpiConsultado(null);
      return;
    }
    let cancelado = false;
    void getPrinterDpi(printerName).then((dpi) => {
      if (!cancelado) setDpiConsultado(dpi?.x ?? null);
    });
    return () => {
      cancelado = true;
    };
  }, [open, printerName]);

  const validacao = rascunho ? validarPerfil(rascunho) : null;
  const larguraNecessaria = rascunho ? calcularLarguraNecessariaMm(rascunho) : 0;

  // Preview: sempre re-renderiza pelo MESMO motor usado na impressão real.
  useEffect(() => {
    if (!rascunho || !validacao?.ok) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    let cancelado = false;
    const grade = calcularGrade(rascunho);
    const itens = Array.from({ length: grade.colunas }, (_, i) => i);
    void renderizarFolhas({
      perfil: rascunho,
      itens,
      dpiConsultado,
      desenharCelula: (contexto) => desenharConteudoTeste(contexto, rascunho),
    })
      .then((folhas) => {
        if (cancelado || folhas.length === 0) return;
        const primeira = folhas[0];
        const img = new Image();
        img.onload = () => {
          if (cancelado) return;
          const maxW = 380;
          const escala = Math.min(1, maxW / primeira.larguraDots);
          canvas.width = Math.max(1, Math.round(primeira.larguraDots * escala));
          canvas.height = Math.max(1, Math.round(primeira.alturaDots * escala));
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.imageSmoothingEnabled = true;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = URL.createObjectURL(new Blob([primeira.png as BlobPart], { type: "image/png" }));
      })
      .catch((e) => console.warn("[bobina-preview] falha ao renderizar", e));
    return () => {
      cancelado = true;
    };
  }, [rascunho, validacao?.ok, dpiConsultado]);

  function selecionar(id: string) {
    const perfil = perfis.find((p) => p.id === id);
    if (!perfil) return;
    setSelecionadoId(id);
    setRascunho({ ...perfil });
  }

  function novoPerfil() {
    const base = criarPerfil({ nome: `Novo perfil ${perfis.length + 1}` });
    setSelecionadoId(null);
    setRascunho(base);
  }

  function atualizarCampo<K extends keyof PerfilBobina>(campo: K, valor: PerfilBobina[K]) {
    setRascunho((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  function atualizarNumero(campo: keyof PerfilBobina, texto: string) {
    const valor = Number(texto.replace(",", "."));
    atualizarCampo(campo, (Number.isFinite(valor) ? valor : 0) as never);
  }

  function preencherLarguraAutomaticamente() {
    if (!rascunho) return;
    atualizarCampo("larguraMidiaMm", Math.round(larguraNecessaria * 100) / 100);
  }

  function salvar() {
    if (!rascunho) return;
    const v = validarPerfil(rascunho);
    if (!v.ok) {
      toast.error(v.mensagem ?? "Perfil inválido.");
      return;
    }
    saveBobinaProfile(rascunho);
    recarregar();
    setSelecionadoId(rascunho.id);
    toast.success(`Perfil "${rascunho.nome}" salvo.`);
  }

  function duplicar(id: string) {
    const novo = duplicateBobinaProfile(id);
    if (!novo) return;
    recarregar();
    setSelecionadoId(novo.id);
    setRascunho({ ...novo });
    toast.success(`Perfil duplicado como "${novo.nome}".`);
  }

  function excluir(id: string) {
    const resultado = deleteBobinaProfile(id);
    if (!resultado.ok) {
      toast.error(resultado.mensagem ?? "Não foi possível excluir este perfil.");
      return;
    }
    const lista = recarregar();
    if (selecionadoId === id) {
      const alvo = lista[0] ?? null;
      setSelecionadoId(alvo?.id ?? null);
      setRascunho(alvo ? { ...alvo } : null);
    }
    toast.success("Perfil excluído.");
  }

  function tornarPadrao(id: string) {
    setDefaultBobinaProfile(id);
    recarregar();
    toast.success("Definido como perfil padrão.");
  }

  function usarNesteTerminal(id: string) {
    setActiveBobinaProfileId(id);
    recarregar();
    toast.success("Este terminal passa a usar este perfil para etiquetas.");
  }

  async function imprimirTeste() {
    if (!rascunho) return;
    if (!printerName) {
      toast.error("Configure a impressora de etiquetas antes de imprimir o teste.");
      return;
    }
    const v = validarPerfil(rascunho);
    if (!v.ok) {
      toast.error(v.mensagem ?? "Perfil inválido.");
      return;
    }
    setImprimindoTeste(true);
    try {
      const grade = calcularGrade(rascunho);
      const itens = Array.from({ length: grade.colunas }, (_, i) => i);
      const folhas = await renderizarFolhas({
        perfil: rascunho,
        itens,
        dpiConsultado,
        desenharCelula: (contexto) => desenharConteudoTeste(contexto, rascunho),
      });
      await printLabelSheet(
        folhas.map((f) => f.png),
        printerName,
        1,
      );
      toast.success(
        `Teste enviado para "${printerName}" (${grade.colunas} coluna${grade.colunas > 1 ? "s" : ""}).`,
      );
    } catch (e) {
      toast.error(`Falha no teste: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImprimindoTeste(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Perfis de bobina / etiqueta</DialogTitle>
            <DialogDescription>
              Defina dimensões, colunas, gaps, margens, orientação, DPI e calibração da bobina. A
              mesma impressora pode trocar de perfil a qualquer momento, sem alterar código.
            </DialogDescription>
          </DialogHeader>

          <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[220px_1fr]">
            {/* Lista de perfis */}
            <div className="flex flex-col gap-2 overflow-y-auto border-b border-border p-4 md:border-b-0 md:border-r">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={novoPerfil}>
                <Plus className="h-3.5 w-3.5" /> Novo perfil
              </Button>
              <div className="space-y-1">
                {perfis.map((p) => {
                  const ativo = p.id === selecionadoId;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-1 rounded-md border p-2 text-left text-xs transition ${
                        ativo ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => selecionar(p.id)}
                      >
                        <div className="flex items-center gap-1 truncate font-medium">
                          {p.nome}
                          {p.padrao && (
                            <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                          )}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {formatarResumoPerfil(p)}
                        </div>
                        {p.id === ativoId && (
                          <Badge variant="secondary" className="mt-1 text-[9px]">
                            em uso neste terminal
                          </Badge>
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => usarNesteTerminal(p.id)}>
                            Usar neste terminal
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => tornarPadrao(p.id)}>
                            Definir como padrão
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => duplicar(p.id)}>
                            <Copy className="mr-2 h-3.5 w-3.5" /> Duplicar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => excluir(p.id)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Editor + preview */}
            <div className="overflow-y-auto p-4">
              {!rascunho ? (
                <p className="text-sm text-muted-foreground">Nenhum perfil selecionado.</p>
              ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nome do perfil</Label>
                      <Input
                        value={rascunho.nome}
                        onChange={(e) => atualizarCampo("nome", e.target.value)}
                      />
                    </div>

                    <Separator />

                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Dimensões da etiqueta
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <Campo label="Largura (mm)">
                          <Input
                            type="number"
                            min={1}
                            step="0.1"
                            value={campoNumero(rascunho.larguraEtiquetaMm)}
                            onChange={(e) => atualizarNumero("larguraEtiquetaMm", e.target.value)}
                          />
                        </Campo>
                        <Campo label="Altura (mm)">
                          <Input
                            type="number"
                            min={1}
                            step="0.1"
                            value={campoNumero(rascunho.alturaEtiquetaMm)}
                            onChange={(e) => atualizarNumero("alturaEtiquetaMm", e.target.value)}
                          />
                        </Campo>
                        <Campo label="Orientação">
                          <Select
                            value={rascunho.orientacao}
                            onValueChange={(v) =>
                              atualizarCampo("orientacao", v as OrientacaoEtiqueta)
                            }
                          >
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="retrato">Retrato</SelectItem>
                              <SelectItem value="paisagem">Paisagem</SelectItem>
                            </SelectContent>
                          </Select>
                        </Campo>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Colunas e mídia
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <Campo label="Colunas (etiquetas/linha)">
                          <Input
                            type="number"
                            min={1}
                            step="1"
                            value={campoNumero(rascunho.colunas)}
                            onChange={(e) => atualizarNumero("colunas", e.target.value)}
                          />
                        </Campo>
                        <Campo label="Gap horizontal (mm)">
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            value={campoNumero(rascunho.gapHorizontalMm)}
                            onChange={(e) => atualizarNumero("gapHorizontalMm", e.target.value)}
                          />
                        </Campo>
                        <Campo label="Gap vertical (mm)">
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            value={campoNumero(rascunho.gapVerticalMm)}
                            onChange={(e) => atualizarNumero("gapVerticalMm", e.target.value)}
                          />
                        </Campo>
                      </div>
                      <div className="mt-3 space-y-1.5">
                        <Label className="text-xs">Largura total da mídia/bobina (mm)</Label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            min={1}
                            step="0.1"
                            value={campoNumero(rascunho.larguraMidiaMm)}
                            onChange={(e) => atualizarNumero("larguraMidiaMm", e.target.value)}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0 whitespace-nowrap"
                            onClick={preencherLarguraAutomaticamente}
                          >
                            Calcular ({larguraNecessaria.toFixed(1)} mm)
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Margens
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Campo label="Esquerda (mm)">
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            value={campoNumero(rascunho.margemEsquerdaMm)}
                            onChange={(e) => atualizarNumero("margemEsquerdaMm", e.target.value)}
                          />
                        </Campo>
                        <Campo label="Direita (mm)">
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            value={campoNumero(rascunho.margemDireitaMm)}
                            onChange={(e) => atualizarNumero("margemDireitaMm", e.target.value)}
                          />
                        </Campo>
                        <Campo label="Superior (mm)">
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            value={campoNumero(rascunho.margemSuperiorMm)}
                            onChange={(e) => atualizarNumero("margemSuperiorMm", e.target.value)}
                          />
                        </Campo>
                        <Campo label="Inferior (mm)">
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            value={campoNumero(rascunho.margemInferiorMm)}
                            onChange={(e) => atualizarNumero("margemInferiorMm", e.target.value)}
                          />
                        </Campo>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Calibração fina (offset)
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Campo label="Offset X (mm) — +direita / −esquerda">
                          <Input
                            type="number"
                            step="0.1"
                            value={campoNumero(rascunho.offsetXMm)}
                            onChange={(e) => atualizarNumero("offsetXMm", e.target.value)}
                          />
                        </Campo>
                        <Campo label="Offset Y (mm) — +baixo / −cima">
                          <Input
                            type="number"
                            step="0.1"
                            value={campoNumero(rascunho.offsetYMm)}
                            onChange={(e) => atualizarNumero("offsetYMm", e.target.value)}
                          />
                        </Campo>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        DPI (resolução de impressão)
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Campo label="Modo">
                          <Select
                            value={rascunho.dpi.modo}
                            onValueChange={(v) =>
                              atualizarCampo("dpi", { ...rascunho.dpi, modo: v as ModoDpi })
                            }
                          >
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">Automático (driver)</SelectItem>
                              <SelectItem value="203">203 DPI</SelectItem>
                              <SelectItem value="300">300 DPI</SelectItem>
                              <SelectItem value="custom">Personalizado</SelectItem>
                            </SelectContent>
                          </Select>
                        </Campo>
                        {rascunho.dpi.modo === "custom" && (
                          <Campo label="DPI personalizado">
                            <Input
                              type="number"
                              min={72}
                              max={1200}
                              step="1"
                              value={campoNumero(rascunho.dpi.personalizado ?? 203)}
                              onChange={(e) =>
                                atualizarCampo("dpi", {
                                  ...rascunho.dpi,
                                  personalizado: Number(e.target.value) || 203,
                                })
                              }
                            />
                          </Campo>
                        )}
                      </div>
                      {rascunho.dpi.modo === "auto" && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          {dpiConsultado
                            ? `Detectado do driver: ${dpiConsultado} dpi.`
                            : "Sem impressora selecionada ou consulta indisponível — usa 203 dpi."}
                        </p>
                      )}
                    </div>

                    {validacao && !validacao.ok && (
                      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{validacao.mensagem}</span>
                      </div>
                    )}
                  </div>

                  {/* Preview + ações */}
                  <div className="space-y-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Pré-visualização
                    </div>
                    <div className="flex justify-center rounded-md border border-dashed border-border bg-white p-2">
                      {validacao?.ok ? (
                        <canvas
                          ref={previewRef}
                          className="max-w-full"
                          style={{ display: "block" }}
                        />
                      ) : (
                        <div className="flex h-32 items-center justify-center text-center text-[11px] text-muted-foreground">
                          Corrija o layout para ver a prévia.
                        </div>
                      )}
                    </div>
                    <p className="text-center text-[11px] text-muted-foreground">
                      {rascunho.colunas} coluna{rascunho.colunas > 1 ? "s" : ""} · linha de{" "}
                      {rascunho.larguraMidiaMm.toFixed(1)} mm
                    </p>

                    <Button
                      className="w-full gap-1.5"
                      variant="outline"
                      disabled={imprimindoTeste || !validacao?.ok || !printerName}
                      onClick={() => void imprimirTeste()}
                    >
                      {imprimindoTeste ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Printer className="h-4 w-4" />
                      )}
                      Imprimir teste
                    </Button>
                    {!printerName && (
                      <p className="text-center text-[11px] text-muted-foreground">
                        Selecione a impressora de etiquetas para testar.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button onClick={salvar} disabled={!rascunho || !validacao?.ok}>
              Salvar perfil
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
