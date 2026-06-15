// ============================================================================
// Banco local SQLite — primeira camada real de persistência do Servidor Local
// ============================================================================
//
// Escopo desta etapa (intencionalmente pequeno e seguro):
//
//   1. `terminals`         → terminais conhecidos pelo servidor (deixa de
//                            ser estado em memória).
//   2. `terminal_events`   → trilha mínima de auditoria de conexão.
//   3. `cache_kv`          → cache read-through com TTL para os 3 domínios
//                            iniciais (produtos, estoque, clientes).
//   4. `meta`              → metadados (schema_version, created_at).
//
// Arquivo físico: <data_dir>/gestao-pro/local.db
//   - Linux:   ~/.local/share/gestao-pro/local.db
//   - macOS:   ~/Library/Application Support/gestao-pro/local.db
//   - Windows: %APPDATA%\gestao-pro\local.db
//
// Concorrência: usamos `Mutex<Connection>` simples. SQLite é serializado
// neste cenário (poucos terminais, baixa contenção). Se virar gargalo,
// trocamos por pool depois sem mudar a interface pública.

use once_cell::sync::OnceCell;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

const SCHEMA_VERSION: i64 = 14;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

#[derive(Debug)]
pub struct DbError(pub String);

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError(e.to_string())
    }
}

impl From<std::io::Error> for DbError {
    fn from(e: std::io::Error) -> Self {
        DbError(e.to_string())
    }
}

pub type DbResult<T> = Result<T, DbError>;

fn db_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("gestao-pro")
}

pub fn db_file() -> PathBuf {
    db_path().join("local.db")
}

pub fn is_initialized() -> bool {
    DB.get().is_some()
}

pub fn ensure_initialized() -> DbResult<()> {
    if is_initialized() {
        Ok(())
    } else {
        init()
    }
}

pub fn init() -> DbResult<()> {
    let dir = db_path();
    std::fs::create_dir_all(&dir)?;
    let path = db_file();
    let conn = Connection::open(&path)?;

    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS terminals (
            terminal_id   TEXT PRIMARY KEY,
            machine_id    TEXT,
            server_id     TEXT,
            terminal_nome TEXT,
            role          TEXT,
            app_version   TEXT,
            host          TEXT,
            first_seen_ms INTEGER NOT NULL,
            last_seen_ms  INTEGER NOT NULL,
            status        TEXT NOT NULL DEFAULT 'online',
            heartbeats    INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_terminals_last_seen
            ON terminals(last_seen_ms DESC);

        CREATE TABLE IF NOT EXISTS terminal_events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            terminal_id   TEXT NOT NULL,
            event_type    TEXT NOT NULL,
            ts_ms         INTEGER NOT NULL,
            server_match  INTEGER,
            expected_server_id TEXT,
            details       TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_terminal_ts
            ON terminal_events(terminal_id, ts_ms DESC);

        CREATE TABLE IF NOT EXISTS cache_kv (
            domain      TEXT NOT NULL,
            cache_key   TEXT NOT NULL,
            payload     TEXT NOT NULL,
            stored_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            PRIMARY KEY (domain, cache_key)
        );

        CREATE INDEX IF NOT EXISTS idx_cache_expires
            ON cache_kv(expires_at_ms);

        -- ====================================================================
        -- v2: Tabelas locais NORMALIZADAS para os primeiros domínios provados.
        -- Substituem o cache JSON cru. Mantemos `cache_kv` em paralelo para
        -- domínios ainda não migrados e como rede de segurança.
        --
        -- Convenções:
        --   * `id` é sempre o UUID/identificador da nuvem (fonte da verdade).
        --   * `payload` mantém o JSON original do upstream — útil enquanto o
        --     adapter ainda lê o objeto inteiro; nas próximas etapas podemos
        --     descartar quando todas as projeções estiverem mapeadas.
        --   * `updated_at_remote_ms` espelha o `updated_at` da nuvem (quando
        --     disponível) — base para sync incremental futuro.
        --   * `synced_at_ms` é quando este servidor local viu o registro.
        --   * `deleted_at_ms` reservado para tombstones futuros.
        -- ====================================================================

        CREATE TABLE IF NOT EXISTS produtos_local (
            id                   TEXT PRIMARY KEY,
            owner_id             TEXT,
            sku                  TEXT,
            nome                 TEXT,
            status               TEXT,
            categoria_id         TEXT,
            categoria_nome       TEXT,
            preco_venda          REAL,
            estoque_atual        REAL,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_produtos_status ON produtos_local(status);
        CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos_local(categoria_id);
        CREATE INDEX IF NOT EXISTS idx_produtos_nome ON produtos_local(nome);
        CREATE INDEX IF NOT EXISTS idx_produtos_sku ON produtos_local(sku);

        CREATE TABLE IF NOT EXISTS clientes_local (
            id                   TEXT PRIMARY KEY,
            owner_id             TEXT,
            remote_id            TEXT,
            nome                 TEXT,
            nome_fantasia        TEXT,
            documento            TEXT,
            tipo                 TEXT,
            email                TEXT,
            telefone             TEXT,
            celular              TEXT,
            status               TEXT,
            payload              TEXT NOT NULL,
            sync_status          TEXT NOT NULL DEFAULT 'synced',
            created_at_ms        INTEGER,
            updated_at_ms        INTEGER,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_clientes_status ON clientes_local(status);
        CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes_local(nome);
        CREATE INDEX IF NOT EXISTS idx_clientes_doc ON clientes_local(documento);
        CREATE INDEX IF NOT EXISTS idx_clientes_remote_id ON clientes_local(remote_id);

        -- Saldos: agregados por (produto_id, variacao_id). A chave única
        -- evita duplicatas quando o snapshot é re-ingerido.
        CREATE TABLE IF NOT EXISTS estoque_saldos_local (
            owner_id       TEXT,
            produto_id     TEXT NOT NULL,
            variacao_id    TEXT NOT NULL DEFAULT '',
            tipo           TEXT,
            quantidade     REAL NOT NULL DEFAULT 0,
            payload        TEXT NOT NULL,
            synced_at_ms   INTEGER NOT NULL,
            PRIMARY KEY (owner_id, produto_id, variacao_id)
        );
        CREATE INDEX IF NOT EXISTS idx_saldos_produto ON estoque_saldos_local(produto_id);

        -- Metadados de sync por domínio (último refresh, contagem ingerida,
        -- origem). Base para o sync incremental futuro.
        CREATE TABLE IF NOT EXISTS domain_sync_meta (
            domain          TEXT PRIMARY KEY,
            last_synced_ms  INTEGER NOT NULL,
            row_count       INTEGER NOT NULL DEFAULT 0,
            last_source     TEXT,
            last_error      TEXT
        );

        -- ====================================================================
        -- v13: Autenticação offline local mínima
        --
        -- Armazena usuários autorizados para login ERP offline e operadores
        -- que já fizeram validação de PIN online neste desktop.
        -- O PIN continua hasheado no cliente local.
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS desktop_authorized_users (
            user_id        TEXT PRIMARY KEY,
            email          TEXT NOT NULL UNIQUE,
            password_hash  TEXT NOT NULL,
            synced_at_ms   INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS funcionarios_local (
            funcionario_id TEXT PRIMARY KEY,
            nome           TEXT NOT NULL,
            login          TEXT NOT NULL,
            role           TEXT NOT NULL,
            ativo          INTEGER NOT NULL DEFAULT 1,
            pin_hash       TEXT,
            synced_at_ms   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_funcionarios_local_ativo
            ON funcionarios_local(ativo);
        CREATE INDEX IF NOT EXISTS idx_funcionarios_local_login
            ON funcionarios_local(login);

        -- ====================================================================
        -- v4: Estoque normalizado real
        --
        -- `estoque_movimentacoes_local` é APPEND-ONLY: o cursor avança por
        -- `data_movimentacao` (timestamp da movimentação na nuvem). Saldo
        -- local passa a ser DERIVADO incrementalmente a partir do delta —
        -- nunca mais um snapshot bruto de quantidades.
        --
        -- `estoque_saldos_local` é mantida (mesmo PK) mas agora é uma
        -- tabela MATERIALIZADA: cada ingestão de movimentações soma/subtrai
        -- a quantidade na linha (produto_id, variacao_id) correspondente.
        -- ====================================================================

        CREATE TABLE IF NOT EXISTS estoque_movimentacoes_local (
            id                   TEXT PRIMARY KEY,
            owner_id             TEXT,
            produto_id           TEXT NOT NULL,
            variacao_id          TEXT,
            tipo                 TEXT NOT NULL,
            quantidade           REAL NOT NULL,
            saldo_anterior       REAL,
            saldo_posterior      REAL,
            custo_unitario       REAL,
            origem               TEXT,
            observacoes          TEXT,
            data_movimentacao_ms INTEGER NOT NULL,
            payload              TEXT NOT NULL,
            synced_at_ms         INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_movs_produto
            ON estoque_movimentacoes_local(produto_id);
        CREATE INDEX IF NOT EXISTS idx_movs_data
            ON estoque_movimentacoes_local(data_movimentacao_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_movs_produto_data
            ON estoque_movimentacoes_local(produto_id, data_movimentacao_ms DESC);

        -- ====================================================================
        -- v5: WRITES LOCAIS de movimentação de estoque + fila offline.
        --
        -- `outbox_estoque_movs` é a FILA OFFLINE idempotente:
        --   * `local_uuid`     → identidade local estável (idempotency key real
        --                        usada no upstream); gerado pelo servidor.
        --   * `client_uuid`    → idempotency key vinda do terminal (modal /
        --                        botão); usada para deduplicar reenvios do
        --                        próprio terminal antes de enfileirar.
        --   * `status`         → 'pending' | 'sending' | 'sent' | 'error'
        --   * `attempts`       → contador de tentativas
        --   * `payload`        → JSON do RegistrarMovimentoEstoqueInput
        --   * `last_error`     → mensagem da última falha
        --   * `remote_id`      → id do movimento na nuvem após push OK
        --
        -- O write local funciona em DOIS PASSOS atômicos:
        --   1. INSERT em `estoque_movimentacoes_local` com id = local_uuid
        --      (já materializa saldo via apply_mov_to_saldo).
        --   2. INSERT em `outbox_estoque_movs` com status='pending'.
        -- Tudo na MESMA transação → ou aparece nos dois lados ou em nenhum.
        -- ====================================================================

        CREATE TABLE IF NOT EXISTS outbox_estoque_movs (
            local_uuid    TEXT PRIMARY KEY,
            owner_id      TEXT,
            client_uuid   TEXT,
            payload       TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'pending',
            attempts      INTEGER NOT NULL DEFAULT 0,
            last_error    TEXT,
            remote_id     TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            sent_at_ms    INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_status
            ON outbox_estoque_movs(status, created_at_ms);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_client_uuid
            ON outbox_estoque_movs(client_uuid)
            WHERE client_uuid IS NOT NULL;

        -- ====================================================================
        -- v7: WRITES LOCAIS de VENDAS/PDV + fila offline.
        --
        -- Estrutura espelha o padrão já validado em estoque (v5/v6) mas em
        -- tabelas próprias para isolar domínios:
        --
        --   `vendas_local`           → cabeçalho da venda registrada no PDV
        --                              local (1 linha por venda).
        --   `venda_itens_local`      → itens da venda (N por venda).
        --   `venda_pagamentos_local` → pagamentos da venda (N por venda).
        --   `outbox_vendas`          → fila offline idempotente para push
        --                              ao upstream via RPC `finalizar_venda_pdv`.
        --
        -- A venda é gravada em UMA transação que persiste cabeçalho+itens+
        -- pagamentos, aplica baixa de estoque local (reusando
        -- `apply_mov_to_saldo` + `estoque_movimentacoes_local`) e enfileira
        -- a outbox. Se algo falhar, NADA fica gravado (atomicidade SQLite).
        --
        -- Idempotência:
        --   * `client_uuid`  → vinda do PDV (1 por carrinho); deduplica
        --                      reenvios do próprio terminal.
        --   * `local_uuid`   → identidade local estável do servidor; é
        --                      ENVIADA como `_client_uuid` na RPC upstream
        --                      → retries cross-runs nunca duplicam venda
        --                      no cloud.
        --
        -- Ainda nesta etapa NÃO criamos caixa local nem financeiro local;
        -- o handler de push apenas reenvia o payload para a RPC do upstream
        -- que já trata caixa+financeiro+estoque cloud lá.
        -- ====================================================================

        CREATE TABLE IF NOT EXISTS vendas_local (
            local_uuid       TEXT PRIMARY KEY,
            owner_id         TEXT,
            client_uuid      TEXT,
            cliente_id       TEXT,
            subtotal         REAL NOT NULL DEFAULT 0,
            desconto         REAL NOT NULL DEFAULT 0,
            total            REAL NOT NULL DEFAULT 0,
            forma_pagamento  TEXT,
            status_pagamento TEXT,
            valor_recebido   REAL,
            troco            REAL,
            observacao       TEXT,
            operador_id      TEXT,
            terminal_id      TEXT,
            gerar_financeiro INTEGER NOT NULL DEFAULT 1,
            qtd_itens        INTEGER NOT NULL DEFAULT 0,
            created_at_ms    INTEGER NOT NULL,
            updated_at_ms    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vendas_local_created
            ON vendas_local(created_at_ms DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_vendas_local_client_uuid
            ON vendas_local(client_uuid) WHERE client_uuid IS NOT NULL;

        CREATE TABLE IF NOT EXISTS venda_itens_local (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id        TEXT,
            venda_local_uuid TEXT NOT NULL,
            produto_id      TEXT NOT NULL,
            descricao       TEXT,
            quantidade      REAL NOT NULL,
            preco_unitario  REAL NOT NULL DEFAULT 0,
            desconto        REAL NOT NULL DEFAULT 0,
            payload         TEXT NOT NULL,
            created_at_ms   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_venda_itens_local_venda
            ON venda_itens_local(venda_local_uuid);

        CREATE TABLE IF NOT EXISTS venda_pagamentos_local (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id        TEXT,
            venda_local_uuid TEXT NOT NULL,
            forma_pagamento TEXT NOT NULL,
            valor           REAL NOT NULL DEFAULT 0,
            valor_recebido  REAL,
            troco           REAL,
            parcelas        INTEGER,
            observacao      TEXT,
            created_at_ms   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_venda_pagtos_local_venda
            ON venda_pagamentos_local(venda_local_uuid);

        CREATE TABLE IF NOT EXISTS outbox_vendas (
            local_uuid          TEXT PRIMARY KEY,
            owner_id            TEXT,
            client_uuid         TEXT,
            payload             TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'pending',
            attempts            INTEGER NOT NULL DEFAULT 0,
            last_error          TEXT,
            remote_id           TEXT,
            created_at_ms       INTEGER NOT NULL,
            updated_at_ms       INTEGER NOT NULL,
            sent_at_ms          INTEGER,
            next_attempt_at_ms  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_vendas_status
            ON outbox_vendas(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_vendas_status_next
            ON outbox_vendas(status, next_attempt_at_ms);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_vendas_client_uuid
            ON outbox_vendas(client_uuid) WHERE client_uuid IS NOT NULL;

        -- ====================================================================
        -- v8: CAIXA LOCAL (offline-first) + fila offline.
        --
        -- Mesmo padrão das outbox de estoque (v5/v6) e vendas (v7), em tabelas
        -- próprias. Operações suportadas nesta etapa:
        --
        --   * abertura       (action='abrir')      → cria caixa_local + outbox
        --   * suprimento     (action='movimento')  → registra mov + outbox
        --   * sangria        (action='movimento')  → registra mov + outbox
        --   * fechamento     (action='fechar')     → marca caixa fechado + outbox
        --
        -- `caixa_local` representa o estado local do caixa (1 linha por caixa
        -- aberto/fechado neste terminal). `caixa_movs_local` é append-only e
        -- persiste todos os suprimentos/sangrias.
        --
        -- `outbox_caixa` é a fila idempotente. Cada item carrega o `action`
        -- + payload completo. O scheduler reenvia para a RPC correspondente
        -- no upstream:
        --   action='abrir'     → RPC `abrir_caixa`
        --   action='movimento' → RPC `caixa_registrar_movimento`
        --   action='fechar'    → RPC `fechar_caixa`
        --
        -- Idempotência:
        --   * `client_uuid`  → vinda do terminal (1 por modal/ação); deduplica
        --                      reenvios do próprio terminal.
        --   * `local_uuid`   → identidade local estável do servidor; vira o
        --                      `_client_uuid` da RPC upstream → retries
        --                      cross-runs nunca duplicam abertura/movimento/
        --                      fechamento no cloud.
        --
        -- IMPORTANTE: nesta etapa NÃO migramos financeiro local nem cancelamento
        -- local de venda; o upstream continua sendo a fonte da verdade
        -- consolidada — caixa local é uma camada offline-first sobre ele.
        -- ====================================================================

        CREATE TABLE IF NOT EXISTS caixa_local (
            local_uuid       TEXT PRIMARY KEY,
            owner_id         TEXT,
            client_uuid      TEXT,
            remote_id        TEXT,
            status           TEXT NOT NULL DEFAULT 'aberto',
            valor_inicial    REAL NOT NULL DEFAULT 0,
            valor_informado  REAL,
            valor_esperado   REAL,
            diferenca        REAL,
            observacao_abertura   TEXT,
            observacao_fechamento TEXT,
            operador_id      TEXT,
            terminal_id      TEXT,
            data_abertura_ms  INTEGER NOT NULL,
            data_fechamento_ms INTEGER,
            created_at_ms    INTEGER NOT NULL,
            updated_at_ms    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_caixa_local_status
            ON caixa_local(status, data_abertura_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_caixa_local_operador
            ON caixa_local(operador_id, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_local_client_uuid
            ON caixa_local(client_uuid) WHERE client_uuid IS NOT NULL;

        CREATE TABLE IF NOT EXISTS caixa_movs_local (
            local_uuid       TEXT PRIMARY KEY,
            owner_id         TEXT,
            client_uuid      TEXT,
            caixa_local_uuid TEXT NOT NULL,
            tipo             TEXT NOT NULL,
            valor            REAL NOT NULL DEFAULT 0,
            motivo           TEXT,
            operador_id      TEXT,
            remote_id        TEXT,
            created_at_ms    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_caixa_movs_caixa
            ON caixa_movs_local(caixa_local_uuid, created_at_ms);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_movs_client_uuid
            ON caixa_movs_local(client_uuid) WHERE client_uuid IS NOT NULL;

        CREATE TABLE IF NOT EXISTS outbox_caixa (
            local_uuid          TEXT PRIMARY KEY,
            owner_id            TEXT,
            client_uuid         TEXT,
            action              TEXT NOT NULL,
            caixa_local_uuid    TEXT NOT NULL,
            payload             TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'pending',
            attempts            INTEGER NOT NULL DEFAULT 0,
            last_error          TEXT,
            remote_id           TEXT,
            created_at_ms       INTEGER NOT NULL,
            updated_at_ms       INTEGER NOT NULL,
            sent_at_ms          INTEGER,
            next_attempt_at_ms  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_caixa_status
            ON outbox_caixa(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_caixa_status_next
            ON outbox_caixa(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_caixa_action
            ON outbox_caixa(action, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_caixa_client_uuid
            ON outbox_caixa(client_uuid) WHERE client_uuid IS NOT NULL;
        "#,
    )?;

    // ------------------------------------------------------------------
    // v3 — Sync incremental: estende `domain_sync_meta` com cursor/estado.
    // Usa ADD COLUMN idempotente (ignora "duplicate column" do SQLite).
    // ------------------------------------------------------------------
    let alters = [
        "ALTER TABLE domain_sync_meta ADD COLUMN last_remote_cursor_ms INTEGER",
        "ALTER TABLE domain_sync_meta ADD COLUMN last_strategy TEXT",
        "ALTER TABLE domain_sync_meta ADD COLUMN last_delta_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE domain_sync_meta ADD COLUMN last_attempt_ms INTEGER",
        "ALTER TABLE domain_sync_meta ADD COLUMN last_synced_ok INTEGER NOT NULL DEFAULT 1",
        // v6: backoff scheduling para a outbox de estoque.
        // `next_attempt_at_ms` controla quando o item está elegível para
        // reenvio automático. NULL = elegível imediatamente (= now).
        "ALTER TABLE outbox_estoque_movs ADD COLUMN next_attempt_at_ms INTEGER",
        // v9: vínculo opcional venda → caixa local aberto no momento da venda.
        // Permite calcular o resumo local do caixa (totais por forma de
        // pagamento) de forma determinística, sem depender de timestamp.
        "ALTER TABLE vendas_local ADD COLUMN caixa_local_uuid TEXT",
        // v10: cancelamento local de venda. `status` controla o ciclo de vida
        // local da venda ('ativa' | 'cancelada'). Os demais campos guardam
        // contexto do cancelamento (motivo, momento, operador, idempotência).
        "ALTER TABLE vendas_local ADD COLUMN status TEXT NOT NULL DEFAULT 'ativa'",
        "ALTER TABLE vendas_local ADD COLUMN cancelado_em_ms INTEGER",
        "ALTER TABLE vendas_local ADD COLUMN cancelado_motivo TEXT",
        "ALTER TABLE vendas_local ADD COLUMN cancelado_operador_id TEXT",
        "ALTER TABLE vendas_local ADD COLUMN cancelado_client_uuid TEXT",
        "ALTER TABLE vendas_local ADD COLUMN cancelamento_local_uuid TEXT",
        // v11: financeiro local mais completo. Estende lancamentos_financeiros_local
        // com metadados de ciclo de vida, vínculos opcionais (venda/cliente/fornecedor),
        // datas de competência/vencimento/pagamento e idempotência para inserções manuais.
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmado'",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN venda_local_uuid TEXT",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN cliente_id TEXT",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN fornecedor_id TEXT",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN data_competencia_ms INTEGER",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN data_vencimento_ms INTEGER",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN data_pagamento_ms INTEGER",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN client_uuid TEXT",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN operador_id TEXT",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN cancelado_em_ms INTEGER",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN cancelado_motivo TEXT",
        // v12: vínculo com upstream + sync state
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN remote_id TEXT",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'local_only'",
        // v14: clientes offline-first basico.
        "ALTER TABLE clientes_local ADD COLUMN remote_id TEXT",
        "ALTER TABLE clientes_local ADD COLUMN tipo TEXT",
        "ALTER TABLE clientes_local ADD COLUMN email TEXT",
        "ALTER TABLE clientes_local ADD COLUMN telefone TEXT",
        "ALTER TABLE clientes_local ADD COLUMN celular TEXT",
        "ALTER TABLE clientes_local ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'",
        "ALTER TABLE clientes_local ADD COLUMN created_at_ms INTEGER",
        "ALTER TABLE clientes_local ADD COLUMN updated_at_ms INTEGER",
        "ALTER TABLE outbox_clientes ADD COLUMN cliente_local_id TEXT",
        "ALTER TABLE outbox_clientes ADD COLUMN next_attempt_at_ms INTEGER",
        "ALTER TABLE outbox_produtos ADD COLUMN produto_local_id TEXT",
        "ALTER TABLE outbox_produtos ADD COLUMN next_attempt_at_ms INTEGER",
        "ALTER TABLE outbox_produtos ADD COLUMN owner_id TEXT",
        // v16: isolamento multi-tenant fisico no SQLite local.
        // Em bancos existentes, a coluna fica nullable por compatibilidade;
        // todas as leituras novas exigem owner_id igual ao JWT.
        "ALTER TABLE produtos_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE clientes_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE estoque_saldos_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE estoque_movimentacoes_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE vendas_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE venda_itens_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE venda_pagamentos_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE caixa_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE caixa_movs_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE outbox_estoque_movs ADD COLUMN owner_id TEXT",
        "ALTER TABLE outbox_vendas ADD COLUMN owner_id TEXT",
        "ALTER TABLE outbox_caixa ADD COLUMN owner_id TEXT",
        "ALTER TABLE outbox_clientes ADD COLUMN owner_id TEXT",
        "ALTER TABLE outbox_cancelamentos_venda ADD COLUMN owner_id TEXT",
        "ALTER TABLE lancamentos_financeiros_local ADD COLUMN owner_id TEXT",
        "ALTER TABLE outbox_financeiro ADD COLUMN owner_id TEXT",
    ];
    for sql in alters {
        // Erro só ocorre quando a coluna já existe — seguro ignorar.
        let _ = conn.execute(sql, []);
    }
    // Índice para o scheduler escolher rapidamente o próximo lote elegível.
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_outbox_status_next
            ON outbox_estoque_movs(status, next_attempt_at_ms)",
        [],
    );
    // v9: índice para varrer rapidamente vendas vinculadas a um caixa local.
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vendas_local_caixa
            ON vendas_local(caixa_local_uuid) WHERE caixa_local_uuid IS NOT NULL",
        [],
    );
    // v10: índice para filtrar rapidamente vendas ativas vs canceladas.
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vendas_local_status
            ON vendas_local(status, created_at_ms DESC)",
        [],
    );
    // v11: índices/uniqueness do financeiro local estendido.
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lanc_local_status
            ON lancamentos_financeiros_local(status, created_at_ms DESC)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lanc_local_venda
            ON lancamentos_financeiros_local(venda_local_uuid) WHERE venda_local_uuid IS NOT NULL",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_lanc_local_competencia
            ON lancamentos_financeiros_local(data_competencia_ms)",
        [],
    );
    let _ = conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_lanc_local_client_uuid
            ON lancamentos_financeiros_local(client_uuid) WHERE client_uuid IS NOT NULL",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_clientes_remote_id
            ON clientes_local(remote_id)",
        [],
    );
    for sql in [
        "CREATE INDEX IF NOT EXISTS idx_produtos_owner ON produtos_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_clientes_owner ON clientes_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_saldos_owner ON estoque_saldos_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_movs_owner ON estoque_movimentacoes_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_vendas_local_owner ON vendas_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_venda_itens_local_owner ON venda_itens_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_venda_pagtos_local_owner ON venda_pagamentos_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_caixa_local_owner ON caixa_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_caixa_movs_owner ON caixa_movs_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_outbox_estoque_owner ON outbox_estoque_movs(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_outbox_vendas_owner ON outbox_vendas(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_outbox_caixa_owner ON outbox_caixa(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_outbox_clientes_owner ON outbox_clientes(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_outbox_canc_owner ON outbox_cancelamentos_venda(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_lanc_local_owner ON lancamentos_financeiros_local(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_outbox_fin_owner ON outbox_financeiro(owner_id)",
    ] {
        let _ = conn.execute(sql, []);
    }
    // v14: outbox de clientes basicos.
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS outbox_clientes (
            local_uuid          TEXT PRIMARY KEY,
            owner_id            TEXT,
            client_uuid         TEXT,
            cliente_local_id    TEXT NOT NULL,
            payload             TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'pending',
            attempts            INTEGER NOT NULL DEFAULT 0,
            last_error          TEXT,
            remote_id           TEXT,
            created_at_ms       INTEGER NOT NULL,
            updated_at_ms       INTEGER NOT NULL,
            sent_at_ms          INTEGER,
            next_attempt_at_ms  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_clientes_status
            ON outbox_clientes(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_clientes_owner
            ON outbox_clientes(owner_id);
        CREATE INDEX IF NOT EXISTS idx_outbox_clientes_status_next
            ON outbox_clientes(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_clientes_cliente
            ON outbox_clientes(cliente_local_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_clientes_client_uuid
            ON outbox_clientes(client_uuid) WHERE client_uuid IS NOT NULL;
        "#,
    )?;

    // v15: outbox de produtos básicos (cadastro/edição offline)
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS outbox_produtos (
            local_uuid          TEXT PRIMARY KEY,
            owner_id            TEXT,
            client_uuid         TEXT,
            produto_local_id    TEXT NOT NULL,
            payload             TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'pending',
            attempts            INTEGER NOT NULL DEFAULT 0,
            last_error          TEXT,
            remote_id           TEXT,
            created_at_ms       INTEGER NOT NULL,
            updated_at_ms       INTEGER NOT NULL,
            sent_at_ms          INTEGER,
            next_attempt_at_ms  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_produtos_status
            ON outbox_produtos(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_produtos_owner
            ON outbox_produtos(owner_id);
        CREATE INDEX IF NOT EXISTS idx_outbox_produtos_status_next
            ON outbox_produtos(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_produtos_produto
            ON outbox_produtos(produto_local_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_produtos_client_uuid
            ON outbox_produtos(client_uuid) WHERE client_uuid IS NOT NULL;
        "#,
    )?;

    // ------------------------------------------------------------------
    // v10 — Outbox de cancelamentos de venda.
    //
    // Mesmo padrão das outboxes de estoque/vendas/caixa. Cada item carrega
    // o `venda_local_uuid` (FK lógica para vendas_local) e o `remote_id` da
    // venda na nuvem (quando já sincronizada). O scheduler resolve o
    // `_venda_id` upstream em tempo de envio:
    //   * se a venda já tinha `remote_id` quando cancelada → usa direto;
    //   * caso contrário → consulta a outbox de vendas para obter o
    //     remote_id quando ela for sincronizada (ordem causal: venda
    //     primeiro, cancelamento depois).
    //
    // Idempotência:
    //   * `client_uuid` (vinda do PDV/UI) deduplica reenvios do terminal.
    //   * `local_uuid` é estável e vira `_client_uuid` da RPC `cancelar_venda`.
    // ------------------------------------------------------------------
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS outbox_cancelamentos_venda (
            local_uuid          TEXT PRIMARY KEY,
            owner_id            TEXT,
            client_uuid         TEXT,
            venda_local_uuid    TEXT NOT NULL,
            venda_remote_id     TEXT,
            motivo              TEXT,
            operador_id         TEXT,
            payload             TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'pending',
            attempts            INTEGER NOT NULL DEFAULT 0,
            last_error          TEXT,
            remote_response     TEXT,
            created_at_ms       INTEGER NOT NULL,
            updated_at_ms       INTEGER NOT NULL,
            sent_at_ms          INTEGER,
            next_attempt_at_ms  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_canc_status
            ON outbox_cancelamentos_venda(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_canc_owner
            ON outbox_cancelamentos_venda(owner_id);
        CREATE INDEX IF NOT EXISTS idx_outbox_canc_status_next
            ON outbox_cancelamentos_venda(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_canc_venda
            ON outbox_cancelamentos_venda(venda_local_uuid);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_canc_client_uuid
            ON outbox_cancelamentos_venda(client_uuid) WHERE client_uuid IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_canc_venda
            ON outbox_cancelamentos_venda(venda_local_uuid);
        "#,
    )?;

    // ------------------------------------------------------------------
    // v9 — Lançamentos financeiros locais derivados do fechamento do caixa.
    //
    // Esta tabela é puramente DERIVADA: gerada pelo `fechar_caixa_local` a
    // partir das vendas locais associadas + suprimentos/sangrias. Serve como
    // base inicial para um futuro financeiro local mais completo, e como
    // fonte de observabilidade do que aquele caixa "produziu" do ponto de
    // vista financeiro.
    //
    // Não enfileira em outbox nesta etapa — o financeiro real continua sendo
    // gerado no upstream via `fechar_caixa` na nuvem. Aqui é só leitura local.
    //
    // categoria:
    //   'venda_<forma>'  → entrada de venda por forma de pagamento
    //   'suprimento'     → entrada manual de dinheiro no caixa
    //   'sangria'        → saída manual de dinheiro do caixa
    // tipo: 'entrada' | 'saida'
    // ------------------------------------------------------------------
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS lancamentos_financeiros_local (
            local_uuid       TEXT PRIMARY KEY,
            owner_id         TEXT,
            caixa_local_uuid TEXT NOT NULL,
            tipo             TEXT NOT NULL,
            categoria        TEXT NOT NULL,
            forma_pagamento  TEXT,
            valor            REAL NOT NULL DEFAULT 0,
            descricao        TEXT,
            origem           TEXT NOT NULL DEFAULT 'fechamento_caixa',
            payload          TEXT,
            created_at_ms    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_lanc_local_caixa
            ON lancamentos_financeiros_local(caixa_local_uuid, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_lanc_local_owner
            ON lancamentos_financeiros_local(owner_id);
        CREATE INDEX IF NOT EXISTS idx_lanc_local_categoria
            ON lancamentos_financeiros_local(caixa_local_uuid, categoria);
        "#,
    )?;

    // ------------------------------------------------------------------
    // v12 — Outbox de lançamentos financeiros manuais.
    //
    // Mesma arquitetura das outras outboxes (estoque/vendas/caixa/cancel):
    //   * `local_uuid`         → PK estável; também serve de _client_uuid
    //                            ponta-a-ponta para a RPC upstream.
    //   * `client_uuid`        → idempotência ao nível do produtor (UI/PDV).
    //   * `lanc_local_uuid`    → FK lógica para lancamentos_financeiros_local.
    //   * `payload`            → JSON do request enviado à RPC
    //                            `criar_lancamento_avulso`.
    //   * `status`             → pending | sending | sent | error
    //   * `next_attempt_at_ms` → backoff exponencial.
    //   * `remote_id`          → id devolvido pela RPC após sucesso.
    // ------------------------------------------------------------------
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS outbox_financeiro (
            local_uuid          TEXT PRIMARY KEY,
            owner_id            TEXT,
            client_uuid         TEXT,
            lanc_local_uuid     TEXT NOT NULL,
            payload             TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'pending',
            attempts            INTEGER NOT NULL DEFAULT 0,
            last_error          TEXT,
            remote_id           TEXT,
            remote_response     TEXT,
            created_at_ms       INTEGER NOT NULL,
            updated_at_ms       INTEGER NOT NULL,
            sent_at_ms          INTEGER,
            next_attempt_at_ms  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_fin_status
            ON outbox_financeiro(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_fin_owner
            ON outbox_financeiro(owner_id);
        CREATE INDEX IF NOT EXISTS idx_outbox_fin_status_next
            ON outbox_financeiro(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_fin_lanc
            ON outbox_financeiro(lanc_local_uuid);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_fin_client_uuid
            ON outbox_financeiro(client_uuid) WHERE client_uuid IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_fin_lanc
            ON outbox_financeiro(lanc_local_uuid);
        "#,
    )?;

    conn.execute(
        "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SCHEMA_VERSION.to_string()],
    )?;
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('created_at_ms', ?1)
         ON CONFLICT(key) DO NOTHING",
        params![chrono::Utc::now().timestamp_millis().to_string()],
    )?;

    DB.set(Mutex::new(conn))
        .map_err(|_| DbError("DB já inicializado".into()))?;
    Ok(())
}

fn with_conn<T>(f: impl FnOnce(&Connection) -> DbResult<T>) -> DbResult<T> {
    let cell = DB
        .get()
        .ok_or_else(|| DbError("DB não inicializado".into()))?;
    let wait_start = Instant::now();
    eprintln!("[gestao-pro] db::with_conn ACQUIRE lock");
    let guard = cell
        .lock()
        .map_err(|e| DbError(format!("DB lock poisoned: {e}")))?;
    let waited = wait_start.elapsed();
    if waited.as_millis() >= 500 {
        eprintln!(
            "[gestao-pro] sqlite mutex aguardou {}ms; possivel contencao de scheduler/handler",
            waited.as_millis()
        );
    }
    let result = f(&guard);
    drop(guard);
    eprintln!(
        "[gestao-pro] db::with_conn RELEASE lock after {}ms",
        wait_start.elapsed().as_millis()
    );
    result
}

/// Versão pública de `with_conn` para módulos vizinhos (ex.: `backup`)
/// que precisam executar SQL administrativo (logs, metadados).
pub fn with_raw_conn<T>(f: impl FnOnce(&Connection) -> DbResult<T>) -> DbResult<T> {
    with_conn(f)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthorizedUserRow {
    pub user_id: String,
    pub email: String,
    pub synced_at_ms: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FuncionarioLocalRow {
    pub funcionario_id: String,
    pub nome: String,
    pub login: String,
    pub role: String,
    pub ativo: bool,
    pub synced_at_ms: i64,
}

pub fn upsert_authorized_user(
    user_id: &str,
    email: &str,
    password_hash: &str,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            r#"INSERT INTO desktop_authorized_users(user_id, email, password_hash, synced_at_ms)
               VALUES(?1, ?2, ?3, ?4)
               ON CONFLICT(user_id) DO UPDATE SET
                 email = excluded.email,
                 password_hash = excluded.password_hash,
                 synced_at_ms = excluded.synced_at_ms"#,
            params![user_id, email, password_hash, now_ms],
        )?;
        Ok(())
    })
}

pub fn verify_authorized_user(email: &str, password: &str) -> DbResult<Option<AuthorizedUserRow>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT user_id, email, password_hash, synced_at_ms
             FROM desktop_authorized_users
             WHERE lower(email) = lower(?1)",
        )?;
        let row = stmt
            .query_row(params![email], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .optional()?;
        if let Some((user_id, email, password_hash, synced_at_ms)) = row {
            if bcrypt::verify(password, &password_hash).map_err(|e| DbError(e.to_string()))? {
                return Ok(Some(AuthorizedUserRow {
                    user_id,
                    email,
                    synced_at_ms,
                }));
            }
        }
        Ok(None)
    })
}

pub fn authorized_user_by_email(email: &str) -> DbResult<Option<AuthorizedUserRow>> {
    with_conn(|conn| {
        let row = conn
            .query_row(
                "SELECT user_id, email, synced_at_ms
                 FROM desktop_authorized_users
                 WHERE lower(email) = lower(?1)",
                params![email],
                |row| {
                    Ok(AuthorizedUserRow {
                        user_id: row.get(0)?,
                        email: row.get(1)?,
                        synced_at_ms: row.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    })
}

pub fn upsert_funcionario_local(
    funcionario_id: &str,
    nome: &str,
    login: &str,
    role: &str,
    ativo: bool,
    pin_hash: Option<&str>,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            r#"INSERT INTO funcionarios_local(funcionario_id, nome, login, role, ativo, pin_hash, synced_at_ms)
               VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
               ON CONFLICT(funcionario_id) DO UPDATE SET
                 nome = excluded.nome,
                 login = excluded.login,
                 role = excluded.role,
                 ativo = excluded.ativo,
                 pin_hash = COALESCE(excluded.pin_hash, funcionarios_local.pin_hash),
                 synced_at_ms = excluded.synced_at_ms"#,
            params![funcionario_id, nome, login, role, ativo as i64, pin_hash, now_ms],
        )?;
        Ok(())
    })
}

pub fn list_funcionarios_ativos_local() -> DbResult<Vec<FuncionarioLocalRow>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT funcionario_id, nome, login, role, ativo, synced_at_ms
             FROM funcionarios_local
             WHERE ativo = 1
             ORDER BY nome",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(FuncionarioLocalRow {
                    funcionario_id: row.get(0)?,
                    nome: row.get(1)?,
                    login: row.get(2)?,
                    role: row.get(3)?,
                    ativo: row.get::<_, i64>(4)? != 0,
                    synced_at_ms: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, rusqlite::Error>>()?;
        Ok(rows)
    })
}

pub fn verify_funcionario_pin_local(
    funcionario_id: &str,
    pin: &str,
) -> DbResult<Option<FuncionarioLocalRow>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT funcionario_id, nome, login, role, ativo, pin_hash, synced_at_ms
             FROM funcionarios_local
             WHERE funcionario_id = ?1 AND ativo = 1",
        )?;
        let row = stmt
            .query_row(params![funcionario_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)? != 0,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })
            .optional()?;
        if let Some((funcionario_id, nome, login, role, ativo, pin_hash, synced_at_ms)) = row {
            if let Some(pin_hash) = pin_hash {
                if bcrypt::verify(pin, &pin_hash).map_err(|e| DbError(e.to_string()))? {
                    return Ok(Some(FuncionarioLocalRow {
                        funcionario_id,
                        nome,
                        login,
                        role,
                        ativo,
                        synced_at_ms,
                    }));
                }
            }
        }
        Ok(None)
    })
}

// ---------- Terminals ----------

#[derive(Debug, Serialize, Clone)]
pub struct PersistedTerminal {
    pub terminal_id: String,
    pub machine_id: Option<String>,
    pub server_id: Option<String>,
    pub terminal_nome: Option<String>,
    pub role: Option<String>,
    pub app_version: Option<String>,
    pub host: Option<String>,
    pub first_seen_ms: i64,
    pub last_seen_ms: i64,
    pub status: String,
    pub heartbeats: i64,
}

pub struct UpsertHeartbeat<'a> {
    pub terminal_id: &'a str,
    pub machine_id: Option<&'a str>,
    pub server_id: Option<&'a str>,
    pub terminal_nome: Option<&'a str>,
    pub role: Option<&'a str>,
    pub app_version: Option<&'a str>,
    pub host: Option<&'a str>,
    pub now_ms: i64,
}

pub fn upsert_terminal(hb: UpsertHeartbeat<'_>) -> DbResult<PersistedTerminal> {
    with_conn(|conn| {
        conn.execute(
            r#"
            INSERT INTO terminals (
                terminal_id, machine_id, server_id, terminal_nome,
                role, app_version, host,
                first_seen_ms, last_seen_ms, status, heartbeats
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 'online', 1)
            ON CONFLICT(terminal_id) DO UPDATE SET
                machine_id    = COALESCE(excluded.machine_id, terminals.machine_id),
                server_id     = COALESCE(excluded.server_id,  terminals.server_id),
                terminal_nome = COALESCE(excluded.terminal_nome, terminals.terminal_nome),
                role          = COALESCE(excluded.role,       terminals.role),
                app_version   = COALESCE(excluded.app_version, terminals.app_version),
                host          = COALESCE(excluded.host,       terminals.host),
                last_seen_ms  = excluded.last_seen_ms,
                status        = 'online',
                heartbeats    = terminals.heartbeats + 1
            "#,
            params![
                hb.terminal_id,
                hb.machine_id,
                hb.server_id,
                hb.terminal_nome,
                hb.role,
                hb.app_version,
                hb.host,
                hb.now_ms,
            ],
        )?;
        get_terminal(conn, hb.terminal_id)?.ok_or_else(|| DbError("upsert sem retorno".into()))
    })
}

fn get_terminal(conn: &Connection, terminal_id: &str) -> DbResult<Option<PersistedTerminal>> {
    let mut stmt = conn.prepare(
        "SELECT terminal_id, machine_id, server_id, terminal_nome, role, app_version,
                host, first_seen_ms, last_seen_ms, status, heartbeats
         FROM terminals WHERE terminal_id = ?1",
    )?;
    let row = stmt
        .query_row(params![terminal_id], map_terminal_row)
        .optional()?;
    Ok(row)
}

fn map_terminal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersistedTerminal> {
    Ok(PersistedTerminal {
        terminal_id: row.get(0)?,
        machine_id: row.get(1)?,
        server_id: row.get(2)?,
        terminal_nome: row.get(3)?,
        role: row.get(4)?,
        app_version: row.get(5)?,
        host: row.get(6)?,
        first_seen_ms: row.get(7)?,
        last_seen_ms: row.get(8)?,
        status: row.get(9)?,
        heartbeats: row.get(10)?,
    })
}

pub fn list_terminals(limit: i64) -> DbResult<Vec<PersistedTerminal>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT terminal_id, machine_id, server_id, terminal_nome, role, app_version,
                    host, first_seen_ms, last_seen_ms, status, heartbeats
             FROM terminals
             ORDER BY last_seen_ms DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], map_terminal_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn count_terminals() -> DbResult<(i64, i64)> {
    // Retorna (total, online_nos_ultimos_2min)
    with_conn(|conn| {
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM terminals", [], |r| r.get(0))?;
        let cutoff = chrono::Utc::now().timestamp_millis() - 120_000;
        let online: i64 = conn.query_row(
            "SELECT COUNT(*) FROM terminals WHERE last_seen_ms >= ?1",
            params![cutoff],
            |r| r.get(0),
        )?;
        Ok((total, online))
    })
}

// ---------- Auditoria ----------

pub struct LogEvent<'a> {
    pub terminal_id: &'a str,
    pub event_type: &'a str,
    pub ts_ms: i64,
    pub server_match: Option<bool>,
    pub expected_server_id: Option<&'a str>,
    pub details: Option<&'a str>,
}

pub fn log_event(ev: LogEvent<'_>) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO terminal_events
                (terminal_id, event_type, ts_ms, server_match, expected_server_id, details)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                ev.terminal_id,
                ev.event_type,
                ev.ts_ms,
                ev.server_match.map(|b| if b { 1 } else { 0 }),
                ev.expected_server_id,
                ev.details,
            ],
        )?;
        Ok(())
    })
}

#[derive(Debug, Serialize)]
pub struct PersistedEvent {
    pub id: i64,
    pub terminal_id: String,
    pub event_type: String,
    pub ts_ms: i64,
    pub server_match: Option<bool>,
    pub expected_server_id: Option<String>,
    pub details: Option<String>,
}

pub fn list_events(limit: i64) -> DbResult<Vec<PersistedEvent>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, terminal_id, event_type, ts_ms, server_match,
                    expected_server_id, details
             FROM terminal_events
             ORDER BY ts_ms DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            let sm: Option<i64> = r.get(4)?;
            Ok(PersistedEvent {
                id: r.get(0)?,
                terminal_id: r.get(1)?,
                event_type: r.get(2)?,
                ts_ms: r.get(3)?,
                server_match: sm.map(|v| v != 0),
                expected_server_id: r.get(5)?,
                details: r.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

// ---------- Cache KV (read-through) ----------

pub fn cache_get(domain: &str, key: &str, now_ms: i64) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM cache_kv
             WHERE domain = ?1 AND cache_key = ?2 AND expires_at_ms > ?3",
        )?;
        let row = stmt
            .query_row(params![domain, key, now_ms], |r| r.get::<_, String>(0))
            .optional()?;
        Ok(row)
    })
}

pub fn cache_put(domain: &str, key: &str, payload: &str, now_ms: i64, ttl_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO cache_kv(domain, cache_key, payload, stored_at_ms, expires_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(domain, cache_key) DO UPDATE SET
                payload = excluded.payload,
                stored_at_ms = excluded.stored_at_ms,
                expires_at_ms = excluded.expires_at_ms",
            params![domain, key, payload, now_ms, now_ms + ttl_ms],
        )?;
        Ok(())
    })
}

#[derive(Debug, Serialize)]
pub struct DbInfo {
    pub path: String,
    pub schema_version: i64,
    pub terminals_total: i64,
    pub terminals_online: i64,
    pub events_total: i64,
    pub cache_entries: i64,
    pub created_at_ms: Option<i64>,
}

pub fn db_info() -> DbResult<DbInfo> {
    let (total, online) = count_terminals()?;
    with_conn(|conn| {
        let events_total: i64 =
            conn.query_row("SELECT COUNT(*) FROM terminal_events", [], |r| r.get(0))?;
        let cache_entries: i64 =
            conn.query_row("SELECT COUNT(*) FROM cache_kv", [], |r| r.get(0))?;
        let created_at_ms: Option<i64> = conn
            .query_row(
                "SELECT value FROM meta WHERE key='created_at_ms'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .and_then(|s| s.parse().ok());
        Ok(DbInfo {
            path: db_file().to_string_lossy().to_string(),
            schema_version: SCHEMA_VERSION,
            terminals_total: total,
            terminals_online: online,
            events_total,
            cache_entries,
            created_at_ms,
        })
    })
}

// ============================================================================
// v2 — Tabelas tipadas para os primeiros domínios provados
// ============================================================================
//
// Estratégia: o servidor local continua buscando o JSON cru no upstream
// (Supabase REST) e, em paralelo ao cache_kv, INGERE em tabelas tipadas com
// índices. Próximas etapas farão writes locais e sync incremental real.
//
// `payload` mantém o JSON completo do registro para que o adapter possa
// devolver o objeto inteiro sem mapear todas as colunas ainda.

// Helpers puros (parse_iso_to_ms, json_str, json_f64, iso_from_ms_z_pub,
// backoff_ms_for_attempts) foram movidos para `db::helpers` no PROMPT 12.
// Os símbolos continuam disponíveis dentro deste módulo via `use helpers::*`
// abaixo, sem mudar assinaturas nem comportamento.
mod helpers;
use helpers::{backoff_ms_for_attempts, iso_from_ms_z_pub, json_f64, json_str, parse_iso_to_ms};

#[derive(Debug, Serialize)]
pub struct DomainStat {
    pub domain: String,
    pub row_count: i64,
    pub last_synced_ms: Option<i64>,
    pub last_source: Option<String>,
    pub last_strategy: Option<String>,
    pub last_delta_count: i64,
    pub last_remote_cursor_ms: Option<i64>,
    pub last_attempt_ms: Option<i64>,
    pub last_synced_ok: bool,
    pub last_error: Option<String>,
}

/// Estado de sync por domínio (lido pela camada de proxy).
#[derive(Debug, Clone)]
pub struct DomainSyncState {
    pub last_remote_cursor_ms: Option<i64>,
    pub last_strategy: Option<String>,
}

pub fn get_domain_sync_state(domain: &str) -> DbResult<DomainSyncState> {
    with_conn(|conn| {
        let row = conn
            .query_row(
                "SELECT last_remote_cursor_ms, last_strategy
                 FROM domain_sync_meta WHERE domain = ?1",
                params![domain],
                |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        Ok(match row {
            Some((c, s)) => DomainSyncState {
                last_remote_cursor_ms: c,
                last_strategy: s,
            },
            None => DomainSyncState {
                last_remote_cursor_ms: None,
                last_strategy: None,
            },
        })
    })
}

pub fn record_sync_error(domain: &str, now_ms: i64, err: &str) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO domain_sync_meta(domain, last_synced_ms, row_count, last_source,
                last_error, last_strategy, last_delta_count, last_attempt_ms, last_synced_ok)
             VALUES (?1, 0, 0, NULL, ?2, NULL, 0, ?3, 0)
             ON CONFLICT(domain) DO UPDATE SET
                last_error      = excluded.last_error,
                last_attempt_ms = excluded.last_attempt_ms,
                last_synced_ok  = 0",
            params![domain, err, now_ms],
        )?;
        Ok(())
    })
}

/// Argumentos consolidados para gravar metadata após uma ingestão bem-sucedida.
pub struct DomainMetaUpdate<'a> {
    pub domain: &'a str,
    pub row_count: i64,
    pub now_ms: i64,
    pub source: &'a str,   // "upstream" | "manual"
    pub strategy: &'a str, // "snapshot" | "incremental" | "append"
    pub delta_count: i64,
    pub max_remote_updated_ms: Option<i64>,
}

fn upsert_domain_meta(conn: &Connection, upd: DomainMetaUpdate<'_>) -> rusqlite::Result<()> {
    // Avança o cursor monotonicamente — nunca retrocede.
    conn.execute(
        "INSERT INTO domain_sync_meta(domain, last_synced_ms, row_count, last_source,
            last_error, last_strategy, last_delta_count, last_attempt_ms, last_synced_ok,
            last_remote_cursor_ms)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?2, 1, ?7)
         ON CONFLICT(domain) DO UPDATE SET
            last_synced_ms        = excluded.last_synced_ms,
            row_count             = excluded.row_count,
            last_source           = excluded.last_source,
            last_error            = NULL,
            last_strategy         = excluded.last_strategy,
            last_delta_count      = excluded.last_delta_count,
            last_attempt_ms       = excluded.last_attempt_ms,
            last_synced_ok        = 1,
            last_remote_cursor_ms = MAX(
                COALESCE(domain_sync_meta.last_remote_cursor_ms, 0),
                COALESCE(excluded.last_remote_cursor_ms, 0)
            )",
        params![
            upd.domain,
            upd.now_ms,
            upd.row_count,
            upd.source,
            upd.strategy,
            upd.delta_count,
            upd.max_remote_updated_ms,
        ],
    )?;
    Ok(())
}

