import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import { supabase } from "@/integrations/supabase/client";

interface ConfiguracaoPix {
  chave?: string;
  tipo_chave?: string;
  nome_recebedor?: string;
  cidade?: string;
}

interface IntegracaoPix {
  status: string;
  ativo: boolean;
  configuracoes: ConfiguracaoPix | null;
}

export function CobrancaPixTab() {
  const { empresaAtual } = useEmpresaAtual();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tipoChave, setTipoChave] = useState("cnpj");
  const [chave, setChave] = useState("");
  const [nomeRecebedor, setNomeRecebedor] = useState("");
  const [cidade, setCidade] = useState("");

  const { data: integracao, isLoading } = useQuery({
    queryKey: ["integracao_pix", empresaAtual?.id],
    enabled: !!empresaAtual?.id,
    queryFn: async (): Promise<IntegracaoPix | null> => {
      const { data, error } = await (supabase.from as any)("empresa_integracoes")
        .select("status, ativo, configuracoes")
        .eq("empresa_id", empresaAtual!.id)
        .eq("tipo_integracao", "pix")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as IntegracaoPix | null) ?? null;
    },
  });

  useEffect(() => {
    const config = integracao?.configuracoes;
    setTipoChave(config?.tipo_chave || "cnpj");
    setChave(config?.chave || "");
    setNomeRecebedor(config?.nome_recebedor || "");
    setCidade(config?.cidade || "");
  }, [integracao]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!empresaAtual || !user) throw new Error("Selecione uma empresa ativa.");
      if (!chave.trim() || !nomeRecebedor.trim() || !cidade.trim()) {
        throw new Error("Preencha a chave, o nome do recebedor e a cidade.");
      }
      const { error } = await (supabase.from as any)("empresa_integracoes").upsert(
        {
          empresa_id: empresaAtual.id,
          owner_id: empresaAtual.owner_id,
          tipo_integracao: "pix",
          status: "connected",
          ativo: true,
          nome_exibicao: "Cobrança Pix",
          configuracoes: {
            chave: chave.trim(),
            tipo_chave: tipoChave,
            nome_recebedor: nomeRecebedor.trim(),
            cidade: cidade.trim(),
          },
        },
        { onConflict: "empresa_id,tipo_integracao" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["integracao_pix"] });
      toast.success("Configuração Pix salva.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!empresaAtual) {
    return (
      <Card className="mx-auto max-w-3xl">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Selecione uma empresa para configurar a cobrança Pix.
        </CardContent>
      </Card>
    );
  }

  const ativa = Boolean(integracao?.ativo && integracao.status === "connected");

  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex gap-3">
            <div className="h-fit rounded-lg bg-primary/10 p-2 text-primary">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Configuração de cobrança Pix</CardTitle>
              <CardDescription className="mt-1">
                Defina os dados usados para gerar o Pix Copia e Cola das contas a receber.
              </CardDescription>
            </div>
          </div>
          <Badge variant={ativa ? "default" : "secondary"} className="w-fit gap-1">
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : ativa ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : null}
            {isLoading ? "Carregando" : ativa ? "Geração de Pix ativa" : "Geração de Pix inativa"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pix-tipo-chave">Tipo da chave</Label>
            <Select value={tipoChave} onValueChange={setTipoChave} disabled={isLoading}>
              <SelectTrigger id="pix-tipo-chave"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cpf">CPF</SelectItem>
                <SelectItem value="cnpj">CNPJ</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="telefone">Telefone</SelectItem>
                <SelectItem value="aleatoria">Aleatória</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pix-chave">Chave Pix</Label>
            <Input id="pix-chave" value={chave} onChange={(event) => setChave(event.target.value)} disabled={isLoading} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pix-nome">Nome do recebedor</Label>
            <Input id="pix-nome" value={nomeRecebedor} onChange={(event) => setNomeRecebedor(event.target.value)} maxLength={25} disabled={isLoading} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pix-cidade">Cidade</Label>
            <Input id="pix-cidade" value={cidade} onChange={(event) => setCidade(event.target.value)} maxLength={15} disabled={isLoading} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Provedor: Pix estático. A chave é usada somente para montar o payload de cobrança da empresa.
        </p>
        <div className="flex justify-end">
          <Button onClick={() => salvar.mutate()} disabled={isLoading || salvar.isPending}>
            {salvar.isPending ? "Salvando..." : "Salvar configuração Pix"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
