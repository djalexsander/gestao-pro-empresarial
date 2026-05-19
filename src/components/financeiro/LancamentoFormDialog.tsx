
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dataClient } from "@/integrations/data";
import { useClientes } from "@/hooks/useClientes";
import { useFornecedores } from "@/hooks/useFornecedores";
import { ClienteSearchSelect } from "@/components/clientes/ClienteSearchSelect";
import { FornecedorSearchSelect } from "@/components/fornecedores/FornecedorSearchSelect";
import { useHotkeys } from "@/hooks/useHotkeys";
import { FormSection } from "@/components/shared/FormSection";
import type {
  CriarLancamentoAvulsoInput,
  EditarLancamentoAvulsoInput,
  FormaPagamentoLancamento,
  LancamentoAvulsoTipo,
} from "@/integrations/data/types";

const NONE = "__none__";

type FormaPag = NonNullable<FormaPagamentoLancamento>;

interface BaseProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Quando setado, dispara invalidations e fecha após sucesso. */
  onSaved?: () => void;
}

interface CreateProps extends BaseProps {
  mode: "create";
  /** Tipo inicial sugerido pelo contexto (ex.: aba ativa). */
  tipoInicial?: LancamentoAvulsoTipo;
  /** Permitir alternar tipo no formulário (default: true). */
  permitirTrocarTipo?: boolean;
  lancamento?: never;
}

interface EditProps extends BaseProps {
  mode: "edit";
  lancamento: {
    id: string;
    tipo: LancamentoAvulsoTipo;
    descricao: string;
    valor: number;
    data_vencimento: string;
    data_emissao?: string | null;
    categoria_id?: string | null;
    cliente_id?: string | null;
    fornecedor_id?: string | null;
    numero_documento?: string | null;
    forma_pagamento?: string | null;
    observacoes?: string | null;
  };
  tipoInicial?: never;
  permitirTrocarTipo?: never;
}

type Props = CreateProps | EditProps;

interface CategoriaFinanceiraLite {
  id: string;
  nome: string;
  tipo: "receita" | "despesa";
  ativo: boolean;
}