// ---------- Produtos ----------

/// Estratégia da ingestão (afeta como o servidor trata "ausentes").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestStrategy {
    /// Snapshot completo do upstream — base inicial; não sabemos se algo foi
    /// removido fora deste lote, então NÃO marcamos tombstones por ausência.
    Snapshot,
    /// Lote incremental por `updated_at` — só vieram registros alterados.
    /// Tombstone "soft" é aplicado para qualquer linha cujo `status` no
    /// upstream tenha mudado para algo diferente de "ativo".
    Incremental,
    /// Append-only por `data_movimentacao` (ou cursor equivalente). Usado
    /// para domínios imutáveis como `estoque_movimentacoes`: registros
    /// nunca são apagados, só inseridos. Não há tombstone — o cursor
    /// avança e cada nova linha simplesmente é INSERT OR IGNORE.
    Append,
}

impl IngestStrategy {
    pub fn as_str(self) -> &'static str {
        match self {
            IngestStrategy::Snapshot => "snapshot",
            IngestStrategy::Incremental => "incremental",
            IngestStrategy::Append => "append",
        }
    }
}

/// Considera o status remoto como soft-delete (tombstone local).
/// Cloud usa `status` para arquivar/inativar — esta etapa cobre o caso
/// realista. Hard-delete real exigirá endpoint de tombstones (próxima etapa).
fn is_tombstoned_status(status: Option<&str>) -> bool {
    match status {
        None => false,
        Some(s) => {
            let s = s.to_ascii_lowercase();
            s == "inativo" || s == "arquivado" || s == "deleted" || s == "removido"
        }
    }
}

/// Ingere uma resposta do upstream (snapshot OU delta) na tabela tipada.
/// Retorna `(linhas_aplicadas, max_updated_at_ms_no_lote)`.
pub fn ingest_produtos(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
    owner_id: &str,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_produtos: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok((0, None)),
    };

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let mut count = 0usize;
        let mut max_remote_ms: Option<i64> = None;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO produtos_local(
                    id, owner_id, sku, nome, status, categoria_id, categoria_nome,
                    preco_venda, estoque_atual, payload,
                    updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
                 ON CONFLICT(id) DO UPDATE SET
                    owner_id             = excluded.owner_id,
                    sku                  = excluded.sku,
                    nome                 = excluded.nome,
                    status               = excluded.status,
                    categoria_id         = excluded.categoria_id,
                    categoria_nome       = excluded.categoria_nome,
                    preco_venda          = excluded.preco_venda,
                    estoque_atual        = excluded.estoque_atual,
                    payload              = excluded.payload,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, produtos_local.updated_at_remote_ms),
                    synced_at_ms         = excluded.synced_at_ms,
                    deleted_at_ms        = excluded.deleted_at_ms",
            )?;
            for item in items {
                let id = match json_str(item, "id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let categoria_nome = item
                    .get("categoria")
                    .and_then(|c| c.get("nome"))
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string());
                let updated_ms = json_str(item, "updated_at").and_then(parse_iso_to_ms);
                if let Some(ms) = updated_ms {
                    max_remote_ms = Some(max_remote_ms.map_or(ms, |c| c.max(ms)));
                }
                let status = json_str(item, "status");
                // Tombstone aplicado APENAS em modo incremental — em snapshot
                // não temos como diferenciar "não retornou" de "removido", e
                // status pode aparecer como "inativo" sem ser deleção.
                let deleted_at_ms =
                    if strategy == IngestStrategy::Incremental && is_tombstoned_status(status) {
                        Some(now_ms)
                    } else {
                        None::<i64>
                    };
                let mut item_with_owner = item.clone();
                if let Some(obj) = item_with_owner.as_object_mut() {
                    obj.insert(
                        "owner_id".into(),
                        serde_json::Value::String(owner_id.to_string()),
                    );
                }
                let payload =
                    serde_json::to_string(&item_with_owner).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    owner_id,
                    json_str(item, "sku"),
                    json_str(item, "nome"),
                    status,
                    json_str(item, "categoria_id"),
                    categoria_nome,
                    json_f64(item, "preco_venda"),
                    json_f64(item, "estoque_atual"),
                    payload,
                    updated_ms,
                    now_ms,
                    deleted_at_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM produtos_local WHERE owner_id=?1 AND deleted_at_ms IS NULL",
            params![owner_id],
            |r| r.get(0),
        )?;
        upsert_domain_meta(
            &tx,
            DomainMetaUpdate {
                domain: "produtos",
                row_count: total,
                now_ms,
                source: "upstream",
                strategy: strategy.as_str(),
                delta_count: count as i64,
                max_remote_updated_ms: max_remote_ms,
            },
        )?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

/// Compat: chamada antiga (snapshot).
pub fn ingest_produtos_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    ingest_produtos(json_text, now_ms, IngestStrategy::Snapshot, "").map(|(n, _)| n)
}

pub struct ProdutosFilter<'a> {
    pub owner_id: Option<&'a str>,
    pub status: Option<&'a str>,
    pub categoria_id: Option<&'a str>,
    pub busca: Option<&'a str>,
}

/// Lê produtos da tabela local. Retorna o JSON-array (string) compatível
/// com o que o upstream entregaria — assim o adapter atual nem percebe
/// que veio de tabela tipada.
pub fn read_produtos(filter: ProdutosFilter<'_>) -> DbResult<String> {
    with_conn(|conn| {
        let mut sql = String::from(
            "SELECT payload, estoque_atual FROM produtos_local WHERE deleted_at_ms IS NULL",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(owner_id) = filter.owner_id {
            sql.push_str(" AND owner_id = ?");
            args.push(Box::new(owner_id.to_string()));
        }
        if let Some(s) = filter.status {
            sql.push_str(" AND status = ?");
            args.push(Box::new(s.to_string()));
        }
        if let Some(c) = filter.categoria_id {
            sql.push_str(" AND categoria_id = ?");
            args.push(Box::new(c.to_string()));
        }
        if let Some(b) = filter.busca {
            let pat = format!("%{}%", b.to_lowercase());
            sql.push_str(" AND (LOWER(nome) LIKE ? OR LOWER(IFNULL(sku,'')) LIKE ?)");
            args.push(Box::new(pat.clone()));
            args.push(Box::new(pat));
        }
        sql.push_str(" ORDER BY nome ASC");

        let params_dyn: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| &**b).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_dyn.as_slice(), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?))
        })?;
        let mut out_owner: Vec<serde_json::Value> = Vec::new();
        for r in rows {
            let (payload, estoque_atual) = r?;
            let mut item: serde_json::Value =
                serde_json::from_str(&payload).unwrap_or_else(|_| serde_json::json!({}));
            if item.get("categoria_nome").is_none() {
                let categoria_nome = item
                    .get("categoria")
                    .and_then(|c| c.get("nome"))
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string());
                if let Some(nome) = categoria_nome {
                    if let Some(obj) = item.as_object_mut() {
                        obj.insert("categoria_nome".into(), serde_json::Value::String(nome));
                    }
                }
            }
            if item.get("estoque_atual").is_none() {
                if let (Some(obj), Some(v)) = (item.as_object_mut(), estoque_atual) {
                    obj.insert("estoque_atual".into(), serde_json::json!(v));
                }
            }
            if let Some(owner_id) = filter.owner_id {
                if let Some(obj) = item.as_object_mut() {
                    obj.entry("owner_id")
                        .or_insert_with(|| serde_json::Value::String(owner_id.to_string()));
                }
            }
            out_owner.push(item.clone());
        }
        // Isolamento multi-tenant: quando a rota passa owner_id, registros
        // locais sem owner_id ou de outro dono nao podem ser servidos.
        serde_json::to_string(&out_owner).map_err(|e| DbError(e.to_string()))
    })
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1
        )",
        params![table],
        |r| r.get(0),
    )
}

fn table_has_unique_columns(
    conn: &Connection,
    table: &str,
    expected: &[&str],
) -> rusqlite::Result<bool> {
    let mut indexes = conn.prepare(&format!("PRAGMA index_list({table})"))?;
    let rows = indexes.query_map([], |r| {
        Ok((r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0))
    })?;
    let mut unique_indexes = Vec::new();
    for row in rows {
        let (name, unique) = row?;
        if unique {
            unique_indexes.push(name);
        }
    }
    drop(indexes);

    for index in unique_indexes {
        let mut columns_stmt = conn.prepare(&format!("PRAGMA index_info({index})"))?;
        let columns = columns_stmt
            .query_map([], |r| r.get::<_, String>(2))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if columns.len() == expected.len()
            && columns
                .iter()
                .zip(expected.iter())
                .all(|(actual, expected)| actual == expected)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Recupera bancos locais criados antes do isolamento multiempresa.
///
/// A regra é conservadora: só adota linhas sem owner_id quando não existe
/// nenhum outro owner_id diferente do usuário atual no SQLite. Assim bancos
/// antigos de uma única empresa voltam a aparecer sem misturar empresas.
pub fn adopt_legacy_ownerless_data(owner_id: &str) -> DbResult<bool> {
    if owner_id.trim().is_empty() {
        return Err(DbError(
            "LEGACY_OWNER_ADOPT: usuario atual nao autenticado".into(),
        ));
    }
    with_conn(|conn| adopt_legacy_ownerless_data_with_conn(conn, owner_id))
}

fn adopt_legacy_ownerless_data_with_conn(conn: &Connection, owner_id: &str) -> DbResult<bool> {
    let owner_tables = [
        "produtos_local",
        "clientes_local",
        "estoque_saldos_local",
        "estoque_movimentacoes_local",
        "vendas_local",
        "venda_itens_local",
        "venda_pagamentos_local",
        "caixa_local",
        "caixa_movs_local",
        "outbox_estoque_movs",
        "outbox_produtos",
        "outbox_vendas",
        "outbox_caixa",
        "outbox_clientes",
        "outbox_cancelamentos_venda",
        "lancamentos_financeiros_local",
        "outbox_financeiro",
    ];

    for table in owner_tables {
        if !table_exists(conn, table)? {
            continue;
        }
        if !table_has_column(conn, table, "owner_id")? {
            conn.execute(&format!("ALTER TABLE {table} ADD COLUMN owner_id TEXT"), [])?;
        }
        let sql = format!(
            "SELECT COUNT(DISTINCT owner_id)
                   FROM {table}
                  WHERE owner_id IS NOT NULL
                    AND owner_id <> ''
                    AND owner_id <> ?1"
        );
        let conflicts: i64 = conn.query_row(&sql, params![owner_id], |r| r.get(0))?;
        if conflicts > 0 {
            return Err(DbError(format!(
                    "LEGACY_OWNER_CONFLICT: {table} contem dados de outro owner; adocao automatica bloqueada"
                )));
        }
    }

    let tx = conn.unchecked_transaction()?;
    let mut changed = false;

    // Saldos têm PK com owner_id; quando já existe saldo novo do owner,
    // somamos o saldo legado e removemos a linha sem owner.
    let mut adopted_counts = Vec::<(&str, usize)>::new();
    if table_exists(&tx, "estoque_saldos_local")?
        && table_has_column(&tx, "estoque_saldos_local", "owner_id")?
    {
        let legacy_saldos: i64 = tx.query_row(
            "SELECT COUNT(*) FROM estoque_saldos_local
                  WHERE owner_id IS NULL OR owner_id = ''",
            [],
            |r| r.get(0),
        )?;
        if legacy_saldos > 0
            && !table_has_unique_columns(
                &tx,
                "estoque_saldos_local",
                &["owner_id", "produto_id", "variacao_id"],
            )?
        {
            // Schema antigo: UNIQUE(produto_id, variacao_id) impede uma
            // segunda linha para merge, entao a adocao deve ser in-place.
            if table_exists(&tx, "estoque_movimentacoes_local")?
                && table_has_column(&tx, "estoque_movimentacoes_local", "owner_id")?
            {
                // Movimentos do owner atual gravados enquanto o saldo ainda
                // era legacy nao conseguiram atualizar a linha antiga.
                // Soma-os uma unica vez, antes de retirar o owner NULL.
                tx.execute(
                    "UPDATE estoque_saldos_local AS s
                            SET quantidade = quantidade + COALESCE((
                                    SELECT SUM(
                                        CASE
                                            WHEN m.tipo IN ('saida', 'transferencia')
                                                THEN -m.quantidade
                                            ELSE m.quantidade
                                        END
                                    )
                                      FROM estoque_movimentacoes_local m
                                     WHERE m.owner_id=?1
                                       AND m.produto_id=s.produto_id
                                       AND m.variacao_id=s.variacao_id
                                ), 0),
                                owner_id=?1
                          WHERE s.owner_id IS NULL OR s.owner_id = ''",
                    params![owner_id],
                )?;
            } else {
                tx.execute(
                    "UPDATE estoque_saldos_local SET owner_id=?1
                          WHERE owner_id IS NULL OR owner_id = ''",
                    params![owner_id],
                )?;
            }
            adopted_counts.push(("estoque_saldos_local", legacy_saldos as usize));
            changed = true;
        } else if legacy_saldos > 0 {
            let mut rows = Vec::<(String, String, Option<String>, f64, String, i64)>::new();
            {
                let mut stmt = tx.prepare(
                    "SELECT produto_id, variacao_id, tipo, quantidade, payload, synced_at_ms
                       FROM estoque_saldos_local
                      WHERE owner_id IS NULL OR owner_id = ''",
                )?;
                let mapped = stmt.query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, f64>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, i64>(5)?,
                    ))
                })?;
                for row in mapped {
                    rows.push(row?);
                }
            }
            for (produto_id, variacao_id, tipo, quantidade, payload, synced_at_ms) in rows {
                tx.execute(
                    "INSERT INTO estoque_saldos_local(
                        owner_id, produto_id, variacao_id, tipo, quantidade, payload, synced_at_ms
                     ) VALUES (?1,?2,?3,?4,?5,?6,?7)
                     ON CONFLICT(owner_id, produto_id, variacao_id) DO UPDATE SET
                        quantidade = estoque_saldos_local.quantidade + excluded.quantidade,
                        synced_at_ms = MAX(estoque_saldos_local.synced_at_ms, excluded.synced_at_ms)",
                    params![owner_id, produto_id, variacao_id, tipo, quantidade, payload, synced_at_ms],
                )?;
                changed = true;
            }
            if changed {
                tx.execute(
                    "DELETE FROM estoque_saldos_local WHERE owner_id IS NULL OR owner_id = ''",
                    [],
                )?;
            }
            adopted_counts.push(("estoque_saldos_local", legacy_saldos as usize));
        }
    }

    for table in owner_tables {
        if table == "estoque_saldos_local" {
            continue;
        }
        if !table_exists(&tx, table)? || !table_has_column(&tx, table, "owner_id")? {
            continue;
        }
        let sql = format!(
            "UPDATE {table}
                    SET owner_id = ?1
                  WHERE owner_id IS NULL OR owner_id = ''"
        );
        let n = tx.execute(&sql, params![owner_id])?;
        if n > 0 {
            adopted_counts.push((table, n));
        }
        changed = changed || n > 0;
    }

    if changed {
        let now_ms = chrono::Utc::now().timestamp_millis();
        for (table, domain) in [
            ("produtos_local", "produtos"),
            ("estoque_saldos_local", "estoque_saldos"),
        ] {
            if !table_exists(&tx, table)? {
                continue;
            }
            let total: i64 = tx.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE owner_id=?1"),
                params![owner_id],
                |r| r.get(0),
            )?;
            upsert_domain_meta(
                &tx,
                DomainMetaUpdate {
                    domain,
                    row_count: total,
                    now_ms,
                    source: "legacy-owner-adopt",
                    strategy: "migration",
                    delta_count: total,
                    max_remote_updated_ms: None,
                },
            )?;
        }
    }

    tx.commit()?;
    for (table, count) in adopted_counts {
        eprintln!("[gestao-pro] LEGACY ADOPT {table} {count} registros");
    }
    Ok(changed)
}

