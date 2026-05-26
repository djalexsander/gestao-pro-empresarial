import { useState } from "react";
import { SaveBar } from "./SaveBar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Plus,
  KeyRound,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import {
  useFuncionarios,
  useCriarFuncionario,
  useResetarPinFuncionario,
  useToggleFuncionarioAtivo,
  useExcluirFuncionario,
  type Funcionario,
  type FuncionarioRole,
} from "@/hooks/useFuncionarios";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function FuncionariosTab() {
  const { data: funcionarios = [], isLoading } = useFuncionarios();
  const [criarOpen, setCriarOpen] = useState(false);
  const [resetarFunc, setResetarFunc] = useState<Funcionario | null>(null);
  const [excluirFunc, setExcluirFunc] = useState<Funcionario | null>(null);

  const toggleMut = useToggleFuncionarioAtivo();
  const excluirMut = useExcluirFuncionario();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Funcionários (Operadores de caixa)
          </CardTitle>
          <CardDescription>
            Cadastre operadores que farão login no PDV via PIN. Eles não terão
            acesso ao restante do ERP.
          </CardDescription>
        </div>
        <Button onClick={() => setCriarOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Novo
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : funcionarios.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum funcionário cadastrado. Crie o primeiro operador para começar
            a usar o PDV.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Último acesso</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funcionarios.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.nome}</TableCell>
                  <TableCell className="font-mono text-sm">{f.login}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {f.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {f.ativo ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Inativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {f.ultimo_acesso
                      ? format(new Date(f.ultimo_acesso), "dd/MM/yyyy HH:mm", {
                          locale: ptBR,
                        })
                      : "Nunca"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setResetarFunc(f)}
                        title="Redefinir PIN"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          toggleMut.mutate({ id: f.id, ativo: !f.ativo })
                        }
                        title={f.ativo ? "Desativar" : "Ativar"}
                      >
                        {f.ativo ? (
                          <UserX className="h-4 w-4" />
                        ) : (
                          <UserCheck className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExcluirFunc(f)}
                        title="Excluir"
                      >
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

      <CriarFuncionarioDialog open={criarOpen} onOpenChange={setCriarOpen} />
      <ResetarPinDialog
        funcionario={resetarFunc}
        onOpenChange={(o) => !o && setResetarFunc(null)}
      />
      <AlertDialog
        open={!!excluirFunc}
        onOpenChange={(o) => !o && setExcluirFunc(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir funcionário?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluirFunc?.nome} não poderá mais fazer login no PDV. Esta ação
              não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (excluirFunc) {
                  excluirMut.mutate(excluirFunc.id);
                  setExcluirFunc(null);
                }
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CriarFuncionarioDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [nome, setNome] = useState("");
  const [login, setLogin] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<FuncionarioRole>("caixa");
  const criar = useCriarFuncionario();

  function reset() {
    setNome("");
    setLogin("");
    setPin("");
    setRole("caixa");
  }

  async function submit() {
    if (!nome.trim() || !login.trim() || pin.length < 4) return;
    await criar.mutateAsync({ nome: nome.trim(), login: login.trim(), pin, role });
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo funcionário</DialogTitle>
          <DialogDescription>
            Cadastre um operador para login no PDV via PIN.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome completo</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="João da Silva"
            />
          </div>
          <div>
            <Label>Login (apelido curto)</Label>
            <Input
              value={login}
              onChange={(e) => setLogin(e.target.value.toLowerCase())}
              placeholder="joao"
            />
          </div>
          <div>
            <Label>PIN (4 a 6 dígitos)</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
          </div>
          <div>
            <Label>Função</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as FuncionarioRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="caixa">Caixa (apenas PDV)</SelectItem>
                <SelectItem value="gerente">Gerente</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={
              criar.isPending || !nome.trim() || !login.trim() || pin.length < 4
            }
          >
            {criar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetarPinDialog({
  funcionario,
  onOpenChange,
}: {
  funcionario: Funcionario | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [pin, setPin] = useState("");
  const resetar = useResetarPinFuncionario();

  async function submit() {
    if (!funcionario || pin.length < 4) return;
    await resetar.mutateAsync({ id: funcionario.id, pin });
    setPin("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={!!funcionario}
      onOpenChange={(o) => {
        if (!o) setPin("");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redefinir PIN</DialogTitle>
          <DialogDescription>
            Defina um novo PIN para <strong>{funcionario?.nome}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label>Novo PIN (4 a 6 dígitos)</Label>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="••••"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={resetar.isPending || pin.length < 4}
          >
            {resetar.isPending && (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            )}
            Redefinir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
