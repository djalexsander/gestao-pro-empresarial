import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dataClient } from "@/integrations/data";
import { invalidarEmpresaHeaderCache } from "@/lib/export-empresa-header";
import type { ConfigEmpresaDomain } from "@/integrations/data/extra-adapters";

export type ConfigEmpresa = ConfigEmpresaDomain;
export type ConfigEmpresaInput = Omit<ConfigEmpresa, "id">;

/**
 * Carrega as configurações da empresa do usuário logado.
 */
export function useConfigEmpresa() {
  return useQuery({
    queryKey: ["config_empresa"],
    queryFn: () => dataClient.configEmpresa.obter(),
    staleTime: 5 * 60 * 1000,
  });
}

/** Cria/atualiza a configuração da empresa do usuário logado. */
export function useSalvarConfigEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ConfigEmpresaInput> & { id?: string }) =>
      dataClient.configEmpresa.salvar(input),
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
  return dataClient.configEmpresa.uploadLogo({ file, userId: u.user.id });
}

/** Remove a logo do storage (best-effort). */
export async function removerLogoEmpresa(url: string | null): Promise<void> {
  return dataClient.configEmpresa.removerLogo(url);
}