// ---------- Clientes lite ----------

pub fn ingest_clientes(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
    owner_id: &str,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_clientes: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok((0, None)),
    };
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let mut count = 0usize;
        let mut max_remote_ms: Option<i64> = None;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO clientes_local(
                    id, owner_id, remote_id, nome, nome_fantasia, documento, tipo, email,
                    telefone, celular, status, payload, sync_status,
                    created_at_ms, updated_at_ms, updated_at_remote_ms,
                    synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
                 ON CONFLICT(id) DO UPDATE SET
                    owner_id             = excluded.owner_id,
                    remote_id            = COALESCE(clientes_local.remote_id, excluded.remote_id),
                    nome                 = excluded.nome,
                    nome_fantasia        = excluded.nome_fantasia,
                    documento            = excluded.documento,
                    tipo                 = excluded.tipo,
                    email                = excluded.email,
                    telefone             = excluded.telefone,
                    celular              = excluded.celular,
                    status               = excluded.status,
                    payload              = excluded.payload,
                    sync_status          = CASE
                                             WHEN clientes_local.sync_status = 'local_only' THEN clientes_local.sync_status
                                             ELSE excluded.sync_status
                                           END,
                    updated_at_ms        = excluded.updated_at_ms,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, clientes_local.updated_at_remote_ms),
                    synced_at_ms         = excluded.synced_at_ms,
                    deleted_at_ms        = excluded.deleted_at_ms",
            )?;
            for item in items {
                let id = match json_str(item, "id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let updated_ms = json_str(item, "updated_at").and_then(parse_iso_to_ms);
                if let Some(ms) = updated_ms {
                    max_remote_ms = Some(max_remote_ms.map_or(ms, |c| c.max(ms)));
                }
                let status = json_str(item, "status");
                let deleted_at_ms =
                    if strategy == IngestStrategy::Incremental && is_tombstoned_status(status) {
                        Some(now_ms)
                    } else {
                        None::<i64>
                    };
                let mut item_with_owner = item.clone();
                if let Some(obj) = item_with_owner.as_object_mut() {
                    obj.insert(
                        "owner_id".into(),
                        serde_json::Value::String(owner_id.to_string()),
                    );
                }
                let payload =
                    serde_json::to_string(&item_with_owner).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    owner_id,
                    id,
                    json_str(item, "nome"),
                    json_str(item, "nome_fantasia"),
                    json_str(item, "documento"),
                    json_str(item, "tipo"),
                    json_str(item, "email"),
                    json_str(item, "telefone"),
                    json_str(item, "celular"),
                    status,
                    payload,
                    "synced",
                    updated_ms,
                    updated_ms,
                    updated_ms,
                    now_ms,
                    deleted_at_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM clientes_local WHERE owner_id=?1 AND deleted_at_ms IS NULL",
            params![owner_id],
            |r| r.get(0),
        )?;
        upsert_domain_meta(
            &tx,
            DomainMetaUpdate {
                domain: "clientes_lite",
                row_count: total,
                now_ms,
                source: "upstream",
                strategy: strategy.as_str(),
                delta_count: count as i64,
                max_remote_updated_ms: max_remote_ms,
            },
        )?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalClienteInput {
    pub tipo: String,
    pub nome: String,
    pub nome_fantasia: Option<String>,
    pub documento: Option<String>,
    pub inscricao_estadual: Option<String>,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub celular: Option<String>,
    pub data_nascimento: Option<String>,
    pub cep: Option<String>,
    pub logradouro: Option<String>,
    pub numero: Option<String>,
    pub complemento: Option<String>,
    pub bairro: Option<String>,
    pub cidade: Option<String>,
    pub estado: Option<String>,
    pub observacoes: Option<String>,
    pub status: Option<String>,
    pub client_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalClienteResult {
    pub cliente_id: String,
    pub idempotente: bool,
    pub outbox_status: String,
    pub remote_id: Option<String>,
}

fn norm_opt_str(v: &Option<String>) -> Option<String> {
    v.as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn doc_digits(v: &Option<String>) -> Option<String> {
    let d: String = v
        .as_deref()
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    if d.is_empty() {
        None
    } else {
        Some(d)
    }
}

fn cliente_payload_json(
    input: &LocalClienteInput,
    id: &str,
    remote_id: Option<&str>,
    owner_id: &str,
    now_ms: i64,
    sync_status: &str,
) -> serde_json::Value {
    let documento = doc_digits(&input.documento);
    let status = input.status.clone().unwrap_or_else(|| "ativo".into());
    serde_json::json!({
        "id": id,
        "remote_id": remote_id,
        "owner_id": owner_id,
        "tipo": input.tipo,
        "nome": input.nome.trim(),
        "nome_fantasia": norm_opt_str(&input.nome_fantasia),
        "documento": documento,
        "inscricao_estadual": norm_opt_str(&input.inscricao_estadual),
        "email": norm_opt_str(&input.email),
        "telefone": norm_opt_str(&input.telefone),
        "celular": norm_opt_str(&input.celular),
        "data_nascimento": norm_opt_str(&input.data_nascimento),
        "cep": norm_opt_str(&input.cep),
        "logradouro": norm_opt_str(&input.logradouro),
        "numero": norm_opt_str(&input.numero),
        "complemento": norm_opt_str(&input.complemento),
        "bairro": norm_opt_str(&input.bairro),
        "cidade": norm_opt_str(&input.cidade),
        "estado": norm_opt_str(&input.estado),
        "observacoes": norm_opt_str(&input.observacoes),
        "status": status,
        "sync_status": sync_status,
        "created_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms).map(|d| d.to_rfc3339()),
        "updated_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms).map(|d| d.to_rfc3339()),
    })
}

pub fn ingest_clientes_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    ingest_clientes(json_text, now_ms, IngestStrategy::Snapshot, "").map(|(n, _)| n)
}

pub fn read_clientes(owner_id: &str, status: Option<&str>) -> DbResult<String> {
    with_conn(|conn| {
        let mut sql = String::from(
            "SELECT c.payload
               FROM clientes_local c
              WHERE c.owner_id = ?1
                AND c.deleted_at_ms IS NULL
                AND (
                    COALESCE(c.documento, '') = ''
                    OR NOT EXISTS (
                        SELECT 1
                          FROM clientes_local newer
                         WHERE newer.owner_id = c.owner_id
                           AND newer.documento = c.documento
                           AND newer.deleted_at_ms IS NULL
                           AND (
                               COALESCE(newer.updated_at_remote_ms, newer.updated_at_ms, newer.synced_at_ms, 0)
                                 > COALESCE(c.updated_at_remote_ms, c.updated_at_ms, c.synced_at_ms, 0)
                               OR (
                                   COALESCE(newer.updated_at_remote_ms, newer.updated_at_ms, newer.synced_at_ms, 0)
                                     = COALESCE(c.updated_at_remote_ms, c.updated_at_ms, c.synced_at_ms, 0)
                                   AND newer.id > c.id
                               )
                           )
                    )
                )",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(owner_id.to_string())];
        if let Some(s) = status {
            sql.push_str(" AND c.status = ?");
            args.push(Box::new(s.to_string()));
        }
        sql.push_str(" ORDER BY c.nome ASC");
        let params_dyn: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| &**b).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_dyn.as_slice(), |r| r.get::<_, String>(0))?;
        let mut out = String::from("[");
        let mut first = true;
        for r in rows {
            let payload = r?;
            if !first {
                out.push(',');
            }
            out.push_str(&payload);
            first = false;
        }
        out.push(']');
        Ok(out)
    })
}

// ---------- Estoque: movimentações + saldos derivados ----------
//
// Modelo desta etapa:
//
//   * `estoque_movimentacoes_local` é APPEND-ONLY. Cursor de sync é
//     `data_movimentacao` (timestamp definitivo na nuvem; mais estável
//     que `updated_at`, que poderia mudar com edição de observação).
//     Lote = INSERT OR IGNORE pelo `id` → retries idempotentes.
//
//   * `estoque_saldos_local` deixa de ser snapshot bruto e passa a ser
//     uma MATERIALIZAÇÃO incremental: para cada movimentação NOVA do
//     lote, ajustamos a quantidade da linha (produto_id, variacao_id)
//     com o sinal:
//          entrada / devolucao    → +qtd
//          saida   / transferencia → -qtd
//          ajuste                 → +qtd  (ajuste pode vir negativo na nuvem)
//
//   * Snapshot inicial (sem cursor): zera os saldos antes do delta —
//     reconstrução do zero a partir do histórico que está vindo agora.

fn parse_data_mov_ms(item: &serde_json::Value) -> Option<i64> {
    json_str(item, "data_movimentacao")
        .and_then(parse_iso_to_ms)
        .or_else(|| json_str(item, "created_at").and_then(parse_iso_to_ms))
}

fn signal_for_tipo(tipo: Option<&str>) -> f64 {
    match tipo.unwrap_or("") {
        "entrada" | "devolucao" => 1.0,
        "saida" | "transferencia" => -1.0,
        _ => 1.0,
    }
}

fn apply_mov_to_saldo(
    tx: &rusqlite::Transaction<'_>,
    owner_id: &str,
    produto_id: &str,
    variacao_id: &str,
    tipo: Option<&str>,
    quantidade: f64,
    now_ms: i64,
) -> rusqlite::Result<()> {
    let delta = signal_for_tipo(tipo) * quantidade;
    tx.execute(
        "INSERT OR IGNORE INTO estoque_saldos_local(
            owner_id, produto_id, variacao_id, tipo, quantidade, payload, synced_at_ms
         ) VALUES (?1, ?2, ?3, NULL, 0, '{}', ?4)
        ",
        params![owner_id, produto_id, variacao_id, now_ms],
    )?;
    tx.execute(
        "UPDATE estoque_saldos_local
            SET quantidade   = quantidade + ?4,
                synced_at_ms = ?5
          WHERE owner_id = ?1 AND produto_id = ?2 AND variacao_id = ?3",
        params![owner_id, produto_id, variacao_id, delta, now_ms],
    )?;
    Ok(())
}

pub fn ingest_movimentacoes(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
    owner_id: &str,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_movimentacoes: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok((0, None)),
    };

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        if strategy == IngestStrategy::Snapshot {
            tx.execute(
                "DELETE FROM estoque_saldos_local WHERE owner_id=?1",
                params![owner_id],
            )?;
        }

        let mut inserted = 0usize;
        let mut max_ms: Option<i64> = None;

        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO estoque_movimentacoes_local(
                    id, owner_id, produto_id, variacao_id, tipo, quantidade,
                    saldo_anterior, saldo_posterior, custo_unitario,
                    origem, observacoes, data_movimentacao_ms,
                    payload, synced_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            )?;

            for item in items {
                let id = match json_str(item, "id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let produto_id = match json_str(item, "produto_id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let variacao_id = json_str(item, "variacao_id").unwrap_or("").to_string();
                let tipo = json_str(item, "tipo").unwrap_or("").to_string();
                let quantidade = json_f64(item, "quantidade").unwrap_or(0.0);
                let data_ms = match parse_data_mov_ms(item) {
                    Some(ms) => ms,
                    None => continue,
                };
                max_ms = Some(max_ms.map_or(data_ms, |c| c.max(data_ms)));
                let mut item_with_owner = item.clone();
                if let Some(obj) = item_with_owner.as_object_mut() {
                    obj.insert(
                        "owner_id".into(),
                        serde_json::Value::String(owner_id.to_string()),
                    );
                }
                let payload =
                    serde_json::to_string(&item_with_owner).unwrap_or_else(|_| "{}".into());

                let n = stmt.execute(params![
                    id,
                    owner_id,
                    produto_id,
                    variacao_id,
                    tipo,
                    quantidade,
                    json_f64(item, "saldo_anterior"),
                    json_f64(item, "saldo_posterior"),
                    json_f64(item, "custo_unitario"),
                    json_str(item, "origem"),
                    json_str(item, "observacoes"),
                    data_ms,
                    payload,
                    now_ms,
                ])?;

                if n > 0 {
                    apply_mov_to_saldo(
                        &tx,
                        owner_id,
                        &produto_id,
                        &variacao_id,
                        Some(tipo.as_str()),
                        quantidade,
                        now_ms,
                    )?;
                    inserted += 1;
                }
            }
        }

        let total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM estoque_movimentacoes_local WHERE owner_id=?1",
            params![owner_id],
            |r| r.get(0),
        )?;
        upsert_domain_meta(
            &tx,
            DomainMetaUpdate {
                domain: "estoque_movimentacoes",
                row_count: total,
                now_ms,
                source: "upstream",
                strategy: strategy.as_str(),
                delta_count: inserted as i64,
                max_remote_updated_ms: max_ms,
            },
        )?;

        let saldos_total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM estoque_saldos_local WHERE owner_id=?1",
            params![owner_id],
            |r| r.get(0),
        )?;
        upsert_domain_meta(
            &tx,
            DomainMetaUpdate {
                domain: "estoque_saldos",
                row_count: saldos_total,
                now_ms,
                source: "derived",
                strategy: "derived",
                delta_count: inserted as i64,
                max_remote_updated_ms: max_ms,
            },
        )?;

        tx.commit()?;
        Ok((inserted, max_ms))
    })
}

/// Compat com o caminho legacy de saldos (proxy_with_cache).
pub fn ingest_saldos_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    ingest_movimentacoes(json_text, now_ms, IngestStrategy::Snapshot, "").map(|(n, _)| n)
}

pub fn read_saldos(owner_id: &str) -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT produto_id, variacao_id, quantidade
               FROM estoque_saldos_local
              WHERE owner_id = ?1
              ORDER BY produto_id ASC",
        )?;
        let rows = stmt.query_map(params![owner_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
            ))
        })?;
        let mut out = String::from("[");
        let mut first = true;
        for row in rows {
            let (produto_id, variacao_id, qtd) = row?;
            if !first {
                out.push(',');
            }
            let var_field = if variacao_id.is_empty() {
                "null".to_string()
            } else {
                format!("\"{variacao_id}\"")
            };
            out.push_str(&format!(
                "{{\"produto_id\":\"{produto_id}\",\"variacao_id\":{var_field},\"tipo\":\"entrada\",\"quantidade\":{qtd}}}"
            ));
            first = false;
        }
        out.push(']');
        Ok(out)
    })
}

pub fn read_movimentacoes(
    owner_id: &str,
    produto_id: Option<&str>,
    limit: i64,
) -> DbResult<String> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 5000);
        let mut out = String::from("[");
        let mut first = true;

        let mut push_row = |payload: String,
                            pid: String,
                            sku: Option<String>,
                            nome: Option<String>|
         -> DbResult<()> {
            let mut item: serde_json::Value =
                serde_json::from_str(&payload).unwrap_or_else(|_| serde_json::json!({}));
            if let Some(obj) = item.as_object_mut() {
                obj.entry("produto_id")
                    .or_insert_with(|| serde_json::Value::String(pid.clone()));
                if !pid.is_empty() {
                    obj.insert(
                        "produto".into(),
                        serde_json::json!({
                            "id": pid,
                            "sku": sku.unwrap_or_default(),
                            "nome": nome.unwrap_or_default(),
                        }),
                    );
                }
            }
            if !first {
                out.push(',');
            }
            out.push_str(&serde_json::to_string(&item).map_err(|e| DbError(e.to_string()))?);
            first = false;
            Ok(())
        };

        if let Some(pid) = produto_id {
            let mut stmt = conn.prepare(
                "SELECT m.payload, m.produto_id, p.sku, p.nome
                   FROM estoque_movimentacoes_local m
                   LEFT JOIN produtos_local p ON p.id = m.produto_id AND p.owner_id = m.owner_id
                  WHERE m.owner_id = ?1 AND m.produto_id = ?2
                  ORDER BY m.data_movimentacao_ms DESC
                  LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![owner_id, pid, limit], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?;
            for r in rows {
                let (payload, pid, sku, nome) = r?;
                push_row(payload, pid, sku, nome)?;
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT m.payload, m.produto_id, p.sku, p.nome
                   FROM estoque_movimentacoes_local m
                   LEFT JOIN produtos_local p ON p.id = m.produto_id AND p.owner_id = m.owner_id
                  WHERE m.owner_id = ?1
                  ORDER BY m.data_movimentacao_ms DESC
                  LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![owner_id, limit], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?;
            for r in rows {
                let (payload, pid, sku, nome) = r?;
                push_row(payload, pid, sku, nome)?;
            }
        }

        out.push(']');
        Ok(out)
    })
}

pub fn clientes_local_list(
    owner_id: &str,
    status: Option<&str>,
    busca: Option<&str>,
    limit: i64,
) -> DbResult<Vec<serde_json::Value>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut sql = String::from(
            "SELECT c.payload
               FROM clientes_local c
              WHERE c.owner_id=?1
                AND c.deleted_at_ms IS NULL
                AND (
                    COALESCE(c.documento, '') = ''
                    OR NOT EXISTS (
                        SELECT 1
                          FROM clientes_local newer
                         WHERE newer.owner_id = c.owner_id
                           AND newer.documento = c.documento
                           AND newer.deleted_at_ms IS NULL
                           AND (
                               COALESCE(newer.updated_at_remote_ms, newer.updated_at_ms, newer.synced_at_ms, 0)
                                 > COALESCE(c.updated_at_remote_ms, c.updated_at_ms, c.synced_at_ms, 0)
                               OR (
                                   COALESCE(newer.updated_at_remote_ms, newer.updated_at_ms, newer.synced_at_ms, 0)
                                     = COALESCE(c.updated_at_remote_ms, c.updated_at_ms, c.synced_at_ms, 0)
                                   AND newer.id > c.id
                               )
                           )
                    )
                )",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(owner_id.to_string())];
        if let Some(s) = status.filter(|s| !s.is_empty()) {
            sql.push_str(&format!(" AND c.status = ?{}", args.len() + 1));
            args.push(Box::new(s.to_string()));
        }
        if let Some(b) = busca.map(str::trim).filter(|s| !s.is_empty()) {
            let digits: String = b.chars().filter(|c| c.is_ascii_digit()).collect();
            sql.push_str(&format!(
                " AND (lower(COALESCE(c.nome,'')) LIKE ?{} OR lower(COALESCE(c.nome_fantasia,'')) LIKE ?{} OR COALESCE(c.documento,'') LIKE ?{} OR COALESCE(c.telefone,'') LIKE ?{} OR COALESCE(c.celular,'') LIKE ?{})",
                args.len() + 1, args.len() + 2, args.len() + 3, args.len() + 4, args.len() + 5
            ));
            let like = format!("%{}%", b.to_lowercase());
            let digit_like = format!("%{}%", digits);
            args.push(Box::new(like.clone()));
            args.push(Box::new(like));
            args.push(Box::new(digit_like.clone()));
            args.push(Box::new(digit_like.clone()));
            args.push(Box::new(digit_like));
        }
        sql.push_str(&format!(" ORDER BY c.nome ASC LIMIT ?{}", args.len() + 1));
        args.push(Box::new(limit));
        let params_dyn: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| &**b).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_dyn.as_slice(), |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&row?) {
                out.push(v);
            }
        }
        Ok(out)
    })
}

pub fn cliente_local_get(owner_id: &str, cliente_id: &str) -> DbResult<Option<serde_json::Value>> {
    with_conn(|conn| {
        let payload = conn
            .query_row(
                "SELECT payload FROM clientes_local
              WHERE owner_id=?1 AND deleted_at_ms IS NULL AND (id=?2 OR remote_id=?2)
              LIMIT 1",
                params![owner_id, cliente_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(payload.and_then(|p| serde_json::from_str(&p).ok()))
    })
}

pub fn cliente_remote_id(owner_id: &str, cliente_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let v = conn
            .query_row(
                "WITH alvo AS (
                SELECT documento
                  FROM clientes_local
                 WHERE owner_id=?1 AND (id=?2 OR remote_id=?2)
                 LIMIT 1
             )
             SELECT COALESCE(c.remote_id, CASE WHEN c.sync_status='synced' THEN c.id ELSE NULL END)
               FROM clientes_local c
               LEFT JOIN alvo a ON 1=1
              WHERE c.owner_id=?1
                AND (
                    c.id=?2
                    OR c.remote_id=?2
                    OR (
                        COALESCE(a.documento, '') <> ''
                        AND c.documento=a.documento
                        AND c.deleted_at_ms IS NULL
                    )
                )
              ORDER BY
                    CASE WHEN c.deleted_at_ms IS NULL THEN 0 ELSE 1 END,
                    COALESCE(c.updated_at_remote_ms, c.updated_at_ms, c.synced_at_ms, 0) DESC,
                    c.id DESC
              LIMIT 1",
                params![owner_id, cliente_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?;
        Ok(v.flatten())
    })
}

pub fn cliente_check_documento(
    owner_id: &str,
    documento: &str,
    ignore_id: Option<&str>,
) -> DbResult<Option<serde_json::Value>> {
    let doc: String = documento.chars().filter(|c| c.is_ascii_digit()).collect();
    if doc.is_empty() {
        return Ok(None);
    }
    with_conn(|conn| {
        let payload = if let Some(ignore) = ignore_id {
            conn.query_row(
                "SELECT payload FROM clientes_local
                  WHERE owner_id=?1 AND documento=?2 AND deleted_at_ms IS NULL AND id<>?3 AND COALESCE(remote_id,'')<>?3
                  ORDER BY COALESCE(updated_at_remote_ms, updated_at_ms, synced_at_ms, 0) DESC, id DESC
                  LIMIT 1",
                params![owner_id, doc, ignore],
                |r| r.get::<_, String>(0),
            ).optional()?
        } else {
            conn.query_row(
                "SELECT payload FROM clientes_local
                  WHERE owner_id=?1 AND documento=?2 AND deleted_at_ms IS NULL
                  ORDER BY COALESCE(updated_at_remote_ms, updated_at_ms, synced_at_ms, 0) DESC, id DESC
                  LIMIT 1",
                params![owner_id, doc],
                |r| r.get::<_, String>(0),
            ).optional()?
        };
        Ok(payload.and_then(|p| serde_json::from_str(&p).ok()))
    })
}

pub fn registrar_cliente_local(
    owner_id: &str,
    input: LocalClienteInput,
    now_ms: i64,
) -> DbResult<LocalClienteResult> {
    if input.nome.trim().len() < 2 {
        return Err(DbError("Informe o nome do cliente.".into()));
    }
    let documento = doc_digits(&input.documento);
    let status = input.status.clone().unwrap_or_else(|| "ativo".into());
    let nome = input.nome.trim().to_string();

    with_conn(|conn| {
        if let Some(cu) = input.client_uuid.as_deref().filter(|s| !s.is_empty()) {
            let row = conn
                .query_row(
                    "SELECT c.id, o.status, o.remote_id
                  FROM outbox_clientes o
                   JOIN clientes_local c ON c.id=o.cliente_local_id
                  WHERE o.owner_id=?1 AND o.client_uuid=?2 LIMIT 1",
                    params![owner_id, cu],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((id, outbox_status, remote_id)) = row {
                return Ok(LocalClienteResult {
                    cliente_id: id,
                    idempotente: true,
                    outbox_status,
                    remote_id,
                });
            }
        }

        if let Some(doc) = documento.as_deref() {
            let existing = conn.query_row(
                "SELECT id FROM clientes_local WHERE owner_id=?1 AND documento=?2 AND deleted_at_ms IS NULL LIMIT 1",
                params![owner_id, doc],
                |r| r.get::<_, String>(0),
            ).optional()?;
            if existing.is_some() {
                return Err(DbError("Ja existe um cliente com este CPF/CNPJ.".into()));
            }
        }

        let local_id = random_uuid_v4();
        let outbox_id = random_uuid_v4();
        let payload = cliente_payload_json(&input, &local_id, None, owner_id, now_ms, "pending");
        let payload_text = payload.to_string();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO clientes_local(
                id, owner_id, remote_id, nome, nome_fantasia, documento, tipo, email, telefone,
                celular, status, payload, sync_status, created_at_ms, updated_at_ms,
                updated_at_remote_ms, synced_at_ms, deleted_at_ms
             ) VALUES (?1,?2,NULL,?3,?4,?5,?6,?7,?8,?9,?10,?11,'pending',?12,?12,NULL,?12,NULL)",
            params![
                local_id,
                owner_id,
                nome,
                norm_opt_str(&input.nome_fantasia),
                documento,
                input.tipo,
                norm_opt_str(&input.email),
                norm_opt_str(&input.telefone),
                norm_opt_str(&input.celular),
                status,
                payload_text,
                now_ms
            ],
        )?;
        tx.execute(
            "INSERT INTO outbox_clientes(
                local_uuid, owner_id, client_uuid, cliente_local_id, payload, status,
                attempts, created_at_ms, updated_at_ms
             ) VALUES (?1,?2,?3,?4,?5,'pending',0,?6,?6)",
            params![
                outbox_id,
                owner_id,
                input.client_uuid,
                local_id,
                payload.to_string(),
                now_ms
            ],
        )?;
        tx.commit()?;
        Ok(LocalClienteResult {
            cliente_id: local_id,
            idempotente: false,
            outbox_status: "pending".into(),
            remote_id: None,
        })
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalProdutoInput {
    pub sku: String,
    pub codigo_barras: Option<String>,
    pub qr_code: Option<String>,
    pub codigo_interno: Option<String>,
    pub tipo_identificacao_principal: Option<String>,
    pub observacao_tecnica: Option<String>,
    pub nome: String,
    pub descricao: Option<String>,
    pub marca: Option<String>,
    pub unidade: String,
    pub categoria_id: Option<String>,
    pub preco_custo: Option<f64>,
    pub preco_venda: Option<f64>,
    pub estoque_minimo: Option<f64>,
    pub estoque_inicial: Option<f64>,
    pub status: Option<String>,
    pub ncm: Option<String>,
    pub vendido_por_peso: Option<bool>,
    pub plu: Option<String>,
    pub aceita_etiqueta_balanca: Option<bool>,
    pub casas_decimais_quantidade: Option<i64>,
    pub client_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalProdutoResult {
    pub produto_id: String,
    pub idempotente: bool,
    pub outbox_status: String,
    pub remote_id: Option<String>,
}

fn produto_payload_json(
    input: &LocalProdutoInput,
    id: &str,
    remote_id: Option<&str>,
    owner_id: &str,
    now_ms: i64,
    sync_status: &str,
) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "remote_id": remote_id,
        "owner_id": owner_id,
        "sku": input.sku.trim(),
        "codigo_barras": input.codigo_barras.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        "qr_code": input.qr_code.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        "codigo_interno": input.codigo_interno.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        "tipo_identificacao_principal": input.tipo_identificacao_principal.clone(),
        "observacao_tecnica": input.observacao_tecnica.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        "nome": input.nome.trim(),
        "descricao": input.descricao.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        "marca": input.marca.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        "unidade": input.unidade,
        "categoria_id": input.categoria_id.clone(),
        "preco_custo": input.preco_custo,
        "preco_venda": input.preco_venda,
        "estoque_minimo": input.estoque_minimo,
        "estoque_inicial": input.estoque_inicial,
        "status": input.status.clone().unwrap_or_else(|| "ativo".into()),
        "ncm": input.ncm.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        "vendido_por_peso": input.vendido_por_peso,
        "plu": input.plu.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        "aceita_etiqueta_balanca": input.aceita_etiqueta_balanca,
        "casas_decimais_quantidade": input.casas_decimais_quantidade,
        "sync_status": sync_status,
        "created_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms).map(|d| d.to_rfc3339()),
        "updated_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms).map(|d| d.to_rfc3339()),
    })
}

pub fn registrar_produto_local(
    owner_id: &str,
    input: LocalProdutoInput,
    now_ms: i64,
) -> DbResult<LocalProdutoResult> {
    if input.nome.trim().len() < 2 {
        return Err(DbError("Informe o nome do produto.".into()));
    }
    let status = input.status.clone().unwrap_or_else(|| "ativo".into());

    with_conn(|conn| {
        // Idempotência por client_uuid
        if let Some(cu) = input.client_uuid.as_deref().filter(|s| !s.is_empty()) {
            let row = conn
                .query_row(
                    "SELECT p.id, o.status, o.remote_id
                  FROM outbox_produtos o
                   JOIN produtos_local p ON p.id=o.produto_local_id
                  WHERE p.owner_id=?1 AND o.client_uuid=?2 LIMIT 1",
                    params![owner_id, cu],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((id, outbox_status, remote_id)) = row {
                return Ok(LocalProdutoResult {
                    produto_id: id,
                    idempotente: true,
                    outbox_status,
                    remote_id,
                });
            }
        }

        // Basic SKU uniqueness check locally
        let existing = conn.query_row(
            "SELECT id FROM produtos_local WHERE owner_id=?1 AND sku=?2 AND deleted_at_ms IS NULL LIMIT 1",
            params![owner_id, input.sku.trim()],
            |r| r.get::<_, String>(0),
        ).optional()?;
        if existing.is_some() {
            return Err(DbError("Ja existe um produto com este SKU.".into()));
        }

        let local_id = random_uuid_v4();
        let outbox_id = random_uuid_v4();
        let payload = produto_payload_json(&input, &local_id, None, owner_id, now_ms, "pending");
        let payload_text = payload.to_string();

        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO produtos_local(id, owner_id, sku, nome, status, categoria_id, categoria_nome, preco_venda, estoque_atual, payload, updated_at_remote_ms, synced_at_ms, deleted_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,?11,NULL)",
            params![
                local_id,
                owner_id,
                input.sku.trim(),
                input.nome.trim(),
                status,
                input.categoria_id.clone(),
                None::<String>,
                input.preco_venda.unwrap_or(0.0),
                input.estoque_inicial.unwrap_or(0.0),
                payload_text,
                now_ms,
            ],
        )?;

        // Se houver estoque inicial, cria movimentação local e enfileira outbox de estoque
        if let Some(ini) = input.estoque_inicial.filter(|v| *v > 0.0) {
            let mov_local_uuid = random_uuid_v4();
            let variacao_id = "".to_string();
            let saldo_anterior = read_saldo_atual(&tx, owner_id, &local_id, &variacao_id)?;
            let delta = ini;
            let saldo_posterior = saldo_anterior + delta;
            let item_payload = serde_json::json!({
                "id": mov_local_uuid,
                "produto_id": local_id,
                "variacao_id": serde_json::Value::String(variacao_id.clone()),
                "tipo": "entrada",
                "quantidade": delta,
                "saldo_anterior": saldo_anterior,
                "saldo_posterior": saldo_posterior,
                "custo_unitario": serde_json::Value::Null,
                "origem": "inicial_produto",
                "observacoes": serde_json::Value::Null,
                "data_movimentacao": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms).map(|d| d.to_rfc3339()),
                "_pending": true,
                "owner_id": owner_id,
            }).to_string();

            tx.execute(
                "INSERT OR IGNORE INTO estoque_movimentacoes_local(id, owner_id, produto_id, variacao_id, tipo, quantidade, saldo_anterior, saldo_posterior, custo_unitario, origem, observacoes, data_movimentacao_ms, payload, synced_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                params![
                    mov_local_uuid,
                    owner_id,
                    local_id,
                    variacao_id.clone(),
                    "entrada",
                    delta,
                    saldo_anterior,
                    saldo_posterior,
                    Option::<f64>::None,
                    "inicial_produto",
                    Option::<String>::None,
                    now_ms,
                    item_payload,
                    now_ms,
                ],
            )?;

            apply_mov_to_saldo(
                &tx,
                owner_id,
                &local_id,
                &variacao_id,
                Some("entrada"),
                delta,
                now_ms,
            )?;

            tx.execute(
                "INSERT INTO outbox_estoque_movs(local_uuid, owner_id, client_uuid, payload, status, attempts, last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms) VALUES (?1, ?2, ?3, ?4, 'pending', 0, NULL, NULL, ?5, ?5, NULL)",
                params![mov_local_uuid, owner_id, Option::<String>::None, serde_json::json!({"local_uuid": mov_local_uuid, "produto_id": local_id, "variacao_id": serde_json::Value::String(variacao_id), "tipo": "entrada", "quantidade": delta, "owner_id": owner_id}).to_string(), now_ms],
            )?;
        }

        tx.execute(
            "INSERT INTO outbox_produtos(local_uuid, owner_id, client_uuid, produto_local_id, payload, status, attempts, created_at_ms, updated_at_ms) VALUES (?1,?2,?3,?4,?5,'pending',0,?6,?6)",
            params![outbox_id, owner_id, input.client_uuid, local_id, produto_payload_json(&input, &local_id, None, owner_id, now_ms, "pending").to_string(), now_ms],
        )?;

        tx.commit()?;
        Ok(LocalProdutoResult {
            produto_id: local_id,
            idempotente: false,
            outbox_status: "pending".into(),
            remote_id: None,
        })
    })
}

