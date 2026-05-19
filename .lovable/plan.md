# Correção do Modo Terminal + Sincronização Automática

Dois problemas tratados de forma aditiva, sem mexer em regras de PDV/caixa/PIN/permissões nem remover servidor/terminal.

---

## Parte 1 — Terminal não pode bloquear acesso ao ERP

### Diagnóstico
Hoje, em `src/components/layout/AppLayout.tsx` (linhas 57–64), existe um guard que, sempre que `desktopRole === "terminal"`, força navegação para `TERMINAL_HOME` (`/pos`) se a rota não estiver na lista permitida pra terminal. Resultado: mesmo admin logado é jogado para o PDV ao tentar abrir qualquer rota do ERP.

O fluxo de autenticação administrativa (`RequireErpUnlock` + `AdminAuthDialog`) já existe e já valida senha + role admin/gerente. Basta deixar de bloquear no nível do papel da máquina e delegar para os guards de role/unlock que já existem.

### Mudanças

1. **`src/components/desktop/terminalRoutes.ts`**
   - Manter `TERMINAL_HOME = "/pos"` como destino padrão pra terminal.
   - Adicionar helper `isTerminalDefaultRoute(pathname)` (apenas pra navegação inicial), mas **deixar de usar `isTerminalPathAllowed` como gate**.

2. **`src/components/layout/AppLayout.tsx`**
   - Remover o `useEffect` que redireciona terminal para `TERMINAL_HOME` quando a rota não está na lista.
   - Substituir por: se for terminal e o usuário aterrissar em `/hub` sem modo definido, sugerir PDV como padrão (já é o comportamento de `useMode`/hub). Não bloquear nada.
   - O acesso administrativo continua protegido pela cadeia já existente: `RequireAuth → RequireNotMaster → RequireErpUnlock → RequireAdminLike → RequireTerminalPermissao`. Quem entra com role `caixa` continua restrito por `RequireAdminLike` (que redireciona pra `/pos`). Quem entra como admin/gerente passa.

3. **`src/components/auth/RequireRole.tsx`** (`RequireAdminLike`)
   - Sem alteração funcional — já bloqueia caixa-only fora das rotas permitidas. Garantia: terminal + admin = passa; terminal + caixa = não passa. Isso satisfaz o requisito de segurança.

4. **Trocar modo (botão já existente em `AppShell`)**
   - Já funciona alternando entre PDV e ERP via `clearModo()` + ida ao `/hub`. Adicionar `console.log("[MODE_SWITCH] alternando ERP/PDV")` no handler.

5. **Logs DEV**
   - `[MODE_ACCESS] terminal permitindo acesso ERP com admin` em `RequireErpUnlock` quando unlock for concedido em máquina terminal.
   - `[MODE_SWITCH] ...` no botão Trocar modo.

### O que NÃO muda
- Wizard de primeiro uso (`DesktopSetupWizard`) continua aparecendo se `precisaConfigurar`.
- `RequireTerminalPermissao` continua respeitando as permissões granulares do terminal definidas no admin.
- PDV / caixa / PIN / fluxo de operador inalterados.

---

## Parte 2 — Sincronização automática em background

### Diagnóstico
Já existe toda a infraestrutura:
- `serverConnection.sincronizarTudoAgora(cfg)` faz o flush.
- `useLocalServerWatchdog`, `useTerminalConexao`, `useNetworkStatus`, `useOfflineReadiness` já monitoram saúde/conexão.
- `SincronizacaoCard` hoje só dispara via botão manual + recarrega overview a cada 15 s.

Falta um orquestrador que dispare o flush automaticamente em 4 gatilhos e exiba status discreto.

### Mudanças

