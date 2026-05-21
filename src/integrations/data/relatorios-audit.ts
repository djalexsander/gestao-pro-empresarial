/**
 * Onda 1 — camada audit-aware para os relatórios financeiros.
 *
 * Por que existe:
 *  - As queries antigas dependiam apenas de RLS. Se o usuário é dono de
 *    uma empresa E membro de outras, as queries retornavam dados de
 *    TODAS as empresas. Isso causa o sintoma "zerei a empresa e ainda
 *    vejo R$ 900 em contas a receber" (vinha de outra empresa).
 *  - Aqui filtramos EXPLICITAMENTE por `owner_id = empresaAtual.owner_id`.
 *  - Cancelados/estornados/rascunhos NUNCA entram nos totais.
 *  - Cada função devolve { rows, audit } para o painel Auditoria.
 *
 * Empresa zerada -> rows=[], audit.totalCalculado=0, audit.totalRegistros=0.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  classificarStatusPadrao,
  emptyAudit,
  logAudit,
  withAudit,
  type AuditedResult,
} from "@/lib/relatorios/audit";
import type {
  ContasReceberFiltro,
  DreTotaisDomain,
  FluxoCaixaLinhaDomain,
  LancamentoContasReceberDomain,
  LancamentoFinanceiroDomain,
  RelatorioRangeInput,
} from "./relatorios-adapter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLancFinanceiro(l: any): LancamentoFinanceiroDomain {
  return {
    id: l.id,
    descricao: l.descricao,
    tipo: l.tipo,
    valor: Number(l.valor) || 0,
    valor_pago: Number(l.valor_pago) || 0,
    data_emissao: l.data_emissao,
    data_vencimento: l.data_vencimento,
    data_pagamento: l.data_pagamento,
    status: l.status,
    forma_pagamento: l.forma_pagamento,
    categoria_id: l.categoria_id,
    categoria_nome: l.categoria?.nome ?? null,
    cliente_id: l.cliente?.id ?? null,
    cliente_nome: l.cliente?.nome ?? null,
    fornecedor_id: l.fornecedor?.id ?? null,
    fornecedor_nome: l.fornecedor?.nome_fantasia ?? l.fornecedor?.razao_social ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLancCR(l: any): LancamentoContasReceberDomain {
  return {
    id: l.id,
    descricao: l.descricao,
    valor: Number(l.valor) || 0,
    valor_pago: Number(l.valor_pago) || 0,
    data_emissao: l.data_emissao,
    data_vencimento: l.data_vencimento,
    data_pagamento: l.data_pagamento,
    status: l.status,
    forma_pagamento: l.forma_pagamento,
    observacoes: l.observacoes,
    numero_documento: l.numero_documento,
    cliente_id: l.cliente_id,
    cliente_nome: l.cliente?.nome ?? null,
    cliente_documento: l.cliente?.documento ?? null,
    cliente_telefone: l.cliente?.telefone ?? null,
    cliente_celular: l.cliente?.celular ?? null,
    cliente_email: l.cliente?.email ?? null,
    venda_id: l.venda_id,
    venda_numero: l.venda?.numero ?? null,
    venda_data: l.venda?.data_emissao ?? null,
    venda_total: l.venda?.total != null ? Number(l.venda.total) : null,
    conciliado_em: l.conciliado_em,
  };
}

/* ============== Fluxo Financeiro Gerencial ============== */