#[derive(Debug, Serialize)]
pub struct OutboxProdutoItem {
    pub local_uuid: String,
    pub owner_id: Option<String>,
    pub client_uuid: Option<String>,
    pub produto_local_id: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

fn map_outbox_produto(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxProdutoItem> {
    Ok(OutboxProdutoItem {
        local_uuid: r.get(0)?,
        owner_id: r.get(1)?,
        client_uuid: r.get(2)?,
        produto_local_id: r.get(3)?,
        payload: r.get(4)?,
        status: r.get(5)?,
        attempts: r.get(6)?,
        last_error: r.get(7)?,
        remote_id: r.get(8)?,
        created_at_ms: r.get(9)?,
        updated_at_ms: r.get(10)?,
        sent_at_ms: r.get(11)?,
    })
}

const OUTBOX_PRODUTO_COLS: &str = "local_uuid, owner_id, client_uuid, produto_local_id, payload, status, attempts, last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

pub fn outbox_produtos_list(
    owner_id: &str,
    limit: i64,
    only_status: Option<&str>,
) -> DbResult<Vec<OutboxProdutoItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = if only_status.is_some() {
            format!("SELECT {OUTBOX_PRODUTO_COLS} FROM outbox_produtos WHERE owner_id=?1 AND status=?2 ORDER BY created_at_ms DESC LIMIT ?3")
        } else {
            format!("SELECT {OUTBOX_PRODUTO_COLS} FROM outbox_produtos WHERE owner_id=?1 ORDER BY created_at_ms DESC LIMIT ?2")
        };
        let mut stmt = conn.prepare(&sql)?;
        let rows = if let Some(st) = only_status {
            stmt.query_map(params![owner_id, st, limit], map_outbox_produto)?
        } else {
            stmt.query_map(params![owner_id, limit], map_outbox_produto)?
        };
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
}

pub fn produto_remote_id(owner_id: &str, produto_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let mapped = conn
            .query_row(
                "SELECT remote_id
                   FROM outbox_produtos
                  WHERE owner_id=?1
                    AND (produto_local_id=?2 OR remote_id=?2)
                    AND status='sent'
                    AND COALESCE(remote_id, '') <> ''
                  ORDER BY sent_at_ms DESC
                  LIMIT 1",
                params![owner_id, produto_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        if mapped.is_some() {
            return Ok(mapped);
        }
        let exists = conn
            .query_row(
                "SELECT 1 FROM produtos_local WHERE owner_id=?1 AND id=?2 LIMIT 1",
                params![owner_id, produto_id],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        Ok(exists.then(|| produto_id.to_string()))
    })
}

pub fn outbox_produtos_pending_batch(
    owner_id: &str,
    limit: i64,
) -> DbResult<Vec<OutboxProdutoItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!("SELECT {OUTBOX_PRODUTO_COLS} FROM outbox_produtos WHERE owner_id=?1 AND status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?2 ORDER BY created_at_ms ASC LIMIT ?3");
        let mut stmt = conn.prepare(&sql)?;
        let mut out = Vec::new();
        for row in stmt.query_map(params![owner_id, now, limit], map_outbox_produto)? {
            out.push(row?);
        }
        Ok(out)
    })
}

pub fn outbox_produtos_pending_batch_all(
    owner_id: &str,
    limit: i64,
) -> DbResult<Vec<OutboxProdutoItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = format!("SELECT {OUTBOX_PRODUTO_COLS} FROM outbox_produtos WHERE owner_id=?1 AND status='pending' ORDER BY created_at_ms ASC LIMIT ?2");
        let mut stmt = conn.prepare(&sql)?;
        let mut out = Vec::new();
        for row in stmt.query_map(params![owner_id, limit], map_outbox_produto)? {
            out.push(row?);
        }
        Ok(out)
    })
}

pub fn outbox_produtos_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_produtos SET status='sending', updated_at_ms=?2, attempts=attempts+1 WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_produtos_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn
            .query_row(
                "SELECT attempts FROM outbox_produtos WHERE local_uuid=?1",
                params![local_uuid],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(1);
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_produtos SET status='error', last_error=?2, updated_at_ms=?3, next_attempt_at_ms=NULL WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_produtos SET status='pending', last_error=?2, updated_at_ms=?3, next_attempt_at_ms=?4 WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_produtos_mark_sent(local_uuid: &str, remote_id: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let sql = format!("SELECT {OUTBOX_PRODUTO_COLS} FROM outbox_produtos WHERE local_uuid=?1");
        let item = conn
            .query_row(&sql, params![local_uuid], map_outbox_produto)
            .optional()?
            .ok_or_else(|| DbError("produto nao encontrado na outbox".into()))?;
        let mut payload: serde_json::Value =
            serde_json::from_str(&item.payload).unwrap_or_else(|_| serde_json::json!({}));
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "remote_id".into(),
                serde_json::Value::String(remote_id.to_string()),
            );
            obj.insert(
                "sync_status".into(),
                serde_json::Value::String("synced".into()),
            );
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE outbox_produtos SET status='sent', sent_at_ms=?2, updated_at_ms=?2, remote_id=?3, last_error=NULL, next_attempt_at_ms=NULL WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id],
        )?;

        // Atualiza produtos_local: tenta alterar PK para remote_id, caso falhe insere novo
        let payload_text = payload.to_string();
        let n = tx.execute(
            "UPDATE produtos_local SET id=?2, owner_id=?3, payload=?4, updated_at_remote_ms=?5, synced_at_ms=?5 WHERE id=?1",
            params![item.produto_local_id, remote_id, json_str(&payload, "owner_id"), payload_text, now_ms],
        )?;
        if n == 0 {
            // não existia linha local com este id — insere nova
            tx.execute(
                "INSERT INTO produtos_local(id, owner_id, sku, nome, status, categoria_id, categoria_nome, preco_venda, estoque_atual, payload, updated_at_remote_ms, synced_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    remote_id,
                    json_str(&payload, "owner_id"),
                    json_str(&payload, "sku"),
                    json_str(&payload, "nome"),
                    json_str(&payload, "status"),
                    json_str(&payload, "categoria_id"),
                    json_str(&payload, "categoria_nome"),
                    json_f64(&payload, "preco_venda"),
                    json_f64(&payload, "estoque_atual"),
                    payload_text,
                    now_ms,
                    now_ms,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_produtos_reset_errors(owner_id: &str, now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_produtos SET status='pending', updated_at_ms=?2, next_attempt_at_ms=NULL, last_error=NULL WHERE owner_id=?1 AND status='error'",
            params![owner_id, now_ms],
        )?;
        Ok(n as i64)
    })
}

pub fn outbox_produtos_record_flush_round(
    kind: &str,
    now_ms: i64,
    attempted: i64,
    sent: i64,
    failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        let prefix = if kind == "auto" { "auto" } else { "manual" };
        meta_set_i64(
            conn,
            &format!("outbox_produtos_last_{prefix}_flush_ms"),
            now_ms,
        )?;
        meta_set_i64(
            conn,
            &format!("outbox_produtos_last_{prefix}_attempted"),
            attempted,
        )?;
        meta_set_i64(conn, &format!("outbox_produtos_last_{prefix}_sent"), sent)?;
        meta_set_i64(
            conn,
            &format!("outbox_produtos_last_{prefix}_failed"),
            failed,
        )?;
        Ok(())
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct OutboxClienteItem {
    pub local_uuid: String,
    pub owner_id: Option<String>,
    pub client_uuid: Option<String>,
    pub cliente_local_id: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

#[derive(Debug, Serialize, Default)]
pub struct OutboxClientesStats {
    pub pending: i64,
    pub sending: i64,
    pub sent: i64,
    pub error: i64,
    pub last_sent_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub due_now: i64,
    pub next_attempt_at_ms: Option<i64>,
    pub last_auto_flush_ms: Option<i64>,
    pub last_manual_flush_ms: Option<i64>,
}

fn map_outbox_cliente(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxClienteItem> {
    Ok(OutboxClienteItem {
        local_uuid: r.get(0)?,
        owner_id: r.get(1)?,
        client_uuid: r.get(2)?,
        cliente_local_id: r.get(3)?,
        payload: r.get(4)?,
        status: r.get(5)?,
        attempts: r.get(6)?,
        last_error: r.get(7)?,
        remote_id: r.get(8)?,
        created_at_ms: r.get(9)?,
        updated_at_ms: r.get(10)?,
        sent_at_ms: r.get(11)?,
    })
}

const OUTBOX_CLIENTE_COLS: &str = "local_uuid, owner_id, client_uuid, cliente_local_id, payload, status, attempts, last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

pub fn outbox_clientes_stats(owner_id: &str) -> DbResult<OutboxClientesStats> {
    with_conn(|conn| {
        let mut s = OutboxClientesStats::default();
        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM outbox_clientes WHERE owner_id=?1 GROUP BY status",
        )?;
        for row in stmt.query_map(params![owner_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })? {
            let (st, n) = row?;
            match st.as_str() {
                "pending" => s.pending = n,
                "sending" => s.sending = n,
                "sent" => s.sent = n,
                "error" => s.error = n,
                _ => {}
            }
        }
        s.last_sent_at_ms = conn
            .query_row(
                "SELECT MAX(sent_at_ms) FROM outbox_clientes WHERE owner_id=?1 AND status='sent'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_clientes WHERE owner_id=?1 AND status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            params![owner_id], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_clientes WHERE owner_id=?1 AND status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?2",
            params![owner_id, now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0)) FROM outbox_clientes WHERE owner_id=?1 AND status='pending'",
            params![owner_id], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_clientes_last_auto_flush_ms")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_clientes_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_clientes_record_flush_round(
    kind: &str,
    now_ms: i64,
    attempted: i64,
    sent: i64,
    failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        let prefix = if kind == "auto" { "auto" } else { "manual" };
        meta_set_i64(
            conn,
            &format!("outbox_clientes_last_{prefix}_flush_ms"),
            now_ms,
        )?;
        meta_set_i64(
            conn,
            &format!("outbox_clientes_last_{prefix}_attempted"),
            attempted,
        )?;
        meta_set_i64(conn, &format!("outbox_clientes_last_{prefix}_sent"), sent)?;
        meta_set_i64(
            conn,
            &format!("outbox_clientes_last_{prefix}_failed"),
            failed,
        )?;
        Ok(())
    })
}

pub fn outbox_clientes_list(
    owner_id: &str,
    limit: i64,
    only_status: Option<&str>,
) -> DbResult<Vec<OutboxClienteItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = if only_status.is_some() {
            format!("SELECT {OUTBOX_CLIENTE_COLS} FROM outbox_clientes WHERE owner_id=?1 AND status=?2 ORDER BY created_at_ms DESC LIMIT ?3")
        } else {
            format!("SELECT {OUTBOX_CLIENTE_COLS} FROM outbox_clientes WHERE owner_id=?1 ORDER BY created_at_ms DESC LIMIT ?2")
        };
        let mut stmt = conn.prepare(&sql)?;
        let rows = if let Some(st) = only_status {
            stmt.query_map(params![owner_id, st, limit], map_outbox_cliente)?
        } else {
            stmt.query_map(params![owner_id, limit], map_outbox_cliente)?
        };
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
}

pub fn outbox_clientes_pending_batch(
    owner_id: &str,
    limit: i64,
) -> DbResult<Vec<OutboxClienteItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!("SELECT {OUTBOX_CLIENTE_COLS} FROM outbox_clientes WHERE owner_id=?1 AND status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?2 ORDER BY created_at_ms ASC LIMIT ?3");
        let mut stmt = conn.prepare(&sql)?;
        let mut out = Vec::new();
        for row in stmt.query_map(params![owner_id, now, limit], map_outbox_cliente)? {
            out.push(row?);
        }
        Ok(out)
    })
}

pub fn outbox_clientes_pending_batch_all(
    owner_id: &str,
    limit: i64,
) -> DbResult<Vec<OutboxClienteItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = format!("SELECT {OUTBOX_CLIENTE_COLS} FROM outbox_clientes WHERE owner_id=?1 AND status='pending' ORDER BY created_at_ms ASC LIMIT ?2");
        let mut stmt = conn.prepare(&sql)?;
        let mut out = Vec::new();
        for row in stmt.query_map(params![owner_id, limit], map_outbox_cliente)? {
            out.push(row?);
        }
        Ok(out)
    })
}

pub fn outbox_clientes_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_clientes SET status='sending', updated_at_ms=?2, attempts=attempts+1 WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_clientes_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn
            .query_row(
                "SELECT attempts FROM outbox_clientes WHERE local_uuid=?1",
                params![local_uuid],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(1);
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_clientes SET status='error', last_error=?2, updated_at_ms=?3, next_attempt_at_ms=NULL WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_clientes SET status='pending', last_error=?2, updated_at_ms=?3, next_attempt_at_ms=?4 WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_clientes_mark_sent(local_uuid: &str, remote_id: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let sql = format!("SELECT {OUTBOX_CLIENTE_COLS} FROM outbox_clientes WHERE local_uuid=?1");
        let item = conn
            .query_row(&sql, params![local_uuid], map_outbox_cliente)
            .optional()?
            .ok_or_else(|| DbError("cliente nao encontrado na outbox".into()))?;
        let mut payload: serde_json::Value =
            serde_json::from_str(&item.payload).unwrap_or_else(|_| serde_json::json!({}));
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "remote_id".into(),
                serde_json::Value::String(remote_id.to_string()),
            );
            obj.insert(
                "sync_status".into(),
                serde_json::Value::String("synced".into()),
            );
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE outbox_clientes SET status='sent', sent_at_ms=?2, updated_at_ms=?2, remote_id=?3, last_error=NULL, next_attempt_at_ms=NULL WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id],
        )?;
        tx.execute(
            "UPDATE clientes_local SET remote_id=?2, sync_status='synced', payload=?3, updated_at_ms=?4, synced_at_ms=?4 WHERE id=?1",
            params![item.cliente_local_id, remote_id, payload.to_string(), now_ms],
        )?;
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_clientes_reset_errors(owner_id: &str, now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_clientes
                SET status='pending', updated_at_ms=?2, next_attempt_at_ms=NULL, last_error=NULL
              WHERE owner_id=?1 AND status='error'",
            params![owner_id, now_ms],
        )?;
        Ok(n as i64)
    })
}

// ---------- Stats por domínio ----------

pub fn list_domain_stats() -> DbResult<Vec<DomainStat>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT domain, row_count, last_synced_ms, last_source,
                    last_strategy, last_delta_count, last_remote_cursor_ms,
                    last_attempt_ms, last_synced_ok, last_error
             FROM domain_sync_meta
             ORDER BY domain ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            let ok: i64 = r.get(8)?;
            Ok(DomainStat {
                domain: r.get(0)?,
                row_count: r.get(1)?,
                last_synced_ms: r.get::<_, Option<i64>>(2)?,
                last_source: r.get::<_, Option<String>>(3)?,
                last_strategy: r.get::<_, Option<String>>(4)?,
                last_delta_count: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                last_remote_cursor_ms: r.get::<_, Option<i64>>(6)?,
                last_attempt_ms: r.get::<_, Option<i64>>(7)?,
                last_synced_ok: ok != 0,
                last_error: r.get::<_, Option<String>>(9)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// True quando temos pelo menos uma linha tipada para o domínio (utilizado
/// para servir `local-table` mesmo após o cache_kv expirar).
pub fn domain_has_rows(domain: &str) -> DbResult<bool> {
    with_conn(|conn| {
        let table = match domain {
            "produtos" => "produtos_local",
            "clientes_lite" => "clientes_local",
            "estoque_saldos" => "estoque_saldos_local",
            "estoque_movimentacoes" => "estoque_movimentacoes_local",
            _ => return Ok(false),
        };
        let sql = format!("SELECT COUNT(*) FROM {table}");
        let n: i64 = conn.query_row(&sql, [], |r| r.get(0))?;
        Ok(n > 0)
    })
}

// ============================================================================
// v5 — Writes locais de movimentação de estoque + fila offline (outbox)
// ============================================================================
//
// Modelo:
//   * `local_uuid` é GERADO pelo servidor (UUID v4). É a identidade real
//     dessa movimentação enquanto ela vive offline e é a chave de
//     idempotência usada no upstream — assim retries pelo sync nunca
//     duplicam.
//   * `client_uuid` é a chave que o terminal já mandava (1 por modal). Se
//     vier repetida (duplo clique, retry de rede entre terminal e servidor),
//     o servidor reconhece e devolve a movimentação já enfileirada — sem
//     gravar de novo, sem duplicar saldo.

#[derive(Debug, Clone, Serialize)]
pub struct LocalMovimentacaoInput {
    pub produto_id: String,
    pub variacao_id: Option<String>,
    pub tipo: String,
    pub quantidade: f64,
    pub custo_unitario: Option<f64>,
    pub observacoes: Option<String>,
    pub origem: Option<String>,
    pub client_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalMovimentacaoResult {
    pub local_uuid: String,
    pub idempotente: bool,
    pub saldo_anterior: f64,
    pub saldo_posterior: f64,
}

fn random_uuid_v4() -> String {
    // UUID v4 simples — evita dependência extra. Usa o RNG do SQLite.
    let bytes: [u8; 16] = with_conn(|conn| {
        let blob: Vec<u8> = conn.query_row("SELECT randomblob(16)", [], |r| r.get(0))?;
        let mut a = [0u8; 16];
        for (i, b) in blob.iter().take(16).enumerate() {
            a[i] = *b;
        }
        Ok(a)
    })
    .unwrap_or([0u8; 16]);
    let mut b = bytes;
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]
    )
}

/// Lê saldo atual (produto, variacao) — 0 se não existe linha.
fn read_saldo_atual(
    tx: &rusqlite::Transaction<'_>,
    owner_id: &str,
    produto_id: &str,
    variacao_id: &str,
) -> rusqlite::Result<f64> {
    let v: Option<f64> = tx
        .query_row(
            "SELECT quantidade FROM estoque_saldos_local
              WHERE owner_id = ?1 AND produto_id = ?2 AND variacao_id = ?3",
            params![owner_id, produto_id, variacao_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v.unwrap_or(0.0))
}

/// Escreve uma movimentação LOCALMENTE:
///   1. Idempotência por `client_uuid`: se já existe na outbox, devolve a
///      movimentação anterior (sem efeito colateral).
///   2. Calcula saldo_anterior, valida saldo negativo.
///   3. Insere em `estoque_movimentacoes_local` (com id = local_uuid),
///      aplica delta no saldo materializado, enfileira na outbox —
///      tudo em UMA transação.
pub fn registrar_movimento_local(
    owner_id: &str,
    input: LocalMovimentacaoInput,
    now_ms: i64,
) -> DbResult<LocalMovimentacaoResult> {
    // Validação básica antes de transação.
    if input.quantidade <= 0.0 {
        return Err(DbError("quantidade deve ser > 0".into()));
    }
    let tipo_norm = input.tipo.trim().to_ascii_lowercase();
    if !matches!(
        tipo_norm.as_str(),
        "entrada" | "saida" | "ajuste" | "devolucao" | "transferencia"
    ) {
        return Err(DbError(format!("tipo inválido: {}", input.tipo)));
    }

    // Idempotência por client_uuid — antes de abrir transação grande.
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some(existing) = with_conn(|conn| {
                let row = conn
                    .query_row(
                        "SELECT local_uuid, payload FROM outbox_estoque_movs
                          WHERE owner_id = ?1 AND client_uuid = ?2",
                        params![owner_id, cu],
                        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                    )
                    .optional()?;
                Ok(row)
            })? {
                let (local_uuid, _payload) = existing;
                // Lê saldo atual como saldo_posterior; saldo_anterior é
                // recomposto a partir do tipo+quantidade já gravados.
                let posterior = with_conn(|conn| {
                    let v: Option<f64> = conn
                        .query_row(
                            "SELECT quantidade FROM estoque_saldos_local
                              WHERE owner_id = ?1 AND produto_id = ?2 AND variacao_id = ?3",
                            params![
                                owner_id,
                                input.produto_id,
                                input.variacao_id.clone().unwrap_or_default()
                            ],
                            |r| r.get(0),
                        )
                        .optional()?;
                    Ok(v.unwrap_or(0.0))
                })?;
                let delta = signal_for_tipo(Some(&tipo_norm)) * input.quantidade;
                return Ok(LocalMovimentacaoResult {
                    local_uuid,
                    idempotente: true,
                    saldo_anterior: posterior - delta,
                    saldo_posterior: posterior,
                });
            }
        }
    }

    let local_uuid = random_uuid_v4();
    let variacao_id = input.variacao_id.clone().unwrap_or_default();

    let payload_json = serde_json::json!({
        "local_uuid": local_uuid,
        "produto_id": input.produto_id,
        "variacao_id": input.variacao_id,
        "tipo": tipo_norm,
        "quantidade": input.quantidade,
        "custo_unitario": input.custo_unitario,
        "observacoes": input.observacoes,
        "origem": input.origem,
        "client_uuid": input.client_uuid,
        "owner_id": owner_id,
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        let saldo_anterior = read_saldo_atual(&tx, owner_id, &input.produto_id, &variacao_id)?;
        let delta = signal_for_tipo(Some(&tipo_norm)) * input.quantidade;
        let saldo_posterior = saldo_anterior + delta;

        // Bloqueia saldo negativo (paridade com a RPC do upstream).
        if saldo_posterior < 0.0 && (tipo_norm == "saida" || tipo_norm == "transferencia") {
            return Err(DbError(format!(
                "saldo insuficiente: atual={saldo_anterior}, tentativa={}",
                input.quantidade
            )));
        }

        // 1) Insere no histórico local com id = local_uuid (estável).
        let item_payload = serde_json::json!({
            "id": local_uuid,
            "produto_id": input.produto_id,
            "variacao_id": input.variacao_id,
            "tipo": tipo_norm,
            "quantidade": input.quantidade,
            "saldo_anterior": saldo_anterior,
            "saldo_posterior": saldo_posterior,
            "custo_unitario": input.custo_unitario,
            "origem": input.origem,
            "observacoes": input.observacoes,
            "data_movimentacao": iso_from_ms_z_pub(now_ms),
            "_pending": true,
        })
        .to_string();

        tx.execute(
            "INSERT OR IGNORE INTO estoque_movimentacoes_local(
                id, owner_id, produto_id, variacao_id, tipo, quantidade,
                saldo_anterior, saldo_posterior, custo_unitario,
                origem, observacoes, data_movimentacao_ms,
                payload, synced_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                local_uuid,
                owner_id,
                input.produto_id,
                variacao_id,
                tipo_norm,
                input.quantidade,
                saldo_anterior,
                saldo_posterior,
                input.custo_unitario,
                input.origem,
                input.observacoes,
                now_ms,
                item_payload,
                now_ms,
            ],
        )?;

        // 2) Materializa saldo (mesmo padrão do ingest do upstream).
        apply_mov_to_saldo(
            &tx,
            owner_id,
            &input.produto_id,
            &variacao_id,
            Some(tipo_norm.as_str()),
            input.quantidade,
            now_ms,
        )?;

        // 3) Enfileira na outbox.
        tx.execute(
            "INSERT INTO outbox_estoque_movs(
                local_uuid, owner_id, client_uuid, payload, status,
                attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms
             ) VALUES (?1, ?2, ?3, ?4, 'pending', 0, NULL, NULL, ?5, ?5, NULL)",
            params![
                local_uuid,
                owner_id,
                input.client_uuid,
                payload_json,
                now_ms
            ],
        )?;

        tx.commit()?;
        Ok(LocalMovimentacaoResult {
            local_uuid,
            idempotente: false,
            saldo_anterior,
            saldo_posterior,
        })
    })
}

// `iso_from_ms_z_pub` foi movida para `db::helpers` (PROMPT 12).

// ---------- Outbox: leitura, stats e atualização de status ----------

