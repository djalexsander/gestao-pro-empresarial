import { getDataMode, isDesktop } from "@/integrations/data/mode";
import { getDesktopConfig } from "@/integrations/desktop/configStore";
import { getBaseUrl } from "@/integrations/desktop/serverConnection";
import type { LancamentoDetalhe } from "@/components/financeiro/LancamentoDetalheDialog";

export interface LocalFinanceiroLancamento {
  local_uuid: string;
  caixa_local_uuid: string | null;
  tipo: "entrada" | "saida" | string;
  categoria: string;
  forma_pagamento: string | null;
  valor: number;
  descricao: string | null;
  origem: string;
  created_at_ms: number;
  status: string;
  venda_local_uuid: string | null;
  cliente_id: string | null;
  fornecedor_id: string | null;
  data_competencia_ms: number | null;
  data_vencimento_ms: number | null;
  data_pagamento_ms: number | null;
  operador_id: string | null;
  cancelado_em_ms: number | null;
  cancelado_motivo: string | null;
  remote_id: string | null;
  sync_status: string;
}

export function isFinanceiroLocalDesktopMode() {
  // Financeiro is now cloud-first and local finance mode is disabled
  // for desktop terminals. Keep the helper available for legacy utility
  // functions, but prevent any local finance UI path from running.
  return false;
}

export function getLocalFinanceiroBaseUrl(): string | null {
  const cfg = getDesktopConfig();
  if (cfg.role === "server") {
    const porta = cfg.terminal?.porta ?? 3333;
    return `http://127.0.0.1:${porta}`;
  }
  return getBaseUrl(cfg.terminal);
}

export async function fetchLocalFinanceiroJson<T>(
  path: string,
  query?: Record<string, string | number | null | undefined>,
): Promise<T> {
  const baseUrl = getLocalFinanceiroBaseUrl();
  if (!baseUrl) throw new Error("Servidor local nao configurado.");
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

export function dateFromMs(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function dateTimeFromMs(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function localLancamentoTipo(row: Pick<LocalFinanceiroLancamento, "tipo">): "receber" | "pagar" {
  return row.tipo === "saida" ? "pagar" : "receber";
}

export function localLancamentoStatus(
  row: Pick<LocalFinanceiroLancamento, "tipo" | "status" | "cancelado_em_ms">,
): LancamentoDetalhe["status"] {
  if (row.cancelado_em_ms || row.status === "cancelado") return "cancelado";
  if (row.status === "pendente") return "pendente";
  if (row.status === "parcial") return "parcial";
  if (row.status === "pago" || row.status === "recebido" || row.status === "vencido") {
    return row.status;
  }
  return row.tipo === "saida" ? "pago" : "recebido";
}

export function mapLocalLancamentoToDetalhe(row: LocalFinanceiroLancamento): LancamentoDetalhe {
  const tipo = localLancamentoTipo(row);
  const status = localLancamentoStatus(row);
  const competenciaMs = row.data_competencia_ms ?? row.created_at_ms;
  const pagamentoMs = row.data_pagamento_ms ?? (status === "pago" || status === "recebido" ? competenciaMs : null);
  const valorPago = status === "pendente" || status === "vencido" ? 0 : Number(row.valor) || 0;
  return {
    id: row.local_uuid,
    descricao: row.descricao ?? row.categoria ?? "Lancamento local",
    valor: Number(row.valor) || 0,
    valor_pago: valorPago,
    data_vencimento: dateFromMs(row.data_vencimento_ms ?? competenciaMs) ?? dateFromMs(row.created_at_ms) ?? "",
    data_pagamento: dateFromMs(pagamentoMs),
    data_emissao: dateFromMs(row.created_at_ms),
    tipo,
    status,
    observacoes: row.cancelado_motivo,
    numero_documento: null,
    forma_pagamento: row.forma_pagamento,
    created_at: dateTimeFromMs(row.created_at_ms),
    conciliado_em: null,
    valor_repasse: null,
    taxa_repasse: null,
    numero_repasse: null,
    observacao_repasse: null,
    cliente_id: row.cliente_id,
    venda_id: row.venda_local_uuid,
    fornecedor_nome: null,
    fornecedor_documento: null,
    fornecedor_telefone: null,
    cliente_nome: null,
    cliente_documento: null,
    cliente_telefone: null,
    cliente_email: null,
    venda_numero: null,
    venda_data: null,
    venda_total: null,
    categoria_nome: row.categoria,
  };
}
