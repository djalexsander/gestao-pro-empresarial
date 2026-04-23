import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, UserPlus, Crown, Shield, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useEmpresaAtual, podeGerenciarMembros, type EmpresaPapel } from "@/hooks/useEmpresa";

const PAPEL_LABEL: Record<EmpresaPapel, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  gerente_operacional: "Gerente operacional",
};

const PAPEL_DESC: Record<EmpresaPapel, string> = {
  owner: "Acesso total. Gerencia plano e usuários.",
  admin: "Sócio. Acesso completo ao ERP, inclusive financeiro.",
  gerente_operacional: "Gerencia operação (vendas, estoque, produtos). Sem acesso ao financeiro.",
};

export function SociosTab() {
  const { empresaAtual, papel } = useEmpresaAtual();
  const podeGerenciar = podeGerenciarMembros(papel);
  const qc = useQueryClient();

  const [email, setEmail] = useState("");
  const [novoPapel, setNovoPapel] = useState<EmpresaPapel>("admin");
  const [removerId, setRemoverId] = useState<string | null>(null);

  const { data: membros = [], isLoading } = useQuery({
    queryKey: ["empresa_membros", empresaAtual?.id],
    enabled: !!empresaAtual?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("listar_membros_empresa", {
        _empresa_id: empresaAtual!.id,
      });
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        user_id: string;
        email: string | null;
        papel: EmpresaPapel;
        created_at: string;
      }>;
    },
  });

  const adicionar = useMutation({
    mutationFn: async () => {
      const trimmed = email.trim();
      if (!trimmed) throw new Error("Informe o e-mail");
      const { data, error } = await supabase.rpc("adicionar_membro_por_email", {
        _empresa_id: empresaAtual!.id,
        _email: trimmed,
        _papel: novoPapel,
      });
      if (error) throw error;
      const result = data as { ok: boolean; erro?: string };
      if (!result.ok) throw new Error(result.erro || "Erro ao adicionar");
      return result;
    },
    onSuccess: () => {
      toast.success("Membro adicionado");
      setEmail("");
      setNovoPapel("admin");
      qc.invalidateQueries({ queryKey: ["empresa_membros"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("remover_membro", { _membro_id: id });
      if (error) throw error;
      const result = data as { ok: boolean; erro?: string };
      if (!result.ok) throw new Error(result.erro || "Erro ao remover");
    },
    onSuccess: () => {
      toast.success("Membro removido");
      setRemoverId(null);
      qc.invalidateQueries({ queryKey: ["empresa_membros"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!empresaAtual) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Carregando empresa...
        </CardContent>
      </Card>
    );
  }

  const membroParaRemover = membros.find((m) => m.id === removerId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Sócios e Administradores
          </CardTitle>
          <CardDescription>
            Adicione outros usuários para acessar o ERP da empresa.
            Funcionários do PDV continuam na aba "Funcionários".
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!podeGerenciar ? (
            <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              Apenas o proprietário pode adicionar ou remover sócios e administradores.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-[1fr,200px,auto] items-end">
              <div className="space-y-1.5">
                <Label htmlFor="membro-email">E-mail do usuário</Label>
                <Input
                  id="membro-email"
                  type="email"
                  placeholder="usuario@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={adicionar.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="membro-papel">Tipo de acesso</Label>
                <Select value={novoPapel} onValueChange={(v) => setNovoPapel(v as EmpresaPapel)}>
                  <SelectTrigger id="membro-papel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador (Sócio)</SelectItem>
                    <SelectItem value="gerente_operacional">Gerente operacional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => adicionar.mutate()}
                disabled={adicionar.isPending || !email.trim()}
              >
                <UserPlus className="h-4 w-4 mr-1.5" />
                Adicionar
              </Button>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            O usuário precisa já ter conta no sistema. Peça para que ele se cadastre primeiro.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Membros atuais</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Adicionado em</TableHead>
                {podeGerenciar && <TableHead className="w-[80px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={podeGerenciar ? 4 : 3} className="text-center text-muted-foreground py-6">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && membros.length === 0 && (
                <TableRow>
                  <TableCell colSpan={podeGerenciar ? 4 : 3} className="text-center text-muted-foreground py-6">
                    Nenhum membro cadastrado.
                  </TableCell>
                </TableRow>
              )}
              {membros.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.email || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={m.papel === "owner" ? "default" : "secondary"} className="gap-1">
                      {m.papel === "owner" && <Crown className="h-3 w-3" />}
                      {m.papel === "admin" && <Shield className="h-3 w-3" />}
                      {m.papel === "gerente_operacional" && <Briefcase className="h-3 w-3" />}
                      {PAPEL_LABEL[m.papel]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(m.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  {podeGerenciar && (
                    <TableCell>
                      {m.papel !== "owner" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setRemoverId(m.id)}
                          aria-label="Remover membro"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Níveis de acesso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(Object.keys(PAPEL_LABEL) as EmpresaPapel[]).map((p) => (
            <div key={p} className="flex items-start gap-3 rounded-md border border-border/60 p-3">
              <div className="mt-0.5">
                {p === "owner" && <Crown className="h-4 w-4 text-amber-500" />}
                {p === "admin" && <Shield className="h-4 w-4 text-primary" />}
                {p === "gerente_operacional" && <Briefcase className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div>
                <p className="font-medium">{PAPEL_LABEL[p]}</p>
                <p className="text-muted-foreground">{PAPEL_DESC[p]}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={!!removerId} onOpenChange={(o) => !o && setRemoverId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
            <AlertDialogDescription>
              {membroParaRemover?.email} perderá acesso ao ERP desta empresa.
              Esta ação pode ser desfeita adicionando o membro novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removerId && remover.mutate(removerId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogFooter>
      </AlertDialog>
    </div>
  );
}