#[derive(Debug, Serialize)]
pub struct OutboxItem {
    pub local_uuid: String,
    pub owner_id: Option<String>,
    pub client_uuid: Option<String>,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

#[derive(Debug, Serialize, Default)]
pub struct OutboxStats {
    pub pending: i64,
    pub sending: i64,
    pub sent: i64,
    pub error: i64,
    pub last_sent_at_ms: Option<i64>,
    pub last_error: Option<String>,
    /// Itens `pending` cujo `next_attempt_at_ms` já está vencido — ou seja,
    /// elegíveis para envio agora pelo scheduler.
    pub due_now: i64,
    /// `next_attempt_at_ms` mais próximo entre os pending — quando o
    /// scheduler tentará a próxima rodada.
    pub next_attempt_at_ms: Option<i64>,
    /// Última rodada do scheduler (independente de ter enviado algo).
    pub last_auto_flush_ms: Option<i64>,
    /// Última rodada do scheduler em que algo realmente foi para o upstream.
    pub last_auto_flush_sent_ms: Option<i64>,
    /// Estatística da última rodada automática (tentou/enviou/falhou).
    pub last_auto_attempted: Option<i64>,
    pub last_auto_sent: Option<i64>,
    pub last_auto_failed: Option<i64>,
    /// Última rodada manual ("Sincronizar agora").
    pub last_manual_flush_ms: Option<i64>,
}

pub fn outbox_stats(owner_id: &str) -> DbResult<OutboxStats> {
    with_conn(|conn| {
        let mut s = OutboxStats::default();
        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM outbox_estoque_movs WHERE owner_id=?1 GROUP BY status",
        )?;
        let rows = stmt.query_map(params![owner_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (st, n) = r?;
            match st.as_str() {
                "pending" => s.pending = n,
                "sending" => s.sending = n,
                "sent" => s.sent = n,
                "error" => s.error = n,
                _ => {}
            }
        }
        s.last_sent_at_ms = conn
            .query_row(
                "SELECT MAX(sent_at_ms) FROM outbox_estoque_movs WHERE owner_id=?1 AND status='sent'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_error = conn
            .query_row(
                "SELECT last_error FROM outbox_estoque_movs
                  WHERE owner_id=?1 AND status='error' ORDER BY updated_at_ms DESC LIMIT 1",
                params![owner_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();

        // Backoff observability: due_now e próxima janela.
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn
            .query_row(
                "SELECT COUNT(*) FROM outbox_estoque_movs
                  WHERE owner_id=?1
                    AND status='pending'
                    AND COALESCE(next_attempt_at_ms, 0) <= ?2",
                params![owner_id, now],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        s.next_attempt_at_ms = conn
            .query_row(
                "SELECT MIN(COALESCE(next_attempt_at_ms, 0))
                   FROM outbox_estoque_movs WHERE owner_id=?1 AND status='pending'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();

        // Meta do scheduler — chaves opcionais; ausente = NULL.
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_last_manual_flush_ms")?;
        Ok(s)
    })
}

fn meta_get_i64(conn: &Connection, key: &str) -> DbResult<Option<i64>> {
    let v: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(v.and_then(|s| s.parse::<i64>().ok()))
}

fn meta_set_i64(conn: &Connection, key: &str, value: i64) -> DbResult<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )?;
    Ok(())
}

/// Registra a rodada do scheduler (auto ou manual) para a UI.
pub fn outbox_record_flush_round(
    kind: &str, // "auto" | "manual"
    now_ms: i64,
    attempted: i64,
    sent: i64,
    failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

pub fn outbox_list(
    owner_id: &str,
    limit: i64,
    only_status: Option<&str>,
) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let (sql, has_filter) = match only_status {
            Some(_) => (
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms, owner_id
                   FROM outbox_estoque_movs
                  WHERE owner_id = ?1 AND status = ?2
                  ORDER BY created_at_ms DESC
                  LIMIT ?3"
                    .to_string(),
                true,
            ),
            None => (
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms, owner_id
                   FROM outbox_estoque_movs
                  WHERE owner_id = ?1
                  ORDER BY created_at_ms DESC
                  LIMIT ?2"
                    .to_string(),
                false,
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let map_row = |r: &rusqlite::Row<'_>| -> rusqlite::Result<OutboxItem> {
            Ok(OutboxItem {
                local_uuid: r.get(0)?,
                client_uuid: r.get(1)?,
                payload: r.get(2)?,
                status: r.get(3)?,
                attempts: r.get(4)?,
                last_error: r.get(5)?,
                remote_id: r.get(6)?,
                created_at_ms: r.get(7)?,
                updated_at_ms: r.get(8)?,
                sent_at_ms: r.get(9)?,
                owner_id: r.get(10)?,
            })
        };
        let mut out = Vec::new();
        if has_filter {
            let s = only_status.unwrap();
            let rows = stmt.query_map(params![owner_id, s, limit], map_row)?;
            for r in rows {
                out.push(r?);
            }
        } else {
            let rows = stmt.query_map(params![owner_id, limit], map_row)?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    })
}

/// Retorna SOMENTE itens `pending` com `next_attempt_at_ms <= now` (ou NULL).
/// É a base do flush automático: NUNCA puxa um item em backoff.
pub fn outbox_pending_batch(owner_id: &str, limit: i64) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                    remote_id, created_at_ms, updated_at_ms, sent_at_ms, owner_id
               FROM outbox_estoque_movs
              WHERE owner_id = ?1
                AND status = 'pending'
                AND COALESCE(next_attempt_at_ms, 0) <= ?2
              ORDER BY created_at_ms ASC
              LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![owner_id, now, limit], |r| {
            Ok(OutboxItem {
                local_uuid: r.get(0)?,
                client_uuid: r.get(1)?,
                payload: r.get(2)?,
                status: r.get(3)?,
                attempts: r.get(4)?,
                last_error: r.get(5)?,
                remote_id: r.get(6)?,
                created_at_ms: r.get(7)?,
                updated_at_ms: r.get(8)?,
                sent_at_ms: r.get(9)?,
                owner_id: r.get(10)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Igual a `outbox_pending_batch` mas IGNORA `next_attempt_at_ms`. Usado
/// pelo flush manual: o operador clicou "Sincronizar agora" e quer ignorar
/// a janela de espera do backoff.
pub fn outbox_pending_batch_all(owner_id: &str, limit: i64) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                    remote_id, created_at_ms, updated_at_ms, sent_at_ms, owner_id
               FROM outbox_estoque_movs
              WHERE owner_id = ?1 AND status = 'pending'
              ORDER BY created_at_ms ASC
              LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![owner_id, limit], |r| {
            Ok(OutboxItem {
                local_uuid: r.get(0)?,
                client_uuid: r.get(1)?,
                payload: r.get(2)?,
                status: r.get(3)?,
                attempts: r.get(4)?,
                last_error: r.get(5)?,
                remote_id: r.get(6)?,
                created_at_ms: r.get(7)?,
                updated_at_ms: r.get(8)?,
                sent_at_ms: r.get(9)?,
                owner_id: r.get(10)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn outbox_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_estoque_movs
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_mark_sent(local_uuid: &str, remote_id: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_estoque_movs
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, last_error=NULL, next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id],
        )?;
        Ok(())
    })
}

/// Política de backoff exponencial limitado (em ms):
/// 1ª falha → 5s, 2ª → 15s, 3ª → 1min, 4ª → 5min, 5ª+ → 15min (cap).
// `backoff_ms_for_attempts` foi movida para `db::helpers` (PROMPT 12).

/// Após este nº de tentativas automáticas o item para de ser retomado pelo
/// scheduler e fica como `error`, exigindo "Reenfileirar erros" / manual.
const MAX_AUTO_ATTEMPTS: i64 = 8;

/// Marca falha de envio. Decide entre dois caminhos:
///  * `attempts < MAX_AUTO_ATTEMPTS` → mantém `status='pending'` com
///    `next_attempt_at_ms` agendado para o backoff. O scheduler retoma
///    automaticamente.
///  * caso contrário → `status='error'` (precisa de intervenção manual).
/// Em ambos os casos, `last_error` é preservado para a UI.
pub fn outbox_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn
            .query_row(
                "SELECT attempts FROM outbox_estoque_movs WHERE local_uuid=?1",
                params![local_uuid],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(1);

        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_estoque_movs
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_estoque_movs
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

/// Limpa backoff/erros e força reenvio imediato.
/// Útil tanto para o botão "Reenfileirar erros" quanto para o "Sincronizar
/// agora" do operador (que quer ignorar a janela de espera).
pub fn outbox_reset_errors(owner_id: &str, now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_estoque_movs
                SET status='pending', updated_at_ms=?2,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE owner_id=?1 AND status IN ('error','pending') AND last_error IS NOT NULL",
            params![owner_id, now_ms],
        )?;
        Ok(n as i64)
    })
}

// ============================================================================
// VENDAS LOCAIS (PDV) — write local + outbox de vendas
// ============================================================================
//
// Mesmo padrão da outbox de estoque (v5/v6), porém em tabelas próprias.
// Em UMA transação:
//   1. Idempotência por client_uuid (já existe? devolve a mesma venda).
//   2. INSERT em `vendas_local` com id = local_uuid.
//   3. INSERT N em `venda_itens_local`.
//   4. INSERT N em `venda_pagamentos_local`.
//   5. Para cada item, baixa estoque local (reusa apply_mov_to_saldo +
//      INSERT em estoque_movimentacoes_local com origem='venda').
//   6. INSERT em `outbox_vendas` com payload completo p/ enviar à RPC
//      `finalizar_venda_pdv` no upstream (que cuida de caixa+financeiro+
//      estoque do lado cloud).
//
// O upstream usa `_client_uuid = local_uuid` → idempotência cross-runs.

#[derive(Debug, Deserialize)]
pub struct LocalVendaItemInput {
    pub produto_id: String,
    pub quantidade: f64,
    pub preco_unitario: f64,
    #[serde(default)]
    pub desconto: f64,
    #[serde(default)]
    pub descricao: Option<String>,
    /// Demais campos (peso, plu, etc.) são preservados em `extra` no payload
    /// que vai à RPC do upstream.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct LocalVendaPagamentoInput {
    pub forma_pagamento: String,
    pub valor: f64,
    #[serde(default)]
    pub valor_recebido: Option<f64>,
    #[serde(default)]
    pub troco: Option<f64>,
    #[serde(default)]
    pub parcelas: Option<i64>,
    #[serde(default)]
    pub observacao: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct LocalVendaInput {
    pub cliente_id: Option<String>,
    pub subtotal: f64,
    pub desconto: f64,
    pub total: f64,
    pub forma_pagamento: String,
    pub status_pagamento: String,
    pub valor_recebido: Option<f64>,
    pub troco: Option<f64>,
    pub observacao: Option<String>,
    pub itens: Vec<LocalVendaItemInput>,
    #[serde(default)]
    pub pagamentos: Vec<LocalVendaPagamentoInput>,
    #[serde(default = "default_true")]
    pub gerar_financeiro: bool,
    pub operador_id: Option<String>,
    pub terminal_id: Option<String>,
    pub client_uuid: Option<String>,
    /// Data de vencimento (YYYY-MM-DD) — obrigatória quando há pagamento
    /// `fiado`. Validada aqui e re-enviada à RPC `finalizar_venda_pdv` como
    /// `_data_vencimento` no push da outbox.
    #[serde(default)]
    pub data_vencimento: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalVendaListItem {
    pub id: String,
    pub numero: String,
    pub cliente_id: Option<String>,
    pub cliente_nome: Option<String>,
    pub data_emissao: String,
    pub data_finalizacao: Option<String>,
    pub total: f64,
    pub status: String,
    pub status_pagamento: String,
    pub forma_pagamento: Option<String>,
    pub caixa_id: Option<String>,
    pub operador_id: Option<String>,
    pub terminal_id: Option<String>,
    pub sync_status: Option<String>,
    pub sync_remote_id: Option<String>,
    pub sync_error: Option<String>,
    pub cancel_sync_status: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalVendaDetalheItem {
    pub id: String,
    pub produto_id: String,
    pub descricao: Option<String>,
    pub quantidade: f64,
    pub preco_unitario: f64,
    pub desconto: f64,
    pub total: f64,
    pub produto_nome: Option<String>,
    pub sku: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalVendaDetalhePagamento {
    pub id: String,
    pub forma_pagamento: String,
    pub valor: f64,
    pub valor_recebido: Option<f64>,
    pub troco: Option<f64>,
    pub parcelas: Option<i64>,
    pub observacao: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalVendaDetalhe {
    pub id: String,
    pub numero: String,
    pub cliente_nome: Option<String>,
    pub data_emissao: String,
    pub data_finalizacao: Option<String>,
    pub subtotal: f64,
    pub desconto: f64,
    pub total: f64,
    pub valor_recebido: Option<f64>,
    pub troco: Option<f64>,
    pub valor_pago_total: f64,
    pub valor_restante: f64,
    pub status: String,
    pub status_pagamento: String,
    pub forma_pagamento: Option<String>,
    pub observacoes: Option<String>,
    pub itens: Vec<LocalVendaDetalheItem>,
    pub pagamentos: Vec<LocalVendaDetalhePagamento>,
    pub sync_status: Option<String>,
    pub sync_remote_id: Option<String>,
    pub sync_error: Option<String>,
    pub cancel_sync_status: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalVendaResumo {
    pub qtd_vendas: i64,
    pub qtd_canceladas: i64,
    pub total_vendido: f64,
    pub ticket_medio: f64,
    pub qtd_pendentes: i64,
    pub valor_pendente: f64,
}

fn local_venda_numero(local_uuid: &str, remote_id: Option<&str>) -> String {
    if let Some(rid) = remote_id.filter(|s| !s.is_empty()) {
        return rid.to_string();
    }
    let short = local_uuid
        .chars()
        .take(8)
        .collect::<String>()
        .to_uppercase();
    format!("LOCAL-{short}")
}

fn local_date_from_ms(ms: i64) -> String {
    iso_from_ms_z_pub(ms)
        .split('T')
        .next()
        .unwrap_or("1970-01-01")
        .to_string()
}

fn local_date_start_ms(date: &str) -> DbResult<i64> {
    let d = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|e| DbError(format!("data inicial invalida: {e}")))?;
    let dt = d
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| DbError("data inicial invalida".into()))?;
    Ok(dt.and_utc().timestamp_millis())
}

fn local_date_end_exclusive_ms(date: &str) -> DbResult<i64> {
    let d = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|e| DbError(format!("data final invalida: {e}")))?;
    let next = d
        .succ_opt()
        .ok_or_else(|| DbError("data final invalida".into()))?;
    let dt = next
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| DbError("data final invalida".into()))?;
    Ok(dt.and_utc().timestamp_millis())
}

pub fn vendas_local_resumo(
    owner_id: &str,
    data_inicio: &str,
    data_fim: &str,
) -> DbResult<LocalVendaResumo> {
    let inicio_ms = local_date_start_ms(data_inicio)?;
    let fim_ms = local_date_end_exclusive_ms(data_fim)?;
    if fim_ms <= inicio_ms {
        return Err(DbError("periodo invalido para resumo de vendas".into()));
    }

    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "WITH vendas_periodo AS (
                SELECT v.local_uuid,
                       COALESCE(v.status,'ativa') AS status,
                       COALESCE(v.status_pagamento,'pendente') AS status_pagamento,
                       COALESCE(v.total,0) AS total,
                       COALESCE(p.valor_pago,0) AS valor_pago
                  FROM vendas_local v
             LEFT JOIN (
                    SELECT venda_local_uuid, SUM(COALESCE(valor,0)) AS valor_pago
                      FROM venda_pagamentos_local
                     WHERE owner_id = ?1
                  GROUP BY venda_local_uuid
                  ) p ON p.venda_local_uuid = v.local_uuid
                 WHERE v.owner_id = ?1
                   AND v.created_at_ms >= ?2
                   AND v.created_at_ms < ?3
            )
            SELECT
                COALESCE(SUM(CASE WHEN status <> 'cancelada' THEN 1 ELSE 0 END),0) AS qtd_vendas,
                COALESCE(SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END),0) AS qtd_canceladas,
                COALESCE(SUM(CASE WHEN status <> 'cancelada' THEN total ELSE 0 END),0) AS total_vendido,
                COALESCE(SUM(CASE
                    WHEN status <> 'cancelada'
                     AND status_pagamento IN ('pendente','parcial','vencido')
                    THEN 1 ELSE 0 END),0) AS qtd_pendentes,
                COALESCE(SUM(CASE
                    WHEN status = 'cancelada' THEN 0
                    WHEN status_pagamento IN ('pendente','vencido') THEN total
                    WHEN status_pagamento = 'parcial' THEN MAX(total - valor_pago, 0)
                    ELSE 0 END),0) AS valor_pendente
              FROM vendas_periodo",
        )?;
        let (qtd_vendas, qtd_canceladas, total_vendido, qtd_pendentes, valor_pendente) = stmt
            .query_row(params![owner_id, inicio_ms, fim_ms], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, f64>(4)?,
                ))
            })?;
        let ticket_medio = if qtd_vendas > 0 {
            total_vendido / qtd_vendas as f64
        } else {
            0.0
        };
        Ok(LocalVendaResumo {
            qtd_vendas,
            qtd_canceladas,
            total_vendido,
            ticket_medio,
            qtd_pendentes,
            valor_pendente,
        })
    })
}

pub fn vendas_local_list(owner_id: &str, limit: i64) -> DbResult<Vec<LocalVendaListItem>> {
    let limit = limit.clamp(1, 1000);
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT v.local_uuid, v.cliente_id, c.nome, v.created_at_ms,
                    v.total, COALESCE(v.status,'ativa'), v.status_pagamento,
                    v.forma_pagamento, v.caixa_local_uuid, v.operador_id,
                    v.terminal_id, ov.status, ov.remote_id, ov.last_error,
                    oc.status
               FROM vendas_local v
          LEFT JOIN clientes_local c ON c.owner_id = v.owner_id AND c.id = v.cliente_id
          LEFT JOIN outbox_vendas ov ON ov.owner_id = v.owner_id AND ov.local_uuid = v.local_uuid
          LEFT JOIN outbox_cancelamentos_venda oc ON oc.owner_id = v.owner_id AND oc.venda_local_uuid = v.local_uuid
              WHERE v.owner_id = ?1
           ORDER BY v.created_at_ms DESC
              LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![owner_id, limit], |r| {
            let id: String = r.get(0)?;
            let created_at_ms: i64 = r.get(3)?;
            let remote_id: Option<String> = r.get(12)?;
            Ok(LocalVendaListItem {
                numero: local_venda_numero(&id, remote_id.as_deref()),
                id,
                cliente_id: r.get(1)?,
                cliente_nome: r.get(2)?,
                data_emissao: local_date_from_ms(created_at_ms),
                data_finalizacao: Some(local_date_from_ms(created_at_ms)),
                total: r.get::<_, f64>(4)?,
                status: r.get::<_, String>(5)?,
                status_pagamento: r.get::<_, String>(6)?,
                forma_pagamento: r.get(7)?,
                caixa_id: r.get(8)?,
                operador_id: r.get(9)?,
                terminal_id: r.get(10)?,
                sync_status: r.get(11)?,
                sync_remote_id: remote_id,
                sync_error: r.get(13)?,
                cancel_sync_status: r.get(14)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
}

pub fn venda_local_detalhe(owner_id: &str, venda_id: &str) -> DbResult<Option<LocalVendaDetalhe>> {
    with_conn(|conn| {
        let header = conn
            .query_row(
                "SELECT v.local_uuid, c.nome, v.created_at_ms, v.subtotal,
                        v.desconto, v.total, v.valor_recebido, v.troco,
                        COALESCE(v.status,'ativa'), v.status_pagamento,
                        v.forma_pagamento, v.observacao, ov.status,
                        ov.remote_id, ov.last_error, oc.status
                   FROM vendas_local v
              LEFT JOIN clientes_local c ON c.owner_id = v.owner_id AND c.id = v.cliente_id
              LEFT JOIN outbox_vendas ov ON ov.owner_id = v.owner_id AND ov.local_uuid = v.local_uuid
              LEFT JOIN outbox_cancelamentos_venda oc ON oc.owner_id = v.owner_id AND oc.venda_local_uuid = v.local_uuid
                  WHERE v.owner_id = ?1 AND (v.local_uuid = ?2 OR v.client_uuid = ?2 OR ov.remote_id = ?2)
                  LIMIT 1",
                params![owner_id, venda_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, f64>(3)?,
                        r.get::<_, f64>(4)?,
                        r.get::<_, f64>(5)?,
                        r.get::<_, Option<f64>>(6)?,
                        r.get::<_, Option<f64>>(7)?,
                        r.get::<_, String>(8)?,
                        r.get::<_, String>(9)?,
                        r.get::<_, Option<String>>(10)?,
                        r.get::<_, Option<String>>(11)?,
                        r.get::<_, Option<String>>(12)?,
                        r.get::<_, Option<String>>(13)?,
                        r.get::<_, Option<String>>(14)?,
                        r.get::<_, Option<String>>(15)?,
                    ))
                },
            )
            .optional()?;

        let Some((
            id,
            cliente_nome,
            created_at_ms,
            subtotal,
            desconto,
            total,
            valor_recebido,
            troco,
            status,
            status_pagamento,
            forma_pagamento,
            observacoes,
            sync_status,
            sync_remote_id,
            sync_error,
            cancel_sync_status,
        )) = header
        else {
            return Ok(None);
        };

        let mut stmt_itens = conn.prepare(
            "SELECT i.id, i.produto_id, i.descricao, i.quantidade,
                    i.preco_unitario, i.desconto,
                    ((i.quantidade * i.preco_unitario) - i.desconto) AS total,
                    p.nome, p.sku
               FROM venda_itens_local i
          LEFT JOIN produtos_local p ON p.id = i.produto_id
              WHERE i.owner_id = ?1 AND i.venda_local_uuid = ?2
           ORDER BY i.id ASC",
        )?;
        let itens_rows = stmt_itens.query_map(params![owner_id, id], |r| {
            Ok(LocalVendaDetalheItem {
                id: r.get::<_, i64>(0)?.to_string(),
                produto_id: r.get(1)?,
                descricao: r.get(2)?,
                quantidade: r.get::<_, f64>(3)?,
                preco_unitario: r.get::<_, f64>(4)?,
                desconto: r.get::<_, f64>(5)?,
                total: r.get::<_, f64>(6)?,
                produto_nome: r.get(7)?,
                sku: r.get(8)?,
            })
        })?;
        let mut itens = Vec::new();
        for row in itens_rows {
            itens.push(row?);
        }

        let mut stmt_pgtos = conn.prepare(
            "SELECT id, forma_pagamento, valor, valor_recebido, troco,
                    parcelas, observacao
               FROM venda_pagamentos_local
              WHERE owner_id = ?1 AND venda_local_uuid = ?2
           ORDER BY id ASC",
        )?;
        let pgtos_rows = stmt_pgtos.query_map(params![owner_id, id], |r| {
            Ok(LocalVendaDetalhePagamento {
                id: r.get::<_, i64>(0)?.to_string(),
                forma_pagamento: r.get(1)?,
                valor: r.get::<_, f64>(2)?,
                valor_recebido: r.get(3)?,
                troco: r.get(4)?,
                parcelas: r.get(5)?,
                observacao: r.get(6)?,
            })
        })?;
        let mut pagamentos = Vec::new();
        for row in pgtos_rows {
            pagamentos.push(row?);
        }
        let valor_pago_total = pagamentos.iter().map(|p| p.valor).sum::<f64>();
        let valor_restante = (total - valor_pago_total).max(0.0);

        Ok(Some(LocalVendaDetalhe {
            numero: local_venda_numero(&id, sync_remote_id.as_deref()),
            id,
            cliente_nome,
            data_emissao: local_date_from_ms(created_at_ms),
            data_finalizacao: Some(local_date_from_ms(created_at_ms)),
            subtotal,
            desconto,
            total,
            valor_recebido,
            troco,
            valor_pago_total,
            valor_restante,
            status,
            status_pagamento,
            forma_pagamento,
            observacoes,
            itens,
            pagamentos,
            sync_status,
            sync_remote_id,
            sync_error,
            cancel_sync_status,
        }))
    })
}

#[derive(Debug, Serialize)]
pub struct LocalVendaResult {
    pub local_uuid: String,
    pub idempotente: bool,
    pub qtd_itens: i64,
    pub total: f64,
}

pub fn registrar_venda_local(
    owner_id: &str,
    input: LocalVendaInput,
    now_ms: i64,
) -> DbResult<LocalVendaResult> {
    if input.itens.is_empty() {
        return Err(DbError("venda sem itens".into()));
    }

    // FIADO: cliente + data_vencimento são obrigatórios. Mesma regra do
    // backend cloud — falhar aqui evita que o PDV registre uma venda offline
    // que depois quebraria na RPC `finalizar_venda_pdv` por falta de dados.
    let tem_fiado = input.forma_pagamento.eq_ignore_ascii_case("fiado")
        || input
            .pagamentos
            .iter()
            .any(|p| p.forma_pagamento.eq_ignore_ascii_case("fiado"));
    if tem_fiado {
        if input
            .cliente_id
            .as_deref()
            .map(|s| s.is_empty())
            .unwrap_or(true)
        {
            return Err(DbError(
                "Venda fiado exige cliente — selecione um cliente antes de finalizar.".into(),
            ));
        }
        if input
            .data_vencimento
            .as_deref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
        {
            return Err(DbError(
                "Venda fiado exige data de vencimento — informe a data antes de finalizar.".into(),
            ));
        }
    }

    // Idempotência por client_uuid (antes da transação grande).
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some((local_uuid, qtd, total)) = with_conn(|conn| {
                let row = conn
                    .query_row(
                        "SELECT local_uuid, qtd_itens, total
                           FROM vendas_local WHERE owner_id = ?1 AND client_uuid = ?2",
                        params![owner_id, cu],
                        |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, i64>(1)?,
                                r.get::<_, f64>(2)?,
                            ))
                        },
                    )
                    .optional()?;
                Ok(row)
            })? {
                return Ok(LocalVendaResult {
                    local_uuid,
                    idempotente: true,
                    qtd_itens: qtd,
                    total,
                });
            }
        }
    }

    let local_uuid = random_uuid_v4();
    let qtd_itens = input.itens.len() as i64;

    let itens_json: Vec<serde_json::Value> = input
        .itens
        .iter()
        .map(|i| {
            let mut obj = serde_json::Map::new();
            obj.insert("produto_id".into(), serde_json::json!(i.produto_id));
            obj.insert("quantidade".into(), serde_json::json!(i.quantidade));
            obj.insert("preco_unitario".into(), serde_json::json!(i.preco_unitario));
            obj.insert("desconto".into(), serde_json::json!(i.desconto));
            if let Some(d) = &i.descricao {
                obj.insert("descricao".into(), serde_json::json!(d));
            }
            for (k, v) in &i.extra {
                obj.insert(k.clone(), v.clone());
            }
            serde_json::Value::Object(obj)
        })
        .collect();

    let pagtos_json: Vec<serde_json::Value> = input
        .pagamentos
        .iter()
        .map(|p| {
            serde_json::json!({
                "forma_pagamento": p.forma_pagamento,
                "valor": p.valor,
                "valor_recebido": p.valor_recebido,
                "troco": p.troco,
                "parcelas": p.parcelas,
                "observacao": p.observacao,
            })
        })
        .collect();

    let payload_json = serde_json::json!({
        "local_uuid":       local_uuid,
        "cliente_id":       input.cliente_id,
        "subtotal":         input.subtotal,
        "desconto":         input.desconto,
        "total":            input.total,
        "forma_pagamento":  input.forma_pagamento,
        "status_pagamento": input.status_pagamento,
        "valor_recebido":   input.valor_recebido,
        "troco":            input.troco,
        "observacao":       input.observacao,
        "itens":            itens_json,
        "pagamentos":       pagtos_json,
        "gerar_financeiro": input.gerar_financeiro,
        "operador_id":      input.operador_id,
        "terminal_id":      input.terminal_id,
        "client_uuid":      input.client_uuid,
        "data_vencimento":  input.data_vencimento,
        "owner_id":         owner_id,
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        // 0) Resolve o caixa local aberto para vincular esta venda.
        //    Estratégia: prioriza match por operador_id; cai para qualquer
        //    caixa aberto neste banco (típico em terminais 1-caixa). Venda sem
        //    caixa local aberto NÃO é permitida — o PDV offline deve ser
        //    atrelado a um caixa local aberto.
        let caixa_local_uuid: Option<String> = {
            let by_op: Option<String> = match input.operador_id.as_deref() {
                Some(op) if !op.is_empty() => tx
                    .query_row(
                        "SELECT local_uuid FROM caixa_local
                      WHERE owner_id = ?1 AND status='aberto' AND operador_id = ?2
                   ORDER BY data_abertura_ms DESC LIMIT 1",
                        params![owner_id, op],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?,
                _ => None,
            };
            if by_op.is_some() {
                by_op
            } else {
                tx.query_row(
                    "SELECT local_uuid FROM caixa_local
                      WHERE owner_id = ?1 AND status='aberto'
                   ORDER BY data_abertura_ms DESC LIMIT 1",
                    params![owner_id],
                    |r| r.get::<_, String>(0),
                )
                .optional()?
            }
        };

        if caixa_local_uuid.is_none() {
            return Err(DbError(
                "Não há caixa local aberto. Abra um caixa antes de finalizar a venda.".into(),
            ));
        }

        // 0.5) Validação atômica de estoque local.
        //
        // Agrega a quantidade pedida por produto (mesmo SKU repetido em
        // múltiplas linhas conta junto) e compara com o saldo materializado
        // em `estoque_saldos_local`. Bloqueia a venda INTEIRA se algum
        // produto não tiver saldo suficiente — mesma regra do backend
        // cloud (`finalizar_venda_pdv`). Garante que não há baixa parcial.
        //
        // Concorrência multi-terminal é tratada no cloud via
        // pg_advisory_xact_lock dentro da RPC. Localmente, SQLite serializa
        // writes na mesma instância, e a leitura+escrita ocorrem dentro
        // desta transação.
        {
            use std::collections::BTreeMap;
            let mut por_produto: BTreeMap<String, f64> = BTreeMap::new();
            for item in &input.itens {
                *por_produto.entry(item.produto_id.clone()).or_insert(0.0) += item.quantidade;
            }
            for (produto_id, qtd_pedida) in &por_produto {
                let variacao_id = String::new();
                let saldo = read_saldo_atual(&tx, owner_id, produto_id, &variacao_id)?;
                if saldo < *qtd_pedida {
                    let nome: Option<String> = tx
                        .query_row(
                            "SELECT nome FROM produtos_local WHERE id = ?1",
                            params![produto_id],
                            |r| r.get::<_, Option<String>>(0),
                        )
                        .optional()?
                        .flatten();
                    let label = nome.unwrap_or_else(|| produto_id.clone());
                    return Err(DbError(format!(
                        "Estoque insuficiente para \"{label}\". Disponível: {saldo}, solicitado: {qtd_pedida}."
                    )));
                }
            }
        }

        // 1) Cabeçalho.
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO vendas_local(
                local_uuid, owner_id, client_uuid, cliente_id, subtotal, desconto, total,
                forma_pagamento, status_pagamento, valor_recebido, troco,
                observacao, operador_id, terminal_id, gerar_financeiro,
                qtd_itens, caixa_local_uuid, created_at_ms, updated_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
            params![
                local_uuid,
                owner_id,
                input.client_uuid,
                input.cliente_id,
                input.subtotal,
                input.desconto,
                input.total,
                input.forma_pagamento,
                input.status_pagamento,
                input.valor_recebido,
                input.troco,
                input.observacao,
                input.operador_id,
                input.terminal_id,
                if input.gerar_financeiro { 1i64 } else { 0i64 },
                qtd_itens,
                caixa_local_uuid,
                now_ms,
            ],
        )?;
        if inserted == 0 {
            if let Some(cu) = input.client_uuid.as_deref().filter(|s| !s.is_empty()) {
                if let Some((local_uuid, qtd, total)) = tx
                    .query_row(
                        "SELECT local_uuid, qtd_itens, total FROM vendas_local WHERE owner_id = ?1 AND client_uuid = ?2",
                        params![owner_id, cu],
                        |r| Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, f64>(2)?,
                        )),
                    )
                    .optional()? {
                    return Ok(LocalVendaResult {
                        local_uuid,
                        idempotente: true,
                        qtd_itens: qtd,
                        total,
                    });
                }
            }
            return Err(DbError(
                "Falha ao registrar a venda. Já existe uma venda local com este client_uuid."
                    .into(),
            ));
        }

        // 2) Itens + baixa de estoque local.
        for (idx, item) in input.itens.iter().enumerate() {
            let item_payload =
                serde_json::to_string(&itens_json[idx]).unwrap_or_else(|_| "{}".to_string());
            tx.execute(
                "INSERT INTO venda_itens_local(
                    owner_id, venda_local_uuid, produto_id, descricao, quantidade,
                    preco_unitario, desconto, payload, created_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    owner_id,
                    local_uuid,
                    item.produto_id,
                    item.descricao,
                    item.quantidade,
                    item.preco_unitario,
                    item.desconto,
                    item_payload,
                    now_ms,
                ],
            )?;

            // Baixa de estoque local: 1 movimentação 'saida' por item, com
            // id derivado do (local_uuid, idx). NÃO enfileira na outbox de
            // estoque — o upstream gera as movimentações automaticamente
            // quando processa a venda via `finalizar_venda_pdv`.
            let mov_id = format!("{}-i{}", local_uuid, idx);
            let variacao_id = String::new();
            let saldo_anterior = read_saldo_atual(&tx, owner_id, &item.produto_id, &variacao_id)?;
            let saldo_posterior = saldo_anterior - item.quantidade;
            let mov_payload = serde_json::json!({
                "id": mov_id,
                "produto_id": item.produto_id,
                "tipo": "saida",
                "quantidade": item.quantidade,
                "saldo_anterior": saldo_anterior,
                "saldo_posterior": saldo_posterior,
                "origem": "venda",
                "venda_local_uuid": local_uuid,
                "data_movimentacao": iso_from_ms_z_pub(now_ms),
                "_pending": true,
            })
            .to_string();
            let mov_inserted = tx.execute(
                "INSERT OR IGNORE INTO estoque_movimentacoes_local(
                    id, owner_id, produto_id, variacao_id, tipo, quantidade,
                    saldo_anterior, saldo_posterior, custo_unitario,
                    origem, observacoes, data_movimentacao_ms,
                    payload, synced_at_ms
                 ) VALUES (?1,?2,?3,?4,'saida',?5,?6,?7,NULL,'venda',NULL,?8,?9,?8)",
                params![
                    mov_id,
                    owner_id,
                    item.produto_id,
                    variacao_id,
                    item.quantidade,
                    saldo_anterior,
                    saldo_posterior,
                    now_ms,
                    mov_payload,
                ],
            )?;
            if mov_inserted > 0 {
                apply_mov_to_saldo(
                    &tx,
                    owner_id,
                    &item.produto_id,
                    &variacao_id,
                    Some("saida"),
                    item.quantidade,
                    now_ms,
                )?;
            }
        }

        // 3) Pagamentos.
        for p in &input.pagamentos {
            tx.execute(
                "INSERT INTO venda_pagamentos_local(
                    owner_id, venda_local_uuid, forma_pagamento, valor, valor_recebido,
                    troco, parcelas, observacao, created_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    owner_id,
                    local_uuid,
                    p.forma_pagamento,
                    p.valor,
                    p.valor_recebido,
                    p.troco,
                    p.parcelas,
                    p.observacao,
                    now_ms,
                ],
            )?;
        }

        // 4) Outbox.
        tx.execute(
            "INSERT INTO outbox_vendas(
                local_uuid, owner_id, client_uuid, payload, status,
                attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,?4,'pending',0,NULL,NULL,?5,?5,NULL,NULL)",
            params![
                local_uuid,
                owner_id,
                input.client_uuid,
                payload_json,
                now_ms
            ],
        )?;

        tx.commit()?;
        Ok(LocalVendaResult {
            local_uuid,
            idempotente: false,
            qtd_itens,
            total: input.total,
        })
    })
}

// ---------- Outbox de vendas: stats / listagem / status ----------

#[derive(Debug, Serialize, Default)]
pub struct OutboxVendasStats {
    pub pending: i64,
    pub sending: i64,
    pub sent: i64,
    pub error: i64,
    pub last_sent_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub due_now: i64,
    pub next_attempt_at_ms: Option<i64>,
    pub last_auto_flush_ms: Option<i64>,
    pub last_auto_flush_sent_ms: Option<i64>,
    pub last_auto_attempted: Option<i64>,
    pub last_auto_sent: Option<i64>,
    pub last_auto_failed: Option<i64>,
    pub last_manual_flush_ms: Option<i64>,
}