export async function fetchFluxoCaixaAudit(
  ownerId: string | null,
  input: RelatorioRangeInput,
): Promise<AuditedResult<FluxoCaixaLinhaDomain>> {
  const ctx = {
    relatorio: "relatorio.fluxo_caixa",
    fonte: "financeiro_lancamentos",
    ownerId,
    filtros: { inicio: input.inicio, fim: input.fim, campoData: "vencimento" },
  };
  if (!ownerId) {
    const audit = emptyAudit(ctx);
    logAudit(audit);
    return { rows: [], audit };
  }
  const { data, error } = await supabase
    .from("financeiro_lancamentos")
    .select(
      "id, descricao, tipo, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento",
    )
    .eq("owner_id", ownerId)
    .gte("data_vencimento", input.inicio)
    .lte("data_vencimento", input.fim)
    .order("data_vencimento", { ascending: false })
    .limit(5000);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brutas: FluxoCaixaLinhaDomain[] = (data ?? []).map((l: any) => ({
    id: l.id,
    descricao: l.descricao,
    tipo: l.tipo,
    valor: Number(l.valor) || 0,
    valor_pago: Number(l.valor_pago) || 0,
    emissao: l.data_emissao,
    vencimento: l.data_vencimento,
    pagamento: l.data_pagamento,
    status: l.status,
    forma: l.forma_pagamento,
  }));
  const result = withAudit(
    ctx,
    brutas,
    (r) => classificarStatusPadrao(r.status),
    (r) => r.valor,
  );
  logAudit(result.audit);
  return result;
}

/* ============== Relatório Financeiro ============== */

export async function fetchFinanceiroPeriodoAudit(
  ownerId: string | null,
  input: RelatorioRangeInput,
): Promise<AuditedResult<LancamentoFinanceiroDomain>> {
  const ctx = {
    relatorio: "relatorio.financeiro",
    fonte: "financeiro_lancamentos (+ categorias, clientes, fornecedores)",
    ownerId,
    filtros: { inicio: input.inicio, fim: input.fim, campoData: "vencimento" },
  };
  if (!ownerId) {
    const audit = emptyAudit(ctx);
    logAudit(audit);
    return { rows: [], audit };
  }
  const { data, error } = await supabase
    .from("financeiro_lancamentos")
    .select(
      `id, descricao, tipo, valor, valor_pago, data_emissao, data_vencimento,
       data_pagamento, status, forma_pagamento, categoria_id,
       categoria:categorias_financeiras(id, nome),
       cliente:clientes(id, nome),
       fornecedor:fornecedores(id, razao_social, nome_fantasia)`,
    )
    .eq("owner_id", ownerId)
    .gte("data_vencimento", input.inicio)
    .lte("data_vencimento", input.fim)
    .order("data_vencimento", { ascending: false })
    .limit(5000);
  if (error) throw error;
  const brutas = (data ?? []).map(mapLancFinanceiro);
  const result = withAudit(
    ctx,
    brutas,
    (r) => classificarStatusPadrao(r.status),
    (r) => r.valor,
  );
  logAudit(result.audit);
  return result;
}

/* ============== Contas a Receber ============== */

export async function fetchContasReceberAudit(
  ownerId: string | null,
  input: ContasReceberFiltro,
): Promise<AuditedResult<LancamentoContasReceberDomain>> {
  const ctx = {
    relatorio: "relatorio.contas_receber",
    fonte: "financeiro_lancamentos (tipo=receber)",
    ownerId,
    filtros: {
      inicio: input.inicio,
      fim: input.fim,
      campoData: input.campoData,
      clienteId: input.clienteId ?? "todos",
    },
  };
  if (!ownerId) {
    const audit = emptyAudit(ctx);
    logAudit(audit);
    return { rows: [], audit };
  }
  let q = supabase
    .from("financeiro_lancamentos")
    .select(
      `id, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento, observacoes, numero_documento, cliente_id, venda_id, conciliado_em,
       cliente:clientes(id, nome, nome_fantasia, documento, telefone, celular, email),
       venda:vendas(id, numero, data_emissao, total)`,
    )
    .eq("owner_id", ownerId)
    .eq("tipo", "receber")
    .order(
      input.campoData === "emissao"
        ? "data_emissao"
        : input.campoData === "pagamento"
          ? "data_pagamento"
          : "data_vencimento",
      { ascending: false },
    )
    .limit(5000);

  if (input.campoData === "vencimento") {
    q = q.gte("data_vencimento", input.inicio).lte("data_vencimento", input.fim);
  } else if (input.campoData === "emissao") {
    q = q.gte("data_emissao", input.inicio).lte("data_emissao", input.fim);
  } else {
    q = q
      .not("data_pagamento", "is", null)
      .gte("data_pagamento", input.inicio)
      .lte("data_pagamento", input.fim);
  }
  if (input.clienteId && input.clienteId !== "todos") {
    q = q.eq("cliente_id", input.clienteId);
  }

  const { data, error } = await q;
  if (error) throw error;
  const brutas = (data ?? []).map(mapLancCR);
  const result = withAudit(
    ctx,
    brutas,
    (r) => classificarStatusPadrao(r.status),
    (r) => r.valor,
  );
  logAudit(result.audit);
  return result;
}