1. **Novo hook `src/hooks/useAutoSync.ts`**
   - Estado global compartilhado (módulo singleton) com `status: "idle" | "syncing" | "ok" | "error" | "pending"`, `lastSyncAt`, `pending`, `error`.
   - Dispara `sincronizarTudoAgora(cfg)` nas situações:
     - **Boot** (montagem inicial após auth + cfg disponível).
     - **Entrada no ERP** (path entra em rota não-PDV pela primeira vez).
     - **Reconexão de internet** (`useNetworkStatus` voltando a online).
     - **Periódico** (`setInterval` de 7 minutos).
   - Implementa backoff exponencial em erro (1 → 2 → 4 → máx 8 min); reseta em sucesso.
   - Guarda `inFlightRef` pra evitar concorrência (não duplica chamadas).
   - Logs: `[AUTO_SYNC] iniciado ao abrir app | ao entrar ERP | ao reconectar | periódico`, `[AUTO_SYNC] concluído ok=X failed=Y`, `[AUTO_SYNC] erro — próximo retry em Xs`.
   - Só roda quando há `TerminalConexaoConfig` válida (modo terminal/desktop com servidor local). Em web puro/cloud, o hook fica em no-op.

2. **Integração no `AppLayout`**
   - Chamar `useAutoSync()` uma vez no nível do layout (após `useFlushConfigEmpresaPending`). Não bloqueia a UI.

3. **Indicador discreto `SyncStatusPill`** (`src/components/layout/SyncStatusPill.tsx`)
   - Componente compacto pra topo (ao lado do `DesktopRoleBadge`):
     - "Sincronizando…" (spinner)
     - "Sincronizado há X min" (check verde)
     - "N pendências" (ícone âmbar)
     - "Erro de sincronização" (ícone vermelho com tooltip)
   - Tooltip com timestamp ISO.

4. **Boot do servidor local (`useLocalServerBoot`)**
   - Já roda quando a máquina é Servidor. Adicionar `console.log("[AUTO_SYNC] servidor local iniciado, agendando primeiro sync")` e enfileirar primeiro sync 5 s após o boot completar.

5. **PDV não trava**
   - O hook é montado no `AppLayout`, fora do `RequirePosSession`. PDV continua usando dados locais imediatamente; sync roda em paralelo. Nenhuma chamada de PDV passa a aguardar sync.

6. **Botão manual continua**
   - `SincronizacaoCard` permanece inalterado funcionalmente. Apenas exibirá `lastSyncAt` mais fresco porque o auto-sync atualiza o overview.

### Idempotência
O endpoint `sincronizarTudoAgora` já é idempotente (cada outbox usa `client_uuid` único). Não há risco de duplicação.

---

## Detalhes técnicos

### Arquivos novos
- `src/hooks/useAutoSync.ts`
- `src/components/layout/SyncStatusPill.tsx`

### Arquivos editados
- `src/components/layout/AppLayout.tsx` — remover bloqueio terminal; montar `useAutoSync` + `SyncStatusPill`; log `[MODE_SWITCH]`.
- `src/components/desktop/terminalRoutes.ts` — manter `TERMINAL_HOME`, remover dependência do gate de path.
- `src/components/auth/RequireErpUnlock.tsx` — log `[MODE_ACCESS]` quando unlock bem-sucedido em máquina terminal.
- `src/components/desktop/useLocalServerBoot.ts` — agendar primeiro auto-sync após boot.

### Não alterar
- Adapters de dados (`local-server`, `local-terminal`, `cloud`).
- Schema do banco.
- Fluxo de PIN / abertura de caixa.
- `RequireTerminalPermissao` e tabelas de permissão.
- Cadeia de auth (`AuthProvider`, `OperadorProvider`, `TerminalProvider`).

### Como testar
1. Configurar máquina como Terminal, logar como admin, ir em `/financeiro` — deve abrir (antes redirecionava pra `/pos`).
2. Logar como operador caixa em terminal — `/financeiro` deve redirecionar pra `/pos` (via `RequireAdminLike`).
3. Botão "Trocar modo" continua alternando ERP ↔ PDV.
4. Abrir app online → ver log `[AUTO_SYNC] iniciado ao abrir app` no console, e `SyncStatusPill` ir de "Sincronizando…" pra "Sincronizado agora".
5. Desligar/ligar internet → ver `[AUTO_SYNC] iniciado ao reconectar`.
6. Abrir PDV — não deve aguardar sync (PDV abre imediato).
7. Forçar erro de rede no servidor local → ver backoff nos logs e badge "Erro de sincronização".
8. Botão "Sincronizar agora" no card continua funcionando.
