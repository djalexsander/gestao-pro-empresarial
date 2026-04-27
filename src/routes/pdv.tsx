import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScanLine,
  Search,
  Trash2,
  X,
  ShoppingBag,
  User,
  Camera,
  Receipt,
  Loader2,
  Package,
  CheckCircle2,
  Eraser,
  LogOut,
  ArrowLeft,
  Boxes,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScannerDialog } from "@/components/scanner/ScannerDialog";
import { FinalizarVendaDialog } from "@/components/pdv/FinalizarVendaDialog";
import { VendaSucessoDialog } from "@/components/pdv/VendaSucessoDialog";
import {
  buscarProdutoPorCodigo,
  type ProdutoBuscaResult,
} from "@/hooks/useProdutoCodigo";
import { buscarProdutoPorPlu } from "@/hooks/useProdutoPorPlu";
import { useBalancaConfig } from "@/hooks/useBalancaConfig";
import { parseEtiquetaBalanca, calcularPesoEValor } from "@/lib/balanca";
import { PesoDialog } from "@/components/pdv/PesoDialog";
import { ConsultarPrecoDialog } from "@/components/pdv/ConsultarPrecoDialog";
import { MultiplicadorDialog } from "@/components/pdv/MultiplicadorDialog";
import { useScanner } from "@/hooks/useScanner";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useProdutos } from "@/hooks/useProdutos";
import {
  useClientes,
  checkDocumentoDuplicado,
  type ClienteLite,
} from "@/hooks/useClientes";
import { useSaldosLote, type FormaPagamento, type StatusPagamento } from "@/hooks/useVendas";
import { useSomPDV } from "@/hooks/useSomPDV";
import { ClienteDialog } from "@/components/clientes/ClienteDialog";
import { UserPlus, IdCard, AlertCircle } from "lucide-react";
import {
  classificarDocumento,
  formatarDocumento,
  maskDocumentoProgressivo,
  somenteDigitos,
  validarDocumento,
} from "@/lib/documento";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperador } from "@/components/auth/OperadorProvider";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { TerminalAtualBadge } from "@/components/auth/TerminalSelector";
import { RequirePosSession } from "@/components/auth/RequirePosSession";
import { PdvErrorBoundary } from "@/components/pdv/PdvErrorBoundary";
import {
  PdvQuickViewDialog,
  type PdvQuickViewKey,
} from "@/components/pdv/PdvQuickViewDialog";
import { useUserRole } from "@/hooks/useUserRole";
import { useCaixaAberto, useCaixaResumo } from "@/hooks/useCaixa";
import { FecharCaixaDialog } from "@/components/caixa/FecharCaixaDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/mock-data";

export const Route = createFileRoute("/pdv")({
  head: () => ({
    meta: [
      { title: "PDV — Nova Venda — Gestão Pro" },
      {
        name: "description",
        content: "Frente de caixa para vendas rápidas com leitura de código de barras.",
      },
    ],
  }),
  component: () => (
    <RequirePosSession>
      <PdvErrorBoundary>
        <PDVPage />
      </PdvErrorBoundary>
    </RequirePosSession>
  ),
});

interface VendaItem {
  key: string; // identificador único na tela (produto + variacao)
  produto_id: string;
  sku: string;
  nome: string;
  unidade: string;
  preco_unitario: number;
  quantidade: number;
  desconto: number; // valor absoluto por linha
  // ===== Vendido por peso / auditoria de balança =====
  vendido_por_peso?: boolean;
  /** Preço por KG (snapshot) — só para vendido_por_peso. */
  preco_por_kg?: number;
  /** Casas decimais para exibir a quantidade. */
  casas_decimais?: number;
  /** Auditoria — preenchido quando o item entra via etiqueta da balança ou peso manual. */
  codigo_lido?: string;
  plu_extraido?: string;
  peso_extraido?: number;
  valor_extraido?: number;
  tipo_interpretacao?: "peso" | "valor" | "manual";
}

const DEFAULT_FOCUS_DELAY = 30;

function PDVPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { operador, trocarOperador } = useOperador();
  const { terminal } = useTerminal();
  const { data: produtos = [], isLoading: loadingProdutos } = useProdutos();
  const { data: clientes = [] } = useClientes();
  const { data: caixaAberto } = useCaixaAberto(operador?.id ?? null);
  const { data: resumoCaixa } = useCaixaResumo(caixaAberto?.id);

  // Modal de fechamento de caixa (acionado por Voltar/Encerrar).
  // exitAfterClose = quando o caixa for fechado com sucesso, encerra a sessão
  // do operador e volta para /pos. Usado nos botões Voltar e Encerrar.
  const [fecharCaixaOpen, setFecharCaixaOpen] = useState(false);
  const exitAfterCloseRef = useRef(false);

  // Quando o caixa some (foi fechado), saímos do PDV de volta para /pos
  // se o usuário tinha pedido para sair. Isso roda depois que o React Query
  // invalida o cache em useFecharCaixa.
  useEffect(() => {
    if (!exitAfterCloseRef.current) return;
    if (caixaAberto) return;
    exitAfterCloseRef.current = false;
    trocarOperador();
    navigate({ to: "/hub" });
  }, [caixaAberto, navigate, trocarOperador]);

  // Bloqueia fechamento da aba/janela enquanto houver caixa aberto.
  useEffect(() => {
    if (!caixaAberto) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [caixaAberto]);

  function handleSair() {
    if (caixaAberto) {
      exitAfterCloseRef.current = true;
      setFecharCaixaOpen(true);
      toast.info("É necessário fechar o caixa antes de sair.");
      return;
    }
    // sem caixa aberto (estado raro): apenas encerra operador e volta ao HUB
    trocarOperador();
    navigate({ to: "/hub" });
  }


  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<VendaItem[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [consultaPrecoOpen, setConsultaPrecoOpen] = useState(false);
  const [multDialogOpen, setMultDialogOpen] = useState(false);
  /** Multiplicador ativo aplicado à PRÓXIMA bipagem de produto não-pesado. */
  const [multiplicador, setMultiplicador] = useState<number>(1);
  const [confirmClear, setConfirmClear] = useState<null | "clear" | "cancel">(
    null,
  );
  const [cliente, setCliente] = useState<ClienteLite | null>(null);
  const [clientePopoverOpen, setClientePopoverOpen] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null);
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [finalizarOpen, setFinalizarOpen] = useState(false);
  const [sucessoOpen, setSucessoOpen] = useState(false);
  const [quickView, setQuickView] = useState<PdvQuickViewKey | null>(null);
  const { isCaixa, isAdminLike } = useUserRole();
  const podeAcessarRapido = isCaixa || isAdminLike;
  const [vendaConcluida, setVendaConcluida] = useState<null | {
    id: string;
    numero: string | null;
    total: number;
    subtotal: number;
    desconto: number;
    totalItens: number;
    forma: FormaPagamento;
    status: StatusPagamento;
    troco: number;
    valorRecebido: number | null;
    cliente: { nome: string; documento?: string | null } | null;
    operador: string | null;
    observacao: string | null;
    itens: Array<{
      descricao: string;
      sku: string;
      quantidade: number;
      unidade: string;
      preco_unitario: number;
      desconto: number;
      total: number;
    }>;
    data: Date;
  }>(null);

  const [novoClienteOpen, setNovoClienteOpen] = useState(false);
  const [novoClienteDoc, setNovoClienteDoc] = useState<string | null>(null);

  // ============ Busca por CPF/CNPJ ============
  const [docQuery, setDocQuery] = useState("");
  const [docLookupBusy, setDocLookupBusy] = useState(false);
  // Quando true, a busca por Enter já foi disparada e não encontrou cliente.
  // Habilita ArrowDown para mover foco até "Cadastrar com este documento".
  const [docBuscaSemResultado, setDocBuscaSemResultado] = useState(false);
  const docQueryInputRef = useRef<HTMLInputElement>(null);
  const cadastrarComDocBtnRef = useRef<HTMLButtonElement>(null);
  const cadastrarNovoBtnRef = useRef<HTMLButtonElement>(null);
  const docInfo = validarDocumento(docQuery);
  const docDigits = somenteDigitos(docQuery);
  const matchLocalPorDoc = useMemo<ClienteLite | null>(() => {
    if (!docDigits) return null;
    return (
      clientes.find((c) => (c.documento ?? "").replace(/\D+/g, "") === docDigits) ?? null
    );
  }, [clientes, docDigits]);

  // Reset da flag de "sem resultado" sempre que o usuário muda o documento.
  useEffect(() => {
    setDocBuscaSemResultado(false);
  }, [docQuery]);

  async function handleSelecionarPorDoc() {
    if (!docInfo.tipo) {
      toast.warning("Digite um CPF (11) ou CNPJ (14) completo.");
      docQueryInputRef.current?.focus();
      return;
    }
    if (!docInfo.valido) {
      toast.error(`${docInfo.tipo} inválido. Confira os dígitos.`);
      docQueryInputRef.current?.focus();
      return;
    }
    // Hit local primeiro
    if (matchLocalPorDoc) {
      setCliente(matchLocalPorDoc);
      setClientePopoverOpen(false);
      setDocQuery("");
      setDocBuscaSemResultado(false);
      som.beep("ok");
      toast.success(`Cliente "${matchLocalPorDoc.nome}" selecionado.`);
      return;
    }
    // Fallback no servidor (caso ainda não esteja no cache local)
    setDocLookupBusy(true);
    try {
      const found = await checkDocumentoDuplicado(docDigits);
      if (found) {
        const lite: ClienteLite = {
          id: found.id,
          nome: found.nome,
          nome_fantasia: found.nome_fantasia ?? null,
          documento: found.documento ?? null,
        };
        setCliente(lite);
        setClientePopoverOpen(false);
        setDocQuery("");
        setDocBuscaSemResultado(false);
        som.beep("ok");
        toast.success(`Cliente "${found.nome}" selecionado.`);
      } else {
        som.beep("warn");
        setDocBuscaSemResultado(true);
        toast.message("Nenhum cliente com este documento.", {
          description: "↓ para selecionar 'Cadastrar com este documento' e Enter.",
        });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDocLookupBusy(false);
    }
  }

  // F4 = abrir popover de cliente / focar no campo de CPF/CNPJ.
  // Se já estiver aberto, apenas reposiciona o foco no input.
  function abrirOuFocarBuscaCliente() {
    if (!clientePopoverOpen) {
      setClientePopoverOpen(true);
      // Foco será aplicado pelo efeito abaixo, quando o popover montar.
    } else {
      docQueryInputRef.current?.focus();
      docQueryInputRef.current?.select();
    }
  }

  // Foco automático no input de CPF/CNPJ ao abrir o popover de cliente.
  useEffect(() => {
    if (!clientePopoverOpen) return;
    const t = setTimeout(() => {
      docQueryInputRef.current?.focus();
      docQueryInputRef.current?.select();
    }, 60);
    return () => clearTimeout(t);
  }, [clientePopoverOpen]);

  function handleCadastrarComDoc() {
    if (!docInfo.tipo) {
      toast.warning("Digite um CPF (11) ou CNPJ (14) completo.");
      return;
    }
    if (!docInfo.valido) {
      toast.error(`${docInfo.tipo} inválido. Confira os dígitos.`);
      return;
    }
    if (matchLocalPorDoc) {
      setCliente(matchLocalPorDoc);
      setClientePopoverOpen(false);
      setDocQuery("");
      toast.info(`Cliente já cadastrado: ${matchLocalPorDoc.nome}.`);
      return;
    }
    setNovoClienteDoc(docDigits);
    setClientePopoverOpen(false);
    setNovoClienteOpen(true);
  }

  const saldosLote = useSaldosLote();
  const som = useSomPDV();

  const scanInputRef = useRef<HTMLInputElement>(null);
  const manualSearchInputRef = useRef<HTMLInputElement>(null);

  // Quando a busca manual abrir (clique ou F9), garante foco no campo de
  // pesquisa imediatamente, sem precisar do mouse.
  useEffect(() => {
    if (!searchPopoverOpen) return;
    const id = requestAnimationFrame(() => {
      manualSearchInputRef.current?.focus();
      manualSearchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [searchPopoverOpen]);

  // Foco automático no campo de leitura
  useEffect(() => {
    const t = setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
    return () => clearTimeout(t);
  }, []);

  // Restaura foco quando abre/fecha popovers/dialogs
  useEffect(() => {
    if (
      !scannerOpen &&
      !clientePopoverOpen &&
      !searchPopoverOpen &&
      !confirmClear &&
      !finalizarOpen &&
      !sucessoOpen &&
      !multDialogOpen
    ) {
      const t = setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
      return () => clearTimeout(t);
    }
  }, [scannerOpen, clientePopoverOpen, searchPopoverOpen, confirmClear, finalizarOpen, sucessoOpen, multDialogOpen]);

  // ============ Totais ============
  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (acc, it) => acc + it.preco_unitario * it.quantidade,
      0,
    );
    const descontoTotal = items.reduce((acc, it) => acc + it.desconto, 0);
    const total = Math.max(0, subtotal - descontoTotal);
    const totalItens = items.reduce((acc, it) => acc + it.quantidade, 0);
    return { subtotal, descontoTotal, total, totalItens };
  }, [items]);

  // ============ Adicionar item ============
  function addItemFromProduto(
    p: {
      produto_id: string;
      sku: string;
      nome: string;
      unidade: string;
      preco_venda: number;
    },
    opts?: {
      quantidade?: number;
      precoUnitario?: number;
      mergeable?: boolean;
      // Metadados de peso/auditoria de balança (opcionais).
      vendido_por_peso?: boolean;
      preco_por_kg?: number;
      casas_decimais?: number;
      codigo_lido?: string;
      plu_extraido?: string;
      peso_extraido?: number;
      valor_extraido?: number;
      tipo_interpretacao?: "peso" | "valor" | "manual";
    },
  ) {
    const qty = opts?.quantidade ?? 1;
    const preco = opts?.precoUnitario ?? (Number(p.preco_venda) || 0);
    // ⚠️ Política do PDV: cada bipagem cria uma linha nova.
    // Mergeable é opt-in apenas em fluxos específicos (não usado atualmente).
    const mergeable = opts?.mergeable ?? false;
    setItems((prev) => {
      if (mergeable) {
        const idx = prev.findIndex((it) => it.produto_id === p.produto_id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], quantidade: next[idx].quantidade + qty };
          setLastAddedKey(next[idx].key);
          return next;
        }
      }
      const novo: VendaItem = {
        key: `${p.produto_id}-${Date.now()}`,
        produto_id: p.produto_id,
        sku: p.sku,
        nome: p.nome,
        unidade: p.unidade,
        preco_unitario: preco,
        quantidade: qty,
        desconto: 0,
        vendido_por_peso: opts?.vendido_por_peso,
        preco_por_kg: opts?.preco_por_kg,
        casas_decimais: opts?.casas_decimais,
        codigo_lido: opts?.codigo_lido,
        plu_extraido: opts?.plu_extraido,
        peso_extraido: opts?.peso_extraido,
        valor_extraido: opts?.valor_extraido,
        tipo_interpretacao: opts?.tipo_interpretacao,
      };
      setLastAddedKey(novo.key);
      return [novo, ...prev];
    });
  }

  // ============ Balança / peso ============
  const { data: balancaCfg } = useBalancaConfig();
  const [pesoDialog, setPesoDialog] = useState<{
    produto_id: string;
    sku: string;
    nome: string;
    unidade: string;
    preco_venda: number;
    casas_decimais: number;
  } | null>(null);

  // ============ Buscar por código ============
  async function handleScanCode(value: string) {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      // 1) Tenta produto normal pelo código exato
      const found = await buscarProdutoPorCodigo(v);
      if (found) {
        if (found.status !== "ativo") {
          som.beep("warn");
          toast.warning(`Produto "${found.nome}" está ${found.status}.`);
        } else {
          som.beep("ok");
        }
        // Se for vendido por peso, abre diálogo de peso ao bipar PLU/SKU avulso
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fAny = found as any;
        if (fAny.vendido_por_peso) {
          setPesoDialog({
            produto_id: found.produto_id,
            sku: found.sku,
            nome: found.nome,
            unidade: found.unidade,
            preco_venda: found.preco_venda,
            casas_decimais: Number(fAny.casas_decimais_quantidade ?? 3),
          });
          return;
        }
        const qtdAplicada = multiplicador > 1 ? multiplicador : 1;
        addItemFromProduto(
          {
            produto_id: found.produto_id,
            sku: found.sku,
            nome: found.nome,
            unidade: found.unidade,
            preco_venda: found.preco_venda,
          },
          { quantidade: qtdAplicada },
        );
        if (qtdAplicada > 1) {
          toast.success(
            `+ ${found.nome} × ${qtdAplicada}`,
            { duration: 1400 },
          );
          setMultiplicador(1); // reset após aplicar
        } else {
          toast.success(`+ ${found.nome}`, { duration: 1200 });
        }
        return;
      }

      // 2) Não achou — se balança ativa, tenta interpretar como etiqueta
      if (balancaCfg?.ativo) {
        const parsed = parseEtiquetaBalanca(v, balancaCfg);
        if (parsed.ok) {
          const prod = await buscarProdutoPorPlu(parsed.plu);
          if (!prod) {
            som.beep("error");
            toast.error("Produto da etiqueta não encontrado. Verifique o PLU.");
            return;
          }
          if (!prod.vendido_por_peso || !prod.aceita_etiqueta_balanca) {
            som.beep("error");
            toast.error(
              "Produto encontrado, mas não está configurado para venda por peso/etiqueta.",
            );
            return;
          }
          if (prod.preco_venda <= 0) {
            som.beep("error");
            toast.error("Preço por KG zerado. Configure o produto.");
            return;
          }
          const calc = calcularPesoEValor(parsed, prod.preco_venda);
          if ("erro" in calc) {
            som.beep("error");
            toast.error(calc.erro);
            return;
          }
          som.beep("ok");
          addItemFromProduto(
            {
              produto_id: prod.produto_id,
              sku: prod.sku,
              nome: prod.nome,
              unidade: "KG",
              preco_venda: prod.preco_venda,
            },
            {
              quantidade: calc.quantidade,
              precoUnitario: prod.preco_venda,
              mergeable: false,
              vendido_por_peso: true,
              preco_por_kg: prod.preco_venda,
              casas_decimais: 3,
              codigo_lido: v,
              plu_extraido: parsed.plu,
              peso_extraido: calc.quantidade,
              valor_extraido:
                parsed.tipo === "valor" ? calc.valor_total : undefined,
              tipo_interpretacao: parsed.tipo === "valor" ? "valor" : "peso",
            },
          );
          toast.success(
            `+ ${prod.nome} • ${calc.quantidade.toFixed(3)} KG = R$ ${calc.valor_total.toFixed(2)}`,
            { duration: 1800 },
          );
          return;
        }
      }

      som.beep("error");
      toast.error(`Produto não encontrado para "${v}"`);
    } catch (e) {
      som.beep("error");
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setCode("");
      setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
    }
  }

  // Scanner USB global
  useScanner((scanned) => handleScanCode(scanned), { enabled: true });

  // ============ Atalhos globais do PDV ============
  const [hotkeyFlash, setHotkeyFlash] = useState<string | null>(null);
  function flashHotkey(key: string) {
    setHotkeyFlash(key);
    window.setTimeout(() => {
      setHotkeyFlash((cur) => (cur === key ? null : cur));
    }, 350);
  }

  // F1 produtos · F2 estoque · F3 compras · F7 nova · F8 limpar · F9 buscar · F10 finalizar
  useHotkeys(
    [
      {
        key: "F1",
        allowInInputs: true,
        handler: () => {
          if (!podeAcessarRapido || quickView) return;
          flashHotkey("F1");
          setQuickView("produtos");
        },
      },
      {
        key: "F2",
        allowInInputs: true,
        handler: () => {
          if (!podeAcessarRapido || quickView) return;
          flashHotkey("F2");
          setQuickView("estoque");
        },
      },
      {
        key: "F3",
        allowInInputs: true,
        handler: () => {
          if (!podeAcessarRapido || quickView) return;
          flashHotkey("F3");
          setQuickView("compras");
        },
      },
      {
        key: "F7",
        allowInInputs: true,
        handler: () => {
          flashHotkey("F7");
          if (items.length > 0) {
            setConfirmClear("clear");
          } else {
            scanInputRef.current?.focus();
          }
        },
      },
      {
        key: "F8",
        allowInInputs: true,
        handler: () => {
          flashHotkey("F8");
          if (items.length > 0) setConfirmClear("clear");
        },
      },
      {
        key: "F4",
        allowInInputs: true,
        handler: () => {
          flashHotkey("F4");
          abrirOuFocarBuscaCliente();
        },
      },
      {
        key: "F5",
        allowInInputs: true,
        handler: () => {
          flashHotkey("F5");
          setMultDialogOpen(true);
        },
      },
      {
        key: "F6",
        allowInInputs: true,
        handler: () => {
          flashHotkey("F6");
          setConsultaPrecoOpen(true);
        },
      },
      {
        key: "F9",
        allowInInputs: true,
        handler: () => {
          flashHotkey("F9");
          setSearchPopoverOpen(true);
        },
      },
      {
        key: "F10",
        allowInInputs: true,
        handler: () => {
          flashHotkey("F10");
          if (items.length > 0 && !finalizarOpen) finalizarVenda();
        },
      },
      {
        key: "Escape",
        allowInInputs: true,
        handler: () => {
          // ESC: 1º cancela multiplicador ativo (mesmo com foco no input
          // principal), depois cancela venda em andamento.
          if (multiplicador > 1) {
            setMultiplicador(1);
            toast.info("Multiplicador cancelado.");
            // Devolve o foco ao campo principal do produto.
            setTimeout(() => scanInputRef.current?.focus(), 0);
            return;
          }
          if (
            items.length > 0 &&
            !finalizarOpen &&
            !sucessoOpen &&
            !confirmClear &&
            !scannerOpen
          ) {
            setConfirmClear("cancel");
          }
        },
      },
    ],
    {
      // Escopo "page": atalhos do PDV ficam suspensos automaticamente
      // enquanto qualquer modal (Finalizar, Sucesso, Scanner) estiver no
      // topo do stack. Os guards abaixo são redundância defensiva.
      enabled:
        !finalizarOpen &&
        !sucessoOpen &&
        !scannerOpen &&
        !quickView &&
        !consultaPrecoOpen &&
        !multDialogOpen,
      scope: "page",
    },
  );

  function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    handleScanCode(code);
  }

  // ============ Remover linha ============
  // Cada bipagem cria uma nova linha; a única ação por linha é excluir.
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function clearVenda() {
    setItems([]);
    setObservacao("");
    setLastAddedKey(null);
    setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
  }

  function cancelVenda() {
    // Cancelar venda NUNCA sai do PDV — apenas limpa o que foi montado.
    clearVenda();
    setCliente(null);
  }

  async function finalizarVenda() {
    if (items.length === 0) {
      toast.warning("Adicione ao menos um item à venda.");
      return;
    }

    // ============ Validação de estoque ============
    try {
      const ids = Array.from(new Set(items.map((it) => it.produto_id)));
      const saldos = await saldosLote.mutateAsync(ids);
      const req = new Map<string, number>();
      for (const it of items) {
        req.set(it.produto_id, (req.get(it.produto_id) ?? 0) + it.quantidade);
      }
      const insuficientes: string[] = [];
      for (const [pid, qty] of req.entries()) {
        const saldo = saldos.get(pid) ?? 0;
        if (saldo < qty) {
          const it = items.find((i) => i.produto_id === pid);
          insuficientes.push(
            `${it?.nome ?? pid} (saldo ${saldo}, pedido ${qty})`,
          );
        }
      }
      if (insuficientes.length > 0) {
        const msg = "Estoque insuficiente:\n• " + insuficientes.join("\n• ");
        const ok = window.confirm(
          msg + "\n\nDeseja continuar mesmo assim? O estoque ficará negativo.",
        );
        if (!ok) {
          toast.warning("Venda não finalizada — estoque insuficiente.");
          return;
        }
        toast.warning("Atenção: venda gerará estoque negativo.");
      }
    } catch (e) {
      toast.error(`Falha ao validar estoque: ${(e as Error).message}`);
      return;
    }

    setFinalizarOpen(true);
  }

  // ============ Busca manual ============
  const filteredProdutos = useMemo(() => {
    const q = manualQuery.trim().toLowerCase();
    if (!q) return produtos.slice(0, 25);
    return produtos
      .filter((p) => {
        return (
          p.nome.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.codigo_barras ?? "").toLowerCase().includes(q) ||
          (p.codigo_interno ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 50);
  }, [produtos, manualQuery]);

  // ============ Render ============
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Topbar próprio do PDV (sem ERP) */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">PDV — Nova Venda</span>
          <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">
            Frente de caixa
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <TerminalAtualBadge />
          <Badge variant="secondary" className="gap-1">
            <User className="h-3 w-3" />
            {operador?.nome ?? user?.email ?? "—"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSair}
            title="Encerrar operador — exige fechamento do caixa"
          >
            <LogOut className="mr-1 h-4 w-4" /> Encerrar
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
      {/* Header da venda */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              PDV — Nova Venda
              <Badge variant="outline" className="text-xs font-normal">
                Frente de caixa
              </Badge>
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                Operador:{" "}
                <span className="font-medium text-foreground">
                  {operador?.nome ?? user?.email ?? "—"}
                </span>
              </span>
              <span className="hidden items-center gap-1.5 sm:flex">
                {podeAcessarRapido && (
                  <>
                    <PdvKbd flash={hotkeyFlash === "F1"}>F1</PdvKbd>
                    <span>produtos</span>
                    <PdvKbd flash={hotkeyFlash === "F2"}>F2</PdvKbd>
                    <span>estoque</span>
                    <PdvKbd flash={hotkeyFlash === "F3"}>F3</PdvKbd>
                    <span>compras</span>
                    <span className="mx-1 text-border">·</span>
                  </>
                )}
                <PdvKbd flash={hotkeyFlash === "F4"}>F4</PdvKbd>
                <span>cliente</span>
                <PdvKbd flash={hotkeyFlash === "F5"}>F5</PdvKbd>
                <span>multiplicador</span>
                <PdvKbd flash={hotkeyFlash === "F6"}>F6</PdvKbd>
                <span>preço</span>
                <PdvKbd flash={hotkeyFlash === "F7"}>F7</PdvKbd>
                <span>nova</span>
                <PdvKbd flash={hotkeyFlash === "F8"}>F8</PdvKbd>
                <span>limpar</span>
                <PdvKbd flash={hotkeyFlash === "F9"}>F9</PdvKbd>
                <span>buscar</span>
                <PdvKbd flash={hotkeyFlash === "F10"}>F10</PdvKbd>
                <span>finalizar</span>
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {podeAcessarRapido && (
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-1.5 py-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 px-2.5"
                onClick={() => setQuickView("produtos")}
                title="Abrir Produtos (F1)"
              >
                <Package className="h-4 w-4" />
                Produtos
                <PdvKbd className="ml-0.5">F1</PdvKbd>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 px-2.5"
                onClick={() => setQuickView("estoque")}
                title="Abrir Estoque (F2)"
              >
                <Boxes className="h-4 w-4" />
                Estoque
                <PdvKbd className="ml-0.5">F2</PdvKbd>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 px-2.5"
                onClick={() => setQuickView("compras")}
                title="Abrir Compras (F3)"
              >
                <ShoppingCart className="h-4 w-4" />
                Compras
                <PdvKbd className="ml-0.5">F3</PdvKbd>
              </Button>
            </div>
          )}
          <Popover open={clientePopoverOpen} onOpenChange={setClientePopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" title="Buscar/selecionar cliente (F4)">
                <User className="h-4 w-4" />
                {cliente ? cliente.nome : "Cliente: Consumidor"}
                <PdvKbd className="ml-1">F4</PdvKbd>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-0">
              {/* Busca por CPF/CNPJ — antiduplicidade */}
              <div className="space-y-2 border-b border-border bg-muted/30 p-3">
                <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <IdCard className="h-3.5 w-3.5" />
                  Buscar por CPF / CNPJ
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    ref={docQueryInputRef}
                    value={docQuery}
                    onChange={(e) =>
                      setDocQuery(maskDocumentoProgressivo(e.target.value))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSelecionarPorDoc();
                        return;
                      }
                      if (e.key === "ArrowDown") {
                        // Move foco para a opção de cadastro quando aplicável.
                        const target =
                          docInfo.valido && !matchLocalPorDoc
                            ? cadastrarComDocBtnRef.current
                            : cadastrarNovoBtnRef.current;
                        if (target) {
                          e.preventDefault();
                          target.focus();
                        }
                      }
                    }}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label="Buscar cliente por CPF ou CNPJ"
                    className={cn(
                      "h-9 font-mono text-sm",
                      docInfo.tipo && !docInfo.valido &&
                        "border-destructive focus-visible:ring-destructive",
                      docInfo.valido && "border-success focus-visible:ring-success",
                    )}
                  />
                  <Button
                    size="sm"
                    type="button"
                    onClick={handleSelecionarPorDoc}
                    disabled={!docInfo.valido || docLookupBusy}
                  >
                    {docLookupBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Buscar
                  </Button>
                </div>

                {/* Feedback */}
                {docQuery && !docInfo.tipo && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <AlertCircle className="h-3 w-3" />
                    Digite os {classificarDocumento(docQuery) === null ? "11 dígitos do CPF ou 14 do CNPJ" : ""}.
                  </p>
                )}
                {docInfo.tipo && !docInfo.valido && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {docInfo.tipo} inválido — confira os dígitos.
                  </p>
                )}
                {docInfo.valido && matchLocalPorDoc && (
                  <div className="rounded-md border border-success/30 bg-success/10 p-2 text-xs">
                    <p className="font-medium text-success">
                      Cliente já cadastrado:
                    </p>
                    <p className="mt-0.5 truncate">
                      {matchLocalPorDoc.nome}{" "}
                      <span className="text-muted-foreground">
                        ({formatarDocumento(matchLocalPorDoc.documento ?? "")})
                      </span>
                    </p>
                  </div>
                )}
                {docInfo.valido && !matchLocalPorDoc && (
                  <Button
                    ref={cadastrarComDocBtnRef}
                    type="button"
                    variant={docBuscaSemResultado ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "w-full justify-start gap-2 focus-visible:ring-2 focus-visible:ring-primary",
                      docBuscaSemResultado && "ring-2 ring-primary ring-offset-1",
                    )}
                    onClick={handleCadastrarComDoc}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        docQueryInputRef.current?.focus();
                      }
                    }}
                  >
                    <UserPlus className="h-4 w-4" />
                    Cadastrar com este {docInfo.tipo}
                  </Button>
                )}
              </div>

              <Command>
                <CommandInput placeholder="Buscar cliente por nome..." />
                <CommandList>
                  <CommandEmpty>Nenhum cliente.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => {
                        setCliente(null);
                        setClientePopoverOpen(false);
                      }}
                    >
                      <X className="h-4 w-4" /> Sem cliente (Consumidor)
                    </CommandItem>
                    {clientes.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.nome} ${c.documento ?? ""}`}
                        onSelect={() => {
                          setCliente(c);
                          setClientePopoverOpen(false);
                        }}
                      >
                        <User className="h-4 w-4" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{c.nome}</span>
                          {c.documento && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatarDocumento(c.documento)}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
                <div className="border-t border-border p-2">
                  <Button
                    ref={cadastrarNovoBtnRef}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 text-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => {
                      setClientePopoverOpen(false);
                      setNovoClienteDoc(docDigits || null);
                      setNovoClienteOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        docQueryInputRef.current?.focus();
                      }
                    }}
                  >
                    <UserPlus className="h-4 w-4" />
                    Cadastrar novo cliente
                  </Button>
                </div>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Body: 2 colunas */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ============ LADO ESQUERDO ============ */}
        <div className="flex min-h-0 flex-col gap-3">
          {/* Campo de leitura grande */}
          <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-lg">
            {multiplicador > 1 && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded bg-warning/30 px-2 font-mono text-base font-bold text-warning-foreground">
                    {multiplicador}×
                  </span>
                  <span className="font-medium">
                    Multiplicador ativo — bique o produto
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs"
                  onClick={() => {
                    setMultiplicador(1);
                    toast.info("Multiplicador cancelado.");
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Cancelar (Esc)
                </Button>
              </div>
            )}
            <form onSubmit={handleSubmitCode} className="flex items-center gap-2">
              <div className="relative flex-1">
                <ScanLine
                  className={cn(
                    "pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 transition-colors",
                    busy ? "text-primary" : "text-primary/70",
                  )}
                />
                <Input
                  ref={scanInputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Escaneie ou digite o código de barras / QR Code…"
                  className="h-14 border-primary/40 bg-background/60 pl-12 pr-12 font-mono text-lg tracking-wider focus-visible:ring-primary"
                  autoComplete="off"
                  spellCheck={false}
                />
                {busy && (
                  <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-primary" />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-14 w-14"
                onClick={() => setScannerOpen(true)}
                title="Abrir câmera"
              >
                <Camera className="h-5 w-5" />
              </Button>
              <Button type="submit" size="lg" className="h-14 px-6" disabled={busy || !code.trim()}>
                Adicionar
              </Button>
            </form>

            {/* Busca manual inline */}
            <div className="mt-3 flex items-center gap-2">
              <Popover open={searchPopoverOpen} onOpenChange={setSearchPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
                    title="Buscar produto manualmente (F9)"
                  >
                    <Search className="h-4 w-4" />
                    Buscar produto manualmente
                    <kbd className="ml-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      F9
                    </kbd>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[420px] p-0">
                  <Command shouldFilter={false}>
                    <CommandInput
                      ref={manualSearchInputRef}
                      value={manualQuery}
                      onValueChange={setManualQuery}
                      placeholder="Nome, SKU, código de barras…"
                      autoFocus
                    />
                    <CommandList>
                      <CommandEmpty>
                        {loadingProdutos ? "Carregando..." : "Nenhum produto encontrado."}
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredProdutos.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={p.id}
                            onSelect={() => {
                              addItemFromProduto({
                                produto_id: p.id,
                                sku: p.sku,
                                nome: p.nome,
                                unidade: p.unidade,
                                preco_venda: Number(p.preco_venda) || 0,
                              });
                              setSearchPopoverOpen(false);
                              setManualQuery("");
                            }}
                          >
                            <Package className="h-4 w-4" />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate">{p.nome}</span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {p.sku}
                                {p.codigo_barras && ` · ${p.codigo_barras}`}
                              </span>
                            </div>
                            <span className="ml-2 shrink-0 tabular-nums text-xs">
                              {formatBRL(Number(p.preco_venda) || 0)}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <span className="ml-auto text-xs text-muted-foreground">
                Pressione <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">Enter</kbd> ou bipe um produto
              </span>
            </div>
          </Card>

          {/* Tabela de itens */}
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="grid grid-cols-[1fr_120px_140px_140px_44px] items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Produto</span>
              <span className="text-center">Quantidade</span>
              <span className="text-right">Unitário</span>
              <span className="text-right">Subtotal</span>
              <span />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <EmptyItems />
              ) : (
                <ul>
                  {items.map((it) => {
                    const sub = it.preco_unitario * it.quantidade - it.desconto;
                    return (
                      <li
                        key={it.key}
                        className={cn(
                          "grid grid-cols-[1fr_120px_140px_140px_44px] items-center gap-2 border-b border-border/60 px-4 py-3 transition-colors",
                          lastAddedKey === it.key && "bg-success/10 animate-in fade-in",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{it.nome}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {it.sku} · {it.unidade}
                            {it.desconto > 0 && (
                              <span className="ml-2 text-warning">
                                desc. {formatBRL(it.desconto)}
                              </span>
                            )}
                          </p>
                          {it.vendido_por_peso && (
                            <p className="mt-0.5 font-mono text-xs text-primary">
                              {it.quantidade.toFixed(it.casas_decimais ?? 3)} {it.unidade || "KG"}
                              {" × "}
                              {formatBRL(it.preco_por_kg ?? it.preco_unitario)}/{it.unidade || "KG"}
                              {" = "}
                              {formatBRL(
                                Math.max(0, it.preco_unitario * it.quantidade - it.desconto),
                              )}
                            </p>
                          )}
                        </div>
                        <div className="text-center font-mono text-sm tabular-nums">
                          {it.vendido_por_peso
                            ? `${it.quantidade.toFixed(it.casas_decimais ?? 3)} ${it.unidade || "KG"}`
                            : `${it.quantidade} ${it.unidade || "un."}`}
                        </div>
                        <div className="text-right tabular-nums">
                          {formatBRL(it.preco_unitario)}
                        </div>
                        <div className="text-right font-semibold tabular-nums">
                          {formatBRL(Math.max(0, sub))}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeItem(it.key)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </div>

        {/* ============ LADO DIREITO — RESUMO ============ */}
        <aside className="flex min-h-0 flex-col gap-3">
          <Card className="flex-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold">Resumo da venda</h3>
              <Receipt className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-4 p-4">
              <div className="space-y-2 text-sm">
                <Row label="Linhas">
                  <span className="tabular-nums">{items.length}</span>
                </Row>
                <Row label="Unidades">
                  <span className="tabular-nums text-muted-foreground">
                    {totals.totalItens.toFixed(
                      items.some((it) => it.vendido_por_peso) ? 3 : 0,
                    )}
                  </span>
                </Row>
                <Row label="Subtotal">
                  <span className="tabular-nums">{formatBRL(totals.subtotal)}</span>
                </Row>
                <Row label="Descontos">
                  <span className="tabular-nums text-warning">
                    {totals.descontoTotal > 0 ? `- ${formatBRL(totals.descontoTotal)}` : formatBRL(0)}
                  </span>
                </Row>
              </div>

              <div className="border-t border-border pt-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="font-mono text-3xl font-bold tabular-nums text-primary">
                  {formatBRL(totals.total)}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Observação
                </label>
                <Textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={2}
                  placeholder="Ex.: entrega no balcão, troco para R$ 100…"
                  className="resize-none text-sm"
                />
              </div>
            </div>
          </Card>

          {/* Ações */}
          <div className="space-y-2">
            <Button
              size="lg"
              className={cn(
                "h-14 w-full text-base font-semibold",
                hotkeyFlash === "F10" && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              onClick={finalizarVenda}
              disabled={items.length === 0}
            >
              <CheckCircle2 className="h-5 w-5" />
              Finalizar venda · {formatBRL(totals.total)}
              <PdvKbd className="ml-1 border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground">
                F10
              </PdvKbd>
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmClear("clear")}
                disabled={items.length === 0}
                className={cn(
                  hotkeyFlash === "F8" && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
              >
                <Eraser className="h-4 w-4" /> Limpar
                <PdvKbd className="ml-1">F8</PdvKbd>
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmClear("cancel")}
              >
                <X className="h-4 w-4" /> Cancelar
                <PdvKbd className="ml-1">Esc</PdvKbd>
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* Scanner por câmera */}
      <ScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        mode="any"
        onResult={(scanned) => {
          setScannerOpen(false);
          handleScanCode(scanned);
        }}
      />

      {/* Finalização da venda */}
      <FinalizarVendaDialog
        open={finalizarOpen}
        onOpenChange={setFinalizarOpen}
        itens={items.map((it) => ({
          produto_id: it.produto_id,
          quantidade: it.quantidade,
          preco_unitario: it.preco_unitario,
          desconto: it.desconto,
          descricao: it.nome,
          // Auditoria de balança (apenas quando aplicável)
          vendido_por_peso: it.vendido_por_peso,
          preco_por_kg: it.preco_por_kg ?? null,
          codigo_lido: it.codigo_lido ?? null,
          plu_extraido: it.plu_extraido ?? null,
          peso_extraido: it.peso_extraido ?? null,
          valor_extraido: it.valor_extraido ?? null,
          tipo_interpretacao: it.tipo_interpretacao ?? null,
        }))}
        subtotal={totals.subtotal}
        desconto={totals.descontoTotal}
        total={totals.total}
        totalItens={totals.totalItens}
        cliente={cliente ? { id: cliente.id, nome: cliente.nome } : null}
        observacao={observacao}
        operadorEmail={user?.email}
        onConfirmed={({ vendaId, forma, status, troco, valorRecebido }) => {
          setFinalizarOpen(false);
          som.beep("ok");
          setVendaConcluida({
            id: vendaId,
            numero: null,
            total: totals.total,
            subtotal: totals.subtotal,
            desconto: totals.descontoTotal,
            totalItens: totals.totalItens,
            forma,
            status,
            troco,
            valorRecebido: valorRecebido || null,
            cliente: cliente
              ? { nome: cliente.nome, documento: cliente.documento ?? null }
              : null,
            operador: user?.email ?? null,
            observacao: observacao || null,
            itens: items.map((it) => ({
              descricao: it.nome,
              sku: it.sku,
              quantidade: it.quantidade,
              unidade: it.unidade,
              preco_unitario: it.preco_unitario,
              desconto: it.desconto,
              total: Math.max(0, it.preco_unitario * it.quantidade - it.desconto),
            })),
            data: new Date(),
          });
          setSucessoOpen(true);
          // Limpa o carrinho mas mantém cliente para próxima venda rápida
          clearVenda();
        }}
      />

      {/* Cadastro rápido de cliente (PDV) */}
      <ClienteDialog
        open={novoClienteOpen}
        onOpenChange={(v) => {
          setNovoClienteOpen(v);
          if (!v) setNovoClienteDoc(null);
        }}
        quickMode
        defaultDocumento={novoClienteDoc}
        onSaved={(c) => {
          setCliente({
            id: c.id,
            nome: c.nome,
            nome_fantasia: c.nome_fantasia ?? null,
            documento: c.documento ?? null,
          });
          setDocQuery("");
          setNovoClienteDoc(null);
          toast.success(`Cliente "${c.nome}" selecionado para a venda.`);
        }}
      />

      {/* Sucesso pós-venda */}
      <VendaSucessoDialog
        open={sucessoOpen}
        onOpenChange={setSucessoOpen}
        venda={vendaConcluida}
        onNovaVenda={() => {
          setSucessoOpen(false);
          setVendaConcluida(null);
        }}
        onVerVendas={() => {
          // PDV é ambiente isolado: não saímos para /vendas (ERP).
          // Apenas fecha o resumo e mantém o operador no PDV.
          setSucessoOpen(false);
          setVendaConcluida(null);
          setCliente(null);
        }}
      />

      {/* Acesso rápido (modal) — Produtos / Estoque / Compras sem sair do PDV */}
      <PdvQuickViewDialog view={quickView} onClose={() => setQuickView(null)} />

      {/* Consulta de preço (F6) — somente leitura, não altera venda/estoque */}
      <ConsultarPrecoDialog
        open={consultaPrecoOpen}
        onOpenChange={setConsultaPrecoOpen}
        balancaConfig={balancaCfg ?? null}
        onClosed={() => {
          setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
        }}
      />

      {/* Multiplicador (F5) — quantidade aplicada na próxima bipagem */}
      <MultiplicadorDialog
        open={multDialogOpen}
        onOpenChange={setMultDialogOpen}
        onConfirm={(q) => {
          setMultiplicador(q);
          toast.success(`Multiplicador ativo: ${q}× — bique o produto.`, {
            duration: 2000,
          });
          setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
        }}
      />

      {/* Diálogo de peso para produtos vendidos por KG sem etiqueta da balança */}
      <PesoDialog
        open={!!pesoDialog}
        onOpenChange={(o) => !o && setPesoDialog(null)}
        produtoNome={pesoDialog?.nome ?? ""}
        precoPorKg={pesoDialog?.preco_venda ?? 0}
        casasDecimais={pesoDialog?.casas_decimais ?? 3}
        onConfirm={(pesoKg) => {
          if (!pesoDialog) return;
          som.beep("ok");
          addItemFromProduto(
            {
              produto_id: pesoDialog.produto_id,
              sku: pesoDialog.sku,
              nome: pesoDialog.nome,
              unidade: "KG",
              preco_venda: pesoDialog.preco_venda,
            },
            {
              quantidade: pesoKg,
              precoUnitario: pesoDialog.preco_venda,
              mergeable: false,
              vendido_por_peso: true,
              preco_por_kg: pesoDialog.preco_venda,
              casas_decimais: pesoDialog.casas_decimais,
              peso_extraido: pesoKg,
              tipo_interpretacao: "manual",
            },
          );
          toast.success(
            `+ ${pesoDialog.nome} • ${pesoKg.toFixed(3)} KG = R$ ${(pesoKg * pesoDialog.preco_venda).toFixed(2)}`,
            { duration: 1800 },
          );
          setPesoDialog(null);
        }}
      />

      {/* Fechamento de caixa (acionado por Voltar/Encerrar) */}
      {caixaAberto && (
        <FecharCaixaDialog
          open={fecharCaixaOpen}
          onOpenChange={(open) => {
            setFecharCaixaOpen(open);
            if (!open) {
              // usuário cancelou: não vai sair
              exitAfterCloseRef.current = false;
            }
          }}
          caixaId={caixaAberto.id}
          resumo={resumoCaixa ?? null}
        />
      )}

      {/* Confirmações */}
      <AlertDialog
        open={confirmClear !== null}
        onOpenChange={(open) => !open && setConfirmClear(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmClear === "clear" ? "Limpar venda?" : "Cancelar venda?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmClear === "clear"
                ? "Todos os itens da venda atual serão removidos. Esta ação não pode ser desfeita."
                : "A venda atual será descartada. Você continuará no PDV."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmClear === "clear") clearVenda();
                else cancelVenda();
                setConfirmClear(null);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function EmptyItems() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ScanLine className="h-7 w-7" />
      </div>
      <div>
        <p className="font-medium">Nenhum item na venda</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Bipe um código de barras ou busque um produto para começar.
        </p>
      </div>
    </div>
  );
}

function PdvKbd({
  children,
  flash,
  className,
}: {
  children: React.ReactNode;
  flash?: boolean;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[1.4rem] items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground shadow-sm transition-all",
        flash && "scale-110 border-primary bg-primary/20 text-primary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
