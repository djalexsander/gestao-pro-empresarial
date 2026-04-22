import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Settings2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useConfigComercial, useSetConfigComercial, useAdminPlanos,
} from "@/hooks/useSaasAdmin";

export const Route = createFileRoute("/admin/config-comercial")({
  head: () => ({ meta: [{ title: "Configurações comerciais — Master" }] }),
  component: ConfigComercialPage,
});

function ConfigComercialPage() {
  const { data, isLoading } = useConfigComercial();
  const { data: planos = [] } = useAdminPlanos();
  const save = useSetConfigComercial();

  const [form, setForm] = useState({
    dias_trial: 7,
    permitir_modulos_no_trial: true,
    plano_padrao_id: "__none__",
    valor_padrao_sistema: 0,
  });

  useEffect(() => {
    if (data) {
      setForm({
        dias_trial: data.dias_trial,
        permitir_modulos_no_trial: data.permitir_modulos_no_trial,
        plano_padrao_id: data.plano_padrao_id ?? "__none__",
        valor_padrao_sistema: Number(data.valor_padrao_sistema),
      });
    }
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações comerciais"
        description="Defaults aplicados a todas as novas empresas."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-5 w-5" /> Trial e plano padrão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Dias de trial</Label>
                  <Input type="number" min={0} value={form.dias_trial}
                    onChange={(e) => setForm({ ...form, dias_trial: Number(e.target.value) })} />
                  <p className="text-xs text-muted-foreground">
                    Quantos dias toda nova empresa ganha em modo trial.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Plano padrão</Label>
                  <Select value={form.plano_padrao_id}
                    onValueChange={(v) => setForm({ ...form, plano_padrao_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— nenhum —</SelectItem>
                      {planos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Plano atribuído automaticamente no início do trial.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Valor padrão do sistema (R$)</Label>
                  <Input type="number" step="0.01" value={form.valor_padrao_sistema}
                    onChange={(e) => setForm({ ...form, valor_padrao_sistema: Number(e.target.value) })} />
                  <p className="text-xs text-muted-foreground">
                    Referência usada em telas de cobrança.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Liberar módulos durante o trial</p>
                  <p className="text-sm text-muted-foreground">
                    Se ativado, todos os módulos ficam disponíveis durante o trial.
                  </p>
                </div>
                <Switch
                  checked={form.permitir_modulos_no_trial}
                  onCheckedChange={(c) => setForm({ ...form, permitir_modulos_no_trial: c })}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  disabled={save.isPending}
                  onClick={() => save.mutate({
                    dias_trial: form.dias_trial,
                    permitir_modulos_no_trial: form.permitir_modulos_no_trial,
                    plano_padrao_id: form.plano_padrao_id === "__none__" ? null : form.plano_padrao_id,
                    valor_padrao_sistema: form.valor_padrao_sistema,
                  })}
                >
                  {save.isPending ? "Salvando…" : "Salvar configurações"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
