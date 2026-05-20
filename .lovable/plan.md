## Objetivo

O app desktop (Tauri) deve abrir e renderizar **imediatamente com dados do SQLite local**, sem esperar Supabase. Sync cloud roda em background e nunca apaga cache local. Caixa aberto e vendas locais sobrevivem reinício offline. Terminais LAN continuam usando o servidor local.

**Não vou:** trocar Tauri, trocar SQLite, migrar pra Electron, recriar adapters, mexer em endpoints de domínio que já funcionam.

**Vou:** corrigir só o caminho de boot e as 5 regras que estão violadas hoje.

---

## Diagnóstico que farei antes de codar (1 sessão)

Ler em paralelo, sem alterar:
- `src-tauri/src/lib.rs`, `local_server.rs`, `db.rs` — confirmar que o SQLite já abre antes do webview e que `local_server` sobe sem rede.
- `src/integrations/data/adapters/local-server.ts` e `local-terminal.ts` — ver se hoje fazem fallback pro cloud quando endpoint local responde.
- `src/integrations/data/mode.ts` — ver se `getDataMode()` no desktop já resolve `local-server`/`local-terminal` sem internet.
- `src/components/auth/AuthProvider.tsx`, `OperadorProvider`, `TerminalProvider` — identificar se algum deles **bloqueia render** esperando `supabase.auth.getUser()` ou sessão online.
- `src/components/providers/QueryProvider.tsx` — confirmar `staleTime`, `gcTime`, persistência (provavelmente sem persister; é por isso que parece "vazio" no boot).
- `src/components/shared/OfflineBanner.tsx`, `useLocalServerWatchdog` — entender o status visual atual.
- `src/routes/__root.tsx` + `AppLayout` — achar todos os `Suspense`/loaders bloqueantes.

Saída do diagnóstico: lista exata dos pontos que bloqueiam, anotada em notas das tasks. **Não codifico nada antes disso.**

---

## Mudanças (escopo fechado)

### 1. AuthProvider não bloqueia em desktop offline
- Se `isDesktop()` e não há internet, render imediatamente com sessão local cacheada (`localStorage`/secure storage). Supabase `getSession()` roda em background; quando voltar, atualiza.
- Logs: `[BOOT_LOCAL_FIRST]`, `[LOCAL_STATE_RESTORED]`.

### 2. Persistência do React Query (cache que sobrevive reload)
- Adicionar `@tanstack/react-query-persist-client` + `createSyncStoragePersister` no `QueryProvider` **somente no shell desktop**.
- Resultado: ao reabrir, listas (produtos/clientes/estoque/financeiro) aparecem instantaneamente do cache enquanto o adapter local refaz a query.

### 3. Resolução de modo no boot prioriza local
- Em `getDataMode()`: no desktop, se há `local.db` válido (checar via `invoke('local_db_status')` que vou adicionar no Rust), forçar `local-server`/`local-terminal` mesmo se houver internet. Cloud vira backup, não fonte.

### 4. Adapter local nunca cai pra cloud silenciosamente em leitura
- Revisar `local-server.ts`/`local-terminal.ts`: se endpoint local responde (mesmo vazio legítimo), **não** consultar cloud. Fallback cloud só quando local está fisicamente fora (timeout/erro de rede LAN), e mesmo assim sem sobrescrever cache local com vazio.

### 5. Sync cloud → local NUNCA limpa local com resposta vazia
- Adicionar guarda no caminho de sync (provavelmente em `local_server.rs` ou no orquestrador de sync TS): se payload remoto = `[]` ou erro, **manter snapshot local**. Só substituir quando vier payload com `count > 0` ou `last_sync` mais novo que o local.
- Logs: `[LOCAL_CACHE_PRESERVED]`, `[CLOUD_SYNC_SKIPPED]`.

### 6. Caixa aberto sobrevive reinício
- Garantir comando Tauri `caixa_aberto_local()` que lê da tabela `caixas` local com `status='aberto'`.
- No boot do `CaixaProvider` (ou rota `/caixa`/`/pdv`), consultar primeiro o local; se houver caixa aberto, restaurar operador/terminal sem chamar Supabase.
- Logs: `[CAIXA_RESTORE]`.

### 7. Status visual honesto
- `OfflineBanner` passa a mostrar 3 estados separados: **Operando localmente / Sincronizando em segundo plano / Sem internet — dados locais**. Nunca "erro crítico" se `local.db` está OK.
- Adicionar "Última sincronização: há X min" lendo de uma chave em `local_meta`.

### 8. Diagnóstico estendido (`/diagnostico` ou tela existente)
- Adicionar bloco "Estado local" com: banco existe, schema version, contagens (produtos/clientes/vendas/caixa aberto), última venda local, outbox pendente, terminais conectados, última sync cloud, status cloud separado.

### 9. Sync em background
- Garantir que o orquestrador de sync (já existe) roda via `setInterval` em web worker / task Rust, **nunca no caminho de render**. Cancela limpo no `beforeunload`.

---

## Fora de escopo (não toco agora)

- Reescrever protocolo LAN, schema SQLite, outbox, backup/restore.
- Adicionar novos módulos de domínio.
- Mudar fluxo de auth para login offline novo (uso o cache existente).
- UI nova além dos status no banner e bloco diagnóstico.

---

## Tasks (ordem de execução)

1. Diagnóstico de boot (leitura + notas).
2. Persister do React Query no shell desktop.
3. AuthProvider non-blocking em desktop offline.
4. `getDataMode()` prioriza local quando `local.db` válido.
5. Guarda anti-wipe no sync cloud→local.
6. Restauração de caixa aberto no boot.
7. OfflineBanner com 3 estados + "última sync".
8. Bloco "Estado local" no diagnóstico.
9. QA: roteiro dos 13 testes do seu spec (com internet off no DevTools / firewall).

Cada task é um commit pequeno. Você pode parar entre qualquer uma.

---

## Tecnicalidades

- Comandos Tauri novos a adicionar (mínimos): `local_db_status`, `caixa_aberto_local`, `local_meta_get`, `local_meta_set`. Implementação trivial em cima do `db.rs` existente.
- Sem novas dependências npm além de `@tanstack/react-query-persist-client` e `@tanstack/query-sync-storage-persister`.
- Sem migration SQL nova (uso tabela `local_meta` se existir, senão crio via comando Rust idempotente).
- Tudo guardado por `isDesktop()` — web continua igual.
