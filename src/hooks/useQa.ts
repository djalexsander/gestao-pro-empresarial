// Hooks da área "QA do Sistema (Validação de Lançamento)" — apenas super admin.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type QaSeveridade = "critico" | "medio" | "leve";
export type QaStatusAvaliacao = "nao_testado" | "ok" | "leve" | "medio" | "critico";
export type QaValidacaoStatus = "em_andamento" | "finalizada";

export interface QaModulo {
  id: string;
  chave: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  ativo: boolean;
}

export interface QaItem {
  id: string;
  modulo_id: string;
  titulo: string;
  descricao: string | null;
  severidade: QaSeveridade;
  critico: boolean;
  rota_link: string | null;
  ordem: number;
  ativo: boolean;
}

export interface QaValidacao {
  id: string;
  titulo: string;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  status: QaValidacaoStatus;
  iniciada_em: string;
  finalizada_em: string | null;
  observacao_final: string | null;
  resumo: Record<string, unknown> | null;
}

export interface QaAvaliacao {
  id: string;
  validacao_id: string;
  item_id: string;
  status: QaStatusAvaliacao;
  observacao: string | null;
  evidencia_url: string | null;
  testado_em: string | null;
  testado_por: string | null;
  testado_por_nome: string | null;
  updated_at: string;
}

export interface QaResumoStatus {
  total: number;
  ok: number;
  leve: number;
  medio: number;
  critico: number;
  naoTestado: number;
  pctConcluido: number;
  statusLancamento: "pronto" | "ressalvas" | "nao_recomendado" | "indefinido";
}

/* ===================== Catálogo ===================== */

export function useQaModulos() {
  return useQuery({
    queryKey: ["qa", "modulos"],
    queryFn: () => dataClient.qa.listarModulos(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useQaItens() {
  return useQuery({
    queryKey: ["qa", "itens"],
    queryFn: () => dataClient.qa.listarItens(),
    staleTime: 5 * 60 * 1000,
  });
}

/* ===================== Validações ===================== */

export function useQaValidacoes() {
  return useQuery({
    queryKey: ["qa", "validacoes"],
    queryFn: () => dataClient.qa.listarValidacoes(),
  });
}

export function useQaValidacaoAtiva() {
  return useQuery({
    queryKey: ["qa", "validacao_ativa"],
    queryFn: () => dataClient.qa.validacaoAtiva(),
  });
}

export function useQaAvaliacoes(validacaoId: string | undefined) {
  return useQuery({
    queryKey: ["qa", "avaliacoes", validacaoId],
    enabled: !!validacaoId,
    queryFn: () => dataClient.qa.listarAvaliacoes(validacaoId!),
  });
}

/* ===================== Mutations ===================== */

export function useCriarValidacao() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { titulo: string; responsavelNome?: string }) => {
      if (!user) throw new Error("Sem sessão");
      return dataClient.qa.criarValidacao({
        titulo: input.titulo,
        responsavel_id: user.id,
        responsavel_nome: input.responsavelNome ?? user.email ?? "Master",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["qa", "validacoes"] });
      qc.invalidateQueries({ queryKey: ["qa", "validacao_ativa"] });
      toast.success("Nova rodada de validação criada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useFinalizarValidacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      observacao?: string;
      resumo?: Record<string, unknown>;
    }) =>
      dataClient.qa.finalizarValidacao({
        id: input.id,
        observacao_final: input.observacao ?? null,
        resumo: input.resumo ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["qa", "validacoes"] });
      qc.invalidateQueries({ queryKey: ["qa", "validacao_ativa"] });
      toast.success("Validação finalizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSalvarAvaliacao() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      validacao_id: string;
      item_id: string;
      status: QaStatusAvaliacao;
      observacao?: string | null;
      evidencia_url?: string | null;
    }) => {
      if (!user) throw new Error("Sem sessão");
      return dataClient.qa.salvarAvaliacao({
        validacao_id: input.validacao_id,
        item_id: input.item_id,
        status: input.status,
        observacao: input.observacao ?? null,
        evidencia_url: input.evidencia_url ?? null,
        testado_por: user.id,
        testado_por_nome: user.email ?? "Master",
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["qa", "avaliacoes", vars.validacao_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ===================== Upload de evidência ===================== */

export async function uploadQaEvidencia(file: File, validacaoId: string): Promise<string> {
  return dataClient.qa.uploadEvidencia({ file, validacao_id: validacaoId });
}

export async function getQaEvidenciaSignedUrl(path: string): Promise<string | null> {
  return dataClient.qa.signedUrlEvidencia(path);
}

/* ===================== Cálculos ===================== */

export function calcularResumoQa(
  itens: QaItem[],
  avaliacoes: QaAvaliacao[],
): QaResumoStatus {
  const total = itens.length;
  const map = new Map(avaliacoes.map((a) => [a.item_id, a]));
  let ok = 0, leve = 0, medio = 0, critico = 0, naoTestado = 0;
  let temCriticoFalho = false;
  let temMedioFalho = false;

  for (const it of itens) {
    const av = map.get(it.id);
    const status = av?.status ?? "nao_testado";
    switch (status) {
      case "ok": ok += 1; break;
      case "leve": leve += 1; break;
      case "medio":
        medio += 1;
        if (it.critico) temCriticoFalho = true;
        else temMedioFalho = true;
        break;
      case "critico":
        critico += 1;
        temCriticoFalho = true;
        break;
      default: naoTestado += 1; break;
    }
  }

  const criticosNaoTestados = itens.filter(
    (it) => it.critico && (map.get(it.id)?.status ?? "nao_testado") === "nao_testado",
  ).length;

  const pctConcluido = total > 0 ? Math.round(((total - naoTestado) / total) * 100) : 0;

  let statusLancamento: QaResumoStatus["statusLancamento"] = "indefinido";
  if (total > 0) {
    if (temCriticoFalho || critico > 0) statusLancamento = "nao_recomendado";
    else if (temMedioFalho || medio > 0 || criticosNaoTestados > 0) statusLancamento = "ressalvas";
    else if (naoTestado === 0) statusLancamento = "pronto";
    else statusLancamento = "ressalvas";
  }

  return { total, ok, leve, medio, critico, naoTestado, pctConcluido, statusLancamento };
}
