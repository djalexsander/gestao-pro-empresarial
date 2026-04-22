import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Mail, MapPin, Phone, Receipt, ShoppingBag, TrendingUp } from "lucide-react";
import {
  useClienteHistorico,
  useClienteMetricas,
  type Cliente,
} from "@/hooks/useClientes";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cliente: Cliente | null;
}

const STATUS_PGTO: Record<string, string> = {
  pago: "bg-success/15 text-success border-success/30",
  pendente: "bg-warning/15 text-warning border-warning/30",
  parcial: "bg-primary/15 text-primary border-primary/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};

function formatDoc(value: string | null) {
  if (!value) return "—";
  const d = value.replace(/\D+/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14)
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value;
}

export function ClienteDetailDialog({ open, onOpenChange, cliente }: Props) {
  const { data: metricasMap } = useClienteMetricas();
  const { data: historico = [], isLoading: loadingHist } = useClienteHistorico(
    cliente?.id ?? null,
  );

  if (!cliente) return null;
  const m = metricasMap?.get(cliente.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2">
                {cliente.nome}
                <Badge variant="outline" className="text-xs">
                  {cliente.tipo}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    cliente.status === "ativo"
                      ? "bg-success/15 text-success border-success/30"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {cliente.status}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {cliente.nome_fantasia ?? formatDoc(cliente.documento)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Métricas */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Pedidos"
            value={(m?.total_vendas ?? 0).toString()}
            icon={ShoppingBag}
            tone="primary"
          />
          <MetricCard
            label="Total comprado"
            value={formatBRL(m?.valor_total ?? 0)}
            icon={Receipt}
            tone="success"
          />
          <MetricCard
            label="Ticket médio"
            value={formatBRL(m?.ticket_medio ?? 0)}
            icon={TrendingUp}
            tone="info"
          />
          <MetricCard
            label="Última compra"
            value={
              m?.ultima_venda
                ? new Date(m.ultima_venda + "T00:00:00").toLocaleDateString("pt-BR")
                : "—"
            }
            icon={Receipt}
            tone="warning"
          />
        </div>

        {/* Contato + endereço */}
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <ContatoLinha
              icon={Mail}
              label="E-mail"
              value={cliente.email ?? "—"}
              href={cliente.email ? `mailto:${cliente.email}` : undefined}
            />
            <ContatoLinha
              icon={Phone}
              label="Telefone"
              value={cliente.celular ?? cliente.telefone ?? "—"}
              href={
                cliente.celular || cliente.telefone
                  ? `tel:${(cliente.celular ?? cliente.telefone)?.replace(/\D+/g, "")}`
                  : undefined
              }
            />
            <ContatoLinha
              icon={MapPin}
              label="Endereço"
              value={
                [
                  cliente.logradouro,
                  cliente.numero,
                  cliente.bairro,
                  cliente.cidade && cliente.estado
                    ? `${cliente.cidade} - ${cliente.estado}`
                    : cliente.cidade ?? cliente.estado,
                ]
                  .filter(Boolean)
                  .join(", ") || "—"
              }
            />
            <ContatoLinha
              icon={Receipt}
              label="Documento"
              value={formatDoc(cliente.documento)}
            />
          </CardContent>
        </Card>

        {/* Histórico */}
        <div>
          <h4 className="mb-2 text-sm font-semibold">Histórico de vendas</h4>
          <Card>
            <ScrollArea className="h-[260px]">
              {loadingHist ? (
                <div className="flex h-32 items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : historico.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  Nenhuma venda registrada para este cliente.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {historico.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="font-mono text-xs text-muted-foreground">
                          {v.numero}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(v.data_emissao + "T00:00:00").toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("capitalize", STATUS_PGTO[v.status_pagamento] ?? "")}
                      >
                        {v.status_pagamento}
                      </Badge>
                      <span
                        className={cn(
                          "w-28 text-right font-medium tabular-nums",
                          v.status === "cancelada" && "text-muted-foreground line-through",
                        )}
                      >
                        {formatBRL(v.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </Card>
        </div>

        {cliente.observacoes && (
          <Card>
            <CardContent className="p-4 text-sm">
              <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                Observações
              </p>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {cliente.observacoes}
              </p>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  tone: "primary" | "success" | "warning" | "info";
}) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning-foreground",
    info: "bg-info/10 text-info",
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", tones[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ContatoLinha({
  icon: Icon,
  label,
  value,
  href,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        {href ? (
          <a
            href={href}
            className="block truncate text-sm hover:text-primary hover:underline"
          >
            {value}
          </a>
        ) : (
          <p className="truncate text-sm">{value}</p>
        )}
      </div>
    </div>
  );
}