function parseValor(s: string): number {
  const n = Number(String(s).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LancamentoFormDialog(props: Props) {
  const { open, onOpenChange, onSaved, mode } = props;
  const isEdit = mode === "edit";
  const qc = useQueryClient();

  const [tipo, setTipo] = useState<LancamentoAvulsoTipo>(
    isEdit ? props.lancamento.tipo : (props.tipoInicial ?? "receber"),
  );
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [dataVencimento, setDataVencimento] = useState(todayISO());
  const [dataEmissao, setDataEmissao] = useState(todayISO());
  const [categoriaId, setCategoriaId] = useState<string>(NONE);
  const [clienteId, setClienteId] = useState<string>(NONE);
  const [fornecedorId, setFornecedorId] = useState<string>(NONE);
  const [numeroDocumento, setNumeroDocumento] = useState("");
  const [formaPagamento, setFormaPagamento] = useState<FormaPag | typeof NONE>(NONE);
  const [observacoes, setObservacoes] = useState("");
  // client_uuid estável por modal aberto: idempotência contra duplo-clique e retry.
  const [clientUuid, setClientUuid] = useState("");

  // Reset do form quando reabrir
  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      const l = props.lancamento;
      setTipo(l.tipo);
      setDescricao(l.descricao ?? "");
      setValor(
        Number(l.valor ?? 0)
          .toFixed(2)
          .replace(".", ","),
      );
      setDataVencimento((l.data_vencimento ?? todayISO()).slice(0, 10));
      setDataEmissao((l.data_emissao ?? todayISO()).slice(0, 10));
      setCategoriaId(l.categoria_id ?? NONE);
      setClienteId(l.cliente_id ?? NONE);
      setFornecedorId(l.fornecedor_id ?? NONE);
      setNumeroDocumento(l.numero_documento ?? "");
      setFormaPagamento(((l.forma_pagamento as FormaPag) ?? NONE) as FormaPag | typeof NONE);
      setObservacoes(l.observacoes ?? "");
    } else {
      setTipo(props.tipoInicial ?? "receber");
      setDescricao("");
      setValor("");
      setDataVencimento(todayISO());
      setDataEmissao(todayISO());
      setCategoriaId(NONE);
      setClienteId(NONE);
      setFornecedorId(NONE);
      setNumeroDocumento("");
      setFormaPagamento(NONE);
      setObservacoes("");
    }
    setClientUuid(crypto.randomUUID());
  }, [open, isEdit, props]);

  // Categorias financeiras filtradas pelo tipo (receita/despesa)
  const tipoCategoria: "receita" | "despesa" = tipo === "receber" ? "receita" : "despesa";
  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias_financeiras_ativas"],
    queryFn: async () => {
      const data = await dataClient.categoriasFinanceiras.list({});
      return (data ?? []).filter((c) => c.ativo).map((c) => ({
        id: c.id, nome: c.nome, tipo: c.tipo, ativo: c.ativo,
      })) as CategoriaFinanceiraLite[];
    },
    enabled: open,
  });
  const categoriasFiltradas = useMemo(
    () => categorias.filter((c) => c.tipo === tipoCategoria),
    [categorias, tipoCategoria],
  );

  // Limpa categoria se não bate com o tipo (ao trocar receber<->pagar)
  useEffect(() => {
    if (categoriaId === NONE) return;
    const ok = categoriasFiltradas.some((c) => c.id === categoriaId);
    if (!ok) setCategoriaId(NONE);
  }, [categoriaId, categoriasFiltradas]);

  const { data: clientes = [] } = useClientes();
  const { data: fornecedores = [] } = useFornecedores();

  const valorNum = parseValor(valor);
  const podeSalvar = descricao.trim().length > 0 && valorNum > 0 && !!dataVencimento && !!tipo;

  const salvar = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const input: EditarLancamentoAvulsoInput = {
          lancamento_id: props.lancamento.id,
          descricao: descricao.trim(),
          valor: valorNum,
          data_vencimento: dataVencimento,
          data_emissao: dataEmissao || null,
          categoria_id: categoriaId === NONE ? null : categoriaId,
          cliente_id: tipo === "receber" && clienteId !== NONE ? clienteId : null,
          fornecedor_id: tipo === "pagar" && fornecedorId !== NONE ? fornecedorId : null,
          numero_documento: numeroDocumento.trim() || null,
          forma_pagamento: formaPagamento === NONE ? null : (formaPagamento as FormaPag),
          observacoes: observacoes.trim() || null,
          client_uuid: clientUuid || null,
        };
        await dataClient.financeiro.editarLancamentoAvulso(input);
      } else {
        const input: CriarLancamentoAvulsoInput = {
          tipo,
          descricao: descricao.trim(),
          valor: valorNum,
          data_vencimento: dataVencimento,
          data_emissao: dataEmissao || null,
          categoria_id: categoriaId === NONE ? null : categoriaId,
          cliente_id: tipo === "receber" && clienteId !== NONE ? clienteId : null,
          fornecedor_id: tipo === "pagar" && fornecedorId !== NONE ? fornecedorId : null,
          numero_documento: numeroDocumento.trim() || null,
          forma_pagamento: formaPagamento === NONE ? null : (formaPagamento as FormaPag),
          observacoes: observacoes.trim() || null,
          client_uuid: clientUuid || null,
        };
        await dataClient.financeiro.criarLancamentoAvulso(input);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      qc.invalidateQueries({ queryKey: ["financeiro_indicadores_mes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["relatorio_contas_receber"] });
      toast.success(
        isEdit
          ? "Lançamento atualizado."
          : tipo === "receber"
            ? "Conta a receber criada."
            : "Conta a pagar criada.",
      );
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error(e.message ?? (isEdit ? "Falha ao editar." : "Falha ao criar lançamento.")),
  });

  useHotkeys(
    [
      {
        key: "Enter",
        allowInInputs: true,
        handler: (e) => {
          const active = document.activeElement as HTMLElement | null;
          if (active && active.tagName === "TEXTAREA") return;
          if (!podeSalvar || salvar.isPending) return;
          e.preventDefault();
          salvar.mutate();
        },
      },
      {
        key: "Escape",
        allowInInputs: true,
        handler: () => {
          if (!salvar.isPending) onOpenChange(false);
        },
      },
    ],
    { enabled: open, scope: "modal" },
  );

  const permitirTrocarTipo = !isEdit && (props.permitirTrocarTipo ?? true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? "Editar lançamento"
              : tipo === "receber"
                ? "Nova conta a receber"
                : "Nova conta a pagar"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Edite os dados deste lançamento avulso."
              : "Cadastre um lançamento financeiro avulso (sem venda/compra)."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Tipo */}
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(v) => setTipo(v as LancamentoAvulsoTipo)}
              disabled={!permitirTrocarTipo}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="receber">Conta a receber</SelectItem>
                <SelectItem value="pagar">Conta a pagar</SelectItem>
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-[11px] text-muted-foreground">
                O tipo não pode ser alterado. Para mudar, exclua e recrie.
              </p>
            )}
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <Label htmlFor="lan-desc">Descrição *</Label>
            <Input
              id="lan-desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Aluguel mês 11"
              autoFocus
            />
          </div>

          {/* Valor / Vencimento */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lan-valor">Valor *</Label>
              <Input
                id="lan-valor"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lan-venc">Vencimento *</Label>
              <Input
                id="lan-venc"
                type="date"
                value={dataVencimento}
                onChange={(e) => setDataVencimento(e.target.value)}
              />
            </div>
          </div>

          {/* Emissão / Forma */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lan-emissao">Emissão</Label>
              <Input
                id="lan-emissao"
                type="date"
                value={dataEmissao}
                onChange={(e) => setDataEmissao(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Forma prevista</Label>
              <Select
                value={formaPagamento}
                onValueChange={(v) => setFormaPagamento(v as FormaPag | typeof NONE)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="cartao_debito">Débito</SelectItem>
                  <SelectItem value="cartao_credito">Crédito</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="ifood">iFood</SelectItem>
                  <SelectItem value="fiado">Fiado</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Categoria */}
          <div className="space-y-1.5">
            <Label>Categoria ({tipoCategoria})</Label>
            <Select value={categoriaId} onValueChange={setCategoriaId}>
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— sem categoria —</SelectItem>
                {categoriasFiltradas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categoriasFiltradas.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Nenhuma categoria de {tipoCategoria} cadastrada.
              </p>
            )}
          </div>

          {/* Cliente OU Fornecedor */}
          {tipo === "receber" ? (
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <ClienteSearchSelect
                value={clienteId}
                clientes={clientes}
                extraOptions={[{ value: NONE, label: "— sem cliente —" }]}
                onChange={(v) => setClienteId(v)}
                placeholder="—"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Fornecedor</Label>
              <FornecedorSearchSelect
                value={fornecedorId}
                fornecedores={fornecedores}
                filter={() => true}
                extraOptions={[{ value: NONE, label: "— sem fornecedor —" }]}
                onChange={(v) => setFornecedorId(v)}
                placeholder="—"
              />
            </div>
          )}

          {/* Documento */}
          <div className="space-y-1.5">
            <Label htmlFor="lan-doc">Nº do documento</Label>
            <Input
              id="lan-doc"
              value={numeroDocumento}
              onChange={(e) => setNumeroDocumento(e.target.value)}
              placeholder="Ex.: NF 1234"
            />
          </div>

          {/* Observações */}
          <div className="space-y-1.5">
            <Label htmlFor="lan-obs">Observações</Label>
            <Textarea
              id="lan-obs"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvar.isPending}>
            Cancelar <kbd className="ml-2 rounded bg-muted px-1.5 text-[10px]">Esc</kbd>
          </Button>
          <Button
            onClick={() => salvar.mutate()}
            disabled={!podeSalvar || salvar.isPending}
            className="bg-success text-success-foreground hover:bg-success/90"
          >
            {salvar.isPending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar lançamento"}
            <kbd className="ml-2 rounded bg-background/20 px-1.5 text-[10px]">Enter</kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