/* ============== DRE Simplificado ============== */

export interface DreAuditExtras {
  ignoradoVendasCanceladas: number;
  ignoradoLancCancelados: number;
}

export async function fetchDreTotaisAudit(
  ownerId: string | null,
  input: RelatorioRangeInput,
): Promise<{ totais: DreTotaisDomain; audit: import("@/lib/relatorios/audit").RelatorioAuditoria; extras: DreAuditExtras }> {
  const ctx = {
    relatorio: "relatorio.dre",
    fonte: "vendas (receita) + financeiro_lancamentos (outras receitas / despesas pagas)",
    ownerId,
    filtros: { inicio: input.inicio, fim: input.fim },
  };
  if (!ownerId) {
    const audit = emptyAudit(ctx);
    logAudit(audit);
    return {
      totais: { receita_vendas: 0, outras_receitas: 0, despesas: 0 },
      audit,
      extras: { ignoradoVendasCanceladas: 0, ignoradoLancCancelados: 0 },
    };
  }

  const [vendasRes, lancRes] = await Promise.all([
    supabase
      .from("vendas")
      .select("total, status")
      .eq("owner_id", ownerId)
      .gte("data_emissao", input.inicio)
      .lte("data_emissao", input.fim)
      .limit(20000),
    supabase
      .from("financeiro_lancamentos")
      .select("tipo, valor_pago, status")
      .eq("owner_id", ownerId)
      .gte("data_pagamento", input.inicio)
      .lte("data_pagamento", input.fim)
      .limit(20000),
  ]);
  if (vendasRes.error) throw vendasRes.error;
  if (lancRes.error) throw lancRes.error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vendas = (vendasRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lanc = (lancRes.data ?? []) as any[];

  const vendasValidas = vendas.filter((v) => !classificarStatusPadrao(v.status));
  const ignoradoVendas = vendas.length - vendasValidas.length;
  const lancPagos = lanc.filter(
    (l) => l.status === "pago" && !classificarStatusPadrao(l.status),
  );
  const ignoradoLanc = lanc.length - lancPagos.length;

  const receita_vendas = vendasValidas.reduce((a, v) => a + (Number(v.total) || 0), 0);
  const outras_receitas = lancPagos
    .filter((l) => l.tipo === "receita")
    .reduce((a, l) => a + (Number(l.valor_pago) || 0), 0);
  const despesas = lancPagos
    .filter((l) => l.tipo === "despesa")
    .reduce((a, l) => a + (Number(l.valor_pago) || 0), 0);

  const totalCalculado = receita_vendas + outras_receitas - despesas;
  const ignorados = [];
  if (ignoradoVendas > 0)
    ignorados.push({ motivo: "cancelado" as const, quantidade: ignoradoVendas });
  if (ignoradoLanc > 0)
    ignorados.push({ motivo: "fora_do_filtro" as const, quantidade: ignoradoLanc });

  const audit: import("@/lib/relatorios/audit").RelatorioAuditoria = {
    relatorio: ctx.relatorio,
    fonte: ctx.fonte,
    ownerId,
    filtros: ctx.filtros,
    totalRegistrosLidos: vendas.length + lanc.length,
    totalRegistros: vendasValidas.length + lancPagos.length,
    totalCalculado: Number(totalCalculado.toFixed(2)),
    ignorados,
    divergencias: [],
    geradoEm: new Date().toISOString(),
  };
  logAudit(audit);

  return {
    totais: { receita_vendas, outras_receitas, despesas },
    audit,
    extras: {
      ignoradoVendasCanceladas: ignoradoVendas,
      ignoradoLancCancelados: ignoradoLanc,
    },
  };
}