pub fn outbox_vendas_stats(owner_id: &str) -> DbResult<OutboxVendasStats> {
    with_conn(|conn| {
        let mut s = OutboxVendasStats::default();
        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM outbox_vendas WHERE owner_id=?1 GROUP BY status",
        )?;
        let rows = stmt.query_map(params![owner_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (st, n) = r?;
            match st.as_str() {
                "pending" => s.pending = n,
                "sending" => s.sending = n,
                "sent" => s.sent = n,
                "error" => s.error = n,
                _ => {}
            }
        }
        s.last_sent_at_ms = conn
            .query_row(
                "SELECT MAX(sent_at_ms) FROM outbox_vendas WHERE owner_id=?1 AND status='sent'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_error = conn
            .query_row(
                "SELECT last_error FROM outbox_vendas
              WHERE owner_id=?1 AND status='error' ORDER BY updated_at_ms DESC LIMIT 1",
                params![owner_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn
            .query_row(
                "SELECT COUNT(*) FROM outbox_vendas
              WHERE owner_id=?1 AND status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?2",
                params![owner_id, now],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        s.next_attempt_at_ms = conn
            .query_row(
                "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_vendas WHERE owner_id=?1 AND status='pending'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_vendas_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_vendas_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_vendas_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_vendas_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_vendas_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_vendas_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_vendas_record_flush_round(
    kind: &str,
    now_ms: i64,
    attempted: i64,
    sent: i64,
    failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_vendas_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_vendas_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_vendas_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_vendas_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_vendas_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_vendas_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

pub fn outbox_vendas_list(
    owner_id: &str,
    limit: i64,
    only_status: Option<&str>,
) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let map_row = |r: &rusqlite::Row<'_>| -> rusqlite::Result<OutboxItem> {
            Ok(OutboxItem {
                local_uuid: r.get(0)?,
                client_uuid: r.get(1)?,
                payload: r.get(2)?,
                status: r.get(3)?,
                attempts: r.get(4)?,
                last_error: r.get(5)?,
                remote_id: r.get(6)?,
                created_at_ms: r.get(7)?,
                updated_at_ms: r.get(8)?,
                sent_at_ms: r.get(9)?,
                owner_id: r.get(10)?,
            })
        };
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let mut stmt = conn.prepare(
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms, owner_id
                   FROM outbox_vendas WHERE owner_id = ?1 AND status = ?2
                  ORDER BY created_at_ms DESC LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![owner_id, st, limit], map_row)?;
            for r in rows {
                out.push(r?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms, owner_id
                   FROM outbox_vendas WHERE owner_id = ?1 ORDER BY created_at_ms DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![owner_id, limit], map_row)?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    })
}

pub fn outbox_vendas_get(local_uuid: &str) -> DbResult<Option<OutboxItem>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                    remote_id, created_at_ms, updated_at_ms, sent_at_ms, owner_id
               FROM outbox_vendas WHERE local_uuid = ?1",
        )?;
        let item = stmt
            .query_row(params![local_uuid], |r| {
                Ok(OutboxItem {
                    local_uuid: r.get(0)?,
                    client_uuid: r.get(1)?,
                    payload: r.get(2)?,
                    status: r.get(3)?,
                    attempts: r.get(4)?,
                    last_error: r.get(5)?,
                    remote_id: r.get(6)?,
                    created_at_ms: r.get(7)?,
                    updated_at_ms: r.get(8)?,
                    sent_at_ms: r.get(9)?,
                    owner_id: r.get(10)?,
                })
            })
            .optional()?;
        Ok(item)
    })
}

pub fn outbox_vendas_pending_batch(owner_id: &str, limit: i64) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                    remote_id, created_at_ms, updated_at_ms, sent_at_ms, owner_id
               FROM outbox_vendas
              WHERE owner_id=?1 AND status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?2
              ORDER BY created_at_ms ASC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![owner_id, now, limit], |r| {
            Ok(OutboxItem {
                local_uuid: r.get(0)?,
                client_uuid: r.get(1)?,
                payload: r.get(2)?,
                status: r.get(3)?,
                attempts: r.get(4)?,
                last_error: r.get(5)?,
                remote_id: r.get(6)?,
                created_at_ms: r.get(7)?,
                updated_at_ms: r.get(8)?,
                sent_at_ms: r.get(9)?,
                owner_id: r.get(10)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn outbox_vendas_pending_batch_all(owner_id: &str, limit: i64) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                    remote_id, created_at_ms, updated_at_ms, sent_at_ms, owner_id
               FROM outbox_vendas WHERE owner_id=?1 AND status='pending'
              ORDER BY created_at_ms ASC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![owner_id, limit], |r| {
            Ok(OutboxItem {
                local_uuid: r.get(0)?,
                client_uuid: r.get(1)?,
                payload: r.get(2)?,
                status: r.get(3)?,
                attempts: r.get(4)?,
                last_error: r.get(5)?,
                remote_id: r.get(6)?,
                created_at_ms: r.get(7)?,
                updated_at_ms: r.get(8)?,
                sent_at_ms: r.get(9)?,
                owner_id: r.get(10)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn outbox_vendas_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_vendas
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_vendas_mark_sent(local_uuid: &str, remote_id: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_vendas
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, last_error=NULL, next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id],
        )?;
        Ok(())
    })
}

pub fn outbox_vendas_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn
            .query_row(
                "SELECT attempts FROM outbox_vendas WHERE local_uuid=?1",
                params![local_uuid],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(1);
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_vendas
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_vendas
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn venda_caixa_local_uuid(owner_id: &str, venda_local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        conn.query_row(
            "SELECT caixa_local_uuid FROM vendas_local WHERE owner_id=?1 AND local_uuid=?2",
            params![owner_id, venda_local_uuid],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|row| row.flatten())
        .map_err(Into::into)
    })
}

pub fn count_unsynced_vendas_for_caixa(owner_id: &str, caixa_local_uuid: &str) -> DbResult<i64> {
    with_conn(|conn| {
        conn.query_row(
            "SELECT COUNT(*)
               FROM outbox_vendas ov
               JOIN vendas_local vl ON vl.local_uuid = ov.local_uuid
              WHERE ov.owner_id = ?1
                AND vl.owner_id = ?1
                AND vl.caixa_local_uuid = ?2
                AND ov.status IN ('pending','sending')",
            params![owner_id, caixa_local_uuid],
            |r| r.get::<_, i64>(0),
        )
        .map_err(Into::into)
    })
}

pub fn outbox_vendas_reset_errors(owner_id: &str, now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_vendas
                SET status='pending', updated_at_ms=?2,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE owner_id=?1 AND status IN ('error','pending') AND last_error IS NOT NULL",
            params![owner_id, now_ms],
        )?;
        Ok(n as i64)
    })
}

// ============================================================================
// CAIXA LOCAL (offline-first) — abertura, suprimento/sangria e fechamento
// ============================================================================
//
// Mesmo padrão das outboxes de estoque (v5/v6) e vendas (v7), em tabelas
// próprias (`caixa_local`, `caixa_movs_local`, `outbox_caixa`). Cada item
// da outbox carrega `action` ∈ {abrir, movimento, fechar} + payload, e o
// scheduler reenvia para a RPC correspondente no upstream.
//
// Idempotência:
//   * `client_uuid` (terminal) deduplica reenvios do próprio terminal antes
//     de enfileirar.
//   * `local_uuid` (servidor local) é estável e vira `_client_uuid` da RPC
//     upstream → retries cross-runs nunca duplicam.
//
// IMPORTANTE: NÃO recalculamos resumo financeiro completo localmente. O
// upstream continua sendo a fonte da verdade quando online — o caixa local
// existe primariamente para permitir operação offline.

#[derive(Debug, Deserialize)]
pub struct LocalAbrirCaixaInput {
    pub valor_inicial: f64,
    #[serde(default)]
    pub observacao: Option<String>,
    #[serde(default)]
    pub operador_id: Option<String>,
    #[serde(default)]
    pub terminal_id: Option<String>,
    #[serde(default)]
    pub client_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalAbrirCaixaResult {
    pub local_uuid: String,
    pub idempotente: bool,
    pub valor_inicial: f64,
}

pub fn abrir_caixa_local(
    owner_id: &str,
    input: LocalAbrirCaixaInput,
    now_ms: i64,
) -> DbResult<LocalAbrirCaixaResult> {
    if input.valor_inicial < 0.0 {
        return Err(DbError("valor_inicial não pode ser negativo".into()));
    }

    // Idempotência por client_uuid.
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some((local_uuid, vi)) = with_conn(|conn| {
                let row = conn
                    .query_row(
                        "SELECT local_uuid, valor_inicial
                           FROM caixa_local WHERE owner_id = ?1 AND client_uuid = ?2",
                        params![owner_id, cu],
                        |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)),
                    )
                    .optional()?;
                Ok(row)
            })? {
                return Ok(LocalAbrirCaixaResult {
                    local_uuid,
                    idempotente: true,
                    valor_inicial: vi,
                });
            }
        }
    }

    // Já existe caixa aberto neste contexto? (mesmo operador / sem operador).
    // Se sim, devolvemos como idempotente — o front vai reusar o mesmo caixa.
    let existente = with_conn(|conn| {
        let oper = input.operador_id.as_deref();
        let row = if let Some(op) = oper {
            conn.query_row(
                "SELECT local_uuid, valor_inicial FROM caixa_local
                  WHERE owner_id=?1 AND status='aberto' AND operador_id = ?2
               ORDER BY data_abertura_ms DESC LIMIT 1",
                params![owner_id, op],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)),
            )
        } else {
            conn.query_row(
                "SELECT local_uuid, valor_inicial FROM caixa_local
                  WHERE owner_id=?1 AND status='aberto' AND operador_id IS NULL
               ORDER BY data_abertura_ms DESC LIMIT 1",
                params![owner_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)),
            )
        }
        .optional()?;
        Ok(row)
    })?;
    if let Some((local_uuid, vi)) = existente {
        return Ok(LocalAbrirCaixaResult {
            local_uuid,
            idempotente: true,
            valor_inicial: vi,
        });
    }

    let local_uuid = random_uuid_v4();
    let payload_json = serde_json::json!({
        "local_uuid":    local_uuid,
        "valor_inicial": input.valor_inicial,
        "observacao":    input.observacao,
        "operador_id":   input.operador_id,
        "terminal_id":   input.terminal_id,
        "client_uuid":   input.client_uuid,
        "owner_id":      owner_id,
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO caixa_local(
                local_uuid, owner_id, client_uuid, remote_id, status, valor_inicial,
                observacao_abertura, operador_id, terminal_id,
                data_abertura_ms, created_at_ms, updated_at_ms
             ) VALUES (?1,?2,?3,NULL,'aberto',?4,?5,?6,?7,?8,?8,?8)",
            params![
                local_uuid,
                owner_id,
                input.client_uuid,
                input.valor_inicial,
                input.observacao,
                input.operador_id,
                input.terminal_id,
                now_ms,
            ],
        )?;
        tx.execute(
            "INSERT INTO outbox_caixa(
                local_uuid, owner_id, client_uuid, action, caixa_local_uuid, payload,
                status, attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,'abrir',?4,?5,'pending',0,NULL,NULL,?6,?6,NULL,NULL)",
            params![
                local_uuid,
                owner_id,
                input.client_uuid,
                local_uuid,
                payload_json,
                now_ms
            ],
        )?;
        tx.commit()?;
        Ok(LocalAbrirCaixaResult {
            local_uuid,
            idempotente: false,
            valor_inicial: input.valor_inicial,
        })
    })
}

#[derive(Debug, Deserialize)]
pub struct LocalMovimentoCaixaInput {
    /// Pode ser o local_uuid ou o remote_id do caixa. Resolvemos para o
    /// caixa_local correspondente; se o front mandou um remote_id que ainda
    /// não foi enxergado localmente, recusamos com erro claro.
    pub caixa_id: String,
    pub tipo: String, // "sangria" | "suprimento"
    pub valor: f64,
    #[serde(default)]
    pub motivo: Option<String>,
    #[serde(default)]
    pub operador_id: Option<String>,
    #[serde(default)]
    pub client_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalMovimentoCaixaResult {
    pub local_uuid: String,
    pub idempotente: bool,
    pub caixa_local_uuid: String,
    pub tipo: String,
    pub valor: f64,
}

fn resolve_caixa_local_uuid(
    conn: &Connection,
    owner_id: &str,
    caixa_id: &str,
) -> DbResult<Option<String>> {
    // Tenta direto pelo local_uuid.
    let by_local: Option<String> = conn
        .query_row(
            "SELECT local_uuid FROM caixa_local WHERE owner_id = ?1 AND local_uuid = ?2",
            params![owner_id, caixa_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    if by_local.is_some() {
        return Ok(by_local);
    }
    // Tenta por remote_id (caixa que veio do upstream em alguma sincronização
    // futura — não usado nesta etapa, mas deixa o caminho preparado).
    let by_remote: Option<String> = conn
        .query_row(
            "SELECT local_uuid FROM caixa_local WHERE owner_id = ?1 AND remote_id = ?2",
            params![owner_id, caixa_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    Ok(by_remote)
}

pub fn registrar_mov_caixa_local(
    owner_id: &str,
    input: LocalMovimentoCaixaInput,
    now_ms: i64,
) -> DbResult<LocalMovimentoCaixaResult> {
    if input.tipo != "sangria" && input.tipo != "suprimento" {
        return Err(DbError(format!(
            "tipo inválido: {} (use 'sangria' ou 'suprimento')",
            input.tipo
        )));
    }
    if input.valor <= 0.0 {
        return Err(DbError("valor deve ser maior que zero".into()));
    }

    // Idempotência por client_uuid.
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some(row) = with_conn(|conn| {
                let r = conn
                    .query_row(
                        "SELECT local_uuid, caixa_local_uuid, tipo, valor
                           FROM caixa_movs_local WHERE owner_id = ?1 AND client_uuid = ?2",
                        params![owner_id, cu],
                        |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, String>(2)?,
                                r.get::<_, f64>(3)?,
                            ))
                        },
                    )
                    .optional()?;
                Ok(r)
            })? {
                let (local_uuid, caixa_local_uuid, tipo, valor) = row;
                return Ok(LocalMovimentoCaixaResult {
                    local_uuid,
                    idempotente: true,
                    caixa_local_uuid,
                    tipo,
                    valor,
                });
            }
        }
    }

    let caixa_local_uuid =
        with_conn(|conn| resolve_caixa_local_uuid(conn, owner_id, &input.caixa_id))?.ok_or_else(
            || {
                DbError(format!(
                    "caixa não encontrado localmente: {}",
                    input.caixa_id
                ))
            },
        )?;

    // Verifica que o caixa ainda está aberto.
    let status: Option<String> = with_conn(|conn| {
        let s = conn
            .query_row(
                "SELECT status FROM caixa_local WHERE owner_id = ?1 AND local_uuid = ?2",
                params![owner_id, caixa_local_uuid],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(s)
    })?;
    if status.as_deref() != Some("aberto") {
        return Err(DbError("caixa não está aberto localmente".into()));
    }

    let local_uuid = random_uuid_v4();
    let payload_json = serde_json::json!({
        "local_uuid":       local_uuid,
        "caixa_local_uuid": caixa_local_uuid,
        "caixa_id":         input.caixa_id,
        "tipo":             input.tipo,
        "valor":            input.valor,
        "motivo":           input.motivo,
        "operador_id":      input.operador_id,
        "client_uuid":      input.client_uuid,
        "owner_id":         owner_id,
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO caixa_movs_local(
                local_uuid, owner_id, client_uuid, caixa_local_uuid, tipo, valor,
                motivo, operador_id, remote_id, created_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9)",
            params![
                local_uuid,
                owner_id,
                input.client_uuid,
                caixa_local_uuid,
                input.tipo,
                input.valor,
                input.motivo,
                input.operador_id,
                now_ms,
            ],
        )?;
        tx.execute(
            "INSERT INTO outbox_caixa(
                local_uuid, owner_id, client_uuid, action, caixa_local_uuid, payload,
                status, attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,'movimento',?4,?5,'pending',0,NULL,NULL,?6,?6,NULL,NULL)",
            params![
                local_uuid,
                owner_id,
                input.client_uuid,
                caixa_local_uuid,
                payload_json,
                now_ms,
            ],
        )?;
        tx.execute(
            "UPDATE caixa_local SET updated_at_ms=?1 WHERE owner_id=?2 AND local_uuid=?3",
            params![now_ms, owner_id, caixa_local_uuid],
        )?;
        tx.commit()?;
        Ok(LocalMovimentoCaixaResult {
            local_uuid,
            idempotente: false,
            caixa_local_uuid,
            tipo: input.tipo,
            valor: input.valor,
        })
    })
}

#[derive(Debug, Deserialize)]
pub struct LocalFecharCaixaInput {
    pub caixa_id: String,
    pub valor_informado: f64,
    #[serde(default)]
    pub observacao: Option<String>,
    #[serde(default)]
    pub client_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalFecharCaixaResult {
    pub local_uuid: String,
    pub caixa_local_uuid: String,
    pub idempotente: bool,
    pub valor_informado: f64,
}

pub fn fechar_caixa_local(
    owner_id: &str,
    input: LocalFecharCaixaInput,
    now_ms: i64,
) -> DbResult<LocalFecharCaixaResult> {
    if input.valor_informado < 0.0 {
        return Err(DbError("valor_informado não pode ser negativo".into()));
    }

    let caixa_local_uuid =
        with_conn(|conn| resolve_caixa_local_uuid(conn, owner_id, &input.caixa_id))?.ok_or_else(
            || {
                DbError(format!(
                    "caixa não encontrado localmente: {}",
                    input.caixa_id
                ))
            },
        )?;

    // Idempotência por client_uuid (no nível da outbox de fechamento).
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some(local_uuid) = with_conn(|conn| {
                let r = conn
                    .query_row(
                        "SELECT local_uuid FROM outbox_caixa
                          WHERE owner_id=?1 AND client_uuid=?2 AND action='fechar'",
                        params![owner_id, cu],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?;
                Ok(r)
            })? {
                return Ok(LocalFecharCaixaResult {
                    local_uuid,
                    caixa_local_uuid,
                    idempotente: true,
                    valor_informado: input.valor_informado,
                });
            }
        }
    }

    // Caixa precisa estar aberto.
    let status: Option<String> = with_conn(|conn| {
        let s = conn
            .query_row(
                "SELECT status FROM caixa_local WHERE owner_id = ?1 AND local_uuid = ?2",
                params![owner_id, caixa_local_uuid],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(s)
    })?;
    if status.as_deref() != Some("aberto") {
        return Err(DbError("caixa já está fechado localmente".into()));
    }

    let local_uuid = random_uuid_v4();
    let payload_json = serde_json::json!({
        "local_uuid":       local_uuid,
        "caixa_local_uuid": caixa_local_uuid,
        "caixa_id":         input.caixa_id,
        "valor_informado":  input.valor_informado,
        "observacao":       input.observacao,
        "client_uuid":      input.client_uuid,
        "owner_id":         owner_id,
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE caixa_local
                SET status='fechado',
                    valor_informado=?1,
                    observacao_fechamento=?2,
                    data_fechamento_ms=?3,
                    updated_at_ms=?3
              WHERE owner_id=?4 AND local_uuid=?5",
            params![
                input.valor_informado,
                input.observacao,
                now_ms,
                owner_id,
                caixa_local_uuid,
            ],
        )?;
        tx.execute(
            "INSERT INTO outbox_caixa(
                local_uuid, owner_id, client_uuid, action, caixa_local_uuid, payload,
                status, attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,'fechar',?4,?5,'pending',0,NULL,NULL,?6,?6,NULL,NULL)",
            params![
                local_uuid,
                owner_id,
                input.client_uuid,
                caixa_local_uuid,
                payload_json,
                now_ms,
            ],
        )?;

        tx.commit()?;
        Ok(LocalFecharCaixaResult {
            local_uuid,
            caixa_local_uuid,
            idempotente: false,
            valor_informado: input.valor_informado,
        })
    })
}

// ---------------------------------------------------------------------------
// Lançamentos financeiros locais derivados — geração e leitura
// ---------------------------------------------------------------------------
//
// Os lançamentos são DERIVADOS do estado local do caixa e das vendas locais
// associadas. Isso significa que podem ser regenerados a qualquer momento
// sem perda de informação (a fonte da verdade continua sendo
// `caixa_local`, `caixa_movs_local`, `vendas_local` e `venda_pagamentos_local`).
//
// Esta função é chamada DENTRO da transação de `fechar_caixa_local` e também
// pode ser chamada de fora (`regenerar_lancamentos_locais_caixa`) caso seja
// preciso recalcular após reabertura/sync.

fn gerar_lancamentos_locais_para_caixa(
    tx: &rusqlite::Transaction<'_>,
    caixa_local_uuid: &str,
    now_ms: i64,
) -> rusqlite::Result<()> {
    // Limpa derivados antigos deste caixa.
    tx.execute(
        "DELETE FROM lancamentos_financeiros_local WHERE caixa_local_uuid=?1",
        params![caixa_local_uuid],
    )?;

    // 1) Vendas — agregadas por forma de pagamento.
    //    Usa venda_pagamentos_local quando há linhas; cai para o
    //    cabeçalho da venda quando não há (vendas com forma única).
    let mut stmt = tx.prepare(
        "SELECT COALESCE(NULLIF(p.forma_pagamento,''), 'indefinido') AS forma,
                ROUND(SUM(p.valor),2) AS total
           FROM venda_pagamentos_local p
           JOIN vendas_local v ON v.local_uuid = p.venda_local_uuid
          WHERE v.caixa_local_uuid = ?1
            AND COALESCE(v.status,'ativa') <> 'cancelada'
          GROUP BY forma
         HAVING SUM(p.valor) <> 0",
    )?;
    let pagto_rows: Vec<(String, f64)> = stmt
        .query_map(params![caixa_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    // Fallback: vendas sem entrada em venda_pagamentos_local — usa o
    // cabeçalho (forma_pagamento + total) para não perder valor.
    let mut stmt = tx.prepare(
        "SELECT COALESCE(NULLIF(v.forma_pagamento,''), 'indefinido') AS forma,
                ROUND(SUM(v.total),2) AS total
           FROM vendas_local v
          WHERE v.caixa_local_uuid = ?1
            AND COALESCE(v.status,'ativa') <> 'cancelada'
            AND NOT EXISTS (
                SELECT 1 FROM venda_pagamentos_local p
                 WHERE p.venda_local_uuid = v.local_uuid
            )
          GROUP BY forma
         HAVING SUM(v.total) <> 0",
    )?;
    let cab_rows: Vec<(String, f64)> = stmt
        .query_map(params![caixa_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    // Agrega cabeçalho-fallback no mesmo dicionário.
    use std::collections::BTreeMap;
    let mut por_forma: BTreeMap<String, f64> = BTreeMap::new();
    for (f, v) in pagto_rows.into_iter().chain(cab_rows.into_iter()) {
        *por_forma.entry(f).or_insert(0.0) += v;
    }
    for (forma, valor) in por_forma.iter() {
        if (*valor).abs() < 0.005 {
            continue;
        }
        let lid = random_uuid_v4();
        let categoria = format!("venda_{}", forma);
        let descricao = format!("Vendas — {}", forma);
        tx.execute(
            "INSERT INTO lancamentos_financeiros_local(
                local_uuid, caixa_local_uuid, tipo, categoria, forma_pagamento,
                valor, descricao, origem, payload, created_at_ms,
                status, data_competencia_ms, data_pagamento_ms
             ) VALUES (?1,?2,'entrada',?3,?4,?5,?6,'fechamento_caixa',NULL,?7,
                       'confirmado',?7,?7)",
            params![
                lid,
                caixa_local_uuid,
                categoria,
                forma,
                valor,
                descricao,
                now_ms
            ],
        )?;
    }

    // 2) Suprimentos / sangrias — totais agregados.
    let (total_sup, total_san): (f64, f64) = tx
        .query_row(
            "SELECT
            COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN tipo='sangria'    THEN valor ELSE 0 END),0)
           FROM caixa_movs_local WHERE caixa_local_uuid=?1",
            params![caixa_local_uuid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0.0, 0.0));

    if total_sup.abs() >= 0.005 {
        let lid = random_uuid_v4();
        tx.execute(
            "INSERT INTO lancamentos_financeiros_local(
                local_uuid, caixa_local_uuid, tipo, categoria, forma_pagamento,
                valor, descricao, origem, payload, created_at_ms,
                status, data_competencia_ms, data_pagamento_ms
             ) VALUES (?1,?2,'entrada','suprimento',NULL,?3,'Suprimentos do caixa','fechamento_caixa',NULL,?4,
                       'confirmado',?4,?4)",
            params![lid, caixa_local_uuid, total_sup, now_ms],
        )?;
    }
    if total_san.abs() >= 0.005 {
        let lid = random_uuid_v4();
        tx.execute(
            "INSERT INTO lancamentos_financeiros_local(
                local_uuid, caixa_local_uuid, tipo, categoria, forma_pagamento,
                valor, descricao, origem, payload, created_at_ms,
                status, data_competencia_ms, data_pagamento_ms
             ) VALUES (?1,?2,'saida','sangria',NULL,?3,'Sangrias do caixa','fechamento_caixa',NULL,?4,
                       'confirmado',?4,?4)",
            params![lid, caixa_local_uuid, total_san, now_ms],
        )?;
    }

    Ok(())
}

/// Regenera lançamentos locais para um caixa específico, fora da transação
/// principal de fechamento. Útil para reprocessar quando vendas chegam após
/// o fechamento ter sido enfileirado, ou para debug.
pub fn regenerar_lancamentos_locais_caixa(caixa_local_uuid: &str) -> DbResult<()> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        gerar_lancamentos_locais_para_caixa(
            &tx,
            caixa_local_uuid,
            chrono::Utc::now().timestamp_millis(),
        )?;
        tx.commit()?;
        Ok(())
    })
}

#[derive(Debug, Serialize)]
pub struct LancamentoLocalRow {
    pub local_uuid: String,
    pub caixa_local_uuid: String,
    pub tipo: String,
    pub categoria: String,
    pub forma_pagamento: Option<String>,
    pub valor: f64,
    pub descricao: Option<String>,
    pub origem: String,
    pub created_at_ms: i64,
    // v11
    pub status: String,
    pub venda_local_uuid: Option<String>,
    pub cliente_id: Option<String>,
    pub fornecedor_id: Option<String>,
    pub data_competencia_ms: Option<i64>,
    pub data_vencimento_ms: Option<i64>,
    pub data_pagamento_ms: Option<i64>,
    pub operador_id: Option<String>,
    pub cancelado_em_ms: Option<i64>,
    pub cancelado_motivo: Option<String>,
    // v12 — sync com upstream
    pub remote_id: Option<String>,
    pub sync_status: String,
}

const LANC_SELECT_COLS: &str = "local_uuid, caixa_local_uuid, tipo, categoria, forma_pagamento,
        valor, descricao, origem, created_at_ms,
        COALESCE(status,'confirmado') AS status,
        venda_local_uuid, cliente_id, fornecedor_id,
        data_competencia_ms, data_vencimento_ms, data_pagamento_ms,
        operador_id, cancelado_em_ms, cancelado_motivo,
        remote_id, COALESCE(sync_status,'local_only') AS sync_status";

fn map_lanc_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<LancamentoLocalRow> {
    Ok(LancamentoLocalRow {
        local_uuid: r.get(0)?,
        caixa_local_uuid: r.get(1)?,
        tipo: r.get(2)?,
        categoria: r.get(3)?,
        forma_pagamento: r.get(4)?,
        valor: r.get(5)?,
        descricao: r.get(6)?,
        origem: r.get(7)?,
        created_at_ms: r.get(8)?,
        status: r.get(9)?,
        venda_local_uuid: r.get(10)?,
        cliente_id: r.get(11)?,
        fornecedor_id: r.get(12)?,
        data_competencia_ms: r.get(13)?,
        data_vencimento_ms: r.get(14)?,
        data_pagamento_ms: r.get(15)?,
        operador_id: r.get(16)?,
        cancelado_em_ms: r.get(17)?,
        cancelado_motivo: r.get(18)?,
        remote_id: r.get(19)?,
        sync_status: r.get(20)?,
    })
}

