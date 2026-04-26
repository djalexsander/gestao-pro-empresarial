import { useEffect, useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Plus, Trash2, Power, PowerOff, Monitor, KeyRound, Copy,
  Server, Network, Wifi, WifiOff, UserCircle2, Crown, ShieldCheck,
} from "lucide-react";
import { TerminalPermissoesDialog } from "./TerminalPermissoesDialog";
import { toast } from "sonner";
import {
  useTerminais, useCriarTerminal, useAtualizarTerminal,
  useToggleTerminalAtivo, useExcluirTerminal, useGerarTokenTerminal,
  useDefinirServidor, isTerminalOnline,
  type Terminal,
} from "@/hooks/useTerminais";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export function TerminaisTab() {
  const { data: terminais = [], isLoading } = useTerminais();
  const [novoOpen, setNovoOpen] = useState(false);
  const [editar, setEditar] = useState<Terminal | null>(null);
  const [excluir, setExcluir] = useState<Terminal | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ nome: string; token: string } | null>(null);
  const [promover, setPromover] = useState<Terminal | null>(null);
  const [permissoesAlvo, setPermissoesAlvo] = useState<Terminal | null>(null);

  const toggleMut = useToggleTerminalAtivo();
  const excluirMut = useExcluirTerminal();
  const tokenMut = useGerarTokenTerminal();
  const servidorMut = useDefinirServidor();

  // re-render a cada 30s para atualizar "online há X min"
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  async function gerarToken(t: Terminal) {
    const token = await tokenMut.mutateAsync(t.id);
    setTokenInfo({ nome: t.nome, token });
  }

  const servidor = terminais.find((t) => t.papel === "servidor");
  const onlineCount = terminais.filter((t) => isTerminalOnline(t)).length;

  return (
    <div className="space-y-6">
      {/* Visão geral da rede */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" /> Rede de terminais
          </CardTitle>
          <CardDescription>
            Modelo de PDV em rede: todos os terminais compartilham a mesma base
            (vendas, estoque, clientes, financeiro) em tempo real.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Servidor principal</p>
              <p className="mt-1 flex items-center gap-1.5 font-semibold">
                <Server className="h-4 w-4 text-primary" />
                {servidor ? servidor.nome : (
                  <span className="text-muted-foreground font-normal">
                    Não definido
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Terminais cadastrados</p>
              <p className="mt-1 font-semibold">{terminais.length}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Online agora</p>
              <p className="mt-1 flex items-center gap-1.5 font-semibold">
                <Wifi className="h-4 w-4 text-emerald-500" />
                {onlineCount}
              </p>
            </div>
          </div>
          {!servidor && terminais.length > 0 && (
            <p className="mt-3 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 p-2 text-xs text-amber-600">
              Defina um terminal como <strong>Servidor principal</strong> para
              identificar a máquina de referência da loja (ícone da coroa na
              lista abaixo).
            </p>
          )}
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" /> Terminais (Caixas físicos)
            </CardTitle>
            <CardDescription>
              Cadastre cada ponto de venda físico. Operadores entram com PIN
              sobre o terminal selecionado.
            </CardDescription>
          </div>
          <Button onClick={() => setNovoOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Novo terminal
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : terminais.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhum terminal cadastrado. Crie o primeiro (ex: "Caixa 1").
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Terminal</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Conexão</TableHead>
                  <TableHead>Operador atual</TableHead>
                  <TableHead>Caixa</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terminais.map((t) => {
                  const online = isTerminalOnline(t);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {t.papel === "servidor" && (
                            <Crown
                              className="h-4 w-4 text-amber-500"
                              aria-label="Servidor principal"
                            />
                          )}
                          <div>
                            <div className="font-medium">{t.nome}</div>
                            {t.descricao && (
                              <div className="text-xs text-muted-foreground">
                                {t.descricao}
                              </div>
                            )}
                            {t.identificador_dispositivo && (
                              <div className="font-mono text-[10px] text-muted-foreground">
                                {t.identificador_dispositivo}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {t.papel === "servidor" ? (
                          <Badge className="bg-amber-500 hover:bg-amber-500">
                            <Server className="mr-1 h-3 w-3" /> Servidor
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            <Monitor className="mr-1 h-3 w-3" /> Terminal
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {!t.ativo ? (
                          <Badge variant="secondary">Inativo</Badge>
                        ) : online ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">
                            <Wifi className="mr-1 h-3 w-3" /> Online
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            <WifiOff className="mr-1 h-3 w-3" /> Offline
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {t.operador_atual_nome && online ? (
                          <span className="flex items-center gap-1 text-sm">
                            <UserCircle2 className="h-3.5 w-3.5 text-primary" />
                            {t.operador_atual_nome}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {t.caixa_aberto_id ? (
                          <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                            Aberto
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.heartbeat_at ? (
                          <span title={format(new Date(t.heartbeat_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}>
                            há {formatDistanceToNow(new Date(t.heartbeat_at), { locale: ptBR })}
                          </span>
                        ) : t.ultimo_uso ? (
                          format(new Date(t.ultimo_uso), "dd/MM/yyyy HH:mm", { locale: ptBR })
                        ) : (
                          "Nunca"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {t.papel !== "servidor" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPromover(t)}
                              title="Definir como servidor principal"
                            >
                              <Crown className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => setPermissoesAlvo(t)}
                            title="Permissões deste terminal"
                          >
                            <ShieldCheck className="h-4 w-4 text-primary" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditar(t)} title="Editar">
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => gerarToken(t)}
                            title="Gerar token de pareamento"
                            disabled={tokenMut.isPending}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => toggleMut.mutate({ id: t.id, ativo: !t.ativo })}
                            title={t.ativo ? "Desativar" : "Ativar"}
                          >
                            {t.ativo ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setExcluir(t)} title="Excluir">
                            <Trash2 className="h-4 w-4 text-destructive" />
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

        <TerminalDialog
          open={novoOpen || !!editar}
          terminal={editar}
          onOpenChange={(o) => { if (!o) { setNovoOpen(false); setEditar(null); } }}
        />

        <TerminalPermissoesDialog
          open={!!permissoesAlvo}
          terminal={permissoesAlvo}
          onOpenChange={(o) => !o && setPermissoesAlvo(null)}
        />

        <AlertDialog open={!!excluir} onOpenChange={(o) => !o && setExcluir(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir terminal?</AlertDialogTitle>
              <AlertDialogDescription>
                {excluir?.nome} será removido. As vendas e caixas já vinculados são mantidos.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (excluir) { excluirMut.mutate(excluir.id); setExcluir(null); }
                }}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!promover} onOpenChange={(o) => !o && setPromover(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Definir como servidor principal?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{promover?.nome}</strong> passará a ser o servidor principal
                da rede. O servidor atual (se houver) será rebaixado para terminal.
                <br /><br />
                Como o sistema roda na nuvem, esta marcação é simbólica: serve para
                o administrador identificar qual máquina é a referência da loja.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (promover) {
                    await servidorMut.mutateAsync(promover.id);
                    setPromover(null);
                  }
                }}
              >
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={!!tokenInfo} onOpenChange={(o) => !o && setTokenInfo(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Token de pareamento</DialogTitle>
              <DialogDescription>
                Use no app desktop para parear automaticamente o terminal{" "}
                <strong>{tokenInfo?.nome}</strong>. Guarde em local seguro.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <code className="block break-all font-mono text-sm">{tokenInfo?.token}</code>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  if (tokenInfo) {
                    navigator.clipboard.writeText(tokenInfo.token);
                    toast.success("Token copiado.");
                  }
                }}
              >
                <Copy className="mr-1 h-4 w-4" /> Copiar
              </Button>
              <Button onClick={() => setTokenInfo(null)}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </div>
  );
}

function TerminalDialog({
  open, onOpenChange, terminal,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  terminal: Terminal | null;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [identificador, setIdentificador] = useState("");
  const criar = useCriarTerminal();
  const atualizar = useAtualizarTerminal();
  const editing = !!terminal;

  useEffect(() => {
    if (open) {
      setNome(terminal?.nome ?? "");
      setDescricao(terminal?.descricao ?? "");
      setIdentificador(terminal?.identificador_dispositivo ?? "");
    }
  }, [open, terminal]);

  function reset() {
    setNome(""); setDescricao(""); setIdentificador("");
  }

  async function submit() {
    if (!nome.trim()) return;
    if (editing && terminal) {
      await atualizar.mutateAsync({
        id: terminal.id,
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        identificador_dispositivo: identificador.trim() || null,
      });
    } else {
      await criar.mutateAsync({
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        identificador_dispositivo: identificador.trim() || null,
      });
    }
    reset();
    onOpenChange(false);
  }

  const pending = criar.isPending || atualizar.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar terminal" : "Novo terminal"}</DialogTitle>
          <DialogDescription>
            Identifique o ponto de venda físico (ex: "Caixa 1", "Balcão").
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Caixa 1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && nome.trim()) submit();
              }}
            />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex: Caixa do balcão principal"
            />
          </div>
          <div>
            <Label>Identificador do dispositivo (opcional)</Label>
            <Input
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              placeholder="Ex: hostname-pc-caixa-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Para uso futuro com app desktop (Tauri) que detecta o terminal automaticamente.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={pending || !nome.trim()}>
            {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {editing ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
