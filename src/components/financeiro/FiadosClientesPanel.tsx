import { useMemo, useState } from "react";
import { Search, Users, ChevronRight, HandCoins } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/mock-data";
import { formatDateBR } from "@/lib/date-format";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LancamentoDetalheDialog, type LancamentoDetalhe } from "./LancamentoDetalheDialog";
import { RegistrarPagamentoDialog } from "./RegistrarPagamentoDialog";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Lanc = LancamentoDetalhe;

interface ClienteAgrupado {
  cliente_id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  totalAberto: number;
  totalPago: number;
  qtdTitulos: number;
  ultimaCompra: string | null;
  vencidos: number;
  parciais: number;
  titulos: Lanc[];
}

function statusLabel(l: Lanc): "Pago" | "Parcial" | "Vencido" | "Pendente" | "Cancelado" {
  if (l.status === "pago" || l.status === "recebido") return "Pago";
  if (l.status === "cancelado") return "Cancelado";
  if (l.status === "parcial") return "Parcial";
  if (l.data_vencimento && new Date(l.data_vencimento) < new Date(new Date().toDateString())) {
    return "Vencido";
  }
  return "Pendente";
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

interface Props {
  receber: Lanc[];
  loading?: boolean;
}

export function FiadosClientesPanel({ receber, loading }: Props) {
  const [busca, setBusca] = useState("");
  const [clienteAberto, setClienteAberto] = useState<ClienteAgrupado | null>(null);
  const [detalheLanc, setDetalheLanc] = useState<Lanc | null>(null);
  const [pagamentoLanc, setPagamentoLanc] = useState<Lanc | null>(null);
  const [pagamentoModoTotal, setPagamentoModoTotal] = useState(false);

  // ownerId atual para registrar pagamento
  const { data: ownerId = "" } = useQuery({
    queryKey: ["auth_uid"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? "";
    },
    staleTime: 60_000,
  });

  // Agrupa por cliente
  const grupos = useMemo<ClienteAgrupado[]>(() => {
    const map = new Map<string, ClienteAgrupado>();
    for (const l of receber) {
      if (!l.cliente_id) continue;
      const saldo = Number(l.valor) - Number(l.valor_pago ?? 0);
      if (saldo <= 0.005) continue;
      const key = l.cliente_id;
      const g = map.get(key) ?? {
        cliente_id: key,
        nome: l.cliente_nome ?? "Cliente sem nome",
        documento: l.cliente_documento ?? null,
        telefone: l.cliente_telefone ?? null,
        totalAberto: 0,
        totalPago: 0,
        qtdTitulos: 0,
        ultimaCompra: null,
        vencidos: 0,
        parciais: 0,
        titulos: [],
      };
      g.totalAberto += saldo;
      g.totalPago += Number(l.valor_pago ?? 0);
      g.qtdTitulos += 1;
      g.titulos.push(l);
      const dataRef = l.venda_data ?? l.data_emissao ?? l.created_at;
      if (dataRef && (!g.ultimaCompra || dataRef > g.ultimaCompra)) {
        g.ultimaCompra = dataRef;
      }
      const st = statusLabel(l);
      if (st === "Vencido") g.vencidos += 1;
      if (st === "Parcial") g.parciais += 1;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => b.totalAberto - a.totalAberto);
  }, [receber]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return grupos;
    const qDig = onlyDigits(q);
    return grupos.filter((g) => {
      if (g.nome.toLowerCase().includes(q)) return true;
      if (qDig && g.documento && onlyDigits(g.documento).includes(qDig)) return true;
      if (qDig && g.telefone && onlyDigits(g.telefone).includes(qDig)) return true;
      return false;
    });
  }, [grupos, busca]);

  const totalGeralAberto = grupos.reduce((s, g) => s + g.totalAberto, 0);

  // Recalcula o grupo aberto a partir dos dados mais recentes (após pagamento)
  const clienteAbertoLive = useMemo(() => {
    if (!clienteAberto) return null;
    return grupos.find((g) => g.cliente_id === clienteAberto.cliente_id) ?? null;
  }, [clienteAberto, grupos]);

  const statusGrupo = (g: ClienteAgrupado): "Em aberto" | "Parcial" | "Vencido" => {
    if (g.vencidos > 0) return "Vencido";
    if (g.parciais > 0) return "Parcial";
    return "Em aberto";
  };

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">Clientes em aberto</p>
              <p className="text-2xl font-semibold tabular-nums">{grupos.length}</p>
            </div>
            <Users className="h-8 w-8 text-muted-foreground/50" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">Total fiado em aberto</p>
              <p className="text-2xl font-semibold tabular-nums text-warning">
                {formatBRL(totalGeralAberto)}
              </p>
            </div>
            <HandCoins className="h-8 w-8 text-muted-foreground/50" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Títulos pendentes</p>
            <p className="text-2xl font-semibold tabular-nums">
              {grupos.reduce((s, g) => s + g.qtdTitulos, 0)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {grupos.reduce((s, g) => s + g.vencidos, 0)} vencidos ·{" "}
              {grupos.reduce((s, g) => s + g.parciais, 0)} parciais
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CPF/CNPJ ou telefone..."
          className="pl-9"
          autoFocus
        />
      </div>

      {/* Lista */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>CPF/CNPJ</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead className="text-right">Em aberto</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-center">Títulos</TableHead>
                <TableHead>Última compra</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!loading && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    {busca
                      ? "Nenhum cliente encontrado para a busca."
                      : "Nenhum cliente com fiado em aberto."}
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((g) => {
                const st = statusGrupo(g);
                return (
                  <TableRow
                    key={g.cliente_id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setClienteAberto(g)}
                  >
                    <TableCell className="font-medium">{g.nome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {g.documento ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {g.telefone ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold text-warning">
                      {formatBRL(g.totalAberto)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatBRL(g.totalPago)}
                    </TableCell>
                    <TableCell className="text-center">{g.qtdTitulos}</TableCell>
                    <TableCell className="text-sm">{formatDateBR(g.ultimaCompra)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          st === "Vencido"
                            ? "destructive"
                            : st === "Parcial"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {st}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detalhe do cliente */}
      <Dialog
        open={!!clienteAberto}
        onOpenChange={(o) => !o && setClienteAberto(null)}
      >
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{clienteAbertoLive?.nome ?? clienteAberto?.nome}</DialogTitle>
            <DialogDescription>
              {clienteAberto?.documento ? `CPF/CNPJ: ${clienteAberto.documento}` : null}
              {clienteAberto?.documento && clienteAberto?.telefone ? " · " : null}
              {clienteAberto?.telefone ? `Tel: ${clienteAberto.telefone}` : null}
            </DialogDescription>
          </DialogHeader>

          {clienteAbertoLive && (
            <div className="shrink-0 grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Total em aberto</p>
                <p className="font-mono font-semibold tabular-nums text-warning">
                  {formatBRL(clienteAbertoLive.totalAberto)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total já pago</p>
                <p className="font-mono tabular-nums">
                  {formatBRL(clienteAbertoLive.totalPago)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Títulos pendentes</p>
                <p className="font-mono tabular-nums">{clienteAbertoLive.qtdTitulos}</p>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venda</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clienteAbertoLive?.titulos.map((l) => {
                  const saldo = Number(l.valor) - Number(l.valor_pago ?? 0);
                  const st = statusLabel(l);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">
                        <div>{l.venda_numero ?? l.numero_documento ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          Parcela {Number(l.parcela_numero) || 1}/{Number(l.parcela_total) || 1}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDateBR(l.venda_data ?? l.data_emissao)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDateBR(l.data_vencimento)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatBRL(Number(l.valor))}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatBRL(Number(l.valor_pago ?? 0))}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold">
                        {formatBRL(saldo)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={st} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPagamentoModoTotal(false);
                              setPagamentoLanc(l);
                            }}
                            disabled={saldo <= 0.005}
                          >
                            Receber
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetalheLanc(l);
                            }}
                          >
                            Detalhes
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {clienteAbertoLive && clienteAbertoLive.titulos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                      Sem títulos em aberto.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="z-10 shrink-0 border-t border-border bg-background pt-4">
            <Button variant="outline" onClick={() => setClienteAberto(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reuso do dialog padrão para pagamento (parcial/total) */}
      {pagamentoLanc && (
        <RegistrarPagamentoDialog
          open={!!pagamentoLanc}
          onOpenChange={(o) => !o && setPagamentoLanc(null)}
          lancamentoId={pagamentoLanc.id}
          ownerId={ownerId}
          saldoRestante={Number(pagamentoLanc.valor) - Number(pagamentoLanc.valor_pago ?? 0)}
          valorTotal={Number(pagamentoLanc.valor)}
          descricao={pagamentoLanc.descricao}
          tipo={pagamentoLanc.tipo}
          modoTotal={pagamentoModoTotal}
        />
      )}

      <LancamentoDetalheDialog
        open={!!detalheLanc}
        onOpenChange={(o) => !o && setDetalheLanc(null)}
        lancamento={detalheLanc}
      />
    </div>
  );
}