pub fn lancamentos_local_por_caixa(caixa_local_uuid: &str) -> DbResult<Vec<LancamentoLocalRow>> {
    with_conn(|conn| {
        let sql = format!(
            "SELECT {cols} FROM lancamentos_financeiros_local
              WHERE caixa_local_uuid=?1
           ORDER BY tipo DESC, categoria ASC, created_at_ms ASC",
            cols = LANC_SELECT_COLS
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![caixa_local_uuid], map_lanc_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

// ---------------------------------------------------------------------------
// v11 — Financeiro local: listagem geral com filtros, resumo e CRUD manual
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
pub struct FinanceiroFiltro {
    pub tipo: Option<String>, // 'entrada' | 'saida'
    pub categoria: Option<String>,
    pub origem: Option<String>, // 'fechamento_caixa' | 'manual' | ...
    pub status: Option<String>, // 'confirmado' | 'pendente' | 'cancelado'
    pub caixa_local_uuid: Option<String>,
    pub venda_local_uuid: Option<String>,
    pub desde_ms: Option<i64>,
    pub ate_ms: Option<i64>,
    pub limit: Option<i64>,
}

pub fn lancamentos_local_listar(filtro: &FinanceiroFiltro) -> DbResult<Vec<LancamentoLocalRow>> {
    with_conn(|conn| {
        let mut sql = format!(
            "SELECT {cols} FROM lancamentos_financeiros_local WHERE 1=1",
            cols = LANC_SELECT_COLS
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        macro_rules! push_str_filter {
            ($sql:ident, $args:ident, $val:expr, $tpl:expr) => {{
                if let Some(v) = $val {
                    $args.push(Box::new(v.clone()));
                    $sql.push_str(&format!($tpl, $args.len()));
                }
            }};
        }
        macro_rules! push_i64_filter {
            ($sql:ident, $args:ident, $val:expr, $tpl:expr) => {{
                if let Some(v) = $val {
                    $args.push(Box::new(v));
                    $sql.push_str(&format!($tpl, $args.len()));
                }
            }};
        }
        push_str_filter!(sql, args, &filtro.tipo, " AND tipo=?{}");
        push_str_filter!(sql, args, &filtro.categoria, " AND categoria=?{}");
        push_str_filter!(sql, args, &filtro.origem, " AND origem=?{}");
        push_str_filter!(
            sql,
            args,
            &filtro.status,
            " AND COALESCE(status,'confirmado')=?{}"
        );
        push_str_filter!(
            sql,
            args,
            &filtro.caixa_local_uuid,
            " AND caixa_local_uuid=?{}"
        );
        push_str_filter!(
            sql,
            args,
            &filtro.venda_local_uuid,
            " AND venda_local_uuid=?{}"
        );
        push_i64_filter!(
            sql,
            args,
            filtro.desde_ms,
            " AND COALESCE(data_competencia_ms,created_at_ms)>=?{}"
        );
        push_i64_filter!(
            sql,
            args,
            filtro.ate_ms,
            " AND COALESCE(data_competencia_ms,created_at_ms)<=?{}"
        );
        sql.push_str(
            " ORDER BY COALESCE(data_competencia_ms,created_at_ms) DESC, created_at_ms DESC",
        );
        let limit = filtro.limit.unwrap_or(500).clamp(1, 5000);
        sql.push_str(&format!(" LIMIT {}", limit));

        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), map_lanc_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

#[derive(Debug, Serialize, Default)]
pub struct FinanceiroResumo {
    pub total_entradas: f64,
    pub total_saidas: f64,
    pub saldo: f64,
    pub qtd_lancamentos: i64,
    pub qtd_entradas: i64,
    pub qtd_saidas: i64,
    pub por_categoria: Vec<FinanceiroResumoCat>,
    pub por_origem: Vec<FinanceiroResumoCat>,
}

#[derive(Debug, Serialize)]
pub struct FinanceiroResumoCat {
    pub chave: String,
    pub tipo: String,
    pub valor: f64,
    pub qtd: i64,
}

pub fn financeiro_resumo_local(filtro: &FinanceiroFiltro) -> DbResult<FinanceiroResumo> {
    let rows = lancamentos_local_listar(&FinanceiroFiltro {
        limit: Some(5000),
        ..clone_filtro(filtro)
    })?;
    let mut r = FinanceiroResumo::default();
    use std::collections::BTreeMap;
    let mut por_cat: BTreeMap<(String, String), (f64, i64)> = BTreeMap::new();
    let mut por_ori: BTreeMap<(String, String), (f64, i64)> = BTreeMap::new();
    for l in rows.iter() {
        if l.status == "cancelado" {
            continue;
        }
        if l.tipo == "entrada" {
            r.total_entradas += l.valor;
            r.qtd_entradas += 1;
        } else if l.tipo == "saida" {
            r.total_saidas += l.valor;
            r.qtd_saidas += 1;
        }
        r.qtd_lancamentos += 1;
        let kc = (l.categoria.clone(), l.tipo.clone());
        let e = por_cat.entry(kc).or_insert((0.0, 0));
        e.0 += l.valor;
        e.1 += 1;
        let ko = (l.origem.clone(), l.tipo.clone());
        let e = por_ori.entry(ko).or_insert((0.0, 0));
        e.0 += l.valor;
        e.1 += 1;
    }
    r.saldo = r.total_entradas - r.total_saidas;
    r.por_categoria = por_cat
        .into_iter()
        .map(|((chave, tipo), (valor, qtd))| FinanceiroResumoCat {
            chave,
            tipo,
            valor,
            qtd,
        })
        .collect();
    r.por_origem = por_ori
        .into_iter()
        .map(|((chave, tipo), (valor, qtd))| FinanceiroResumoCat {
            chave,
            tipo,
            valor,
            qtd,
        })
        .collect();
    Ok(r)
}

fn clone_filtro(f: &FinanceiroFiltro) -> FinanceiroFiltro {
    FinanceiroFiltro {
        tipo: f.tipo.clone(),
        categoria: f.categoria.clone(),
        origem: f.origem.clone(),
        status: f.status.clone(),
        caixa_local_uuid: f.caixa_local_uuid.clone(),
        venda_local_uuid: f.venda_local_uuid.clone(),
        desde_ms: f.desde_ms,
        ate_ms: f.ate_ms,
        limit: f.limit,
    }
}

#[derive(Debug, Deserialize)]
pub struct LancamentoManualInput {
    pub tipo: String, // 'entrada' | 'saida'
    pub categoria: String,
    pub valor: f64,
    pub forma_pagamento: Option<String>,
    pub descricao: Option<String>,
    pub status: Option<String>, // default 'confirmado'
    pub caixa_local_uuid: Option<String>,
    pub venda_local_uuid: Option<String>,
    pub cliente_id: Option<String>,
    pub fornecedor_id: Option<String>,
    pub data_competencia_ms: Option<i64>,
    pub data_vencimento_ms: Option<i64>,
    pub data_pagamento_ms: Option<i64>,
    pub operador_id: Option<String>,
    pub client_uuid: Option<String>, // idempotência
}

#[derive(Debug, Serialize)]
pub struct LancamentoManualResult {
    pub local_uuid: String,
    pub idempotente: bool,
}

pub fn lancamento_manual_inserir(
    input: &LancamentoManualInput,
) -> DbResult<LancamentoManualResult> {
    if input.tipo != "entrada" && input.tipo != "saida" {
        return Err(DbError("tipo deve ser 'entrada' ou 'saida'".into()));
    }
    if input.valor <= 0.0 {
        return Err(DbError("valor deve ser maior que zero".into()));
    }
    if input.categoria.trim().is_empty() {
        return Err(DbError("categoria é obrigatória".into()));
    }
    let now_ms = chrono::Utc::now().timestamp_millis();
    let status = input
        .status
        .clone()
        .unwrap_or_else(|| "confirmado".to_string());
    let competencia = input.data_competencia_ms.unwrap_or(now_ms);

    with_conn(|conn| {
        // Idempotência via client_uuid (UNIQUE parcial).
        if let Some(cu) = input.client_uuid.as_deref() {
            let existing: Option<String> = conn
                .query_row(
                    "SELECT local_uuid FROM lancamentos_financeiros_local WHERE client_uuid=?1",
                    params![cu],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(lu) = existing {
                return Ok(LancamentoManualResult {
                    local_uuid: lu,
                    idempotente: true,
                });
            }
        }
        let lid = random_uuid_v4();
        // caixa_local_uuid é NOT NULL na tabela original; usamos string vazia
        // quando não vinculado (lançamento manual fora de caixa).
        let caixa = input.caixa_local_uuid.clone().unwrap_or_default();

        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO lancamentos_financeiros_local(
                local_uuid, caixa_local_uuid, tipo, categoria, forma_pagamento,
                valor, descricao, origem, payload, created_at_ms,
                status, venda_local_uuid, cliente_id, fornecedor_id,
                data_competencia_ms, data_vencimento_ms, data_pagamento_ms,
                client_uuid, operador_id, sync_status
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,'manual',NULL,?8,
                       ?9,?10,?11,?12,?13,?14,?15,?16,?17,'pending')",
            params![
                lid,
                caixa,
                input.tipo,
                input.categoria,
                input.forma_pagamento,
                input.valor,
                input.descricao,
                now_ms,
                status,
                input.venda_local_uuid,
                input.cliente_id,
                input.fornecedor_id,
                competencia,
                input.data_vencimento_ms,
                input.data_pagamento_ms,
                input.client_uuid,
                input.operador_id
            ],
        )?;

        // v12 — enfileira na outbox financeira para sync com o upstream.
        // Mapeia tipo local → tipo upstream (entrada→receita, saida→despesa).
        let tipo_upstream = if input.tipo == "entrada" {
            "receita"
        } else {
            "despesa"
        };
        let date_iso = |ms: i64| {
            let dt = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
                .unwrap_or_else(|| chrono::Utc::now());
            dt.format("%Y-%m-%d").to_string()
        };
        let venc_ms = input.data_vencimento_ms.unwrap_or(competencia);
        let payload = serde_json::json!({
            "_tipo": tipo_upstream,
            "_descricao": input.descricao.clone().unwrap_or_else(|| input.categoria.clone()),
            "_valor": input.valor,
            "_data_vencimento": date_iso(venc_ms),
            "_data_emissao": date_iso(competencia),
            "_categoria_id": serde_json::Value::Null,
            "_cliente_id": input.cliente_id,
            "_fornecedor_id": input.fornecedor_id,
            "_numero_documento": serde_json::Value::Null,
            "_forma_pagamento": input.forma_pagamento,
            "_observacoes": serde_json::Value::Null,
            // _client_uuid ponta-a-ponta usa nosso local_uuid: estável e único.
            "_client_uuid": &lid,
        });
        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_financeiro(
                local_uuid, client_uuid, lanc_local_uuid, payload,
                status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,?4,'pending',0,?5,?5,NULL)",
            params![
                outbox_id,
                input.client_uuid,
                lid,
                payload.to_string(),
                now_ms
            ],
        )?;
        tx.commit()?;
        Ok(LancamentoManualResult {
            local_uuid: lid,
            idempotente: false,
        })
    })
}

pub fn lancamento_cancelar(local_uuid: &str, motivo: Option<&str>) -> DbResult<bool> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let n = conn.execute(
            "UPDATE lancamentos_financeiros_local
                SET status='cancelado', cancelado_em_ms=?1, cancelado_motivo=?2
              WHERE local_uuid=?3 AND COALESCE(status,'confirmado') <> 'cancelado'",
            params![now_ms, motivo, local_uuid],
        )?;
        Ok(n > 0)
    })
}

// ---------------------------------------------------------------------------
// Resumo local do caixa — totais derivados em tempo real
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct CaixaResumoFormaRow {
    pub forma_pagamento: String,
    pub total: f64,
    pub qtd_vendas: i64,
}

#[derive(Debug, Serialize)]
pub struct CaixaResumoLocal {
    pub caixa_local_uuid: String,
    pub remote_id: Option<String>,
    pub status: String,
    pub data_abertura_ms: i64,
    pub data_fechamento_ms: Option<i64>,
    pub operador_id: Option<String>,
    pub terminal_id: Option<String>,
    pub valor_inicial: f64,
    pub valor_informado: Option<f64>,
    /// Esperado em dinheiro = valor_inicial + entradas em dinheiro - sangrias + suprimentos.
    pub valor_esperado_dinheiro: f64,
    /// Diferença = valor_informado - valor_esperado_dinheiro (quando fechado).
    pub diferenca: Option<f64>,
    pub total_vendido: f64,
    pub qtd_vendas: i64,
    pub total_suprimentos: f64,
    pub total_sangrias: f64,
    pub por_forma: Vec<CaixaResumoFormaRow>,
}

pub fn caixa_resumo_local(
    owner_id: &str,
    caixa_local_uuid: &str,
) -> DbResult<Option<CaixaResumoLocal>> {
    with_conn(|conn| {
        // Cabeçalho do caixa.
        let cab: Option<(
            String,
            Option<String>,
            String,
            i64,
            Option<i64>,
            Option<String>,
            Option<String>,
            f64,
            Option<f64>,
        )> = conn
            .query_row(
                "SELECT local_uuid, remote_id, status, data_abertura_ms, data_fechamento_ms,
                    operador_id, terminal_id, valor_inicial, valor_informado
               FROM caixa_local WHERE owner_id=?1 AND local_uuid=?2",
                params![owner_id, caixa_local_uuid],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                    ))
                },
            )
            .optional()?;
        let Some(cab) = cab else { return Ok(None) };
        let (clu, remote_id, status, dt_ab, dt_fc, oper, term, valor_inicial, valor_informado) =
            cab;

        // Totais por forma de pagamento (pagamentos detalhados).
        let mut stmt = conn.prepare(
            "SELECT COALESCE(NULLIF(p.forma_pagamento,''),'indefinido') AS forma,
                    ROUND(SUM(p.valor),2) AS total,
                    COUNT(DISTINCT v.local_uuid) AS qtd
               FROM venda_pagamentos_local p
               JOIN vendas_local v ON v.local_uuid = p.venda_local_uuid
              WHERE v.owner_id = ?1 AND p.owner_id = ?1 AND v.caixa_local_uuid = ?2
            AND COALESCE(v.status,'ativa') <> 'cancelada'
              GROUP BY forma",
        )?;
        let mut por_forma_map: std::collections::BTreeMap<String, (f64, i64)> =
            std::collections::BTreeMap::new();
        for row in stmt.query_map(params![owner_id, caixa_local_uuid], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })? {
            let (f, t, q) = row?;
            let e = por_forma_map.entry(f).or_insert((0.0, 0));
            e.0 += t;
            e.1 += q;
        }
        drop(stmt);
        // Fallback cabeçalho.
        let mut stmt = conn.prepare(
            "SELECT COALESCE(NULLIF(v.forma_pagamento,''),'indefinido') AS forma,
                    ROUND(SUM(v.total),2) AS total,
                    COUNT(*) AS qtd
               FROM vendas_local v
              WHERE v.owner_id = ?1 AND v.caixa_local_uuid = ?2
            AND COALESCE(v.status,'ativa') <> 'cancelada'
                AND NOT EXISTS (
                    SELECT 1 FROM venda_pagamentos_local p
                     WHERE p.owner_id = ?1 AND p.venda_local_uuid = v.local_uuid
                )
              GROUP BY forma",
        )?;
        for row in stmt.query_map(params![owner_id, caixa_local_uuid], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })? {
            let (f, t, q) = row?;
            let e = por_forma_map.entry(f).or_insert((0.0, 0));
            e.0 += t;
            e.1 += q;
        }
        drop(stmt);

        let por_forma: Vec<CaixaResumoFormaRow> = por_forma_map
            .into_iter()
            .map(|(forma, (total, q))| CaixaResumoFormaRow {
                forma_pagamento: forma,
                total,
                qtd_vendas: q,
            })
            .collect();

        // Total geral + qtd vendas.
        let (total_vendido, qtd_vendas): (f64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(total),0), COUNT(*)
               FROM vendas_local WHERE owner_id = ?1 AND caixa_local_uuid = ?2
                 AND COALESCE(status,'ativa') <> 'cancelada'",
                params![owner_id, caixa_local_uuid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or((0.0, 0));

        // Suprimentos / sangrias.
        let (total_sup, total_san): (f64, f64) = conn
            .query_row(
                "SELECT
                COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN tipo='sangria'    THEN valor ELSE 0 END),0)
               FROM caixa_movs_local WHERE owner_id=?1 AND caixa_local_uuid=?2",
                params![owner_id, caixa_local_uuid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or((0.0, 0.0));

        // Esperado em dinheiro: valor_inicial + (vendas em "dinheiro") + suprimentos - sangrias.
        let total_dinheiro: f64 = por_forma
            .iter()
            .filter(|f| {
                let s = f.forma_pagamento.to_lowercase();
                s == "dinheiro" || s == "cash" || s == "money"
            })
            .map(|f| f.total)
            .sum();
        let valor_esperado_dinheiro = valor_inicial + total_dinheiro + total_sup - total_san;
        let diferenca = valor_informado.map(|v| {
            let d = v - valor_esperado_dinheiro;
            (d * 100.0).round() / 100.0
        });

        Ok(Some(CaixaResumoLocal {
            caixa_local_uuid: clu,
            remote_id,
            status,
            data_abertura_ms: dt_ab,
            data_fechamento_ms: dt_fc,
            operador_id: oper,
            terminal_id: term,
            valor_inicial,
            valor_informado,
            valor_esperado_dinheiro: (valor_esperado_dinheiro * 100.0).round() / 100.0,
            diferenca,
            total_vendido: (total_vendido * 100.0).round() / 100.0,
            qtd_vendas,
            total_suprimentos: (total_sup * 100.0).round() / 100.0,
            total_sangrias: (total_san * 100.0).round() / 100.0,
            por_forma,
        }))
    })
}

/// Resolve um identificador (local_uuid OU remote_id) de caixa para o
/// `local_uuid` interno. Útil para os handlers HTTP aceitarem qualquer um.
pub fn resolve_caixa_id_publico(owner_id: &str, any_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| resolve_caixa_local_uuid(conn, owner_id, any_id))
}

// ---------------------------------------------------------------------------
// Estado local do caixa — leitura simples para a UI / handlers
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct CaixaLocalRow {
    pub local_uuid: String,
    pub remote_id: Option<String>,
    pub client_uuid: Option<String>,
    pub status: String,
    pub valor_inicial: f64,
    pub valor_informado: Option<f64>,
    pub valor_esperado: Option<f64>,
    pub diferenca: Option<f64>,
    pub observacao_abertura: Option<String>,
    pub observacao_fechamento: Option<String>,
    pub operador_id: Option<String>,
    pub terminal_id: Option<String>,
    pub data_abertura_ms: i64,
    pub data_fechamento_ms: Option<i64>,
    pub qtd_movimentos: i64,
    pub total_suprimentos: f64,
    pub total_sangrias: f64,
}

pub fn caixa_local_aberto(
    owner_id: &str,
    operador_id: Option<&str>,
) -> DbResult<Option<CaixaLocalRow>> {
    with_conn(|conn| {
        let row_opt: Option<(
            String,
            Option<String>,
            Option<String>,
            String,
            f64,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            i64,
            Option<i64>,
        )> = if let Some(op) = operador_id {
            conn.query_row(
                "SELECT local_uuid, remote_id, client_uuid, status, valor_inicial,
                        valor_informado, valor_esperado, diferenca,
                        observacao_abertura, observacao_fechamento,
                        operador_id, terminal_id,
                        data_abertura_ms, data_fechamento_ms
                   FROM caixa_local
                  WHERE owner_id=?1 AND status='aberto' AND operador_id = ?2
               ORDER BY data_abertura_ms DESC LIMIT 1",
                params![owner_id, op],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                        r.get(11)?,
                        r.get(12)?,
                        r.get(13)?,
                    ))
                },
            )
            .optional()?
        } else {
            conn.query_row(
                "SELECT local_uuid, remote_id, client_uuid, status, valor_inicial,
                        valor_informado, valor_esperado, diferenca,
                        observacao_abertura, observacao_fechamento,
                        operador_id, terminal_id,
                        data_abertura_ms, data_fechamento_ms
                   FROM caixa_local
                  WHERE owner_id=?1 AND status='aberto'
               ORDER BY data_abertura_ms DESC LIMIT 1",
                params![owner_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                        r.get(11)?,
                        r.get(12)?,
                        r.get(13)?,
                    ))
                },
            )
            .optional()?
        };
        let Some(row) = row_opt else { return Ok(None) };
        let (
            local_uuid,
            remote_id,
            client_uuid,
            status,
            valor_inicial,
            valor_informado,
            valor_esperado,
            diferenca,
            obs_ab,
            obs_fc,
            oper,
            term,
            dt_ab,
            dt_fc,
        ) = row;
        let (qtd, sup, san): (i64, f64, f64) = conn
            .query_row(
                "SELECT
                COUNT(*),
                COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN tipo='sangria' THEN valor ELSE 0 END),0)
               FROM caixa_movs_local WHERE owner_id=?1 AND caixa_local_uuid=?2",
                params![owner_id, local_uuid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap_or((0, 0.0, 0.0));
        Ok(Some(CaixaLocalRow {
            local_uuid,
            remote_id,
            client_uuid,
            status,
            valor_inicial,
            valor_informado,
            valor_esperado,
            diferenca,
            observacao_abertura: obs_ab,
            observacao_fechamento: obs_fc,
            operador_id: oper,
            terminal_id: term,
            data_abertura_ms: dt_ab,
            data_fechamento_ms: dt_fc,
            qtd_movimentos: qtd,
            total_suprimentos: sup,
            total_sangrias: san,
        }))
    })
}

#[derive(Debug, Serialize)]
pub struct CaixaMovimentoLocalRow {
    pub local_uuid: String,
    pub caixa_local_uuid: String,
    pub tipo: String,
    pub valor: f64,
    pub motivo: Option<String>,
    pub operador_id: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
}

pub fn caixa_local_historico(owner_id: &str, limit: Option<i64>) -> DbResult<Vec<CaixaLocalRow>> {
    with_conn(|conn| {
        let sql = if limit.is_some() {
            "SELECT c.local_uuid, c.remote_id, c.client_uuid, c.status, c.valor_inicial,
                    c.valor_informado, c.valor_esperado, c.diferenca,
                    c.observacao_abertura, c.observacao_fechamento,
                    c.operador_id, c.terminal_id,
                    c.data_abertura_ms, c.data_fechamento_ms,
                    COALESCE(m.qtd,0),
                    COALESCE(m.total_suprimentos,0),
                    COALESCE(m.total_sangrias,0)
               FROM caixa_local c
               LEFT JOIN (
                    SELECT caixa_local_uuid,
                           COUNT(*) AS qtd,
                           COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0) AS total_suprimentos,
                           COALESCE(SUM(CASE WHEN tipo='sangria' THEN valor ELSE 0 END),0) AS total_sangrias
                      FROM caixa_movs_local
                     WHERE owner_id=?1
                     GROUP BY caixa_local_uuid
               ) m ON m.caixa_local_uuid = c.local_uuid
              WHERE c.owner_id=?1
              ORDER BY c.data_abertura_ms DESC
              LIMIT ?2"
        } else {
            "SELECT c.local_uuid, c.remote_id, c.client_uuid, c.status, c.valor_inicial,
                    c.valor_informado, c.valor_esperado, c.diferenca,
                    c.observacao_abertura, c.observacao_fechamento,
                    c.operador_id, c.terminal_id,
                    c.data_abertura_ms, c.data_fechamento_ms,
                    COALESCE(m.qtd,0),
                    COALESCE(m.total_suprimentos,0),
                    COALESCE(m.total_sangrias,0)
               FROM caixa_local c
               LEFT JOIN (
                    SELECT caixa_local_uuid,
                           COUNT(*) AS qtd,
                           COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0) AS total_suprimentos,
                           COALESCE(SUM(CASE WHEN tipo='sangria' THEN valor ELSE 0 END),0) AS total_sangrias
                      FROM caixa_movs_local
                     WHERE owner_id=?1
                     GROUP BY caixa_local_uuid
               ) m ON m.caixa_local_uuid = c.local_uuid
              WHERE c.owner_id=?1
              ORDER BY c.data_abertura_ms DESC"
        };

        let mut stmt = conn.prepare(sql)?;

        fn map_caixa_local_row(r: &rusqlite::Row) -> rusqlite::Result<CaixaLocalRow> {
            Ok(CaixaLocalRow {
                local_uuid: r.get(0)?,
                remote_id: r.get(1)?,
                client_uuid: r.get(2)?,
                status: r.get(3)?,
                valor_inicial: r.get(4)?,
                valor_informado: r.get(5)?,
                valor_esperado: r.get(6)?,
                diferenca: r.get(7)?,
                observacao_abertura: r.get(8)?,
                observacao_fechamento: r.get(9)?,
                operador_id: r.get(10)?,
                terminal_id: r.get(11)?,
                data_abertura_ms: r.get(12)?,
                data_fechamento_ms: r.get(13)?,
                qtd_movimentos: r.get(14)?,
                total_suprimentos: r.get(15)?,
                total_sangrias: r.get(16)?,
            })
        }

        let rows = if let Some(limit) = limit {
            stmt.query_map(params![owner_id, limit], map_caixa_local_row)?
        } else {
            stmt.query_map(params![owner_id], map_caixa_local_row)?
        };

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    })
}

