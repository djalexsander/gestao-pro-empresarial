import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useBalancaConfig, useSaveBalancaConfig } from "@/hooks/useBalancaConfig";
import {
  parseEtiquetaBalanca,
  type BalancaConfig,
} from "@/lib/balanca";
import { buscarProdutoPorPlu } from "@/hooks/useProdutoPorPlu";
import { CheckCircle2, XCircle, Scale, FlaskConical } from "lucide-react";

export function BalancaTab() {
  const { data, isLoading } = useBalancaConfig();
  const saveMut = useSaveBalancaConfig();

  const [form, setForm] = useState<BalancaConfig & { observacoes: string | null }>({
    ativo: false,
    prefixos: ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29"],
    comprimento_total: 13,
    inicio_codigo_produto: 2,
    digitos_codigo_produto: 5,
    inicio_peso_valor: 7,
    digitos_peso_valor: 5,
    tipo_codigo: "peso",
    casas_decimais_peso: 3,
    casas_decimais_valor: 2,
    validar_dv: true,
    observacoes: null,
  });
  const [prefixosTxt, setPrefixosTxt] = useState("20,21,22,23,24,25,26,27,28,29");
  const [testCode, setTestCode] = useState("");
  const [testProduto, setTestProduto] = useState<string | null>(null);
  const [testProdutoErr, setTestProdutoErr] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setForm({
        ativo: data.ativo,
        prefixos: data.prefixos,
        comprimento_total: data.comprimento_total,
        inicio_codigo_produto: data.inicio_codigo_produto,
        digitos_codigo_produto: data.digitos_codigo_produto,
        inicio_peso_valor: data.inicio_peso_valor,
        digitos_peso_valor: data.digitos_peso_valor,
        tipo_codigo: data.tipo_codigo,
        casas_decimais_peso: data.casas_decimais_peso,
        casas_decimais_valor: data.casas_decimais_valor,
        validar_dv: data.validar_dv,
        observacoes: data.observacoes,
      });
      setPrefixosTxt(data.prefixos.join(","));
    }
  }, [data]);

  const parseResult = useMemo(() => {
    if (!testCode.trim()) return null;
    return parseEtiquetaBalanca(testCode.trim(), form);
  }, [testCode, form]);

  // Busca o produto correspondente quando o parse for OK
  useEffect(() => {
    let cancel = false;
    setTestProduto(null);
    setTestProdutoErr(null);
    if (!parseResult || !parseResult.ok) return;
    (async () => {
      try {
        const p = await buscarProdutoPorPlu(parseResult.plu);
        if (cancel) return;
        if (!p) {
          setTestProdutoErr("Nenhum produto cadastrado com este PLU.");
        } else {
          setTestProduto(`${p.nome} (SKU ${p.sku}) — R$ ${Number(p.preco_venda).toFixed(2)}/${p.unidade}`);
        }
      } catch (e) {
        if (!cancel) setTestProdutoErr((e as Error).message);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [parseResult]);

  function handleSave() {
    const prefixos = prefixosTxt
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    saveMut.mutate({ ...form, prefixos });
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando configuração...</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Balança / Etiqueta por Peso
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="font-medium">Ativar leitura de etiqueta da balança</p>
              <p className="text-sm text-muted-foreground">
                Quando ativo, o PDV interpreta códigos com prefixo configurado como
                etiquetas de produtos pesados.
              </p>
            </div>
            <Switch
              checked={form.ativo}
              onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: v }))}
            />
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Prefixos aceitos (separados por vírgula)</Label>
              <Input
                value={prefixosTxt}
                onChange={(e) => setPrefixosTxt(e.target.value)}
                placeholder="20,21,22,23,24,25,26,27,28,29"
              />
              <p className="text-xs text-muted-foreground">
                No padrão GS1 brasileiro, balanças usam 20–29.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Comprimento total do código</Label>
              <Input
                type="number"
                value={form.comprimento_total}
                onChange={(e) =>
                  setForm((f) => ({ ...f, comprimento_total: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Posição inicial do PLU (0-indexada)</Label>
              <Input
                type="number"
                value={form.inicio_codigo_produto}
                onChange={(e) =>
                  setForm((f) => ({ ...f, inicio_codigo_produto: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Quantidade de dígitos do PLU</Label>
              <Input
                type="number"
                value={form.digitos_codigo_produto}
                onChange={(e) =>
                  setForm((f) => ({ ...f, digitos_codigo_produto: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Posição inicial do peso/valor</Label>
              <Input
                type="number"
                value={form.inicio_peso_valor}
                onChange={(e) =>
                  setForm((f) => ({ ...f, inicio_peso_valor: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Quantidade de dígitos do peso/valor</Label>
              <Input
                type="number"
                value={form.digitos_peso_valor}
                onChange={(e) =>
                  setForm((f) => ({ ...f, digitos_peso_valor: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de informação na etiqueta</Label>
              <Select
                value={form.tipo_codigo}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, tipo_codigo: v as "peso" | "valor" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="peso">Peso (gramas)</SelectItem>
                  <SelectItem value="valor">Valor total (centavos)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Casas decimais do peso</Label>
              <Input
                type="number"
                value={form.casas_decimais_peso}
                onChange={(e) =>
                  setForm((f) => ({ ...f, casas_decimais_peso: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Casas decimais do valor</Label>
              <Input
                type="number"
                value={form.casas_decimais_valor}
                onChange={(e) =>
                  setForm((f) => ({ ...f, casas_decimais_valor: Number(e.target.value) }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3 md:col-span-2">
              <div>
                <p className="font-medium text-sm">Validar dígito verificador (EAN-13)</p>
                <p className="text-xs text-muted-foreground">
                  Recomendado. Bloqueia leituras com erro de digitação ou impressão.
                </p>
              </div>
              <Switch
                checked={form.validar_dv}
                onCheckedChange={(v) => setForm((f) => ({ ...f, validar_dv: v }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={form.observacoes ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, observacoes: e.target.value }))
              }
              placeholder="Marca/modelo da balança, particularidades..."
              rows={2}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Salvando..." : "Salvar configuração"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Testar leitura
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Cole ou digite um código de barras impresso pela balança</Label>
            <Input
              value={testCode}
              onChange={(e) => setTestCode(e.target.value.replace(/\D/g, ""))}
              className="font-mono"
              placeholder="2012345006001"
            />
          </div>

          {parseResult && (
            <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
              {parseResult.ok ? (
                <>
                  <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="font-medium">Etiqueta válida</span>
                  </div>
                  <Row label="Prefixo" value={parseResult.prefixo} />
                  <Row label="PLU extraído" value={parseResult.plu} />
                  {parseResult.tipo === "peso" ? (
                    <Row
                      label="Peso"
                      value={`${parseResult.peso_kg?.toFixed(3)} KG`}
                    />
                  ) : (
                    <Row
                      label="Valor total"
                      value={`R$ ${parseResult.valor_total?.toFixed(2)}`}
                    />
                  )}
                  <Row
                    label="Produto correspondente"
                    value={
                      testProduto ?? (
                        testProdutoErr ? (
                          <Badge variant="destructive">{testProdutoErr}</Badge>
                        ) : (
                          "Buscando..."
                        )
                      )
                    }
                  />
                </>
              ) : (
                <div className="flex items-start gap-2 text-destructive">
                  <XCircle className="h-4 w-4 mt-0.5" />
                  <div>
                    <p className="font-medium">Etiqueta inválida</p>
                    <p className="text-xs">{parseResult.motivo}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
