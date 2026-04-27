// Hooks da área "QA do Sistema (Validação de Lançamento)" — apenas super admin.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
    queryFn: async (): Promise<QaModulo[]> => {
      const { data, error } = await supabase
        .from("qa_modulos")
        .select("*")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as QaModulo[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useQaItens() {
  return useQuery({
    queryKey: ["qa", "itens"],
    queryFn: async (): Promise<QaItem[]> => {
      const { data, error } = await supabase
        .from("qa_itens")
        .select("*")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as QaItem[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/* ===================== Validações ===================== */

export function useQaValidacoes() {
  return useQuery({
    queryKey: ["qa", "validacoes"],
    queryFn: async (): Promise<QaValidacao[]> => {
      const { data, error } = await supabase
        .from("qa_validacoes")
        .select("*")
        .order("iniciada_em", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as QaValidacao[];
    },
  });
}

export function useQaValidacaoAtiva() {
  return useQuery({
    queryKey: ["qa", "validacao_ativa"],
    queryFn: async (): Promise<QaValidacao | null> => {
      const { data, error } = await supabase
        .from("qa_validacoes")
        .select("*")
        .eq("status", "em_andamento")
        .order("iniciada_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as QaValidacao | null) ?? null;
    },
  });
}

export function useQaAvaliacoes(validacaoId: string | undefined) {
  return useQuery({
    queryKey: ["qa", "avaliacoes", validacaoId],
    enabled: !!validacaoId,
    queryFn: async (): Promise<QaAvaliacao[]> => {
      const { data, error } = await supabase
        .from("qa_avaliacoes")
        .select("*")
        .eq("validacao_id", validacaoId!);
      if (error) throw error;
      return (data ?? []) as QaAvaliacao[];
    },
  });
}

/* ===================== Mutations ===================== */

export function useCriarValidacao() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { titulo: string; responsavelNome?: string }) => {
      if (!user) throw new Error("Sem sessão");
      const { data, error } = await supabase
        .from("qa_validacoes")
        .insert({
          titulo: input.titulo,
          responsavel_id: user.id,
          responsavel_nome: input.responsavelNome ?? user.email ?? "Master",
          status: "em_andamento",
        })
        .select()
        .single();
      if (error) throw error;
      return data as QaValidacao;
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
    mutationFn: async (input: {
      id: string;
      observacao?: string;
      resumo?: Record<string, unknown>;
    }) => {
      const { error } = await supabase
        .from("qa_validacoes")
        .update({
          status: "finalizada",
          finalizada_em: new Date().toISOString(),
          observacao_final: input.observacao ?? null,
          resumo: input.resumo ?? null,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
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
      const payload = {
        validacao_id: input.validacao_id,
        item_id: input.item_id,
        status: input.status,
        observacao: input.observacao ?? null,
        evidencia_url: input.evidencia_url ?? null,
        testado_em: new Date().toISOString(),
        testado_por: user.id,
        testado_por_nome: user.email ?? "Master",
      };
      const { error } = await supabase
        .from("qa_avaliacoes")
        .upsert(payload, { onConflict: "validacao_id,item_id" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["qa", "avaliacoes", vars.validacao_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ===================== Upload de evidência ===================== */

export async function uploadQaEvidencia(file: File, validacaoId: string): Promise<string> {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${validacaoId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("qa-evidencias")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  // Bucket é privado — guardamos o path. Ao exibir, geramos signed URL.
  return path;
}

export async function getQaEvidenciaSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("qa-evidencias")
    .createSignedUrl(path, 60 * 60); // 1 h
  if (error) return null;
  return data?.signedUrl ?? null;
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

  // Itens críticos não testados = bloqueante para "pronto"
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