pub fn caixa_movimentos_local(
    owner_id: &str,
    caixa_local_uuid: &str,
) -> DbResult<Vec<CaixaMovimentoLocalRow>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT local_uuid, caixa_local_uuid, tipo, valor, motivo, operador_id, remote_id, created_at_ms
               FROM caixa_movs_local
              WHERE owner_id = ?1 AND caixa_local_uuid = ?2
           ORDER BY created_at_ms ASC",
        )?;
        let rows = stmt.query_map(params![owner_id, caixa_local_uuid], |r| {
            Ok(CaixaMovimentoLocalRow {
                local_uuid: r.get(0)?,
                caixa_local_uuid: r.get(1)?,
                tipo: r.get(2)?,
                valor: r.get(3)?,
                motivo: r.get(4)?,
                operador_id: r.get(5)?,
                remote_id: r.get(6)?,
                created_at_ms: r.get(7)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    })
}

// ---------------------------------------------------------------------------
// Outbox de caixa — stats / list / status (espelha vendas/estoque)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Default)]
pub struct OutboxCaixaStats {
    pub pending: i64,
    pub sending: i64,
    pub sent: i64,
    pub error: i64,
    pub last_sent_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub due_now: i64,
    pub next_attempt_at_ms: Option<i64>,
    pub last_auto_flush_ms: Option<i64>,
    pub last_auto_flush_sent_ms: Option<i64>,
    pub last_auto_attempted: Option<i64>,
    pub last_auto_sent: Option<i64>,
    pub last_auto_failed: Option<i64>,
    pub last_manual_flush_ms: Option<i64>,
    /// Quebra por action — ajuda a UI mostrar "1 abertura pendente, 2 sangrias".
    pub pending_abrir: i64,
    pub pending_movimento: i64,
    pub pending_fechar: i64,
}

pub fn outbox_caixa_stats(owner_id: &str) -> DbResult<OutboxCaixaStats> {
    with_conn(|conn| {
        let mut s = OutboxCaixaStats::default();
        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM outbox_caixa WHERE owner_id=?1 GROUP BY status",
        )?;
        let rows = stmt.query_map(params![owner_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (st, n) = r?;
            match st.as_str() {
                "pending" => s.pending = n,
                "sending" => s.sending = n,
                "sent" => s.sent = n,
                "error" => s.error = n,
                _ => {}
            }
        }
        let mut stmt = conn.prepare(
            "SELECT action, COUNT(*) FROM outbox_caixa
                       WHERE owner_id=?1 AND status='pending' GROUP BY action",
        )?;
        let rows = stmt.query_map(params![owner_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (act, n) = r?;
            match act.as_str() {
                "abrir" => s.pending_abrir = n,
                "movimento" => s.pending_movimento = n,
                "fechar" => s.pending_fechar = n,
                _ => {}
            }
        }
        s.last_sent_at_ms = conn
            .query_row(
                "SELECT MAX(sent_at_ms) FROM outbox_caixa WHERE owner_id=?1 AND status='sent'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_error = conn
            .query_row(
                "SELECT last_error FROM outbox_caixa
              WHERE owner_id=?1 AND status='error' ORDER BY updated_at_ms DESC LIMIT 1",
                params![owner_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn
            .query_row(
                "SELECT COUNT(*) FROM outbox_caixa
              WHERE owner_id=?1 AND status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?2",
                params![owner_id, now],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        s.next_attempt_at_ms = conn
            .query_row(
                "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_caixa WHERE owner_id=?1 AND status='pending'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_caixa_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_caixa_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_caixa_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_caixa_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_caixa_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_caixa_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_caixa_record_flush_round(
    kind: &str,
    now_ms: i64,
    attempted: i64,
    sent: i64,
    failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_caixa_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_caixa_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_caixa_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_caixa_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_caixa_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_caixa_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

#[derive(Debug, Serialize)]
pub struct OutboxCaixaItem {
    pub local_uuid: String,
    pub owner_id: Option<String>,
    pub client_uuid: Option<String>,
    pub action: String,
    pub caixa_local_uuid: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

fn map_caixa_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxCaixaItem> {
    Ok(OutboxCaixaItem {
        local_uuid: r.get(0)?,
        owner_id: r.get(1)?,
        client_uuid: r.get(2)?,
        action: r.get(3)?,
        caixa_local_uuid: r.get(4)?,
        payload: r.get(5)?,
        status: r.get(6)?,
        attempts: r.get(7)?,
        last_error: r.get(8)?,
        remote_id: r.get(9)?,
        created_at_ms: r.get(10)?,
        updated_at_ms: r.get(11)?,
        sent_at_ms: r.get(12)?,
    })
}

pub fn outbox_caixa_list(
    owner_id: &str,
    limit: i64,
    only_status: Option<&str>,
) -> DbResult<Vec<OutboxCaixaItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let mut stmt = conn.prepare(
                "SELECT local_uuid, owner_id, client_uuid, action, caixa_local_uuid, payload,
                        status, attempts, last_error, remote_id,
                        created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_caixa WHERE owner_id = ?1 AND status = ?2
                  ORDER BY created_at_ms DESC LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![owner_id, st, limit], map_caixa_item)?;
            for r in rows {
                out.push(r?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT local_uuid, owner_id, client_uuid, action, caixa_local_uuid, payload,
                        status, attempts, last_error, remote_id,
                        created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_caixa WHERE owner_id = ?1 ORDER BY created_at_ms DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![owner_id, limit], map_caixa_item)?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    })
}

/// Próximo lote elegível ao scheduler — ordenado por created_at e respeitando
/// o backoff. Para preservar a ordem causal (abrir → movimento → fechar) de um
/// MESMO caixa, o scheduler envia em série e só prossegue para o próximo
/// item do MESMO caixa quando o anterior terminou.
pub fn outbox_caixa_pending_batch(owner_id: &str, limit: i64) -> DbResult<Vec<OutboxCaixaItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT local_uuid, owner_id, client_uuid, action, caixa_local_uuid, payload,
                    status, attempts, last_error, remote_id,
                    created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_caixa
              WHERE owner_id=?1 AND status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?2
              ORDER BY created_at_ms ASC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![owner_id, now, limit], map_caixa_item)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn outbox_caixa_pending_batch_all(
    owner_id: &str,
    limit: i64,
) -> DbResult<Vec<OutboxCaixaItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut stmt = conn.prepare(
            "SELECT local_uuid, owner_id, client_uuid, action, caixa_local_uuid, payload,
                    status, attempts, last_error, remote_id,
                    created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_caixa WHERE owner_id=?1 AND status='pending'
              ORDER BY created_at_ms ASC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![owner_id, limit], map_caixa_item)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn outbox_caixa_get(local_uuid: &str) -> DbResult<Option<OutboxCaixaItem>> {
    with_conn(|conn| {
        let r = conn
            .query_row(
                "SELECT local_uuid, owner_id, client_uuid, action, caixa_local_uuid, payload,
                    status, attempts, last_error, remote_id,
                    created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_caixa WHERE local_uuid=?1",
                params![local_uuid],
                map_caixa_item,
            )
            .optional()?;
        Ok(r)
    })
}

pub fn outbox_vendas_archive_error(
    owner_id: &str,
    local_uuid: &str,
    motivo: Option<&str>,
    now_ms: i64,
) -> DbResult<bool> {
    with_conn(|conn| {
        let msg = motivo
            .map(|m| m.trim())
            .filter(|m| !m.is_empty())
            .unwrap_or("Erro antigo arquivado manualmente; venda local preservada.");
        let n = conn.execute(
            "UPDATE outbox_vendas
                SET status='archived',
                    last_error=?2,
                    updated_at_ms=?3,
                    next_attempt_at_ms=NULL
              WHERE local_uuid=?1
                AND owner_id=?4
                AND status IN ('pending','error')",
            params![local_uuid, msg, now_ms, owner_id],
        )?;
        Ok(n > 0)
    })
}

pub fn outbox_caixa_archive_error(
    owner_id: &str,
    local_uuid: &str,
    motivo: Option<&str>,
    now_ms: i64,
) -> DbResult<bool> {
    with_conn(|conn| {
        let msg = motivo
            .map(|m| m.trim())
            .filter(|m| !m.is_empty())
            .unwrap_or("Erro antigo arquivado manualmente; caixa local preservado.");
        let n = conn.execute(
            "UPDATE outbox_caixa
                SET status='archived',
                    last_error=?2,
                    updated_at_ms=?3,
                    next_attempt_at_ms=NULL
              WHERE local_uuid=?1
                AND owner_id=?4
                AND status='error'",
            params![local_uuid, msg, now_ms, owner_id],
        )?;
        Ok(n > 0)
    })
}

pub fn outbox_caixa_archive_local_group(
    owner_id: &str,
    caixa_local_uuid: &str,
    motivo: Option<&str>,
    now_ms: i64,
) -> DbResult<i64> {
    with_conn(|conn| {
        let msg = motivo
            .map(|m| m.trim())
            .filter(|m| !m.is_empty())
            .unwrap_or("Erro antigo arquivado manualmente; caixa local preservado.");
        let n = conn.execute(
            "UPDATE outbox_caixa
                SET status='archived',
                    last_error=?3,
                    updated_at_ms=?4,
                    next_attempt_at_ms=NULL
              WHERE owner_id=?1
                AND caixa_local_uuid=?2
                AND status IN ('pending','error')",
            params![owner_id, caixa_local_uuid, msg, now_ms],
        )?;
        Ok(n as i64)
    })
}

pub fn caixa_remote_id(owner_id: &str, caixa_local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        conn.query_row(
            "SELECT remote_id FROM caixa_local WHERE owner_id=?1 AND local_uuid=?2",
            params![owner_id, caixa_local_uuid],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|row| row.flatten())
        .map_err(Into::into)
    })
}

pub fn outbox_caixa_item_for_action(
    owner_id: &str,
    caixa_local_uuid: &str,
    action: &str,
) -> DbResult<Option<OutboxCaixaItem>> {
    with_conn(|conn| {
        conn.query_row(
            "SELECT local_uuid, owner_id, client_uuid, action, caixa_local_uuid, payload,
                    status, attempts, last_error, remote_id,
                    created_at_ms, updated_at_ms, sent_at_ms
              FROM outbox_caixa
              WHERE owner_id=?1 AND caixa_local_uuid=?2 AND action=?3
                AND status NOT IN ('archived','skipped')
           ORDER BY created_at_ms ASC
              LIMIT 1",
            params![owner_id, caixa_local_uuid, action],
            map_caixa_item,
        )
        .optional()
        .map_err(Into::into)
    })
}

pub fn outbox_caixa_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_caixa
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_caixa_mark_sent(local_uuid: &str, remote_id: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        // Marca o item.
        tx.execute(
            "UPDATE outbox_caixa
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, last_error=NULL, next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id],
        )?;
        // Propaga o remote_id da abertura para a linha do caixa local — assim
        // futuras movimentações podem ser referenciadas tanto pelo local_uuid
        // quanto pelo remote_id que o front conhecer.
        let action: Option<String> = tx
            .query_row(
                "SELECT action FROM outbox_caixa WHERE local_uuid=?1",
                params![local_uuid],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        if action.as_deref() == Some("abrir") {
            tx.execute(
                "UPDATE caixa_local SET remote_id=?1, updated_at_ms=?2
                  WHERE local_uuid=?3 AND (remote_id IS NULL OR remote_id='')",
                params![remote_id, now_ms, local_uuid],
            )?;
        } else if action.as_deref() == Some("movimento") {
            tx.execute(
                "UPDATE caixa_movs_local SET remote_id=?1
                  WHERE local_uuid=?2 AND (remote_id IS NULL OR remote_id='')",
                params![remote_id, local_uuid],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_caixa_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn
            .query_row(
                "SELECT attempts FROM outbox_caixa WHERE local_uuid=?1",
                params![local_uuid],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(1);
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_caixa
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_caixa
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_caixa_reset_errors(owner_id: &str, now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_caixa
                SET status='pending', updated_at_ms=?2,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE owner_id=?1 AND status IN ('error','pending') AND last_error IS NOT NULL",
            params![owner_id, now_ms],
        )?;
        Ok(n as i64)
    })
}

// ============================================================================
// CANCELAMENTO LOCAL DE VENDA — v10
// ============================================================================
//
// Política:
//   * Idempotente: se a venda já está 'cancelada' localmente, devolve o
//     resultado anterior (idempotente=true) — duplo clique não cria estorno
//     duplo, nem enfileira segundo cancelamento.
//   * Recusa: vendas com status diferente de 'ativa' (i.e. já canceladas)
//     são rejeitadas explicitamente fora do caminho idempotente.
//   * Transacional: numa única transação SQLite:
//       1. UPDATE vendas_local SET status='cancelada' + metadados.
//       2. Para cada item da venda → INSERT em estoque_movimentacoes_local
//          como 'devolucao' + apply_mov_to_saldo (estorno do saldo materializado).
//       3. Regenera lancamentos_financeiros_local do caixa associado (se
//          houver), refletindo a remoção da venda dos totais.
//       4. Enfileira em outbox_cancelamentos_venda (cliente da RPC
//          `cancelar_venda` na nuvem).
//   * Sync:
//       - Se a venda original ainda NÃO foi sincronizada (sem remote_id),
//         o item de cancelamento fica pending até o `push_one_outbox_venda`
//         marcar a venda como `sent` — a partir daí o scheduler de
//         cancelamentos consegue resolver o `_venda_id` upstream.
//       - O `local_uuid` do cancelamento vira o `_client_uuid` da RPC
//         `cancelar_venda` no upstream → idempotência cross-runs.
//   * Estoque: cada item gera UMA movimentação de devolução com id
//     determinístico `<venda_local_uuid>-c<idx>` para evitar duplicidade
//     em retries (INSERT OR IGNORE).

#[derive(Debug, Deserialize)]
pub struct LocalCancelarVendaInput {
    pub venda_local_uuid: String,
    #[serde(default)]
    pub motivo: Option<String>,
    #[serde(default)]
    pub operador_id: Option<String>,
    #[serde(default)]
    pub client_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalCancelarVendaResult {
    pub venda_local_uuid: String,
    pub cancelamento_local_uuid: String,
    pub idempotente: bool,
    pub qtd_itens_estornados: i64,
    pub qtd_total_estornada: f64,
    pub caixa_local_uuid: Option<String>,
    pub outbox_status: String,
}

pub fn cancelar_venda_local(
    owner_id: &str,
    input: LocalCancelarVendaInput,
    now_ms: i64,
) -> DbResult<LocalCancelarVendaResult> {
    if input.venda_local_uuid.is_empty() {
        return Err(DbError("venda_local_uuid obrigatório".into()));
    }

    // Resolve venda. Aceita tanto local_uuid quanto client_uuid (sincronizado
    // ou não) — facilita o frontend que pode ter qualquer um dos dois.
    let venda_row: Option<(String, String, Option<String>, Option<String>)> = with_conn(|conn| {
        let r = conn
            .query_row(
                "SELECT local_uuid, COALESCE(status,'ativa'), caixa_local_uuid,
                    cancelamento_local_uuid
               FROM vendas_local
              WHERE owner_id = ?1 AND (local_uuid = ?2 OR client_uuid = ?2)
              LIMIT 1",
                params![owner_id, input.venda_local_uuid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        Ok(r)
    })?;
    let (venda_uuid, status_atual, caixa_local_uuid, prev_canc) = venda_row.ok_or_else(|| {
        DbError(format!(
            "venda local não encontrada: {}",
            input.venda_local_uuid
        ))
    })?;

    // Idempotente: já cancelada → devolve resumo anterior.
    if status_atual == "cancelada" {
        let canc_uuid = prev_canc.unwrap_or_default();
        let (qtd_itens, qtd_total) = with_conn(|conn| {
            let r = conn
                .query_row(
                    "SELECT COUNT(*), COALESCE(SUM(quantidade),0)
                   FROM venda_itens_local WHERE owner_id = ?1 AND venda_local_uuid = ?2",
                    params![owner_id, venda_uuid],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)),
                )
                .optional()?;
            Ok(r.unwrap_or((0, 0.0)))
        })?;
        return Ok(LocalCancelarVendaResult {
            venda_local_uuid: venda_uuid,
            cancelamento_local_uuid: canc_uuid,
            idempotente: true,
            qtd_itens_estornados: qtd_itens,
            qtd_total_estornada: qtd_total,
            caixa_local_uuid,
            outbox_status: "already".into(),
        });
    }

    // Idempotência por client_uuid (mesmo cancelamento reentregue).
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some(local_uuid) = with_conn(|conn| {
                let r = conn
                    .query_row(
                        "SELECT local_uuid FROM outbox_cancelamentos_venda
                       WHERE owner_id = ?1 AND client_uuid = ?2",
                        params![owner_id, cu],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?;
                Ok(r)
            })? {
                let (qtd_itens, qtd_total) = with_conn(|conn| {
                    let r = conn
                        .query_row(
                            "SELECT COUNT(*), COALESCE(SUM(quantidade),0)
                           FROM venda_itens_local WHERE owner_id = ?1 AND venda_local_uuid = ?2",
                            params![owner_id, venda_uuid],
                            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)),
                        )
                        .optional()?;
                    Ok(r.unwrap_or((0, 0.0)))
                })?;
                return Ok(LocalCancelarVendaResult {
                    venda_local_uuid: venda_uuid,
                    cancelamento_local_uuid: local_uuid,
                    idempotente: true,
                    qtd_itens_estornados: qtd_itens,
                    qtd_total_estornada: qtd_total,
                    caixa_local_uuid,
                    outbox_status: "already".into(),
                });
            }
        }
    }

    // Lê venda_remote_id (se já sincronizada) — vai no payload de outbox.
    let venda_remote_id: Option<String> = with_conn(|conn| {
        let r = conn
            .query_row(
                "SELECT remote_id FROM outbox_vendas WHERE owner_id = ?1 AND local_uuid = ?2",
                params![owner_id, venda_uuid],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?;
        Ok(r.flatten())
    })?;

    let cancelamento_local_uuid = random_uuid_v4();

    let payload_json = serde_json::json!({
        "local_uuid":        cancelamento_local_uuid,
        "venda_local_uuid":  venda_uuid,
        "venda_remote_id":   venda_remote_id,
        "motivo":            input.motivo,
        "operador_id":       input.operador_id,
        "client_uuid":       input.client_uuid,
        "owner_id":          owner_id,
    })
    .to_string();

    let res = with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        // 1) Marca venda como cancelada localmente.
        tx.execute(
            "UPDATE vendas_local
                SET status='cancelada',
                    cancelado_em_ms=?1,
                    cancelado_motivo=?2,
                    cancelado_operador_id=?3,
                    cancelado_client_uuid=?4,
                    cancelamento_local_uuid=?5,
                    updated_at_ms=?1
              WHERE owner_id=?6 AND local_uuid=?7",
            params![
                now_ms,
                input.motivo,
                input.operador_id,
                input.client_uuid,
                cancelamento_local_uuid,
                owner_id,
                venda_uuid,
            ],
        )?;

        // 2) Estorno de estoque — 1 movimentação 'devolucao' por item.
        let mut stmt = tx.prepare(
            "SELECT produto_id, quantidade
               FROM venda_itens_local
              WHERE owner_id = ?1 AND venda_local_uuid = ?2
              ORDER BY id ASC",
        )?;
        let itens: Vec<(String, f64)> = stmt
            .query_map(params![owner_id, venda_uuid], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        drop(stmt);

        let mut qtd_itens: i64 = 0;
        let mut qtd_total: f64 = 0.0;
        for (idx, (produto_id, quantidade)) in itens.iter().enumerate() {
            let mov_id = format!("{}-c{}", venda_uuid, idx);
            let variacao_id = String::new();
            let saldo_anterior = read_saldo_atual(&tx, owner_id, produto_id, &variacao_id)?;
            let saldo_posterior = saldo_anterior + *quantidade;
            let mov_payload = serde_json::json!({
                "id": mov_id,
                "produto_id": produto_id,
                "tipo": "devolucao",
                "quantidade": quantidade,
                "saldo_anterior": saldo_anterior,
                "saldo_posterior": saldo_posterior,
                "origem": "cancelamento_venda",
                "venda_local_uuid": venda_uuid,
                "data_movimentacao": iso_from_ms_z_pub(now_ms),
                "_pending": true,
                "owner_id": owner_id,
            })
            .to_string();
            tx.execute(
                "INSERT OR IGNORE INTO estoque_movimentacoes_local(
                    id, owner_id, produto_id, variacao_id, tipo, quantidade,
                    saldo_anterior, saldo_posterior, custo_unitario,
                    origem, observacoes, data_movimentacao_ms,
                    payload, synced_at_ms
                 ) VALUES (?1,?2,?3,?4,'devolucao',?5,?6,?7,NULL,'cancelamento_venda',
                           NULL,?8,?9,?8)",
                params![
                    mov_id,
                    owner_id,
                    produto_id,
                    variacao_id,
                    quantidade,
                    saldo_anterior,
                    saldo_posterior,
                    now_ms,
                    mov_payload,
                ],
            )?;
            apply_mov_to_saldo(
                &tx,
                owner_id,
                produto_id,
                &variacao_id,
                Some("devolucao"),
                *quantidade,
                now_ms,
            )?;
            qtd_itens += 1;
            qtd_total += *quantidade;
        }

        // 3) Regenera lançamentos derivados do caixa associado (se houver).
        //    A query já filtra vendas canceladas — basta reexecutar.
        if let Some(clu) = caixa_local_uuid.as_deref() {
            gerar_lancamentos_locais_para_caixa(&tx, clu, now_ms)?;
        }

        // 4) Enfileira na outbox de cancelamentos.
        tx.execute(
            "INSERT INTO outbox_cancelamentos_venda(
                local_uuid, owner_id, client_uuid, venda_local_uuid, venda_remote_id,
                motivo, operador_id, payload, status, attempts,
                last_error, remote_response,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending',0,NULL,NULL,?9,?9,NULL,NULL)",
            params![
                cancelamento_local_uuid,
                owner_id,
                input.client_uuid,
                venda_uuid,
                venda_remote_id,
                input.motivo,
                input.operador_id,
                payload_json,
                now_ms,
            ],
        )?;

        tx.commit()?;
        Ok((qtd_itens, qtd_total))
    })?;

    Ok(LocalCancelarVendaResult {
        venda_local_uuid: venda_uuid,
        cancelamento_local_uuid,
        idempotente: false,
        qtd_itens_estornados: res.0,
        qtd_total_estornada: res.1,
        caixa_local_uuid,
        outbox_status: "pending".into(),
    })
}

// ----------------- Outbox de cancelamentos: stats / list / status -----------------

#[derive(Debug, Serialize, Default)]
pub struct OutboxCancelStats {
    pub pending: i64,
    pub sending: i64,
    pub sent: i64,
    pub error: i64,
    pub last_sent_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub due_now: i64,
    pub next_attempt_at_ms: Option<i64>,
    /// Cancelamentos esperando a venda original ser sincronizada antes de poder
    /// ir ao upstream (depende da ordem causal venda → cancelamento).
    pub waiting_venda_sync: i64,
}

pub fn outbox_cancel_stats(owner_id: &str) -> DbResult<OutboxCancelStats> {
    with_conn(|conn| {
        let mut s = OutboxCancelStats::default();
        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM outbox_cancelamentos_venda WHERE owner_id=?1 GROUP BY status",
        )?;
        for r in stmt.query_map(params![owner_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })? {
            let (st, n) = r?;
            match st.as_str() {
                "pending" => s.pending = n,
                "sending" => s.sending = n,
                "sent" => s.sent = n,
                "error" => s.error = n,
                _ => {}
            }
        }
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_cancelamentos_venda WHERE owner_id=?1 AND status='sent'",
            params![owner_id], |r| r.get::<_, Option<i64>>(0),
        ).unwrap_or(None);
        s.last_error = conn
            .query_row(
                "SELECT last_error FROM outbox_cancelamentos_venda
              WHERE owner_id=?1 AND status='error' ORDER BY updated_at_ms DESC LIMIT 1",
                params![owner_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .unwrap_or(None);
        s.due_now = conn
            .query_row(
                "SELECT COUNT(*) FROM outbox_cancelamentos_venda
              WHERE owner_id=?1
                AND status='pending'
                AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms <= ?2)",
                params![owner_id, chrono::Utc::now().timestamp_millis()],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0);
        s.next_attempt_at_ms = conn
            .query_row(
                "SELECT MIN(next_attempt_at_ms) FROM outbox_cancelamentos_venda
              WHERE owner_id=?1 AND status='pending'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .unwrap_or(None);
        // Cancelamentos pendentes cuja venda ainda não foi sincronizada.
        s.waiting_venda_sync = conn
            .query_row(
                "SELECT COUNT(*)
               FROM outbox_cancelamentos_venda c
              WHERE c.status='pending'
                AND c.owner_id=?1
                AND (c.venda_remote_id IS NULL OR c.venda_remote_id = '')
                AND NOT EXISTS (
                    SELECT 1 FROM outbox_vendas v
                     WHERE v.local_uuid = c.venda_local_uuid
                       AND v.owner_id = c.owner_id
                       AND v.status='sent'
                       AND v.remote_id IS NOT NULL
                )",
                params![owner_id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0);
        Ok(s)
    })
}

#[derive(Debug, Serialize)]
pub struct OutboxCancelItem {
    pub local_uuid: String,
    pub owner_id: Option<String>,
    pub client_uuid: Option<String>,
    pub venda_local_uuid: String,
    pub venda_remote_id: Option<String>,
    pub motivo: Option<String>,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
    pub next_attempt_at_ms: Option<i64>,
}

fn map_cancel_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxCancelItem> {
    Ok(OutboxCancelItem {
        local_uuid: r.get(0)?,
        owner_id: r.get(1)?,
        client_uuid: r.get(2)?,
        venda_local_uuid: r.get(3)?,
        venda_remote_id: r.get(4)?,
        motivo: r.get(5)?,
        status: r.get(6)?,
        attempts: r.get(7)?,
        last_error: r.get(8)?,
        created_at_ms: r.get(9)?,
        updated_at_ms: r.get(10)?,
        sent_at_ms: r.get(11)?,
        next_attempt_at_ms: r.get(12)?,
    })
}

pub fn outbox_cancel_list(
    owner_id: &str,
    limit: i64,
    only_status: Option<&str>,
) -> DbResult<Vec<OutboxCancelItem>> {
    with_conn(|conn| {
        let (sql, has_status) = match only_status {
            Some(_) => (
                "SELECT local_uuid, owner_id, client_uuid, venda_local_uuid, venda_remote_id,
                        motivo, status, attempts, last_error,
                        created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
                   FROM outbox_cancelamentos_venda
                  WHERE owner_id = ?1 AND status = ?2
               ORDER BY created_at_ms DESC LIMIT ?3",
                true,
            ),
            None => (
                "SELECT local_uuid, owner_id, client_uuid, venda_local_uuid, venda_remote_id,
                        motivo, status, attempts, last_error,
                        created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
                   FROM outbox_cancelamentos_venda
                  WHERE owner_id = ?1
               ORDER BY created_at_ms DESC LIMIT ?2",
                false,
            ),
        };
        let mut stmt = conn.prepare(sql)?;
        let mut out = Vec::new();
        if has_status {
            let st = only_status.unwrap();
            for r in stmt.query_map(params![owner_id, st, limit], map_cancel_item)? {
                out.push(r?);
            }
        } else {
            for r in stmt.query_map(params![owner_id, limit], map_cancel_item)? {
                out.push(r?);
            }
        }
        Ok(out)
    })
}

pub fn outbox_cancel_pending_batch(owner_id: &str, limit: i64) -> DbResult<Vec<OutboxCancelItem>> {
    with_conn(|conn| {
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT local_uuid, owner_id, client_uuid, venda_local_uuid, venda_remote_id,
                    motivo, status, attempts, last_error,
                    created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
               FROM outbox_cancelamentos_venda
              WHERE owner_id=?1 AND status='pending'
                AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms <= ?2)
           ORDER BY created_at_ms ASC LIMIT ?3",
        )?;
        let mut out = Vec::new();
        for r in stmt.query_map(params![owner_id, now, limit], map_cancel_item)? {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn outbox_cancel_pending_batch_all(
    owner_id: &str,
    limit: i64,
) -> DbResult<Vec<OutboxCancelItem>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT local_uuid, owner_id, client_uuid, venda_local_uuid, venda_remote_id,
                    motivo, status, attempts, last_error,
                    created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
               FROM outbox_cancelamentos_venda
              WHERE owner_id=?1 AND status='pending'
           ORDER BY created_at_ms ASC LIMIT ?2",
        )?;
        let mut out = Vec::new();
        for r in stmt.query_map(params![owner_id, limit], map_cancel_item)? {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Resolve o `venda_remote_id` para um item de cancelamento.
/// Usa o `venda_remote_id` salvo no item; cai para o remote_id corrente da
/// outbox de vendas se a venda foi sincronizada depois do enfileiramento.
/// Retorna None se a venda ainda não foi sincronizada — chamador deve
/// re-agendar o cancelamento.
pub fn cancel_resolve_venda_remote(owner_id: &str, local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let stored: Option<String> = conn.query_row(
            "SELECT venda_remote_id FROM outbox_cancelamentos_venda WHERE owner_id=?1 AND local_uuid=?2",
            params![owner_id, local_uuid],
            |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        if let Some(s) = stored {
            if !s.is_empty() {
                return Ok(Some(s));
            }
        }
        let venda_local: Option<String> = conn.query_row(
            "SELECT venda_local_uuid FROM outbox_cancelamentos_venda WHERE owner_id=?1 AND local_uuid=?2",
            params![owner_id, local_uuid],
            |r| r.get::<_, String>(0),
        ).optional()?;
        let Some(vl) = venda_local else {
            return Ok(None);
        };
        let remote: Option<String> = conn
            .query_row(
                "SELECT remote_id FROM outbox_vendas
              WHERE owner_id=?1 AND local_uuid=?2 AND status='sent'",
                params![owner_id, vl],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        // Persiste para próximas tentativas.
        if let Some(ref r) = remote {
            let _ = conn.execute(
                "UPDATE outbox_cancelamentos_venda
                    SET venda_remote_id=?1, updated_at_ms=?2
                  WHERE local_uuid=?3",
                params![r, chrono::Utc::now().timestamp_millis(), local_uuid],
            );
        }
        Ok(remote)
    })
}

pub fn outbox_cancel_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_cancelamentos_venda
                SET status='sending', attempts=attempts+1, updated_at_ms=?1
              WHERE local_uuid=?2",
            params![now_ms, local_uuid],
        )?;
        Ok(())
    })
}

pub fn outbox_cancel_mark_sent(local_uuid: &str, response_text: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_cancelamentos_venda
                SET status='sent', remote_response=?1, sent_at_ms=?2, updated_at_ms=?2,
                    last_error=NULL, next_attempt_at_ms=NULL
              WHERE local_uuid=?3",
            params![response_text, now_ms, local_uuid],
        )?;
        Ok(())
    })
}

pub fn outbox_cancel_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn
            .query_row(
                "SELECT attempts FROM outbox_cancelamentos_venda WHERE local_uuid=?1",
                params![local_uuid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let backoff = backoff_ms_for_attempts(attempts);
        // Mantém status='pending' para retry com backoff.
        conn.execute(
            "UPDATE outbox_cancelamentos_venda
                SET status='pending', last_error=?1, updated_at_ms=?2,
                    next_attempt_at_ms=?3
              WHERE local_uuid=?4",
            params![err, now_ms, now_ms + backoff, local_uuid],
        )?;
        Ok(())
    })
}

pub fn outbox_cancel_reset_errors(owner_id: &str, now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_cancelamentos_venda
                SET status='pending', updated_at_ms=?2,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE owner_id=?1 AND status IN ('error','pending') AND last_error IS NOT NULL",
            params![owner_id, now_ms],
        )?;
        Ok(n as i64)
    })
}

// ============================================================================
// v12 — Outbox financeira (lançamentos manuais → upstream)
// ============================================================================

#[derive(Debug, Serialize, Default)]
pub struct OutboxFinanceiroStats {
    pub pending: i64,
    pub sending: i64,
    pub sent: i64,
    pub error: i64,
    pub last_sent_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub due_now: i64,
    pub next_attempt_at_ms: Option<i64>,
    pub last_auto_flush_ms: Option<i64>,
    pub last_auto_flush_sent_ms: Option<i64>,
    pub last_auto_attempted: Option<i64>,
    pub last_auto_sent: Option<i64>,
    pub last_auto_failed: Option<i64>,
    pub last_manual_flush_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct OutboxFinanceiroItem {
    pub local_uuid: String,
    pub owner_id: Option<String>,
    pub client_uuid: Option<String>,
    pub lanc_local_uuid: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

fn map_fin_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxFinanceiroItem> {
    Ok(OutboxFinanceiroItem {
        local_uuid: r.get(0)?,
        owner_id: r.get(1)?,
        client_uuid: r.get(2)?,
        lanc_local_uuid: r.get(3)?,
        payload: r.get(4)?,
        status: r.get(5)?,
        attempts: r.get(6)?,
        last_error: r.get(7)?,
        remote_id: r.get(8)?,
        created_at_ms: r.get(9)?,
        updated_at_ms: r.get(10)?,
        sent_at_ms: r.get(11)?,
    })
}

const FIN_COLS: &str =
    "local_uuid, owner_id, client_uuid, lanc_local_uuid, payload, status, attempts,
     last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

pub fn outbox_financeiro_stats(owner_id: &str) -> DbResult<OutboxFinanceiroStats> {
    with_conn(|conn| {
        let mut s = OutboxFinanceiroStats::default();
        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM outbox_financeiro WHERE owner_id=?1 GROUP BY status",
        )?;
        let rows = stmt.query_map(params![owner_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (st, n) = r?;
            match st.as_str() {
                "pending" => s.pending = n,
                "sending" => s.sending = n,
                "sent" => s.sent = n,
                "error" => s.error = n,
                _ => {}
            }
        }
        s.last_sent_at_ms = conn
            .query_row(
                "SELECT MAX(sent_at_ms) FROM outbox_financeiro WHERE owner_id=?1 AND status='sent'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_error = conn
            .query_row(
                "SELECT last_error FROM outbox_financeiro
              WHERE owner_id=?1 AND status='error' ORDER BY updated_at_ms DESC LIMIT 1",
                params![owner_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn
            .query_row(
                "SELECT COUNT(*) FROM outbox_financeiro
              WHERE owner_id=?1 AND status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?2",
                params![owner_id, now],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        s.next_attempt_at_ms = conn
            .query_row(
                "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_financeiro WHERE owner_id=?1 AND status='pending'",
                params![owner_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_fin_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_fin_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_fin_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_fin_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_fin_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_fin_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_financeiro_record_flush_round(
    kind: &str,
    now_ms: i64,
    attempted: i64,
    sent: i64,
    failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_fin_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_fin_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_fin_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_fin_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_fin_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_fin_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

pub fn outbox_financeiro_list(
    owner_id: &str,
    limit: i64,
    only_status: Option<&str>,
) -> DbResult<Vec<OutboxFinanceiroItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let sql = format!(
                "SELECT {cols} FROM outbox_financeiro WHERE owner_id=?1 AND status=?2
                 ORDER BY created_at_ms DESC LIMIT ?3",
                cols = FIN_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![owner_id, st, limit], map_fin_item)?;
            for r in rows {
                out.push(r?);
            }
        } else {
            let sql = format!(
                "SELECT {cols} FROM outbox_financeiro WHERE owner_id=?1
                 ORDER BY created_at_ms DESC LIMIT ?2",
                cols = FIN_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![owner_id, limit], map_fin_item)?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    })
}

pub fn outbox_financeiro_pending_batch(
    owner_id: &str,
    limit: i64,
) -> DbResult<Vec<OutboxFinanceiroItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "SELECT {cols} FROM outbox_financeiro
              WHERE owner_id=?1 AND status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?2
              ORDER BY created_at_ms ASC LIMIT ?3",
            cols = FIN_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![owner_id, now, limit], map_fin_item)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn outbox_financeiro_pending_batch_all(
    owner_id: &str,
    limit: i64,
) -> DbResult<Vec<OutboxFinanceiroItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = format!(
            "SELECT {cols} FROM outbox_financeiro WHERE owner_id=?1 AND status='pending'
             ORDER BY created_at_ms ASC LIMIT ?2",
            cols = FIN_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![owner_id, limit], map_fin_item)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn outbox_financeiro_get(local_uuid: &str) -> DbResult<Option<OutboxFinanceiroItem>> {
    with_conn(|conn| {
        let sql = format!(
            "SELECT {cols} FROM outbox_financeiro WHERE local_uuid=?1",
            cols = FIN_COLS,
        );
        let r = conn
            .query_row(&sql, params![local_uuid], map_fin_item)
            .optional()?;
        Ok(r)
    })
}

pub fn outbox_financeiro_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_financeiro
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_financeiro_mark_sent(
    local_uuid: &str,
    remote_id: &str,
    response: &str,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE outbox_financeiro
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, remote_response=?4, last_error=NULL,
                    next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id, response],
        )?;
        // Propaga o remote_id para o lançamento local (leitura/UI).
        let lanc: Option<String> = tx
            .query_row(
                "SELECT lanc_local_uuid FROM outbox_financeiro WHERE local_uuid=?1",
                params![local_uuid],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(lu) = lanc {
            tx.execute(
                "UPDATE lancamentos_financeiros_local
                    SET remote_id=?1, sync_status='synced'
                  WHERE local_uuid=?2 AND (remote_id IS NULL OR remote_id='')",
                params![remote_id, lu],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_financeiro_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn
            .query_row(
                "SELECT attempts FROM outbox_financeiro WHERE local_uuid=?1",
                params![local_uuid],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(1);
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_financeiro
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
            // Marca o lançamento como em erro de sincronização.
            let _ = conn.execute(
                "UPDATE lancamentos_financeiros_local
                    SET sync_status='error'
                  WHERE local_uuid=(SELECT lanc_local_uuid FROM outbox_financeiro WHERE local_uuid=?1)",
                params![local_uuid],
            );
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_financeiro
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_financeiro_reset_errors(owner_id: &str, now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_financeiro
                SET status='pending', updated_at_ms=?2,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE owner_id=?1 AND status IN ('error','pending') AND last_error IS NOT NULL",
            params![owner_id, now_ms],
        )?;
        Ok(n as i64)
    })
}

#[cfg(test)]
mod legacy_owner_tests {
    use super::*;

    const OWNER: &str = "2aa0fdf8-e2e6-49cf-8ec7-9e1002ea52ae";

    fn create_domain_meta(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE domain_sync_meta(
                domain TEXT PRIMARY KEY,
                last_synced_ms INTEGER NOT NULL,
                row_count INTEGER NOT NULL DEFAULT 0,
                last_source TEXT,
                last_error TEXT,
                last_remote_cursor_ms INTEGER,
                last_strategy TEXT,
                last_delta_count INTEGER NOT NULL DEFAULT 0,
                last_attempt_ms INTEGER,
                last_synced_ok INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
    }

    #[test]
    fn adopts_old_schema_in_place_without_losing_ids_or_balance() {
        let conn = Connection::open_in_memory().unwrap();
        create_domain_meta(&conn);
        conn.execute_batch(
            "CREATE TABLE produtos_local(
                id TEXT PRIMARY KEY,
                owner_id TEXT
            );
            CREATE TABLE estoque_saldos_local(
                produto_id TEXT NOT NULL,
                variacao_id TEXT NOT NULL DEFAULT '',
                tipo TEXT,
                quantidade REAL NOT NULL,
                payload TEXT NOT NULL,
                synced_at_ms INTEGER NOT NULL,
                owner_id TEXT,
                UNIQUE(produto_id, variacao_id)
            );
            CREATE TABLE vendas_local(
                local_uuid TEXT PRIMARY KEY,
                owner_id TEXT
            );
            CREATE TABLE venda_itens_local(
                local_uuid TEXT PRIMARY KEY,
                owner_id TEXT
            );
            CREATE TABLE estoque_movimentacoes_local(
                id TEXT PRIMARY KEY,
                owner_id TEXT,
                produto_id TEXT NOT NULL,
                variacao_id TEXT NOT NULL DEFAULT '',
                tipo TEXT NOT NULL,
                quantidade REAL NOT NULL
            );
            INSERT INTO produtos_local VALUES ('produto-1', NULL);
            INSERT INTO estoque_saldos_local
                VALUES ('produto-1', '', NULL, 73, '{}', 1, NULL);
            INSERT INTO estoque_movimentacoes_local
                VALUES ('movimento-novo', '2aa0fdf8-e2e6-49cf-8ec7-9e1002ea52ae',
                        'produto-1', '', 'entrada', 10);
            INSERT INTO estoque_movimentacoes_local
                VALUES ('movimento-legacy', NULL, 'produto-1', '', 'entrada', 73);
            INSERT INTO vendas_local VALUES ('venda-uuid', NULL);
            INSERT INTO venda_itens_local VALUES ('item-uuid', NULL);",
        )
        .unwrap();

        assert!(adopt_legacy_ownerless_data_with_conn(&conn, OWNER).unwrap());
        let saldo: (String, f64) = conn
            .query_row(
                "SELECT owner_id, quantidade FROM estoque_saldos_local
                  WHERE produto_id='produto-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(saldo, (OWNER.to_string(), 83.0));
        let venda: (String, String) = conn
            .query_row("SELECT local_uuid, owner_id FROM vendas_local", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(venda, ("venda-uuid".into(), OWNER.into()));
    }

    #[test]
    fn merges_legacy_balance_when_owner_composite_key_exists() {
        let conn = Connection::open_in_memory().unwrap();
        create_domain_meta(&conn);
        conn.execute_batch(
            "CREATE TABLE estoque_saldos_local(
                owner_id TEXT NOT NULL DEFAULT '',
                produto_id TEXT NOT NULL,
                variacao_id TEXT NOT NULL DEFAULT '',
                tipo TEXT,
                quantidade REAL NOT NULL,
                payload TEXT NOT NULL,
                synced_at_ms INTEGER NOT NULL,
                PRIMARY KEY(owner_id, produto_id, variacao_id)
            );
            INSERT INTO estoque_saldos_local
                VALUES ('', 'produto-1', '', NULL, 73, '{}', 1);
            INSERT INTO estoque_saldos_local
                VALUES ('2aa0fdf8-e2e6-49cf-8ec7-9e1002ea52ae', 'produto-1', '', NULL, 10, '{}', 2);",
        )
        .unwrap();

        assert!(adopt_legacy_ownerless_data_with_conn(&conn, OWNER).unwrap());
        let saldo: f64 = conn
            .query_row(
                "SELECT quantidade FROM estoque_saldos_local
                  WHERE owner_id=?1 AND produto_id='produto-1'",
                params![OWNER],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(saldo, 83.0);
    }

    #[test]
    fn blocks_adoption_when_another_owner_is_present() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE produtos_local(id TEXT PRIMARY KEY, owner_id TEXT);
             INSERT INTO produtos_local VALUES ('legacy', NULL);
             INSERT INTO produtos_local VALUES ('other', 'outro-owner');",
        )
        .unwrap();

        let error = adopt_legacy_ownerless_data_with_conn(&conn, OWNER).unwrap_err();
        assert!(error.to_string().starts_with("LEGACY_OWNER_CONFLICT:"));
        let owner: Option<String> = conn
            .query_row(
                "SELECT owner_id FROM produtos_local WHERE id='legacy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(owner, None);
    }
}
