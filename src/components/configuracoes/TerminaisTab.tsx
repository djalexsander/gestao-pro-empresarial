import { useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import {
  useTerminais, useCriarTerminal, useAtualizarTerminal,
  useToggleTerminalAtivo, useExcluirTerminal, useGerarTokenTerminal,
  type Terminal,
} from "@/hooks/useTerminais";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function TerminaisTab() {
  const { data: terminais = [], isLoading } = useTerminais();
  const [novoOpen, setNovoOpen] = useState(false);
  const [editar, setEditar] = useState<Terminal | null>(null);
  const [excluir, setExcluir] = useState<Terminal | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ nome: string; token: string } | null>(null);

  const toggleMut = useToggleTerminalAtivo();
  const excluirMut = useExcluirTerminal();
  const tokenMut = useGerarTokenTerminal();

  async function gerarToken(t: Terminal) {
    const token = await tokenMut.mutateAsync(t.id);
    setTokenInfo({ nome: t.nome, token });
  }

  return (
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
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Caixa atual</TableHead>
                <TableHead>Último uso</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terminais.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.nome}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.descricao ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.identificador_dispositivo ?? "—"}
                  </TableCell>
                  <TableCell>
                    {t.ativo ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">Ativo</Badge>
                    ) : (
                      <Badge variant="secondary">Inativo</Badge>
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
                    {t.ultimo_uso
                      ? format(new Date(t.ultimo_uso), "dd/MM/yyyy HH:mm", { locale: ptBR })
                      : "Nunca"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
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
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <TerminalDialog
        open={novoOpen || !!editar}
        terminal={editar}
        onOpenChange={(o) => { if (!o) { setNovoOpen(false); setEditar(null); } }}
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

  // Reset on open
  useState(() => undefined);
  if (open && terminal && nome === "" && descricao === "" && identificador === "") {
    setNome(terminal.nome);
    setDescricao(terminal.descricao ?? "");
    setIdentificador(terminal.identificador_dispositivo ?? "");
  }

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
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Caixa 1" />
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
