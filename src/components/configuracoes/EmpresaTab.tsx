import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Upload, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useConfigEmpresa,
  useSalvarConfigEmpresa,
  uploadLogoEmpresa,
  removerLogoEmpresa,
} from "@/hooks/useConfigEmpresa";

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

export function EmpresaTab() {
  const { data, isLoading } = useConfigEmpresa();
  const salvar = useSalvarConfigEmpresa();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    razao_social: "",
    nome_fantasia: "",
    cnpj: "",
    inscricao_estadual: "",
    email: "",
    telefone: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    estado: "",
    cep: "",
    logo_url: "" as string,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      razao_social: data.razao_social ?? "",
      nome_fantasia: data.nome_fantasia ?? "",
      cnpj: data.cnpj ?? "",
      inscricao_estadual: data.inscricao_estadual ?? "",
      email: data.email ?? "",
      telefone: data.telefone ?? "",
      logradouro: data.logradouro ?? "",
      numero: data.numero ?? "",
      complemento: data.complemento ?? "",
      bairro: data.bairro ?? "",
      cidade: data.cidade ?? "",
      estado: data.estado ?? "",
      cep: data.cep ?? "",
      logo_url: data.logo_url ?? "",
    });
  }, [data]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ACCEPT.split(",").includes(file.type)) {
      toast.error("Formato inválido. Use PNG, JPG, WebP ou SVG.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Arquivo muito grande. Limite de 2 MB.");
      return;
    }

    try {
      setUploading(true);
      const previousUrl = form.logo_url;
      const url = await uploadLogoEmpresa(file);
      // Salva já a referência junto com os demais dados atuais.
      await salvar.mutateAsync({
        id: data?.id,
        ...form,
        logo_url: url,
      });
      setForm((f) => ({ ...f, logo_url: url }));
      // Remove a logo anterior do storage (best-effort).
      if (previousUrl && previousUrl !== url) {
        await removerLogoEmpresa(previousUrl);
      }
      toast.success("Logo enviada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no upload.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoverLogo() {
    if (!form.logo_url) return;
    const url = form.logo_url;
    try {
      setUploading(true);
      await salvar.mutateAsync({ id: data?.id, ...form, logo_url: null });
      setForm((f) => ({ ...f, logo_url: "" }));
      await removerLogoEmpresa(url);
      toast.success("Logo removida.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover.");
    } finally {
      setUploading(false);
    }
  }

  function handleSalvar() {
    if (!form.razao_social.trim()) {
      toast.error("Informe a razão social.");
      return;
    }
    salvar.mutate({ id: data?.id, ...form });
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dados da empresa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da empresa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Logo */}
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
            {form.logo_url ? (
              <img
                src={form.logo_url}
                alt="Logo da empresa"
                className="h-full w-full object-contain"
              />
            ) : (
              <Building2 className="h-10 w-10 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 space-y-1">
            <p className="font-medium">Logomarca</p>
            <p className="text-sm text-muted-foreground">
              Aparecerá em comprovantes, notas e cabeçalhos. PNG, JPG, WebP ou SVG até 2 MB.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={handleFile}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {form.logo_url ? "Trocar" : "Importar logo"}
            </Button>
            {form.logo_url && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemoverLogo}
                disabled={uploading}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remover
              </Button>
            )}
          </div>
        </div>

        {/* Dados cadastrais */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="razao">Razão social *</Label>
            <Input
              id="razao"
              value={form.razao_social}
              onChange={(e) => update("razao_social", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fantasia">Nome fantasia</Label>
            <Input
              id="fantasia"
              value={form.nome_fantasia}
              onChange={(e) => update("nome_fantasia", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cnpj">CNPJ</Label>
            <Input
              id="cnpj"
              value={form.cnpj}
              onChange={(e) => update("cnpj", e.target.value)}
              placeholder="00.000.000/0001-00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ie">Inscrição estadual</Label>
            <Input
              id="ie"
              value={form.inscricao_estadual}
              onChange={(e) => update("inscricao_estadual", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail comercial</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tel">Telefone</Label>
            <Input
              id="tel"
              value={form.telefone}
              onChange={(e) => update("telefone", e.target.value)}
            />
          </div>
        </div>

        {/* Endereço */}
        <div className="grid gap-4 md:grid-cols-6">
          <div className="space-y-1.5 md:col-span-4">
            <Label htmlFor="logradouro">Logradouro</Label>
            <Input
              id="logradouro"
              value={form.logradouro}
              onChange={(e) => update("logradouro", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label htmlFor="numero">Número</Label>
            <Input
              id="numero"
              value={form.numero}
              onChange={(e) => update("numero", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label htmlFor="cep">CEP</Label>
            <Input
              id="cep"
              value={form.cep}
              onChange={(e) => update("cep", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="complemento">Complemento</Label>
            <Input
              id="complemento"
              value={form.complemento}
              onChange={(e) => update("complemento", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="bairro">Bairro</Label>
            <Input
              id="bairro"
              value={form.bairro}
              onChange={(e) => update("bairro", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label htmlFor="cidade">Cidade</Label>
            <Input
              id="cidade"
              value={form.cidade}
              onChange={(e) => update("cidade", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label htmlFor="estado">UF</Label>
            <Input
              id="estado"
              maxLength={2}
              value={form.estado}
              onChange={(e) => update("estado", e.target.value.toUpperCase())}
            />
          </div>
        </div>

        <div>
          <Button onClick={handleSalvar} disabled={salvar.isPending}>
            {salvar.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Salvar alterações
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
