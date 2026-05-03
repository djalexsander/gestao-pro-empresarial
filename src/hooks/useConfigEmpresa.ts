import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invalidarEmpresaHeaderCache } from "@/lib/export-empresa-header";

export interface ConfigEmpresa {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string | null;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  telefone: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  logo_url: string | null;
}

export type ConfigEmpresaInput = Omit<ConfigEmpresa, "id">;

/**
 * Carrega as configurações da empresa do usuário logado.
 * Usado em comprovantes, notas e cabeçalhos de impressão.
 */
export function useConfigEmpresa() {
  return useQuery({
    queryKey: ["config_empresa"],
    queryFn: async (): Promise<ConfigEmpresa | null> => {
      const { data, error } = await supabase
        .from("configuracoes_empresa")
        .select(
          "id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, telefone, email, logradouro, numero, complemento, bairro, cidade, estado, cep, logo_url",
        )
        .maybeSingle();
      if (error) throw error;
      return (data as ConfigEmpresa | null) ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Cria/atualiza a configuração da empresa do usuário logado. */
export function useSalvarConfigEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Partial<ConfigEmpresaInput> & { id?: string },
    ): Promise<ConfigEmpresa> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

      const payload = {
        owner_id: u.user.id,
        razao_social: input.razao_social ?? "Minha Empresa",
        nome_fantasia: input.nome_fantasia ?? null,
        cnpj: input.cnpj ?? null,
        inscricao_estadual: input.inscricao_estadual ?? null,
        inscricao_municipal: input.inscricao_municipal ?? null,
        telefone: input.telefone ?? null,
        email: input.email ?? null,
        logradouro: input.logradouro ?? null,
        numero: input.numero ?? null,
        complemento: input.complemento ?? null,
        bairro: input.bairro ?? null,
        cidade: input.cidade ?? null,
        estado: input.estado ?? null,
        cep: input.cep ?? null,
        logo_url: input.logo_url ?? null,
      };

      if (input.id) {
        const { data, error } = await supabase
          .from("configuracoes_empresa")
          .update(payload)
          .eq("id", input.id)
          .select()
          .single();
        if (error) throw error;
        return data as ConfigEmpresa;
      }

      const { data, error } = await supabase
        .from("configuracoes_empresa")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as ConfigEmpresa;
    },
    onSuccess: () => {
      invalidarEmpresaHeaderCache();
      qc.invalidateQueries({ queryKey: ["config_empresa"] });
      toast.success("Dados da empresa salvos.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Faz upload da logo no bucket "empresa-logos" e retorna a URL pública. */
export async function uploadLogoEmpresa(file: File): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Não autenticado");

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${u.user.id}/logo-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("empresa-logos")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;

  const { data } = supabase.storage.from("empresa-logos").getPublicUrl(path);
  return data.publicUrl;
}

/** Remove a logo do storage (best-effort). */
export async function removerLogoEmpresa(url: string | null): Promise<void> {
  if (!url) return;
  // Extrai o path após /empresa-logos/
  const marker = "/empresa-logos/";
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.substring(idx + marker.length);
  await supabase.storage.from("empresa-logos").remove([path]);
}
