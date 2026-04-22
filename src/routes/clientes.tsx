import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Eye,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  TrendingUp,
  UserCircle,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { ClienteDialog } from "@/components/clientes/ClienteDialog";
import { ClienteDetailDialog } from "@/components/clientes/ClienteDetailDialog";
import {
  useClienteMetricas,
  useClientesFull,
  useToggleClienteStatus,
  type Cliente,
} from "@/hooks/useClientes";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes — Gestão Pro" },
      { name: "description", content: "Cadastro e gestão de clientes." },
    ],
  }),
  component: CustomersPage,
});

function formatDoc(value: string | null) {
  if (!value) return "—";
  const d = value.replace(/\D+/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14)
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value;
}

function CustomersPage() {
  const { data: clientes = [], isLoading } = useClientesFull();
  const { data: metricas } = useClienteMetricas();
  const toggle = useToggleClienteStatus();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "ativo" | "inativo">("todos");
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Cliente | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clientes.filter((c) => {
      if (statusFilter !== "todos" && c.status !== statusFilter) return false;
      if (!q) return true;
      const docDigits = (c.documento ?? "").replace(/\D+/g, "");
      const qDigits = q.replace(/\D+/g, "");
      return (
        c.nome.toLowerCase().includes(q) ||
        (c.nome_fantasia ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.telefone ?? "").toLowerCase().includes(q) ||
        (c.celular ?? "").toLowerCase().includes(q) ||
        (qDigits.length > 0 && docDigits.includes(qDigits))
      );
    });
  }, [clientes, query, statusFilter]);

  // Métricas agregadas para os cards
  const stats = useMemo(() => {
    const total = clientes.length;
    const ativos = clientes.filter((c) => c.status === "ativo").length;
    let valorTotal = 0;
    let pedidosTotal = 0;
    if (metricas) {
      for (const v of metricas.values()) {
        valorTotal += v.valor_total;
        pedidosTotal += v.total_vendas;
      }
    }
    return { total, ativos, inativos: total - ativos, valorTotal, pedidosTotal };
  }, [clientes, metricas]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Sua carteira de clientes ativa e inativa."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Novo cliente
          </Button>
        }
      />

      {/* Métricas */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Clientes ativos"
          value={stats.ativos.toString()}
          hint={`${stats.total} no total`}
          icon={Users}
          iconTone="primary"
        />
        <StatCard
          label="Inativos"
          value={stats.inativos.toString()}
          icon={UserCircle}
          iconTone="warning"
        />
        <StatCard
          label="Pedidos (carteira)"
          value={stats.pedidosTotal.toString()}
          icon={TrendingUp}
          iconTone="info"
        />
        <StatCard
          label="Faturamento da carteira"
          value={formatBRL(stats.valorTotal)}
          icon={TrendingUp}
          iconTone="success"
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, documento, e-mail ou telefone…"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="ativo">Ativos</SelectItem>
              <SelectItem value="inativo">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-60 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Users className="h-10 w-10 opacity-40" />
              <p className="font-medium">Nenhum cliente encontrado</p>
              <p className="text-sm">
                {query || statusFilter !== "todos"
                  ? "Ajuste os filtros para ver mais resultados."
                  : "Cadastre seu primeiro cliente para começar."}
              </p>
              {!query && statusFilter === "todos" && (
                <Button size="sm" className="mt-2" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Novo cliente
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome / Razão</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead className="text-center">Pedidos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Última</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const m = metricas?.get(c.id);
                  return (
                    <TableRow
                      key={c.id}
                      className={cn(c.status === "inativo" && "opacity-60")}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{c.nome}</span>
                          {c.nome_fantasia && (
                            <span className="text-xs text-muted-foreground">
                              {c.nome_fantasia}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatDoc(c.documento)}
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          {c.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex flex-col">
                          {c.email && <span className="truncate">{c.email}</span>}
                          {(c.celular || c.telefone) && (
                            <span>{c.celular ?? c.telefone}</span>
                          )}
                          {!c.email && !c.celular && !c.telefone && "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.cidade
                          ? `${c.cidade}${c.estado ? " - " + c.estado : ""}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {m?.total_vendas ?? 0}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatBRL(m?.valor_total ?? 0)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m?.ultima_venda
                          ? new Date(m.ultima_venda + "T00:00:00").toLocaleDateString(
                              "pt-BR",
                            )
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            c.status === "ativo"
                              ? "bg-success/15 text-success border-success/30"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setDetail(c)}
                            title="Ver detalhes"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditing(c)}
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              toggle.mutate({
                                id: c.id,
                                status: c.status === "ativo" ? "inativo" : "ativo",
                              })
                            }
                            title={c.status === "ativo" ? "Inativar" : "Ativar"}
                          >
                            {c.status === "ativo" ? (
                              <PowerOff className="h-3.5 w-3.5" />
                            ) : (
                              <Power className="h-3.5 w-3.5 text-success" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ClienteDialog
        open={creating || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        cliente={editing}
      />

      <ClienteDetailDialog
        open={detail !== null}
        onOpenChange={(o) => !o && setDetail(null)}
        cliente={detail}
      />
    </div>
  );
}
