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

const SCHEMA_VERSION: i64 = 24;

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
            nome                 TEXT,
            nome_fantasia        TEXT,
            documento            TEXT,
            status               TEXT,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_clientes_status ON clientes_local(status);
        CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes_local(nome);
        CREATE INDEX IF NOT EXISTS idx_clientes_doc ON clientes_local(documento);

        -- v13: Fornecedores locais — mesma estrutura de clientes_local.
        -- Armazena o payload completo de cada fornecedor (FornecedorDomain),
        -- permitindo que a tela de Fornecedores funcione 100% offline depois
        -- da primeira ingestão. Filtros (status, busca) são aplicados
        -- client-side sobre a leitura local.
        CREATE TABLE IF NOT EXISTS fornecedores_local (
            id                   TEXT PRIMARY KEY,
            razao_social         TEXT,
            nome_fantasia        TEXT,
            documento            TEXT,
            status               TEXT,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_fornecedores_status ON fornecedores_local(status);
        CREATE INDEX IF NOT EXISTS idx_fornecedores_nome ON fornecedores_local(razao_social);
        CREATE INDEX IF NOT EXISTS idx_fornecedores_doc ON fornecedores_local(documento);

        -- v14: Lançamentos financeiros (cache "completo" para a tela
        -- /financeiro). Guardamos o payload já com joins que a UI consome
        -- (fornecedor, cliente, venda, compra, categoria), exatamente como
        -- vem do PostgREST. Filtros (tipo/status/período) são aplicados
        -- client-side em cima da leitura local.
        CREATE TABLE IF NOT EXISTS financeiro_lancamentos_local (
            id                   TEXT PRIMARY KEY,
            tipo                 TEXT,
            status               TEXT,
            data_vencimento_ms   INTEGER,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_fin_lancs_status ON financeiro_lancamentos_local(status);
        CREATE INDEX IF NOT EXISTS idx_fin_lancs_tipo ON financeiro_lancamentos_local(tipo);
        CREATE INDEX IF NOT EXISTS idx_fin_lancs_venc ON financeiro_lancamentos_local(data_vencimento_ms);

        -- v15: Compras locais — payload completo da listagem com fornecedor
        -- embutido (`fornecedor:fornecedores(id,razao_social,nome_fantasia)`),
        -- exatamente como o cloudAdapter.compras.list devolve. Cursor
        -- incremental por updated_at; sem tombstone (a UI já filtra
        -- canceladas via status do payload).
        CREATE TABLE IF NOT EXISTS compras_local (
            id                   TEXT PRIMARY KEY,
            numero               TEXT,
            fornecedor_id        TEXT,
            status               TEXT,
            data_emissao_ms      INTEGER,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_compras_status ON compras_local(status);
        CREATE INDEX IF NOT EXISTS idx_compras_data ON compras_local(data_emissao_ms);
        CREATE INDEX IF NOT EXISTS idx_compras_fornecedor ON compras_local(fornecedor_id);

        -- v16: Cache de leitura do histórico de vendas (NÃO confundir com
        -- `vendas_local`, que é o PDV/outbox). Aqui guardamos o payload da
        -- listagem (`vendas` + cliente embutido) para alimentar /vendas e
        -- agregações de Dashboard offline. Cursor por updated_at; ordenação
        -- por created_at_ms desc.
        CREATE TABLE IF NOT EXISTS vendas_remote_cache (
            id                   TEXT PRIMARY KEY,
            numero               TEXT,
            cliente_id           TEXT,
            status               TEXT,
            data_emissao_ms      INTEGER,
            created_at_ms        INTEGER,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_vendas_remote_status ON vendas_remote_cache(status);
        CREATE INDEX IF NOT EXISTS idx_vendas_remote_data ON vendas_remote_cache(data_emissao_ms);
        CREATE INDEX IF NOT EXISTS idx_vendas_remote_created ON vendas_remote_cache(created_at_ms);

        -- Saldos: agregados por (produto_id, variacao_id). A chave única
        -- evita duplicatas quando o snapshot é re-ingerido.
        CREATE TABLE IF NOT EXISTS estoque_saldos_local (
            produto_id     TEXT NOT NULL,
            variacao_id    TEXT NOT NULL DEFAULT '',
            tipo           TEXT,
            quantidade     REAL NOT NULL DEFAULT 0,
            payload        TEXT NOT NULL,
            synced_at_ms   INTEGER NOT NULL,
            PRIMARY KEY (produto_id, variacao_id)
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
        // v18: clientes offline-first.
        // `local_uuid` = identidade estável local (igual ao `id` quando criado
        // offline; igual ao `id` remoto quando vindo do snapshot/incremental).
        // `remote_id` = id real na nuvem (igual ao `id` quando snapshot;
        // preenchido pelo push da outbox quando criado offline).
        // `sync_status` ∈ ('synced','local_only','pending','error').
        "ALTER TABLE clientes_local ADD COLUMN local_uuid TEXT",
        "ALTER TABLE clientes_local ADD COLUMN remote_id TEXT",
        "ALTER TABLE clientes_local ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'",
        "ALTER TABLE clientes_local ADD COLUMN last_error TEXT",
        "ALTER TABLE clientes_local ADD COLUMN created_offline_at_ms INTEGER",
        // v19: fornecedores offline-first — espelha o de clientes.
        "ALTER TABLE fornecedores_local ADD COLUMN local_uuid TEXT",
        "ALTER TABLE fornecedores_local ADD COLUMN remote_id TEXT",
        "ALTER TABLE fornecedores_local ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'",
        "ALTER TABLE fornecedores_local ADD COLUMN last_error TEXT",
         "ALTER TABLE fornecedores_local ADD COLUMN created_offline_at_ms INTEGER",
        // v20: compras offline-first.
        "ALTER TABLE compras_local ADD COLUMN local_uuid TEXT",
        "ALTER TABLE compras_local ADD COLUMN remote_id TEXT",
        "ALTER TABLE compras_local ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'",
        "ALTER TABLE compras_local ADD COLUMN last_error TEXT",
        "ALTER TABLE compras_local ADD COLUMN created_offline_at_ms INTEGER",
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

    // v18: backfill — clientes vindos de snapshots têm local_uuid = id e
    // remote_id = id (já existem na nuvem). Idempotente: só preenche quando NULL.
    let _ = conn.execute(
        "UPDATE clientes_local SET local_uuid = id WHERE local_uuid IS NULL",
        [],
    );
    let _ = conn.execute(
        "UPDATE clientes_local SET remote_id = id WHERE remote_id IS NULL AND sync_status='synced'",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_clientes_local_uuid ON clientes_local(local_uuid)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_clientes_remote_id ON clientes_local(remote_id) WHERE remote_id IS NOT NULL",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_clientes_sync_status ON clientes_local(sync_status)",
        [],
    );

    // ------------------------------------------------------------------
    // v18 — Outbox de clientes (cadastro offline-first).
    //
    // Cada item carrega `action` ∈ ('criar','editar','alterar_status','excluir')
    // e `payload` (JSON do request à RPC correspondente). `cliente_local_uuid`
    // é a FK lógica para `clientes_local`. `cliente_remote_id` é resolvido em
    // tempo de envio para `editar/alterar_status/excluir` quando a criação
    // ainda estava na fila (ordem causal: criar → editar → excluir).
    //
    // Colapso (idempotência local):
    //   * `criar` + `editar(s)` ainda pendentes → o `editar` mais recente
    //     PATCHa o payload do `criar` (não envia novo item).
    //   * `criar` + `excluir` ainda pendentes → ambos removidos (no-op).
    //   * `editar` + `editar` synced → mantém o último.
    //   * `excluir` cancela qualquer `editar`/`alterar_status` pendente.
    //
    // Idempotência ponta-a-ponta:
    //   * `criar` usa `_client_uuid = local_uuid` (RPC `criar_cliente`).
    //   * Demais ações são naturalmente idempotentes pelo `_cliente_id`.
    // ------------------------------------------------------------------
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS outbox_clientes (
            local_uuid           TEXT PRIMARY KEY,
            client_uuid          TEXT,
            cliente_local_uuid   TEXT NOT NULL,
            cliente_remote_id    TEXT,
            action               TEXT NOT NULL,
            payload              TEXT NOT NULL,
            status               TEXT NOT NULL DEFAULT 'pending',
            attempts             INTEGER NOT NULL DEFAULT 0,
            last_error           TEXT,
            remote_id            TEXT,
            remote_response      TEXT,
            created_at_ms        INTEGER NOT NULL,
            updated_at_ms        INTEGER NOT NULL,
            sent_at_ms           INTEGER,
            next_attempt_at_ms   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_clientes_status
            ON outbox_clientes(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_clientes_status_next
            ON outbox_clientes(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_clientes_cli
            ON outbox_clientes(cliente_local_uuid, status);
        CREATE INDEX IF NOT EXISTS idx_outbox_clientes_action
            ON outbox_clientes(action, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_clientes_client_uuid
            ON outbox_clientes(client_uuid) WHERE client_uuid IS NOT NULL;
        "#,
    )?;
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

    // v19 — Backfill + Outbox de fornecedores. Mesmo padrão de clientes.
    let _ = conn.execute(
        "UPDATE fornecedores_local SET local_uuid = id WHERE local_uuid IS NULL",
        [],
    );
    let _ = conn.execute(
        "UPDATE fornecedores_local SET remote_id = id WHERE remote_id IS NULL AND sync_status='synced'",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fornecedores_local_uuid ON fornecedores_local(local_uuid)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fornecedores_remote_id ON fornecedores_local(remote_id) WHERE remote_id IS NOT NULL",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fornecedores_sync_status ON fornecedores_local(sync_status)",
        [],
    );
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS outbox_fornecedores (
            local_uuid             TEXT PRIMARY KEY,
            client_uuid            TEXT,
            fornecedor_local_uuid  TEXT NOT NULL,
            fornecedor_remote_id   TEXT,
            action                 TEXT NOT NULL,
            payload                TEXT NOT NULL,
            status                 TEXT NOT NULL DEFAULT 'pending',
            attempts               INTEGER NOT NULL DEFAULT 0,
            last_error             TEXT,
            remote_id              TEXT,
            remote_response        TEXT,
            created_at_ms          INTEGER NOT NULL,
            updated_at_ms          INTEGER NOT NULL,
            sent_at_ms             INTEGER,
            next_attempt_at_ms     INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_fornecedores_status
            ON outbox_fornecedores(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_fornecedores_status_next
            ON outbox_fornecedores(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_fornecedores_for
            ON outbox_fornecedores(fornecedor_local_uuid, status);
        CREATE INDEX IF NOT EXISTS idx_outbox_fornecedores_action
            ON outbox_fornecedores(action, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_fornecedores_client_uuid
            ON outbox_fornecedores(client_uuid) WHERE client_uuid IS NOT NULL;
        "#,
    )?;

    // v20 — Backfill + Outbox de compras. Mesmo padrão de clientes/fornecedores,
    // porém compras carregam itens, impacto em estoque (ao receber) e geram
    // lançamento financeiro. As ações da outbox cobrem o fluxo completo:
    //   * 'criar'           → cria a compra (cabeçalho + itens) no upstream
    //   * 'editar_metadados'→ patch nos campos editáveis (data_*, fornecedor, NF, obs)
    //   * 'alterar_status'  → muda o status (pendente, cancelada, etc.)
    //   * 'receber'         → recebe a compra inteira (gera estoque + financeiro)
    //   * 'receber_itens'   → recebe parcialmente os itens informados
    //   * 'excluir'         → exclui a compra
    //
    // Colapso (idempotência local):
    //   * editar_metadados pendente + novo editar_metadados → merge no payload
    //   * alterar_status pendente + novo alterar_status → substitui status
    //   * criar pendente + editar_metadados/alterar_status → patch no payload do criar
    //   * criar pendente + excluir → ambos removidos (no-op)
    //
    // Causalidade: editar/alterar_status/receber*/excluir só vão upstream
    // depois que o 'criar' resolver o remote_id da compra.
    let _ = conn.execute(
        "UPDATE compras_local SET local_uuid = id WHERE local_uuid IS NULL",
        [],
    );
    let _ = conn.execute(
        "UPDATE compras_local SET remote_id = id WHERE remote_id IS NULL AND sync_status='synced'",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_compras_local_uuid ON compras_local(local_uuid)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_compras_remote_id ON compras_local(remote_id) WHERE remote_id IS NOT NULL",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_compras_sync_status ON compras_local(sync_status)",
        [],
    );
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS outbox_compras (
            local_uuid          TEXT PRIMARY KEY,
            client_uuid         TEXT,
            compra_local_uuid   TEXT NOT NULL,
            compra_remote_id    TEXT,
            action              TEXT NOT NULL,
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
        CREATE INDEX IF NOT EXISTS idx_outbox_compras_status
            ON outbox_compras(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_compras_status_next
            ON outbox_compras(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_compras_for
            ON outbox_compras(compra_local_uuid, status);
        CREATE INDEX IF NOT EXISTS idx_outbox_compras_action
            ON outbox_compras(action, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_compras_client_uuid
            ON outbox_compras(client_uuid) WHERE client_uuid IS NOT NULL;

        -- v20: itens de compra locais. Espelha `compra_itens` no remoto.
        -- `local_uuid` = identidade estável local; `remote_id` resolvido após
        -- o push do criar da compra. `compra_local_uuid` é a FK lógica.
        -- `quantidade_recebida` é mantido localmente para refletir
        -- recebimentos parciais offline (derivação de estoque).
        CREATE TABLE IF NOT EXISTS compra_itens_local (
            local_uuid           TEXT PRIMARY KEY,
            remote_id            TEXT,
            compra_local_uuid    TEXT NOT NULL,
            compra_remote_id     TEXT,
            produto_id           TEXT NOT NULL,
            variacao_id          TEXT,
            descricao            TEXT,
            quantidade           REAL NOT NULL DEFAULT 0,
            quantidade_recebida  REAL NOT NULL DEFAULT 0,
            preco_unitario       REAL NOT NULL DEFAULT 0,
            desconto             REAL NOT NULL DEFAULT 0,
            total                REAL NOT NULL DEFAULT 0,
            sync_status          TEXT NOT NULL DEFAULT 'pending',
            created_at_ms        INTEGER NOT NULL,
            updated_at_ms        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_compra_itens_local_compra
            ON compra_itens_local(compra_local_uuid);
        CREATE INDEX IF NOT EXISTS idx_compra_itens_local_remote
            ON compra_itens_local(remote_id) WHERE remote_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_compra_itens_local_compra_remote
            ON compra_itens_local(compra_remote_id) WHERE compra_remote_id IS NOT NULL;
        "#,
    )?;
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

    // ------------------------------------------------------------------
    // Caches de relatórios — caixas, movimentos, funcionários e terminais.
    // Mesma filosofia de `compras_local` / `vendas_remote_cache`: payload
    // bruto do PostgREST + cursor incremental por updated_at. Usados pelas
    // telas de relatórios (caixa) sem dependência de internet.
    // ------------------------------------------------------------------
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS caixas_remote_cache (
            id                   TEXT PRIMARY KEY,
            status               TEXT,
            operador_id          TEXT,
            terminal_id          TEXT,
            data_abertura_ms     INTEGER,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_caixas_rc_abertura
            ON caixas_remote_cache(data_abertura_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_caixas_rc_status
            ON caixas_remote_cache(status);

        CREATE TABLE IF NOT EXISTS caixa_movimentos_remote_cache (
            id                   TEXT PRIMARY KEY,
            caixa_id             TEXT,
            tipo                 TEXT,
            created_at_ms        INTEGER,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_caixa_movs_rc_caixa
            ON caixa_movimentos_remote_cache(caixa_id, created_at_ms DESC);

        CREATE TABLE IF NOT EXISTS funcionarios_remote_cache (
            id                   TEXT PRIMARY KEY,
            nome                 TEXT,
            ativo                INTEGER,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_func_rc_ativo
            ON funcionarios_remote_cache(ativo);

        CREATE TABLE IF NOT EXISTS terminais_remote_cache (
            id                   TEXT PRIMARY KEY,
            nome                 TEXT,
            ativo                INTEGER,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_term_rc_ativo
            ON terminais_remote_cache(ativo);

        CREATE TABLE IF NOT EXISTS pagamentos_empresa_remote_cache (
            id                   TEXT PRIMARY KEY,
            status               TEXT,
            created_at_ms        INTEGER,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_pag_emp_rc_created
            ON pagamentos_empresa_remote_cache(created_at_ms DESC);

        CREATE TABLE IF NOT EXISTS venda_itens_remote_cache (
            id                   TEXT PRIMARY KEY,
            venda_id             TEXT,
            produto_id           TEXT,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_venda_itens_rc_venda
            ON venda_itens_remote_cache(venda_id);
        CREATE INDEX IF NOT EXISTS idx_venda_itens_rc_produto
            ON venda_itens_remote_cache(produto_id);

        -- v17 (Sub-etapa 4.1): verificador local seguro de PIN do operador.
        -- Permite validação offline pelo servidor local (LAN central) sem
        -- depender do cache JS de cada terminal.
        --
        -- IMPORTANTE: NUNCA armazenamos PIN em texto puro. Apenas o hash
        -- PBKDF2-HMAC-SHA256(salt, pin, iter), gerado localmente após
        -- validação online bem-sucedida ("aquecimento"). O hash bcrypt do
        -- banco-fonte (Postgres) NÃO é importado por segurança.
        CREATE TABLE IF NOT EXISTS operadores_offline (
            funcionario_id   TEXT PRIMARY KEY,
            empresa_id       TEXT,
            nome             TEXT NOT NULL,
            login            TEXT NOT NULL,
            role             TEXT NOT NULL,
            ativo            INTEGER NOT NULL DEFAULT 1,
            algorithm        TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
            iterations       INTEGER NOT NULL DEFAULT 80000,
            salt_b64         TEXT NOT NULL,
            hash_b64         TEXT NOT NULL,
            failed_attempts  TEXT NOT NULL DEFAULT '[]',
            locked_until_ms  INTEGER NOT NULL DEFAULT 0,
            updated_at_ms    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operadores_offline_login
            ON operadores_offline(login);

        -- ====================================================================
        -- v18 (Etapa 5 continuação): trilha de auditoria local de estoque.
        --
        -- Cada movimentação local (entrada/saída/ajuste/devolução) registra
        -- aqui uma linha de auditoria DENTRO da mesma transação SQLite que
        -- grava `estoque_movimentacoes_local` + `outbox_estoque_movs`. Se a
        -- transação falhar, nada fica gravado — inclusive a auditoria.
        --
        -- Nunca é enviada para a nuvem; é apenas histórico forense local
        -- (qual terminal/operador disparou, saldo antes/depois, origem).
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS estoque_audit_local (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms           INTEGER NOT NULL,
            local_uuid      TEXT,
            produto_id      TEXT NOT NULL,
            variacao_id     TEXT,
            tipo            TEXT NOT NULL,
            quantidade      REAL NOT NULL,
            saldo_anterior  REAL,
            saldo_posterior REAL,
            origem          TEXT,
            terminal_id     TEXT,
            operador_id     TEXT,
            sync_status     TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS idx_audit_estoque_ts
            ON estoque_audit_local(ts_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_estoque_produto
            ON estoque_audit_local(produto_id, ts_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_estoque_local_uuid
            ON estoque_audit_local(local_uuid);

        -- ====================================================================
        -- v19 (Etapa 6): trilhas locais para PDV.
        --
        --  * `vendas_audit_local`     — auditoria forense de cada venda/
        --                                cancelamento, gravada na MESMA
        --                                transação SQLite de registrar/cancelar.
        --  * `contas_receber_local`   — título local gerado quando a venda
        --                                tem forma de pagamento fiado/clientes
        --                                a receber. Espelha o que o cloud
        --                                cria após o sync; permite consulta
        --                                offline e auditoria.
        --
        -- Nenhuma das duas é enviada direto à nuvem — `outbox_vendas` já
        -- carrega tudo. Estas tabelas são leitura local + forense.
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS vendas_audit_local (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms           INTEGER NOT NULL,
            evento          TEXT NOT NULL,   -- 'criada' | 'cancelada'
            venda_local_uuid TEXT NOT NULL,
            client_uuid     TEXT,
            cliente_id      TEXT,
            operador_id     TEXT,
            terminal_id     TEXT,
            forma_pagamento TEXT,
            qtd_itens       INTEGER NOT NULL DEFAULT 0,
            total           REAL NOT NULL DEFAULT 0,
            motivo          TEXT,
            origem          TEXT,           -- 'servidor' | 'terminal'
            sync_status     TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS idx_audit_vendas_ts
            ON vendas_audit_local(ts_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_vendas_local
            ON vendas_audit_local(venda_local_uuid);
        CREATE INDEX IF NOT EXISTS idx_audit_vendas_evento
            ON vendas_audit_local(evento, ts_ms DESC);

        CREATE TABLE IF NOT EXISTS contas_receber_local (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            local_uuid        TEXT NOT NULL UNIQUE,
            venda_local_uuid  TEXT NOT NULL,
            client_uuid       TEXT,
            cliente_id        TEXT,
            cliente_nome      TEXT,
            cliente_cpf       TEXT,
            cliente_telefone  TEXT,
            forma_pagamento   TEXT,
            valor             REAL NOT NULL,
            valor_pago        REAL NOT NULL DEFAULT 0,
            vencimento_ms     INTEGER,
            status            TEXT NOT NULL DEFAULT 'aberto', -- aberto | pago | cancelado
            observacao        TEXT,
            origem            TEXT,
            sync_status       TEXT NOT NULL DEFAULT 'pending',
            created_at_ms     INTEGER NOT NULL,
            updated_at_ms     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cr_local_status
            ON contas_receber_local(status, vencimento_ms);
        CREATE INDEX IF NOT EXISTS idx_cr_local_cliente
            ON contas_receber_local(cliente_id);
        CREATE INDEX IF NOT EXISTS idx_cr_local_venda
            ON contas_receber_local(venda_local_uuid);

        -- ====================================================================
        -- v20 (Etapa 7): trilha de auditoria local do caixa.
        --
        -- Gravada DENTRO da mesma transação SQLite de abrir/movimentar/fechar
        -- o caixa, garante registro forense mesmo offline. Não vai à nuvem;
        -- apenas leitura local + relatórios de auditoria.
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS caixa_audit_local (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms             INTEGER NOT NULL,
            evento            TEXT NOT NULL,   -- 'abertura'|'suprimento'|'sangria'|'fechamento'|'autorizacao'
            caixa_local_uuid  TEXT NOT NULL,
            mov_local_uuid    TEXT,
            client_uuid       TEXT,
            operador_id       TEXT,
            terminal_id       TEXT,
            valor             REAL,
            motivo            TEXT,
            valor_informado   REAL,
            diferenca         REAL,
            origem            TEXT,            -- 'servidor'|'terminal'
            sync_status       TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS idx_audit_caixa_ts
            ON caixa_audit_local(ts_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_caixa_caixa
            ON caixa_audit_local(caixa_local_uuid, ts_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_caixa_evento
            ON caixa_audit_local(evento, ts_ms DESC);

        -- ====================================================================
        -- v21 (Etapa 8): pagamentos de contas a receber + auditoria financeira.
        --
        -- `contas_receber_pagtos_local` registra cada baixa (parcial ou total)
        -- aplicada offline a um título de `contas_receber_local`. Gravada na
        -- MESMA transação do UPDATE do título → atomicidade.
        --
        -- `financeiro_audit_local` é a trilha forense de eventos financeiros
        -- (recebimento, pagamento, cancelamento, alteração de status). Não vai
        -- à nuvem — `outbox_financeiro` já carrega o lançamento avulso quando
        -- ele existir; esta tabela é leitura local + auditoria forense.
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS contas_receber_pagtos_local (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            local_uuid          TEXT NOT NULL UNIQUE,
            client_uuid         TEXT,
            receber_local_uuid  TEXT NOT NULL,
            valor               REAL NOT NULL,
            forma_pagamento     TEXT,
            data_pagamento_ms   INTEGER NOT NULL,
            observacao          TEXT,
            operador_id         TEXT,
            terminal_id         TEXT,
            origem              TEXT,
            sync_status         TEXT NOT NULL DEFAULT 'pending',
            created_at_ms       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cr_pag_receber
            ON contas_receber_pagtos_local(receber_local_uuid, data_pagamento_ms DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_cr_pag_client_uuid
            ON contas_receber_pagtos_local(client_uuid) WHERE client_uuid IS NOT NULL;

        CREATE TABLE IF NOT EXISTS financeiro_audit_local (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms             INTEGER NOT NULL,
            evento            TEXT NOT NULL,   -- 'recebimento'|'pagamento'|'cancelamento'|'alterar_status'
            entidade          TEXT NOT NULL,   -- 'receber'|'pagar'|'lancamento'
            entidade_uuid     TEXT NOT NULL,
            mov_local_uuid    TEXT,
            client_uuid       TEXT,
            cliente_id        TEXT,
            fornecedor_id     TEXT,
            operador_id       TEXT,
            terminal_id       TEXT,
            forma_pagamento   TEXT,
            valor             REAL,
            valor_pago        REAL,
            valor_restante    REAL,
            status_anterior   TEXT,
            status_atual      TEXT,
            motivo            TEXT,
            origem            TEXT,            -- 'servidor'|'terminal'
            sync_status       TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS idx_audit_fin_ts
            ON financeiro_audit_local(ts_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_fin_entidade
            ON financeiro_audit_local(entidade, entidade_uuid, ts_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_fin_evento
            ON financeiro_audit_local(evento, ts_ms DESC);

        -- ====================================================================
        -- v22 (Etapa 9): Contas a PAGAR offline + pagamentos.
        --
        -- Espelha a estrutura de `contas_receber_local` / pagtos. Cada
        -- título em `contas_pagar_local` representa uma obrigação gerada
        -- por uma compra a prazo (ou lançada manualmente). `compra_local_uuid`
        -- é a FK lógica para `compras_local` quando origem='compra'.
        --
        -- Idempotência:
        --   * uq_contas_pagar_origem_compra → uma única conta por compra
        --     (impede duplicação em retry de recebimento ou re-execução
        --     do trigger upstream).
        --   * client_uuid em pagtos deduplica baixas reenviadas.
        --
        -- Gravada na MESMA transação SQLite da operação que a originou
        -- (receber compra) → atomicidade entre estoque + payable.
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS contas_pagar_local (
            local_uuid              TEXT PRIMARY KEY,
            client_uuid             TEXT,
            remote_id               TEXT,
            origem                  TEXT NOT NULL DEFAULT 'compra',  -- 'compra'|'manual'
            compra_local_uuid       TEXT,
            compra_remote_id        TEXT,
            fornecedor_id           TEXT,
            fornecedor_nome         TEXT,
            descricao               TEXT,
            forma_pagamento         TEXT,
            valor                   REAL NOT NULL,
            valor_pago              REAL NOT NULL DEFAULT 0,
            vencimento_ms           INTEGER,
            data_emissao_ms         INTEGER,
            status                  TEXT NOT NULL DEFAULT 'aberto',  -- aberto|pago|cancelado
            sync_status             TEXT NOT NULL DEFAULT 'pending', -- pending|synced|error
            last_error              TEXT,
            observacao              TEXT,
            operador_id             TEXT,
            terminal_id             TEXT,
            created_at_ms           INTEGER NOT NULL,
            updated_at_ms           INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_contas_pagar_status
            ON contas_pagar_local(status, COALESCE(vencimento_ms, created_at_ms));
        CREATE INDEX IF NOT EXISTS idx_contas_pagar_fornecedor
            ON contas_pagar_local(fornecedor_id) WHERE fornecedor_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_contas_pagar_compra
            ON contas_pagar_local(compra_local_uuid) WHERE compra_local_uuid IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_contas_pagar_sync_status
            ON contas_pagar_local(sync_status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_pagar_client_uuid
            ON contas_pagar_local(client_uuid) WHERE client_uuid IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_pagar_origem_compra
            ON contas_pagar_local(compra_local_uuid)
            WHERE compra_local_uuid IS NOT NULL AND origem='compra';

        CREATE TABLE IF NOT EXISTS contas_pagar_pagtos_local (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            local_uuid          TEXT NOT NULL UNIQUE,
            client_uuid         TEXT,
            pagar_local_uuid    TEXT NOT NULL,
            valor               REAL NOT NULL,
            forma_pagamento     TEXT,
            data_pagamento_ms   INTEGER NOT NULL,
            observacao          TEXT,
            operador_id         TEXT,
            terminal_id         TEXT,
            origem              TEXT,
            sync_status         TEXT NOT NULL DEFAULT 'pending',
            created_at_ms       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cp_pag_pagar
            ON contas_pagar_pagtos_local(pagar_local_uuid, data_pagamento_ms DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_pag_client_uuid
            ON contas_pagar_pagtos_local(client_uuid) WHERE client_uuid IS NOT NULL;
        "#,
    )?;

    // v23 — Funcionários offline-first. Estende `funcionarios_remote_cache`
    // com colunas de identidade local/remote/sync e cria `outbox_funcionarios`
    // (mesmo padrão de outbox_fornecedores). Ações suportadas:
    //   * criar           → cria funcionário (RPC funcionario_criar)
    //   * editar          → edita campos (RPC funcionario_editar)
    //   * resetar_pin     → reseta PIN (RPC funcionario_resetar_pin)
    //   * alterar_status  → ativa/inativa (RPC funcionario_alterar_status)
    //   * excluir         → soft-delete (RPC funcionario_excluir)
    let _ = conn.execute(
        "ALTER TABLE funcionarios_remote_cache ADD COLUMN local_uuid TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE funcionarios_remote_cache ADD COLUMN remote_id TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE funcionarios_remote_cache ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE funcionarios_remote_cache ADD COLUMN last_error TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE funcionarios_remote_cache ADD COLUMN created_offline_at_ms INTEGER",
        [],
    );
    let _ = conn.execute(
        "UPDATE funcionarios_remote_cache SET local_uuid = id WHERE local_uuid IS NULL",
        [],
    );
    let _ = conn.execute(
        "UPDATE funcionarios_remote_cache SET remote_id = id WHERE remote_id IS NULL AND sync_status='synced'",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_funcionarios_local_uuid ON funcionarios_remote_cache(local_uuid)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_funcionarios_remote_id ON funcionarios_remote_cache(remote_id) WHERE remote_id IS NOT NULL",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_funcionarios_sync_status ON funcionarios_remote_cache(sync_status)",
        [],
    );
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS outbox_funcionarios (
            local_uuid             TEXT PRIMARY KEY,
            client_uuid            TEXT,
            funcionario_local_uuid TEXT NOT NULL,
            funcionario_remote_id  TEXT,
            action                 TEXT NOT NULL,
            payload                TEXT NOT NULL,
            status                 TEXT NOT NULL DEFAULT 'pending',
            attempts               INTEGER NOT NULL DEFAULT 0,
            last_error             TEXT,
            remote_id              TEXT,
            remote_response        TEXT,
            created_at_ms          INTEGER NOT NULL,
            updated_at_ms          INTEGER NOT NULL,
            sent_at_ms             INTEGER,
            next_attempt_at_ms     INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_funcionarios_status
            ON outbox_funcionarios(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_funcionarios_status_next
            ON outbox_funcionarios(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_funcionarios_func
            ON outbox_funcionarios(funcionario_local_uuid, status);
        CREATE INDEX IF NOT EXISTS idx_outbox_funcionarios_action
            ON outbox_funcionarios(action, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_funcionarios_client_uuid
            ON outbox_funcionarios(client_uuid) WHERE client_uuid IS NOT NULL;
        "#,
    )?;


    // =========================================================================
    // v24 — Produtos & Categorias de produto offline-first.
    //
    // Estende `produtos_local` com colunas de identidade/sync no mesmo padrão
    // adotado em v23 para funcionários, cria `categorias_produto_local`
    // (que ainda não existia) e duas outboxes:
    //
    //   * outbox_produtos              → ações: criar | editar | alterar_status | excluir
    //   * outbox_categorias_produto    → ações: criar | editar | alterar_status | excluir
    //
    // Identidade compartilhada: o desktop gera o UUID localmente e o reutiliza
    // como `id` no Supabase (RPCs `criar_produto` / `criar_categoria_produto`
    // agora aceitam o id vindo do cliente). Isso elimina reconciliação posterior
    // e garante que retries do worker nunca dupliquem dados.
    // =========================================================================
    let _ = conn.execute(
        "ALTER TABLE produtos_local ADD COLUMN local_uuid TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE produtos_local ADD COLUMN remote_id TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE produtos_local ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE produtos_local ADD COLUMN last_error TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE produtos_local ADD COLUMN created_offline_at_ms INTEGER",
        [],
    );
    // Linhas que vieram do snapshot anterior já têm `id` = remote id.
    let _ = conn.execute(
        "UPDATE produtos_local SET local_uuid = id WHERE local_uuid IS NULL",
        [],
    );
    let _ = conn.execute(
        "UPDATE produtos_local SET remote_id = id WHERE remote_id IS NULL AND sync_status='synced'",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_produtos_local_uuid ON produtos_local(local_uuid)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_produtos_remote_id ON produtos_local(remote_id) WHERE remote_id IS NOT NULL",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_produtos_sync_status ON produtos_local(sync_status)",
        [],
    );

    // categorias_produto_local — cache + identidade local. Não existia antes
    // (categorias eram lidas apenas via cloud). Mantém o mesmo shape genérico
    // das demais caches: `id` é o id "lógico" (= local_uuid quando criada
    // offline ou = remote_id quando proveniente do snapshot do Supabase).
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS categorias_produto_local (
            id                   TEXT PRIMARY KEY,
            nome                 TEXT,
            parent_id            TEXT,
            ativo                INTEGER NOT NULL DEFAULT 1,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER,
            local_uuid           TEXT,
            remote_id            TEXT,
            sync_status          TEXT NOT NULL DEFAULT 'synced',
            last_error           TEXT,
            created_offline_at_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_categorias_produto_local_uuid
            ON categorias_produto_local(local_uuid);
        CREATE INDEX IF NOT EXISTS idx_categorias_produto_remote_id
            ON categorias_produto_local(remote_id) WHERE remote_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_categorias_produto_sync_status
            ON categorias_produto_local(sync_status);
        CREATE INDEX IF NOT EXISTS idx_categorias_produto_nome
            ON categorias_produto_local(nome);
        CREATE INDEX IF NOT EXISTS idx_categorias_produto_parent
            ON categorias_produto_local(parent_id);

        CREATE TABLE IF NOT EXISTS outbox_produtos (
            local_uuid          TEXT PRIMARY KEY,
            client_uuid         TEXT,
            produto_local_uuid  TEXT NOT NULL,
            produto_remote_id   TEXT,
            action              TEXT NOT NULL,
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
        CREATE INDEX IF NOT EXISTS idx_outbox_produtos_status
            ON outbox_produtos(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_produtos_status_next
            ON outbox_produtos(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_produtos_prod
            ON outbox_produtos(produto_local_uuid, status);
        CREATE INDEX IF NOT EXISTS idx_outbox_produtos_action
            ON outbox_produtos(action, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_produtos_client_uuid
            ON outbox_produtos(client_uuid) WHERE client_uuid IS NOT NULL;

        CREATE TABLE IF NOT EXISTS outbox_categorias_produto (
            local_uuid           TEXT PRIMARY KEY,
            client_uuid          TEXT,
            categoria_local_uuid TEXT NOT NULL,
            categoria_remote_id  TEXT,
            action               TEXT NOT NULL,
            payload              TEXT NOT NULL,
            status               TEXT NOT NULL DEFAULT 'pending',
            attempts             INTEGER NOT NULL DEFAULT 0,
            last_error           TEXT,
            remote_id            TEXT,
            remote_response      TEXT,
            created_at_ms        INTEGER NOT NULL,
            updated_at_ms        INTEGER NOT NULL,
            sent_at_ms           INTEGER,
            next_attempt_at_ms   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_categorias_produto_status
            ON outbox_categorias_produto(status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_categorias_produto_status_next
            ON outbox_categorias_produto(status, next_attempt_at_ms);
        CREATE INDEX IF NOT EXISTS idx_outbox_categorias_produto_cat
            ON outbox_categorias_produto(categoria_local_uuid, status);
        CREATE INDEX IF NOT EXISTS idx_outbox_categorias_produto_action
            ON outbox_categorias_produto(action, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_categorias_produto_client_uuid
            ON outbox_categorias_produto(client_uuid) WHERE client_uuid IS NOT NULL;
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
    let guard = cell
        .lock()
        .map_err(|e| DbError(format!("DB lock poisoned: {e}")))?;
    f(&guard)
}

/// Versão pública de `with_conn` para módulos vizinhos (ex.: `backup`)
/// que precisam executar SQL administrativo (logs, metadados).
pub fn with_raw_conn<T>(f: impl FnOnce(&Connection) -> DbResult<T>) -> DbResult<T> {
    with_conn(f)
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

pub fn cache_put(
    domain: &str,
    key: &str,
    payload: &str,
    now_ms: i64,
    ttl_ms: i64,
) -> DbResult<()> {
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

fn parse_iso_to_ms(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
}

fn json_str<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn json_f64(v: &serde_json::Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}

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
            Some((c, s)) => DomainSyncState { last_remote_cursor_ms: c, last_strategy: s },
            None => DomainSyncState { last_remote_cursor_ms: None, last_strategy: None },
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
    pub source: &'a str,        // "upstream" | "manual"
    pub strategy: &'a str,      // "snapshot" | "incremental" | "append"
    pub delta_count: i64,
    pub max_remote_updated_ms: Option<i64>,
}

fn upsert_domain_meta(
    conn: &Connection,
    upd: DomainMetaUpdate<'_>,
) -> rusqlite::Result<()> {
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
                    id, sku, nome, status, categoria_id, categoria_nome,
                    preco_venda, estoque_atual, payload,
                    updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
                 ON CONFLICT(id) DO UPDATE SET
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
                let deleted_at_ms = if strategy == IngestStrategy::Incremental
                    && is_tombstoned_status(status)
                {
                    Some(now_ms)
                } else {
                    None::<i64>
                };
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
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
        let total: i64 =
            tx.query_row("SELECT COUNT(*) FROM produtos_local WHERE deleted_at_ms IS NULL", [], |r| r.get(0))?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain: "produtos",
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

/// Compat: chamada antiga (snapshot). Mantida para back-compat — o fluxo real
/// de sync (`proxy_with_incremental_sync`) usa diretamente `ingest_produtos`
/// com `IngestStrategy::Snapshot` quando não há cursor.
#[allow(dead_code)]
pub fn ingest_produtos_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    ingest_produtos(json_text, now_ms, IngestStrategy::Snapshot).map(|(n, _)| n)
}

pub struct ProdutosFilter<'a> {
    pub status: Option<&'a str>,
    pub categoria_id: Option<&'a str>,
    pub busca: Option<&'a str>,
}

/// Lê produtos da tabela local. Retorna o JSON-array (string) compatível
/// com o que o upstream entregaria — assim o adapter atual nem percebe
/// que veio de tabela tipada.
pub fn read_produtos(filter: ProdutosFilter<'_>) -> DbResult<String> {
    with_conn(|conn| {
        // Etapa 5 — busca priorizada (offline-first PDV):
        //   bucket 0 → match exato em SKU (códigos batidos no scanner)
        //   bucket 1 → nome exato
        //   bucket 2 → nome começa com
        //   bucket 3 → SKU começa com
        //   bucket 4 → contém em qualquer lugar
        // Sem busca: ordena alfabeticamente.
        let mut sql = String::from(
            "SELECT payload FROM produtos_local WHERE deleted_at_ms IS NULL",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = filter.status {
            sql.push_str(" AND status = ?");
            args.push(Box::new(s.to_string()));
        }
        if let Some(c) = filter.categoria_id {
            sql.push_str(" AND categoria_id = ?");
            args.push(Box::new(c.to_string()));
        }
        if let Some(b) = filter.busca.map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let lower = b.to_lowercase();
            let prefix = format!("{}%", lower);
            let pat = format!("%{}%", lower);
            sql.push_str(
                " AND (LOWER(nome) LIKE ? OR LOWER(IFNULL(sku,'')) LIKE ?)",
            );
            args.push(Box::new(pat.clone()));
            args.push(Box::new(pat.clone()));
            sql.push_str(
                " ORDER BY (CASE
                    WHEN LOWER(IFNULL(sku,'')) = ? THEN 0
                    WHEN LOWER(IFNULL(nome,'')) = ? THEN 1
                    WHEN LOWER(IFNULL(nome,'')) LIKE ? THEN 2
                    WHEN LOWER(IFNULL(sku,'')) LIKE ? THEN 3
                    ELSE 4
                  END), nome ASC",
            );
            args.push(Box::new(lower.clone()));
            args.push(Box::new(lower));
            args.push(Box::new(prefix.clone()));
            args.push(Box::new(prefix));
        } else {
            sql.push_str(" ORDER BY nome ASC");
        }

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

// ----------------------------------------------------------------------------
// Etapa 5 — Busca de produto por código de barras / PLU (PDV offline-first)
// ----------------------------------------------------------------------------

/// Resultado de uma busca offline contra `produtos_local`.
///
///   * `has_data == false`  → ainda não há produtos sincronizados localmente
///     (caller deve fazer fallback p/ cloud quando online).
///   * `has_data == true && result.is_none()` → há dados sincronizados, mas o
///     código não bate com nenhum produto (resposta autoritativa offline).
///   * `result.is_some()`   → produto encontrado.
pub struct BuscaLocalOutcome {
    pub has_data: bool,
    pub result: Option<serde_json::Value>,
}

fn produtos_has_data(conn: &Connection) -> rusqlite::Result<bool> {
    let n: i64 = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM produtos_local WHERE deleted_at_ms IS NULL)",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(n != 0)
}

fn payload_str_field(payload: &serde_json::Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn payload_f64_field(payload: &serde_json::Value, key: &str) -> f64 {
    payload
        .get(key)
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
}

fn payload_bool_field(payload: &serde_json::Value, key: &str) -> bool {
    payload
        .get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Busca produto por qualquer código (barras, QR, SKU, código interno).
/// Retorna o JSON pronto para o `ProdutoBuscaResult` da UI.
pub fn buscar_produto_por_codigo_local(codigo: &str) -> DbResult<BuscaLocalOutcome> {
    let codigo_t = codigo.trim().to_string();
    if codigo_t.is_empty() {
        return Ok(BuscaLocalOutcome { has_data: true, result: None });
    }
    with_conn(|conn| {
        let has_data = produtos_has_data(conn)?;
        if !has_data {
            return Ok(BuscaLocalOutcome { has_data: false, result: None });
        }
        let mut stmt = conn.prepare(
            "SELECT p.payload, p.id,
                    COALESCE(s.quantidade, 0) AS saldo,
                    CASE
                      WHEN json_extract(p.payload, '$.codigo_barras') = ?1 THEN 'barras'
                      WHEN json_extract(p.payload, '$.qr_code') = ?1 THEN 'qr'
                      WHEN p.sku = ?1 THEN 'sku'
                      WHEN json_extract(p.payload, '$.codigo_interno') = ?1 THEN 'interno'
                      ELSE 'sku'
                    END AS fonte
             FROM produtos_local p
             LEFT JOIN estoque_saldos_local s
                    ON s.produto_id = p.id AND s.variacao_id = ''
             WHERE p.deleted_at_ms IS NULL
               AND (
                 json_extract(p.payload, '$.codigo_barras') = ?1
                 OR json_extract(p.payload, '$.qr_code') = ?1
                 OR p.sku = ?1
                 OR json_extract(p.payload, '$.codigo_interno') = ?1
               )
             LIMIT 1",
        )?;
        let row: Option<(String, String, f64, String)> = stmt
            .query_row(params![codigo_t], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, f64>(2).unwrap_or(0.0),
                    r.get::<_, String>(3)?,
                ))
            })
            .optional()?;
        let Some((payload_str, produto_id, saldo, fonte)) = row else {
            return Ok(BuscaLocalOutcome { has_data: true, result: None });
        };
        let payload: serde_json::Value =
            serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null);
        let categoria_nome = payload
            .get("categoria")
            .and_then(|c| c.get("nome"))
            .and_then(|n| n.as_str())
            .map(|s| s.to_string());
        let result = serde_json::json!({
            "produto_id": produto_id,
            "sku": payload_str_field(&payload, "sku"),
            "nome": payload_str_field(&payload, "nome"),
            "codigo_barras": payload_str_field(&payload, "codigo_barras"),
            "qr_code": payload_str_field(&payload, "qr_code"),
            "codigo_interno": payload_str_field(&payload, "codigo_interno"),
            "tipo_identificacao_principal": payload_str_field(&payload, "tipo_identificacao_principal"),
            "preco_venda": payload_f64_field(&payload, "preco_venda"),
            "preco_custo": payload_f64_field(&payload, "preco_custo"),
            "unidade": payload_str_field(&payload, "unidade"),
            "status": payload_str_field(&payload, "status"),
            "categoria_id": payload_str_field(&payload, "categoria_id"),
            "categoria_nome": categoria_nome,
            "fonte": fonte,
            "saldo_estoque": saldo,
        });
        Ok(BuscaLocalOutcome { has_data: true, result: Some(result) })
    })
}

/// Busca produto por PLU (balança). Estratégia: tenta `plu` → `sku` →
/// `codigo_interno`. Se não bater, repete sem zeros à esquerda.
pub fn buscar_produto_por_plu_local(plu: &str) -> DbResult<BuscaLocalOutcome> {
    let plu_t = plu.trim().to_string();
    if plu_t.is_empty() {
        return Ok(BuscaLocalOutcome { has_data: true, result: None });
    }
    with_conn(|conn| {
        let has_data = produtos_has_data(conn)?;
        if !has_data {
            return Ok(BuscaLocalOutcome { has_data: false, result: None });
        }
        fn try_match(
            conn: &Connection,
            v: &str,
        ) -> rusqlite::Result<Option<(String, String)>> {
            conn.query_row(
                "SELECT payload, id
                   FROM produtos_local
                  WHERE deleted_at_ms IS NULL
                    AND (
                      json_extract(payload, '$.plu') = ?1
                      OR sku = ?1
                      OR json_extract(payload, '$.codigo_interno') = ?1
                    )
                  LIMIT 1",
                params![v],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()
        }
        let mut row = try_match(conn, &plu_t)?;
        if row.is_none() {
            let stripped = plu_t.trim_start_matches('0');
            if !stripped.is_empty() && stripped != plu_t {
                row = try_match(conn, stripped)?;
            }
        }
        let Some((payload_str, produto_id)) = row else {
            return Ok(BuscaLocalOutcome { has_data: true, result: None });
        };
        let payload: serde_json::Value =
            serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null);
        let plu_val = payload_str_field(&payload, "plu")
            .or_else(|| payload_str_field(&payload, "codigo_interno"))
            .or_else(|| payload_str_field(&payload, "sku"));
        let result = serde_json::json!({
            "produto_id": produto_id,
            "sku": payload_str_field(&payload, "sku"),
            "nome": payload_str_field(&payload, "nome"),
            "unidade": payload_str_field(&payload, "unidade"),
            "preco_venda": payload_f64_field(&payload, "preco_venda"),
            "vendido_por_peso": payload_bool_field(&payload, "vendido_por_peso"),
            "aceita_etiqueta_balanca": payload_bool_field(&payload, "aceita_etiqueta_balanca"),
            "plu": plu_val,
            "status": payload_str_field(&payload, "status"),
        });
        Ok(BuscaLocalOutcome { has_data: true, result: Some(result) })
    })
}

// ---------- Clientes lite ----------

pub fn ingest_clientes(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
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
            // Para snapshots/incremental: se já existe linha local com
            // remote_id=item.id (cliente que nasceu offline e foi sincronizado),
            // atualiza essa linha PELO local_uuid em vez de criar nova com id=R
            // (que duplicaria a entidade na UI).
            let mut stmt = tx.prepare(
                "INSERT INTO clientes_local(
                    id, nome, nome_fantasia, documento, status, payload,
                    updated_at_remote_ms, synced_at_ms, deleted_at_ms,
                    local_uuid, remote_id, sync_status, last_error, created_offline_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?1,?1,'synced',NULL,NULL)
                 ON CONFLICT(id) DO UPDATE SET
                    nome                 = excluded.nome,
                    nome_fantasia        = excluded.nome_fantasia,
                    documento            = excluded.documento,
                    status               = excluded.status,
                    payload              = excluded.payload,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, clientes_local.updated_at_remote_ms),
                    synced_at_ms         = excluded.synced_at_ms,
                    deleted_at_ms        = excluded.deleted_at_ms,
                    remote_id            = excluded.id,
                    sync_status          = CASE WHEN clientes_local.sync_status='pending' OR clientes_local.sync_status='error'
                                                THEN clientes_local.sync_status ELSE 'synced' END",
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
                let deleted_at_ms = if strategy == IngestStrategy::Incremental
                    && is_tombstoned_status(status)
                {
                    Some(now_ms)
                } else {
                    None::<i64>
                };
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());

                // Tenta resolver linha existente por remote_id (cliente que
                // nasceu offline). Se encontrada e diferente do id, atualiza
                // por local_uuid e pula o INSERT.
                let existing_lid: Option<String> = tx.query_row(
                    "SELECT local_uuid FROM clientes_local
                      WHERE remote_id=?1 AND id<>?1 LIMIT 1",
                    params![id], |r| r.get(0),
                ).optional()?;
                if let Some(lid) = existing_lid {
                    tx.execute(
                        "UPDATE clientes_local
                            SET nome=?1, nome_fantasia=?2, documento=?3, status=?4,
                                payload=?5, updated_at_remote_ms=COALESCE(?6, updated_at_remote_ms),
                                synced_at_ms=?7, deleted_at_ms=?8, remote_id=?9,
                                sync_status=CASE WHEN sync_status IN ('pending','error') THEN sync_status ELSE 'synced' END
                          WHERE local_uuid=?10",
                        params![
                            json_str(item, "nome"),
                            json_str(item, "nome_fantasia"),
                            json_str(item, "documento"),
                            status,
                            payload,
                            updated_ms,
                            now_ms,
                            deleted_at_ms,
                            id,
                            lid,
                        ],
                    )?;
                    count += 1;
                    continue;
                }

                stmt.execute(params![
                    id,
                    json_str(item, "nome"),
                    json_str(item, "nome_fantasia"),
                    json_str(item, "documento"),
                    status,
                    payload,
                    updated_ms,
                    now_ms,
                    deleted_at_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 =
            tx.query_row("SELECT COUNT(*) FROM clientes_local WHERE deleted_at_ms IS NULL", [], |r| r.get(0))?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain: "clientes_lite",
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

/// Compat: wrapper legacy — sync real usa `ingest_clientes` direto.
#[allow(dead_code)]
pub fn ingest_clientes_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    ingest_clientes(json_text, now_ms, IngestStrategy::Snapshot).map(|(n, _)| n)
}

pub fn read_clientes(status: Option<&str>) -> DbResult<String> {
    with_conn(|conn| {
        let mut sql = String::from(
            "SELECT payload, local_uuid, remote_id, sync_status, last_error
               FROM clientes_local WHERE deleted_at_ms IS NULL",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = status {
            sql.push_str(" AND status = ?");
            args.push(Box::new(s.to_string()));
        }
        sql.push_str(" ORDER BY nome ASC");
        let params_dyn: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| &**b).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_dyn.as_slice(), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut out = String::from("[");
        let mut first = true;
        for r in rows {
            let (payload, local_uuid, remote_id, sync_status, last_error) = r?;
            // Enriquecer payload com metadata local — sem reescrever quando já presente.
            let mut v: serde_json::Value = serde_json::from_str(&payload)
                .unwrap_or(serde_json::json!({}));
            if let Some(o) = v.as_object_mut() {
                if let Some(lid) = local_uuid {
                    o.entry("local_uuid").or_insert(serde_json::Value::String(lid));
                }
                if let Some(rid) = remote_id {
                    o.entry("remote_id").or_insert(serde_json::Value::String(rid));
                }
                if let Some(ss) = sync_status {
                    o.insert("sync_status".into(), serde_json::Value::String(ss));
                }
                if let Some(err) = last_error {
                    o.insert("sync_error".into(), serde_json::Value::String(err));
                }
            }
            if !first { out.push(','); }
            out.push_str(&v.to_string());
            first = false;
        }
        out.push(']');
        Ok(out)
    })
}

// ---------- Fornecedores (v13) ----------
//
// Ingestão e leitura idênticas em padrão à de clientes. Campo de nome no
// cadastro é `razao_social` (FornecedorDomain), por isso a coluna indexada
// muda — o restante segue o mesmo modelo: payload completo + cursor por
// `updated_at` + tombstone por status.

pub fn ingest_fornecedores(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_fornecedores: json inválido: {e}")))?;
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
                "INSERT INTO fornecedores_local(
                    id, razao_social, nome_fantasia, documento, status, payload,
                    updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
                 ON CONFLICT(id) DO UPDATE SET
                    razao_social         = excluded.razao_social,
                    nome_fantasia        = excluded.nome_fantasia,
                    documento            = excluded.documento,
                    status               = excluded.status,
                    payload              = excluded.payload,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, fornecedores_local.updated_at_remote_ms),
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
                let deleted_at_ms = if strategy == IngestStrategy::Incremental
                    && is_tombstoned_status(status)
                {
                    Some(now_ms)
                } else {
                    None::<i64>
                };
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    json_str(item, "razao_social"),
                    json_str(item, "nome_fantasia"),
                    json_str(item, "documento"),
                    status,
                    payload,
                    updated_ms,
                    now_ms,
                    deleted_at_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM fornecedores_local WHERE deleted_at_ms IS NULL",
            [],
            |r| r.get(0),
        )?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain: "fornecedores",
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

pub fn read_fornecedores(status: Option<&str>) -> DbResult<String> {
    with_conn(|conn| {
        let mut sql = String::from(
            "SELECT payload FROM fornecedores_local WHERE deleted_at_ms IS NULL",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = status {
            sql.push_str(" AND status = ?");
            args.push(Box::new(s.to_string()));
        }
        sql.push_str(" ORDER BY razao_social ASC");
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

// ---------- Lançamentos financeiros (cache "completo" v14) ----------
//
// Cache para a tela /financeiro: payload com joins (cliente, fornecedor,
// venda, compra, categoria) — exatamente como vem do PostgREST. Cursor
// incremental por `updated_at`; tombstone quando `status` indica
// cancelamento (cancelado/excluido).

fn parse_date_only_to_ms(s: &str) -> Option<i64> {
    if s.len() >= 10 {
        if let Ok(d) = chrono::NaiveDate::parse_from_str(&s[..10], "%Y-%m-%d") {
            if let Some(dt) = d.and_hms_opt(0, 0, 0) {
                return Some(dt.and_utc().timestamp_millis());
            }
        }
    }
    parse_iso_to_ms(s)
}

fn is_lancamento_tombstone(status: Option<&str>) -> bool {
    match status {
        None => false,
        Some(s) => {
            let s = s.to_ascii_lowercase();
            s == "cancelado" || s == "excluido" || s == "deleted" || s == "removido"
        }
    }
}

pub fn ingest_lancamentos_completo(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_lancamentos_completo: json inválido: {e}")))?;
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
                "INSERT INTO financeiro_lancamentos_local(
                    id, tipo, status, data_vencimento_ms, payload,
                    updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(id) DO UPDATE SET
                    tipo                 = excluded.tipo,
                    status               = excluded.status,
                    data_vencimento_ms   = excluded.data_vencimento_ms,
                    payload              = excluded.payload,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, financeiro_lancamentos_local.updated_at_remote_ms),
                    synced_at_ms         = excluded.synced_at_ms,
                    deleted_at_ms        = excluded.deleted_at_ms",
            )?;
            for item in items {
                let id = match json_str(item, "id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let updated_ms = json_str(item, "updated_at")
                    .and_then(parse_iso_to_ms)
                    .or_else(|| json_str(item, "created_at").and_then(parse_iso_to_ms));
                if let Some(ms) = updated_ms {
                    max_remote_ms = Some(max_remote_ms.map_or(ms, |c| c.max(ms)));
                }
                let status = json_str(item, "status");
                let deleted_at_ms = if strategy == IngestStrategy::Incremental
                    && is_lancamento_tombstone(status)
                {
                    Some(now_ms)
                } else {
                    None::<i64>
                };
                let venc_ms = json_str(item, "data_vencimento").and_then(parse_date_only_to_ms);
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    json_str(item, "tipo"),
                    status,
                    venc_ms,
                    payload,
                    updated_ms,
                    now_ms,
                    deleted_at_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM financeiro_lancamentos_local WHERE deleted_at_ms IS NULL",
            [],
            |r| r.get(0),
        )?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain: "financeiro_lancamentos_completo",
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

pub fn read_lancamentos_completo() -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM financeiro_lancamentos_local
             WHERE deleted_at_ms IS NULL
             ORDER BY data_vencimento_ms ASC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
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

/// Lê o payload JSON cru de UM lançamento financeiro do cache local
/// (`financeiro_lancamentos_local.payload`). Usado pelo endpoint
/// `/api/financeiro/lancamento-fks` (Onda 2 — item 10) para devolver
/// apenas os FKs necessários ao editor sem precisar baixar do cloud.
/// Retorna `Ok(None)` quando o id não está no cache local (ainda não
/// sincronizado) — o adapter TS então cai para cloud.
pub fn read_lancamento_payload_by_id(id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM financeiro_lancamentos_local
             WHERE id = ?1 AND deleted_at_ms IS NULL
             LIMIT 1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let p: String = row.get(0)?;
            Ok(Some(p))
        } else {
            Ok(None)
        }
    })
}

/// Onda 2 — item 6: agrega o fluxo por forma de pagamento usando
/// `venda_pagamentos_local` JOIN `vendas_local`, filtrado por
/// `created_at_ms` (aproximação local de `data_finalizacao`).
///
/// Diferenças vs. cloud (aceitas — cloud continua autoritativo via fallback):
///   - usamos `created_at_ms` (vendas_local não tem `data_finalizacao`);
///   - não aplicamos o ajuste de `financeiro_lancamentos.venda_id` para
///     ifood/fiado/outro porque o cache local não cruza esses lançamentos
///     com venda_id. Para essas formas, tratamos como aReceber quando a
///     venda não estiver paga.
///
/// Retorna a tupla (forma, recebido, a_receber) já agregada.
pub fn fluxo_por_forma_local(
    inicio_ms: i64,
    fim_ms: i64,
) -> DbResult<Vec<(String, f64, f64)>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT p.forma_pagamento,
                    COALESCE(v.status_pagamento, ''),
                    COALESCE(p.valor, 0),
                    COALESCE(p.valor_recebido, 0)
             FROM venda_pagamentos_local p
             JOIN vendas_local v ON v.local_uuid = p.venda_local_uuid
             WHERE v.created_at_ms BETWEEN ?1 AND ?2
               AND COALESCE(v.status, 'ativa') <> 'cancelada'",
        )?;
        let mut rows = stmt.query(params![inicio_ms, fim_ms])?;
        use std::collections::HashMap;
        let mut acc: HashMap<String, (f64, f64)> = HashMap::new();
        while let Some(row) = rows.next()? {
            let forma: String = row.get(0)?;
            let status_pag: String = row.get(1)?;
            let valor: f64 = row.get(2)?;
            let valor_rec: f64 = row.get(3)?;
            let (recebido, a_receber) = match status_pag.as_str() {
                "pago" => (valor, 0.0),
                "parcial" => {
                    let r = valor_rec.min(valor).max(0.0);
                    (r, (valor - r).max(0.0))
                }
                _ => (0.0, valor),
            };
            let e = acc.entry(forma).or_insert((0.0, 0.0));
            e.0 += recebido;
            e.1 += a_receber;
        }
        let mut out: Vec<(String, f64, f64)> = acc
            .into_iter()
            .map(|(k, (r, a))| (k, r, a))
            .filter(|(_, r, a)| *r > 0.0 || *a > 0.0)
            .collect();
        out.sort_by(|a, b| (b.1 + b.2).partial_cmp(&(a.1 + a.2)).unwrap_or(std::cmp::Ordering::Equal));
        Ok(out)
    })
}

// ---------- Compras (v15) ----------
//
// Cache do payload completo da listagem de compras com fornecedor embutido,
// alimentando a tela /compras 100% offline. Cursor incremental por
// `updated_at`. Não usamos tombstone — a UI já lida com `status` (pendente,
// recebida, cancelada, etc.) presente no payload.

pub fn ingest_compras(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_compras: json inválido: {e}")))?;
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
                "INSERT INTO compras_local(
                    id, numero, fornecedor_id, status, data_emissao_ms,
                    payload, updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL)
                 ON CONFLICT(id) DO UPDATE SET
                    numero               = excluded.numero,
                    fornecedor_id        = excluded.fornecedor_id,
                    status               = excluded.status,
                    data_emissao_ms      = excluded.data_emissao_ms,
                    payload              = excluded.payload,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, compras_local.updated_at_remote_ms),
                    synced_at_ms         = excluded.synced_at_ms",
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
                let data_emi_ms = json_str(item, "data_emissao").and_then(parse_date_only_to_ms);
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    json_str(item, "numero"),
                    json_str(item, "fornecedor_id"),
                    json_str(item, "status"),
                    data_emi_ms,
                    payload,
                    updated_ms,
                    now_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM compras_local WHERE deleted_at_ms IS NULL",
            [],
            |r| r.get(0),
        )?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain: "compras",
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

pub fn read_compras(limit: i64) -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM compras_local
             WHERE deleted_at_ms IS NULL
             ORDER BY data_emissao_ms DESC NULLS LAST
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| r.get::<_, String>(0))?;
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

// ---------- Vendas (cache de leitura — v16) ----------
//
// Cache do payload da listagem de vendas (com cliente embutido) que
// alimenta a tela /vendas e as agregações do Dashboard. NÃO substitui
// `vendas_local` (PDV/outbox).

pub fn ingest_vendas_remote(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_vendas_remote: json inválido: {e}")))?;
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
                "INSERT INTO vendas_remote_cache(
                    id, numero, cliente_id, status, data_emissao_ms,
                    created_at_ms, payload, updated_at_remote_ms,
                    synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL)
                 ON CONFLICT(id) DO UPDATE SET
                    numero               = excluded.numero,
                    cliente_id           = excluded.cliente_id,
                    status               = excluded.status,
                    data_emissao_ms      = excluded.data_emissao_ms,
                    created_at_ms        = excluded.created_at_ms,
                    payload              = excluded.payload,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, vendas_remote_cache.updated_at_remote_ms),
                    synced_at_ms         = excluded.synced_at_ms",
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
                let data_emi_ms = json_str(item, "data_emissao").and_then(parse_date_only_to_ms);
                let created_ms = json_str(item, "created_at").and_then(parse_iso_to_ms);
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    json_str(item, "numero"),
                    json_str(item, "cliente_id"),
                    json_str(item, "status"),
                    data_emi_ms,
                    created_ms,
                    payload,
                    updated_ms,
                    now_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM vendas_remote_cache WHERE deleted_at_ms IS NULL",
            [],
            |r| r.get(0),
        )?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain: "vendas_remote",
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

pub fn read_vendas_remote(limit: i64) -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM vendas_remote_cache
             WHERE deleted_at_ms IS NULL
             ORDER BY created_at_ms DESC NULLS LAST
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| r.get::<_, String>(0))?;
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

// ---------- Caches de relatórios: caixas / movimentos / func / term ----------

fn ingest_simple_cache(
    domain: &str,
    table: &str,
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
    map_extra: impl Fn(&serde_json::Value) -> Vec<Box<dyn rusqlite::ToSql>>,
    extra_cols: &[&str],
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest {domain}: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok((0, None)),
    };
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let mut count = 0usize;
        let mut max_remote_ms: Option<i64> = None;
        {
            let cols: Vec<&str> = std::iter::once("id")
                .chain(extra_cols.iter().copied())
                .chain(["payload", "updated_at_remote_ms", "synced_at_ms", "deleted_at_ms"])
                .collect();
            let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
            let updates: Vec<String> = cols
                .iter()
                .filter(|c| **c != "id")
                .map(|c| format!("{c} = excluded.{c}"))
                .collect();
            let sql = format!(
                "INSERT INTO {table}({}) VALUES ({}) ON CONFLICT(id) DO UPDATE SET {}",
                cols.join(","),
                placeholders.join(","),
                updates.join(",")
            );
            let mut stmt = tx.prepare(&sql)?;
            for item in items {
                let id = match json_str(item, "id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let updated_ms = json_str(item, "updated_at").and_then(parse_iso_to_ms);
                if let Some(ms) = updated_ms {
                    max_remote_ms = Some(max_remote_ms.map_or(ms, |c| c.max(ms)));
                }
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                let extras = map_extra(item);
                let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
                params_vec.push(Box::new(id));
                for v in extras {
                    params_vec.push(v);
                }
                params_vec.push(Box::new(payload));
                params_vec.push(Box::new(updated_ms));
                params_vec.push(Box::new(now_ms));
                params_vec.push(Box::new(None::<i64>));
                let refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| &**b).collect();
                stmt.execute(refs.as_slice())?;
                count += 1;
            }
        }
        let total: i64 = tx.query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE deleted_at_ms IS NULL"),
            [],
            |r| r.get(0),
        )?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain,
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

fn json_array_from_rows<I>(rows: I) -> DbResult<String>
where
    I: Iterator<Item = rusqlite::Result<String>>,
{
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
}

pub fn ingest_caixas_remote(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    ingest_simple_cache(
        "caixas_remote",
        "caixas_remote_cache",
        json_text,
        now_ms,
        strategy,
        |item| {
            vec![
                Box::new(json_str(item, "status").map(|s| s.to_string())),
                Box::new(json_str(item, "operador_id").map(|s| s.to_string())),
                Box::new(json_str(item, "terminal_id").map(|s| s.to_string())),
                Box::new(json_str(item, "data_abertura").and_then(parse_iso_to_ms)),
            ]
        },
        &["status", "operador_id", "terminal_id", "data_abertura_ms"],
    )
}

pub fn read_caixas_remote(limit: i64) -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM caixas_remote_cache
             WHERE deleted_at_ms IS NULL
             ORDER BY data_abertura_ms DESC NULLS LAST
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| r.get::<_, String>(0))?;
        json_array_from_rows(rows)
    })
}

pub fn ingest_caixa_movimentos_remote(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    ingest_simple_cache(
        "caixa_movimentos_remote",
        "caixa_movimentos_remote_cache",
        json_text,
        now_ms,
        strategy,
        |item| {
            vec![
                Box::new(json_str(item, "caixa_id").map(|s| s.to_string())),
                Box::new(json_str(item, "tipo").map(|s| s.to_string())),
                Box::new(json_str(item, "created_at").and_then(parse_iso_to_ms)),
            ]
        },
        &["caixa_id", "tipo", "created_at_ms"],
    )
}

pub fn read_caixa_movimentos_remote(caixa_id: &str) -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM caixa_movimentos_remote_cache
             WHERE deleted_at_ms IS NULL AND caixa_id = ?1
             ORDER BY created_at_ms DESC NULLS LAST",
        )?;
        let rows = stmt.query_map(params![caixa_id], |r| r.get::<_, String>(0))?;
        json_array_from_rows(rows)
    })
}

pub fn ingest_funcionarios_remote(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    ingest_simple_cache(
        "funcionarios_remote",
        "funcionarios_remote_cache",
        json_text,
        now_ms,
        strategy,
        |item| {
            let ativo = item
                .get("ativo")
                .and_then(|v| v.as_bool())
                .map(|b| if b { 1i64 } else { 0 });
            vec![
                Box::new(json_str(item, "nome").map(|s| s.to_string())),
                Box::new(ativo),
            ]
        },
        &["nome", "ativo"],
    )
}

pub fn read_funcionarios_ativos_remote() -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM funcionarios_remote_cache
             WHERE deleted_at_ms IS NULL AND ativo = 1
             ORDER BY nome ASC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        json_array_from_rows(rows)
    })
}

/// Variante que devolve TODOS os funcionários cacheados (ativos e inativos),
/// usado pela aba admin "Funcionários". Mantém `deleted_at_ms IS NULL`.
pub fn read_funcionarios_todos_remote() -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM funcionarios_remote_cache
             WHERE deleted_at_ms IS NULL
             ORDER BY nome ASC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        json_array_from_rows(rows)
    })
}

pub fn ingest_terminais_remote(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    ingest_simple_cache(
        "terminais_remote",
        "terminais_remote_cache",
        json_text,
        now_ms,
        strategy,
        |item| {
            let ativo = item
                .get("ativo")
                .and_then(|v| v.as_bool())
                .map(|b| if b { 1i64 } else { 0 });
            vec![
                Box::new(json_str(item, "nome").map(|s| s.to_string())),
                Box::new(ativo),
            ]
        },
        &["nome", "ativo"],
    )
}

pub fn read_terminais_ativos_remote() -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM terminais_remote_cache
             WHERE deleted_at_ms IS NULL AND ativo = 1
             ORDER BY nome ASC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        json_array_from_rows(rows)
    })
}

pub fn ingest_pagamentos_empresa_remote(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest pagamentos_empresa: json inválido: {e}")))?;
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
                "INSERT INTO pagamentos_empresa_remote_cache(
                    id, status, created_at_ms, payload, updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,NULL)
                 ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    created_at_ms = excluded.created_at_ms,
                    payload = excluded.payload,
                    updated_at_remote_ms = excluded.updated_at_remote_ms,
                    synced_at_ms = excluded.synced_at_ms",
            )?;
            for item in items {
                let id = match json_str(item, "id") { Some(s) => s.to_string(), None => continue };
                let status = json_str(item, "status").map(|s| s.to_string());
                let created_ms = json_str(item, "created_at").and_then(parse_iso_to_ms);
                if let Some(ms) = created_ms {
                    max_remote_ms = Some(max_remote_ms.map_or(ms, |c| c.max(ms)));
                }
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![id, status, created_ms, payload, created_ms, now_ms])?;
                count += 1;
            }
        }
        let total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM pagamentos_empresa_remote_cache WHERE deleted_at_ms IS NULL",
            [], |r| r.get(0))?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain: "pagamentos_empresa_remote",
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

pub fn read_pagamentos_empresa_remote(limit: i64) -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM pagamentos_empresa_remote_cache
             WHERE deleted_at_ms IS NULL
             ORDER BY created_at_ms DESC NULLS LAST
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| r.get::<_, String>(0))?;
        json_array_from_rows(rows)
    })
}

pub fn ingest_venda_itens_remote(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    ingest_simple_cache(
        "venda_itens_remote",
        "venda_itens_remote_cache",
        json_text,
        now_ms,
        strategy,
        |item| {
            vec![
                Box::new(json_str(item, "venda_id").map(|s| s.to_string())),
                Box::new(json_str(item, "produto_id").map(|s| s.to_string())),
            ]
        },
        &["venda_id", "produto_id"],
    )
}

pub fn read_venda_itens_remote_periodo(inicio_ms: i64, fim_ms: i64) -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT vi.payload, v.payload AS venda_payload
               FROM venda_itens_remote_cache vi
               JOIN vendas_remote_cache v ON v.id = vi.venda_id
              WHERE vi.deleted_at_ms IS NULL
                AND v.deleted_at_ms IS NULL
                AND COALESCE(v.status,'') != 'cancelada'
                AND v.data_emissao_ms BETWEEN ?1 AND ?2",
        )?;
        let rows = stmt.query_map(params![inicio_ms, fim_ms], |r| {
            let item: String = r.get(0)?;
            let venda: String = r.get(1)?;
            let mut item_v: serde_json::Value = serde_json::from_str(&item).unwrap_or(serde_json::json!({}));
            let venda_v: serde_json::Value = serde_json::from_str(&venda).unwrap_or(serde_json::json!({}));
            if let Some(obj) = item_v.as_object_mut() {
                obj.insert("__venda".into(), venda_v);
            }
            Ok(serde_json::to_string(&item_v).unwrap_or_else(|_| "{}".into()))
        })?;
        json_array_from_rows(rows)
    })
}

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
    produto_id: &str,
    variacao_id: &str,
    tipo: Option<&str>,
    quantidade: f64,
    now_ms: i64,
) -> rusqlite::Result<()> {
    let delta = signal_for_tipo(tipo) * quantidade;
    tx.execute(
        "INSERT INTO estoque_saldos_local(
            produto_id, variacao_id, tipo, quantidade, payload, synced_at_ms
         ) VALUES (?1, ?2, NULL, 0, '{}', ?3)
         ON CONFLICT(produto_id, variacao_id) DO NOTHING",
        params![produto_id, variacao_id, now_ms],
    )?;
    tx.execute(
        "UPDATE estoque_saldos_local
            SET quantidade   = quantidade + ?3,
                synced_at_ms = ?4
          WHERE produto_id = ?1 AND variacao_id = ?2",
        params![produto_id, variacao_id, delta, now_ms],
    )?;
    Ok(())
}

pub fn ingest_movimentacoes(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
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
            tx.execute("DELETE FROM estoque_saldos_local", [])?;
        }

        let mut inserted = 0usize;
        let mut max_ms: Option<i64> = None;

        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO estoque_movimentacoes_local(
                    id, produto_id, variacao_id, tipo, quantidade,
                    saldo_anterior, saldo_posterior, custo_unitario,
                    origem, observacoes, data_movimentacao_ms,
                    payload, synced_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
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
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());

                let n = stmt.execute(params![
                    id,
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
            "SELECT COUNT(*) FROM estoque_movimentacoes_local",
            [],
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
            "SELECT COUNT(*) FROM estoque_saldos_local",
            [],
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
    ingest_movimentacoes(json_text, now_ms, IngestStrategy::Snapshot).map(|(n, _)| n)
}

pub fn read_saldos() -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT produto_id, variacao_id, quantidade
               FROM estoque_saldos_local
              ORDER BY produto_id ASC",
        )?;
        let rows = stmt.query_map([], |r| {
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

pub fn read_movimentacoes(produto_id: Option<&str>, limit: i64) -> DbResult<String> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 5000);
        let mut out = String::from("[");
        let mut first = true;

        if let Some(pid) = produto_id {
            let mut stmt = conn.prepare(
                "SELECT payload FROM estoque_movimentacoes_local
                  WHERE produto_id = ?1
                  ORDER BY data_movimentacao_ms DESC
                  LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![pid, limit], |r| r.get::<_, String>(0))?;
            for r in rows {
                let p = r?;
                if !first { out.push(','); }
                out.push_str(&p);
                first = false;
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT payload FROM estoque_movimentacoes_local
                  ORDER BY data_movimentacao_ms DESC
                  LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], |r| r.get::<_, String>(0))?;
            for r in rows {
                let p = r?;
                if !first { out.push(','); }
                out.push_str(&p);
                first = false;
            }
        }

        out.push(']');
        Ok(out)
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
            "fornecedores" => "fornecedores_local",
            "compras" => "compras_local",
            "vendas_remote" => "vendas_remote_cache",
            "financeiro_lancamentos_completo" => "financeiro_lancamentos_local",
            "estoque_saldos" => "estoque_saldos_local",
            "estoque_movimentacoes" => "estoque_movimentacoes_local",
            "caixas_remote" => "caixas_remote_cache",
            "caixa_movimentos_remote" => "caixa_movimentos_remote_cache",
            "funcionarios_remote" => "funcionarios_remote_cache",
            "terminais_remote" => "terminais_remote_cache",
            "pagamentos_empresa_remote" => "pagamentos_empresa_remote_cache",
            "venda_itens_remote" => "venda_itens_remote_cache",
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
    produto_id: &str,
    variacao_id: &str,
) -> rusqlite::Result<f64> {
    let v: Option<f64> = tx
        .query_row(
            "SELECT quantidade FROM estoque_saldos_local
              WHERE produto_id = ?1 AND variacao_id = ?2",
            params![produto_id, variacao_id],
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
                          WHERE client_uuid = ?1",
                        params![cu],
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
                              WHERE produto_id = ?1 AND variacao_id = ?2",
                            params![input.produto_id, input.variacao_id.clone().unwrap_or_default()],
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
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        let saldo_anterior = read_saldo_atual(&tx, &input.produto_id, &variacao_id)?;
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
                id, produto_id, variacao_id, tipo, quantidade,
                saldo_anterior, saldo_posterior, custo_unitario,
                origem, observacoes, data_movimentacao_ms,
                payload, synced_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                local_uuid,
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
            &input.produto_id,
            &variacao_id,
            Some(tipo_norm.as_str()),
            input.quantidade,
            now_ms,
        )?;

        // 3) Enfileira na outbox.
        tx.execute(
            "INSERT INTO outbox_estoque_movs(
                local_uuid, client_uuid, payload, status,
                attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms
             ) VALUES (?1, ?2, ?3, 'pending', 0, NULL, NULL, ?4, ?4, NULL)",
            params![local_uuid, input.client_uuid, payload_json, now_ms],
        )?;

        // 4) Trilha de auditoria local (v18) — mesma transação.
        // Se qualquer passo falhar, NADA acima fica gravado.
        tx.execute(
            "INSERT INTO estoque_audit_local(
                ts_ms, local_uuid, produto_id, variacao_id, tipo,
                quantidade, saldo_anterior, saldo_posterior, origem,
                terminal_id, operador_id, sync_status
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL,NULL,'pending')",
            params![
                now_ms,
                local_uuid,
                input.produto_id,
                variacao_id,
                tipo_norm,
                input.quantidade,
                saldo_anterior,
                saldo_posterior,
                input.origem,
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

fn iso_from_ms_z_pub(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default()
}

// ---------- Outbox: leitura, stats e atualização de status ----------

#[derive(Debug, Serialize)]
pub struct OutboxItem {
    pub local_uuid: String,
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

pub fn outbox_stats() -> DbResult<OutboxStats> {
    with_conn(|conn| {
        let mut s = OutboxStats::default();
        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM outbox_estoque_movs GROUP BY status",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
                "SELECT MAX(sent_at_ms) FROM outbox_estoque_movs WHERE status='sent'",
                [],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_error = conn
            .query_row(
                "SELECT last_error FROM outbox_estoque_movs
                  WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
                [],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();

        // Backoff observability: due_now e próxima janela.
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn
            .query_row(
                "SELECT COUNT(*) FROM outbox_estoque_movs
                  WHERE status='pending'
                    AND COALESCE(next_attempt_at_ms, 0) <= ?1",
                params![now],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        s.next_attempt_at_ms = conn
            .query_row(
                "SELECT MIN(COALESCE(next_attempt_at_ms, 0))
                   FROM outbox_estoque_movs WHERE status='pending'",
                [],
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
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
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

pub fn outbox_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let (sql, has_filter) = match only_status {
            Some(_) => (
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_estoque_movs
                  WHERE status = ?1
                  ORDER BY created_at_ms DESC
                  LIMIT ?2"
                    .to_string(),
                true,
            ),
            None => (
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_estoque_movs
                  ORDER BY created_at_ms DESC
                  LIMIT ?1"
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
            })
        };
        let mut out = Vec::new();
        if has_filter {
            let s = only_status.unwrap();
            let rows = stmt.query_map(params![s, limit], map_row)?;
            for r in rows { out.push(r?); }
        } else {
            let rows = stmt.query_map(params![limit], map_row)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

/// Retorna SOMENTE itens `pending` com `next_attempt_at_ms <= now` (ou NULL).
/// É a base do flush automático: NUNCA puxa um item em backoff.
pub fn outbox_pending_batch(limit: i64) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                    remote_id, created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_estoque_movs
              WHERE status = 'pending'
                AND COALESCE(next_attempt_at_ms, 0) <= ?1
              ORDER BY created_at_ms ASC
              LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![now, limit], |r| {
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
            })
        })?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

/// Igual a `outbox_pending_batch` mas IGNORA `next_attempt_at_ms`. Usado
/// pelo flush manual: o operador clicou "Sincronizar agora" e quer ignorar
/// a janela de espera do backoff.
pub fn outbox_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                    remote_id, created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_estoque_movs
              WHERE status = 'pending'
              ORDER BY created_at_ms ASC
              LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
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
            })
        })?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
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
fn backoff_ms_for_attempts(attempts: i64) -> i64 {
    match attempts {
        a if a <= 1 => 5_000,
        2 => 15_000,
        3 => 60_000,
        4 => 5 * 60_000,
        _ => 15 * 60_000,
    }
}

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
pub fn outbox_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_estoque_movs
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
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
    /// Vencimento opcional — usado para gerar `contas_receber_local`
    /// quando a forma de pagamento é fiado/clientes a receber.
    #[serde(default)]
    pub vencimento_ms: Option<i64>,
}

fn default_true() -> bool { true }

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
}

#[derive(Debug, Serialize)]
pub struct LocalVendaResult {
    pub local_uuid: String,
    pub idempotente: bool,
    pub qtd_itens: i64,
    pub total: f64,
}

pub fn registrar_venda_local(
    input: LocalVendaInput,
    now_ms: i64,
) -> DbResult<LocalVendaResult> {
    if input.itens.is_empty() {
        return Err(DbError("venda sem itens".into()));
    }

    // Idempotência por client_uuid (antes da transação grande).
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some((local_uuid, qtd, total)) = with_conn(|conn| {
                let row = conn
                    .query_row(
                        "SELECT local_uuid, qtd_itens, total
                           FROM vendas_local WHERE client_uuid = ?1",
                        params![cu],
                        |r| Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, f64>(2)?,
                        )),
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
                "vencimento_ms": p.vencimento_ms,
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
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        // 0) Resolve o caixa local aberto para vincular esta venda.
        //    Estratégia: prioriza match por operador_id; cai para qualquer
        //    caixa aberto neste banco (típico em terminais 1-caixa). NULL é
        //    aceito — venda ainda funciona mesmo sem caixa aberto local.
        let caixa_local_uuid: Option<String> = {
            let by_op: Option<String> = match input.operador_id.as_deref() {
                Some(op) if !op.is_empty() => tx.query_row(
                    "SELECT local_uuid FROM caixa_local
                      WHERE status='aberto' AND operador_id = ?1
                   ORDER BY data_abertura_ms DESC LIMIT 1",
                    params![op],
                    |r| r.get::<_, String>(0),
                ).optional()?,
                _ => None,
            };
            if by_op.is_some() {
                by_op
            } else {
                tx.query_row(
                    "SELECT local_uuid FROM caixa_local
                      WHERE status='aberto'
                   ORDER BY data_abertura_ms DESC LIMIT 1",
                    [],
                    |r| r.get::<_, String>(0),
                ).optional()?
            }
        };

        // 1) Cabeçalho.
        tx.execute(
            "INSERT INTO vendas_local(
                local_uuid, client_uuid, cliente_id, subtotal, desconto, total,
                forma_pagamento, status_pagamento, valor_recebido, troco,
                observacao, operador_id, terminal_id, gerar_financeiro,
                qtd_itens, caixa_local_uuid, created_at_ms, updated_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)",
            params![
                local_uuid,
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

        // 2) Itens + baixa de estoque local.
        for (idx, item) in input.itens.iter().enumerate() {
            let item_payload = serde_json::to_string(&itens_json[idx])
                .unwrap_or_else(|_| "{}".to_string());
            tx.execute(
                "INSERT INTO venda_itens_local(
                    venda_local_uuid, produto_id, descricao, quantidade,
                    preco_unitario, desconto, payload, created_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
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
            let saldo_anterior = read_saldo_atual(&tx, &item.produto_id, &variacao_id)?;
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
            tx.execute(
                "INSERT OR IGNORE INTO estoque_movimentacoes_local(
                    id, produto_id, variacao_id, tipo, quantidade,
                    saldo_anterior, saldo_posterior, custo_unitario,
                    origem, observacoes, data_movimentacao_ms,
                    payload, synced_at_ms
                 ) VALUES (?1,?2,?3,'saida',?4,?5,?6,NULL,'venda',NULL,?7,?8,?7)",
                params![
                    mov_id,
                    item.produto_id,
                    variacao_id,
                    item.quantidade,
                    saldo_anterior,
                    saldo_posterior,
                    now_ms,
                    mov_payload,
                ],
            )?;
            apply_mov_to_saldo(
                &tx,
                &item.produto_id,
                &variacao_id,
                Some("saida"),
                item.quantidade,
                now_ms,
            )?;
        }

        // 3) Pagamentos.
        for p in &input.pagamentos {
            tx.execute(
                "INSERT INTO venda_pagamentos_local(
                    venda_local_uuid, forma_pagamento, valor, valor_recebido,
                    troco, parcelas, observacao, created_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
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
                local_uuid, client_uuid, payload, status,
                attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,'pending',0,NULL,NULL,?4,?4,NULL,NULL)",
            params![local_uuid, input.client_uuid, payload_json, now_ms],
        )?;

        // 5) Auditoria local da venda (v19) — mesma transação.
        let origem_audit = if input.terminal_id.is_some() {
            "terminal"
        } else {
            "servidor"
        };
        tx.execute(
            "INSERT INTO vendas_audit_local(
                ts_ms, evento, venda_local_uuid, client_uuid, cliente_id,
                operador_id, terminal_id, forma_pagamento, qtd_itens, total,
                motivo, origem, sync_status
             ) VALUES (?1,'criada',?2,?3,?4,?5,?6,?7,?8,?9,NULL,?10,'pending')",
            params![
                now_ms,
                local_uuid,
                input.client_uuid,
                input.cliente_id,
                input.operador_id,
                input.terminal_id,
                input.forma_pagamento,
                qtd_itens,
                input.total,
                origem_audit,
            ],
        )?;

        // 6) Contas a receber locais — uma linha por pagamento fiado.
        //    Detecta por substring (cobre "fiado", "clientes_receber",
        //    "a_receber", etc.) ou por status_pagamento != 'pago'.
        let is_fiado_forma = |f: &str| {
            let lf = f.to_ascii_lowercase();
            lf.contains("fiado") || lf.contains("receber") || lf == "credito_loja"
        };
        let mut fiado_linhas = 0i64;
        for p in &input.pagamentos {
            if is_fiado_forma(&p.forma_pagamento) {
                let cr_uuid = random_uuid_v4();
                tx.execute(
                    "INSERT INTO contas_receber_local(
                        local_uuid, venda_local_uuid, client_uuid, cliente_id,
                        cliente_nome, cliente_cpf, cliente_telefone,
                        forma_pagamento, valor, valor_pago, vencimento_ms,
                        status, observacao, origem, sync_status,
                        created_at_ms, updated_at_ms
                     ) VALUES (?1,?2,?3,?4,NULL,NULL,NULL,?5,?6,0,?7,'aberto',?8,?9,'pending',?10,?10)",
                    params![
                        cr_uuid,
                        local_uuid,
                        input.client_uuid,
                        input.cliente_id,
                        p.forma_pagamento,
                        p.valor,
                        p.vencimento_ms,
                        p.observacao,
                        origem_audit,
                        now_ms,
                    ],
                )?;
                fiado_linhas += 1;
            }
        }
        // Fallback: a venda toda é fiado pela `forma_pagamento` da cabeça
        // (e nenhum pagamento detalhado foi enviado).
        if fiado_linhas == 0
            && input.pagamentos.is_empty()
            && is_fiado_forma(&input.forma_pagamento)
        {
            let cr_uuid = random_uuid_v4();
            tx.execute(
                "INSERT INTO contas_receber_local(
                    local_uuid, venda_local_uuid, client_uuid, cliente_id,
                    cliente_nome, cliente_cpf, cliente_telefone,
                    forma_pagamento, valor, valor_pago, vencimento_ms,
                    status, observacao, origem, sync_status,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1,?2,?3,?4,NULL,NULL,NULL,?5,?6,0,NULL,'aberto',?7,?8,'pending',?9,?9)",
                params![
                    cr_uuid,
                    local_uuid,
                    input.client_uuid,
                    input.cliente_id,
                    input.forma_pagamento,
                    input.total,
                    input.observacao,
                    origem_audit,
                    now_ms,
                ],
            )?;
        }

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

pub fn outbox_vendas_stats() -> DbResult<OutboxVendasStats> {
    with_conn(|conn| {
        let mut s = OutboxVendasStats::default();
        let mut stmt = conn
            .prepare("SELECT status, COUNT(*) FROM outbox_vendas GROUP BY status")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_vendas WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_vendas
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_vendas
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1",
            params![now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_vendas WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
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
    kind: &str, now_ms: i64, attempted: i64, sent: i64, failed: i64,
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

pub fn outbox_vendas_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxItem>> {
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
            })
        };
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let mut stmt = conn.prepare(
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_vendas WHERE status = ?1
                  ORDER BY created_at_ms DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![st, limit], map_row)?;
            for r in rows { out.push(r?); }
        } else {
            let mut stmt = conn.prepare(
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_vendas ORDER BY created_at_ms DESC LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], map_row)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

pub fn outbox_vendas_pending_batch(limit: i64) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                    remote_id, created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_vendas
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1
              ORDER BY created_at_ms ASC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![now, limit], |r| {
            Ok(OutboxItem {
                local_uuid: r.get(0)?, client_uuid: r.get(1)?, payload: r.get(2)?,
                status: r.get(3)?, attempts: r.get(4)?, last_error: r.get(5)?,
                remote_id: r.get(6)?, created_at_ms: r.get(7)?,
                updated_at_ms: r.get(8)?, sent_at_ms: r.get(9)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_vendas_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                    remote_id, created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_vendas WHERE status='pending'
              ORDER BY created_at_ms ASC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            Ok(OutboxItem {
                local_uuid: r.get(0)?, client_uuid: r.get(1)?, payload: r.get(2)?,
                status: r.get(3)?, attempts: r.get(4)?, last_error: r.get(5)?,
                remote_id: r.get(6)?, created_at_ms: r.get(7)?,
                updated_at_ms: r.get(8)?, sent_at_ms: r.get(9)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
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
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_vendas WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?.unwrap_or(1);
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

pub fn outbox_vendas_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_vendas
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
        )?;
        Ok(n as i64)
    })
}

// ---------------------------------------------------------------------------
// v21 (Etapa 8) — Contas a receber offline (leitura + baixa + cancelamento)
// ---------------------------------------------------------------------------
//
// Mantém `contas_receber_local` como fonte da verdade local. A baixa
// (`baixar_receber_local`) é atômica: insere `contas_receber_pagtos_local`,
// atualiza `valor_pago`/`status` do título, grava `financeiro_audit_local`
// e enfileira `outbox_financeiro` para o lançamento avulso correspondente
// (assim a entrada vira lançamento real no upstream quando reconectar).
//
// O `status` derivado segue a regra: aberto (valor_pago<=0), parcial
// (0<valor_pago<valor), pago (valor_pago>=valor), cancelado (manual),
// vencido (aberto/parcial e vencimento_ms < now). "Vencido" é calculado
// no read — não é persistido — para não exigir job de relógio.

#[derive(Debug, Serialize)]
pub struct ContaReceberLocalRow {
    pub local_uuid: String,
    pub venda_local_uuid: String,
    pub cliente_id: Option<String>,
    pub cliente_nome: Option<String>,
    pub cliente_cpf: Option<String>,
    pub cliente_telefone: Option<String>,
    pub forma_pagamento: Option<String>,
    pub valor: f64,
    pub valor_pago: f64,
    pub valor_restante: f64,
    pub vencimento_ms: Option<i64>,
    pub status: String,           // aberto|parcial|pago|cancelado|vencido
    pub status_base: String,      // aberto|parcial|pago|cancelado (sem 'vencido')
    pub sync_status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Default, Deserialize)]
pub struct ContasReceberLocalFiltro {
    #[serde(default)]
    pub status: Option<String>,         // aberto|parcial|pago|cancelado|vencido|todos
    #[serde(default)]
    pub cliente_id: Option<String>,
    #[serde(default)]
    pub desde_ms: Option<i64>,
    #[serde(default)]
    pub ate_ms: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
}

pub fn contas_receber_local_list(
    f: &ContasReceberLocalFiltro,
    now_ms: i64,
) -> DbResult<Vec<ContaReceberLocalRow>> {
    with_conn(|conn| {
        let mut sql = String::from(
            "SELECT local_uuid, venda_local_uuid, cliente_id, cliente_nome,
                    cliente_cpf, cliente_telefone, forma_pagamento,
                    valor, valor_pago, vencimento_ms, status, sync_status,
                    created_at_ms, updated_at_ms
               FROM contas_receber_local WHERE 1=1",
        );
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(c) = f.cliente_id.as_deref().filter(|s| !s.is_empty()) {
            sql.push_str(" AND cliente_id = ?");
            args.push(c.to_string().into());
        }
        if let Some(d) = f.desde_ms {
            sql.push_str(" AND created_at_ms >= ?");
            args.push(d.into());
        }
        if let Some(a) = f.ate_ms {
            sql.push_str(" AND created_at_ms <= ?");
            args.push(a.into());
        }
        sql.push_str(" ORDER BY COALESCE(vencimento_ms, created_at_ms) ASC");
        let limit = f.limit.unwrap_or(500).clamp(1, 5000);
        sql.push_str(" LIMIT ?");
        args.push(limit.into());

        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let iter = stmt.query_map(params_refs.as_slice(), |r| {
            let local_uuid: String = r.get(0)?;
            let venda_local_uuid: String = r.get(1)?;
            let cliente_id: Option<String> = r.get(2)?;
            let cliente_nome: Option<String> = r.get(3)?;
            let cliente_cpf: Option<String> = r.get(4)?;
            let cliente_telefone: Option<String> = r.get(5)?;
            let forma_pagamento: Option<String> = r.get(6)?;
            let valor: f64 = r.get(7)?;
            let valor_pago: f64 = r.get(8)?;
            let vencimento_ms: Option<i64> = r.get(9)?;
            let status_base: String = r.get(10)?;
            let sync_status: String = r.get(11)?;
            let created_at_ms: i64 = r.get(12)?;
            let updated_at_ms: i64 = r.get(13)?;
            let valor_restante = ((valor - valor_pago).max(0.0) * 100.0).round() / 100.0;
            let status = if status_base == "cancelado" || status_base == "pago" {
                status_base.clone()
            } else if valor_pago > 0.0 && valor_pago < valor {
                // base é 'aberto' mas tem baixa parcial
                if vencimento_ms.map(|v| v < now_ms).unwrap_or(false) { "vencido".into() } else { "parcial".into() }
            } else if vencimento_ms.map(|v| v < now_ms).unwrap_or(false) {
                "vencido".into()
            } else {
                status_base.clone()
            };
            Ok(ContaReceberLocalRow {
                local_uuid, venda_local_uuid,
                cliente_id, cliente_nome, cliente_cpf, cliente_telefone,
                forma_pagamento, valor, valor_pago, valor_restante,
                vencimento_ms, status, status_base, sync_status,
                created_at_ms, updated_at_ms,
            })
        })?;
        let mut out: Vec<ContaReceberLocalRow> = Vec::new();
        for r in iter { out.push(r?); }

        // Filtro de status calculado (depois de derivar).
        if let Some(s) = f.status.as_deref().filter(|s| !s.is_empty() && *s != "todos") {
            out.retain(|r| r.status == s);
        }
        Ok(out)
    })
}

#[derive(Debug, Deserialize)]
pub struct BaixarReceberInput {
    pub receber_id: String,            // local_uuid OU remote_id futuro
    pub valor: f64,
    #[serde(default)]
    pub forma_pagamento: Option<String>,
    #[serde(default)]
    pub data_pagamento_ms: Option<i64>,
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
pub struct BaixarReceberResult {
    pub local_uuid: String,
    pub idempotente: bool,
    pub receber_local_uuid: String,
    pub valor: f64,
    pub valor_pago_total: f64,
    pub valor_restante: f64,
    pub status: String,
}

fn resolve_receber_local_uuid(conn: &Connection, any_id: &str) -> DbResult<Option<String>> {
    let by_local: Option<String> = conn.query_row(
        "SELECT local_uuid FROM contas_receber_local WHERE local_uuid = ?1",
        params![any_id], |r| r.get::<_, String>(0),
    ).optional()?;
    Ok(by_local)
}

pub fn baixar_receber_local(
    input: BaixarReceberInput,
    now_ms: i64,
) -> DbResult<BaixarReceberResult> {
    if input.valor <= 0.0 {
        return Err(DbError("valor da baixa deve ser maior que zero".into()));
    }

    // Idempotência por client_uuid.
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some(row) = with_conn(|conn| {
                let r = conn.query_row(
                    "SELECT local_uuid, receber_local_uuid, valor
                       FROM contas_receber_pagtos_local WHERE client_uuid=?1",
                    params![cu],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?)),
                ).optional()?;
                Ok(r)
            })? {
                let (pid, rid, v) = row;
                let (vtot, vpago, status) = with_conn(|conn| {
                    let t = conn.query_row(
                        "SELECT valor, valor_pago, status FROM contas_receber_local WHERE local_uuid=?1",
                        params![rid], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?)),
                    )?;
                    Ok(t)
                })?;
                let rest = ((vtot - vpago).max(0.0) * 100.0).round() / 100.0;
                return Ok(BaixarReceberResult {
                    local_uuid: pid, idempotente: true,
                    receber_local_uuid: rid, valor: v,
                    valor_pago_total: vpago, valor_restante: rest, status,
                });
            }
        }
    }

    let receber_local_uuid = with_conn(|conn| resolve_receber_local_uuid(conn, &input.receber_id))?
        .ok_or_else(|| DbError(format!("título não encontrado localmente: {}", input.receber_id)))?;

    let dt_pag = input.data_pagamento_ms.unwrap_or(now_ms);
    let pag_uuid = random_uuid_v4();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        // Lê o título atual.
        let (valor_total, valor_pago_atual, status_atual, cliente_id): (f64, f64, String, Option<String>) =
            tx.query_row(
                "SELECT valor, valor_pago, status, cliente_id FROM contas_receber_local
                  WHERE local_uuid = ?1",
                params![receber_local_uuid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?;
        if status_atual == "cancelado" {
            return Err(DbError("título cancelado — não permite baixa".into()).into());
        }
        let novo_pago = ((valor_pago_atual + input.valor) * 100.0).round() / 100.0;
        if novo_pago > valor_total + 0.005 {
            return Err(DbError(format!(
                "baixa excede o valor restante (restante={:.2}, baixa={:.2})",
                (valor_total - valor_pago_atual).max(0.0), input.valor
            )).into());
        }
        let novo_status = if novo_pago + 0.005 >= valor_total { "pago" } else { "aberto" };
        // observação: status 'parcial' é derivado no read; persistimos 'aberto'
        // até virar 'pago' para compatibilidade com schema atual.

        tx.execute(
            "INSERT INTO contas_receber_pagtos_local(
                local_uuid, client_uuid, receber_local_uuid, valor,
                forma_pagamento, data_pagamento_ms, observacao,
                operador_id, terminal_id, origem, sync_status, created_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'servidor','pending',?10)",
            params![
                pag_uuid, input.client_uuid, receber_local_uuid, input.valor,
                input.forma_pagamento, dt_pag, input.observacao,
                input.operador_id, input.terminal_id, now_ms,
            ],
        )?;
        tx.execute(
            "UPDATE contas_receber_local
                SET valor_pago = ?1,
                    status     = ?2,
                    sync_status = CASE WHEN sync_status='synced' THEN 'pending' ELSE sync_status END,
                    updated_at_ms = ?3
              WHERE local_uuid = ?4",
            params![novo_pago, novo_status, now_ms, receber_local_uuid],
        )?;

        // Auditoria local.
        let valor_restante = ((valor_total - novo_pago).max(0.0) * 100.0).round() / 100.0;
        tx.execute(
            "INSERT INTO financeiro_audit_local(
                ts_ms, evento, entidade, entidade_uuid, mov_local_uuid,
                client_uuid, cliente_id, fornecedor_id, operador_id, terminal_id,
                forma_pagamento, valor, valor_pago, valor_restante,
                status_anterior, status_atual, motivo, origem, sync_status
             ) VALUES (?1,'recebimento','receber',?2,?3,?4,?5,NULL,?6,?7,?8,?9,?10,?11,?12,?13,?14,'servidor','pending')",
            params![
                now_ms, receber_local_uuid, pag_uuid, input.client_uuid,
                cliente_id, input.operador_id, input.terminal_id,
                input.forma_pagamento, input.valor, novo_pago, valor_restante,
                status_atual, novo_status, input.observacao,
            ],
        )?;

        tx.commit()?;
        Ok(BaixarReceberResult {
            local_uuid: pag_uuid, idempotente: false,
            receber_local_uuid,
            valor: input.valor,
            valor_pago_total: novo_pago,
            valor_restante,
            status: novo_status.to_string(),
        })
    })
}

#[derive(Debug, Deserialize)]
pub struct CancelarReceberInput {
    pub receber_id: String,
    #[serde(default)]
    pub motivo: Option<String>,
    #[serde(default)]
    pub operador_id: Option<String>,
    #[serde(default)]
    pub terminal_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CancelarReceberResult {
    pub receber_local_uuid: String,
    pub idempotente: bool,
    pub status: String,
}

pub fn cancelar_receber_local(
    input: CancelarReceberInput,
    now_ms: i64,
) -> DbResult<CancelarReceberResult> {
    let receber_local_uuid = with_conn(|conn| resolve_receber_local_uuid(conn, &input.receber_id))?
        .ok_or_else(|| DbError(format!("título não encontrado localmente: {}", input.receber_id)))?;

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let (status_atual, cliente_id): (String, Option<String>) = tx.query_row(
            "SELECT status, cliente_id FROM contas_receber_local WHERE local_uuid=?1",
            params![receber_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if status_atual == "cancelado" {
            return Ok(CancelarReceberResult {
                receber_local_uuid, idempotente: true, status: status_atual,
            });
        }
        tx.execute(
            "UPDATE contas_receber_local
                SET status='cancelado',
                    sync_status = CASE WHEN sync_status='synced' THEN 'pending' ELSE sync_status END,
                    updated_at_ms = ?1
              WHERE local_uuid = ?2",
            params![now_ms, receber_local_uuid],
        )?;
        tx.execute(
            "INSERT INTO financeiro_audit_local(
                ts_ms, evento, entidade, entidade_uuid, mov_local_uuid,
                client_uuid, cliente_id, fornecedor_id, operador_id, terminal_id,
                forma_pagamento, valor, valor_pago, valor_restante,
                status_anterior, status_atual, motivo, origem, sync_status
             ) VALUES (?1,'cancelamento','receber',?2,NULL,NULL,?3,NULL,?4,?5,NULL,NULL,NULL,NULL,?6,'cancelado',?7,'servidor','pending')",
            params![
                now_ms, receber_local_uuid, cliente_id,
                input.operador_id, input.terminal_id, status_atual, input.motivo,
            ],
        )?;
        tx.commit()?;
        Ok(CancelarReceberResult {
            receber_local_uuid, idempotente: false, status: "cancelado".into(),
        })
    })
}


// ===========================================================================
// v22 (Etapa 9) — Contas a PAGAR offline (listagem + criação + baixa + cancel)
// ---------------------------------------------------------------------------
//
// Espelha 1:1 a lógica de `contas_receber_local`. A diferença principal é
// que pagar nasce a partir de uma compra a prazo (chamado do
// `compra_receber_local` / `compra_receber_itens_local` quando
// `gerar_financeiro=true` e existe vencimento) — gravada na MESMA
// transação SQLite do recebimento, garantindo atomicidade
// estoque + payable.
//
// Idempotência:
//   * `uq_contas_pagar_origem_compra` impede duplicação por compra ao
//     retry do recebimento (já existe → no-op, retorna o título).
//   * `client_uuid` em baixas deduplica reenvios entre terminais.
//
// `status` é derivado no read (vencido) — não persistido — para evitar
// dependência de relógio de background.

#[derive(Debug, Serialize)]
pub struct ContaPagarLocalRow {
    pub local_uuid: String,
    pub remote_id: Option<String>,
    pub origem: String,
    pub compra_local_uuid: Option<String>,
    pub compra_remote_id: Option<String>,
    pub fornecedor_id: Option<String>,
    pub fornecedor_nome: Option<String>,
    pub descricao: Option<String>,
    pub forma_pagamento: Option<String>,
    pub valor: f64,
    pub valor_pago: f64,
    pub valor_restante: f64,
    pub vencimento_ms: Option<i64>,
    pub data_emissao_ms: Option<i64>,
    pub status: String,        // aberto|parcial|pago|cancelado|vencido
    pub status_base: String,   // aberto|pago|cancelado
    pub sync_status: String,
    pub observacao: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Default, Deserialize)]
pub struct ContasPagarLocalFiltro {
    #[serde(default)]
    pub status: Option<String>,         // aberto|parcial|pago|cancelado|vencido|todos
    #[serde(default)]
    pub fornecedor_id: Option<String>,
    #[serde(default)]
    pub compra_id: Option<String>,
    #[serde(default)]
    pub desde_ms: Option<i64>,
    #[serde(default)]
    pub ate_ms: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
}

pub fn contas_pagar_local_list(
    f: &ContasPagarLocalFiltro,
    now_ms: i64,
) -> DbResult<Vec<ContaPagarLocalRow>> {
    with_conn(|conn| {
        let mut sql = String::from(
            "SELECT local_uuid, remote_id, origem, compra_local_uuid, compra_remote_id,
                    fornecedor_id, fornecedor_nome, descricao, forma_pagamento,
                    valor, valor_pago, vencimento_ms, data_emissao_ms, status,
                    sync_status, observacao, created_at_ms, updated_at_ms
               FROM contas_pagar_local WHERE 1=1",
        );
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(fid) = f.fornecedor_id.as_deref().filter(|s| !s.is_empty()) {
            sql.push_str(" AND fornecedor_id = ?");
            args.push(fid.to_string().into());
        }
        if let Some(cid) = f.compra_id.as_deref().filter(|s| !s.is_empty()) {
            sql.push_str(" AND (compra_local_uuid = ? OR compra_remote_id = ?)");
            args.push(cid.to_string().into());
            args.push(cid.to_string().into());
        }
        if let Some(d) = f.desde_ms { sql.push_str(" AND created_at_ms >= ?"); args.push(d.into()); }
        if let Some(a) = f.ate_ms { sql.push_str(" AND created_at_ms <= ?"); args.push(a.into()); }
        sql.push_str(" ORDER BY COALESCE(vencimento_ms, created_at_ms) ASC");
        let limit = f.limit.unwrap_or(500).clamp(1, 5000);
        sql.push_str(" LIMIT ?");
        args.push(limit.into());

        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let iter = stmt.query_map(params_refs.as_slice(), |r| {
            let local_uuid: String = r.get(0)?;
            let remote_id: Option<String> = r.get(1)?;
            let origem: String = r.get(2)?;
            let compra_local_uuid: Option<String> = r.get(3)?;
            let compra_remote_id: Option<String> = r.get(4)?;
            let fornecedor_id: Option<String> = r.get(5)?;
            let fornecedor_nome: Option<String> = r.get(6)?;
            let descricao: Option<String> = r.get(7)?;
            let forma_pagamento: Option<String> = r.get(8)?;
            let valor: f64 = r.get(9)?;
            let valor_pago: f64 = r.get(10)?;
            let vencimento_ms: Option<i64> = r.get(11)?;
            let data_emissao_ms: Option<i64> = r.get(12)?;
            let status_base: String = r.get(13)?;
            let sync_status: String = r.get(14)?;
            let observacao: Option<String> = r.get(15)?;
            let created_at_ms: i64 = r.get(16)?;
            let updated_at_ms: i64 = r.get(17)?;
            let valor_restante = ((valor - valor_pago).max(0.0) * 100.0).round() / 100.0;
            let status = if status_base == "cancelado" || status_base == "pago" {
                status_base.clone()
            } else if valor_pago > 0.0 && valor_pago < valor {
                if vencimento_ms.map(|v| v < now_ms).unwrap_or(false) { "vencido".into() } else { "parcial".into() }
            } else if vencimento_ms.map(|v| v < now_ms).unwrap_or(false) {
                "vencido".into()
            } else {
                status_base.clone()
            };
            Ok(ContaPagarLocalRow {
                local_uuid, remote_id, origem, compra_local_uuid, compra_remote_id,
                fornecedor_id, fornecedor_nome, descricao, forma_pagamento,
                valor, valor_pago, valor_restante,
                vencimento_ms, data_emissao_ms,
                status, status_base, sync_status, observacao,
                created_at_ms, updated_at_ms,
            })
        })?;
        let mut out: Vec<ContaPagarLocalRow> = Vec::new();
        for r in iter { out.push(r?); }

        if let Some(s) = f.status.as_deref().filter(|s| !s.is_empty() && *s != "todos") {
            out.retain(|r| r.status == s);
        }
        Ok(out)
    })
}

/// Helper transacional: cria (ou retorna existente) um título de
/// contas a pagar a partir de uma compra. Idempotente via
/// `uq_contas_pagar_origem_compra`. Usado por `compra_receber_local`
/// e `compra_receber_itens_local` dentro da MESMA transação SQLite.
fn criar_pagar_from_compra_tx(
    tx: &rusqlite::Connection,
    compra_local_uuid: &str,
    data_vencimento_ms: Option<i64>,
    now_ms: i64,
) -> DbResult<Option<String>> {
    // Idempotência: já existe?
    let existing: Option<String> = tx.query_row(
        "SELECT local_uuid FROM contas_pagar_local
          WHERE compra_local_uuid=?1 AND origem='compra' LIMIT 1",
        params![compra_local_uuid], |r| r.get(0),
    ).optional()?;
    if let Some(lid) = existing {
        // Atualiza vencimento se mudou (recebimento posterior).
        if let Some(venc) = data_vencimento_ms {
            tx.execute(
                "UPDATE contas_pagar_local
                    SET vencimento_ms = COALESCE(vencimento_ms, ?1),
                        updated_at_ms = ?2
                  WHERE local_uuid = ?3",
                params![venc, now_ms, lid],
            )?;
        }
        return Ok(Some(lid));
    }

    // Carrega cabeçalho da compra.
    let row: Option<(String, Option<String>, f64, Option<i64>)> = tx.query_row(
        "SELECT payload, fornecedor_id, 0.0, data_emissao_ms
           FROM compras_local WHERE local_uuid=?1",
        params![compra_local_uuid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).optional()?;
    let (payload_raw, fornecedor_id, _, data_emissao_ms) = match row {
        Some(t) => t,
        None => return Ok(None),
    };
    let full: serde_json::Value = serde_json::from_str(&payload_raw).unwrap_or(serde_json::json!({}));
    let total = full.get("total").and_then(|v| v.as_f64()).unwrap_or(0.0);
    if total <= 0.0 {
        return Ok(None);
    }
    let fornecedor_nome = full.get("fornecedor")
        .and_then(|o| o.get("razao_social"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let numero = full.get("numero").and_then(|v| v.as_str()).map(String::from).unwrap_or_default();
    let compra_remote_id: Option<String> = tx.query_row(
        "SELECT remote_id FROM compras_local WHERE local_uuid=?1",
        params![compra_local_uuid], |r| r.get(0),
    ).optional()?.flatten();
    let descricao = if numero.is_empty() {
        Some(format!("Compra {}", &compra_local_uuid[..8.min(compra_local_uuid.len())]))
    } else {
        Some(format!("Compra Nº {}", numero))
    };
    let pagar_local_uuid = random_uuid_v4();
    tx.execute(
        "INSERT INTO contas_pagar_local(
            local_uuid, client_uuid, remote_id, origem,
            compra_local_uuid, compra_remote_id,
            fornecedor_id, fornecedor_nome, descricao,
            valor, valor_pago, vencimento_ms, data_emissao_ms,
            status, sync_status, created_at_ms, updated_at_ms
         ) VALUES (?1, ?1, NULL, 'compra',
                   ?2, ?3,
                   ?4, ?5, ?6,
                   ?7, 0, ?8, ?9,
                   'aberto', 'pending', ?10, ?10)",
        params![
            pagar_local_uuid, compra_local_uuid, compra_remote_id,
            fornecedor_id, fornecedor_nome, descricao,
            total, data_vencimento_ms, data_emissao_ms, now_ms,
        ],
    )?;
    // Auditoria.
    tx.execute(
        "INSERT INTO financeiro_audit_local(
            ts_ms, evento, entidade, entidade_uuid, mov_local_uuid,
            client_uuid, cliente_id, fornecedor_id, operador_id, terminal_id,
            forma_pagamento, valor, valor_pago, valor_restante,
            status_anterior, status_atual, motivo, origem, sync_status
         ) VALUES (?1,'criar','pagar',?2,NULL,?2,NULL,?3,NULL,NULL,NULL,?4,0,?4,NULL,'aberto',?5,'servidor','pending')",
        params![
            now_ms, pagar_local_uuid, fornecedor_id, total,
            format!("compra:{}", compra_local_uuid),
        ],
    )?;
    Ok(Some(pagar_local_uuid))
}

#[derive(Debug, Deserialize)]
pub struct BaixarPagarInput {
    pub pagar_id: String,
    pub valor: f64,
    #[serde(default)]
    pub forma_pagamento: Option<String>,
    #[serde(default)]
    pub data_pagamento_ms: Option<i64>,
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
pub struct BaixarPagarResult {
    pub local_uuid: String,
    pub idempotente: bool,
    pub pagar_local_uuid: String,
    pub valor: f64,
    pub valor_pago_total: f64,
    pub valor_restante: f64,
    pub status: String,
}

fn resolve_pagar_local_uuid(conn: &Connection, any_id: &str) -> DbResult<Option<String>> {
    let r: Option<String> = conn.query_row(
        "SELECT local_uuid FROM contas_pagar_local
          WHERE local_uuid=?1 OR remote_id=?1 LIMIT 1",
        params![any_id], |r| r.get(0),
    ).optional()?;
    Ok(r)
}

pub fn baixar_pagar_local(
    input: BaixarPagarInput,
    now_ms: i64,
) -> DbResult<BaixarPagarResult> {
    if input.valor <= 0.0 {
        return Err(DbError("valor da baixa deve ser maior que zero".into()));
    }

    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some(row) = with_conn(|conn| {
                let r = conn.query_row(
                    "SELECT local_uuid, pagar_local_uuid, valor
                       FROM contas_pagar_pagtos_local WHERE client_uuid=?1",
                    params![cu],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?)),
                ).optional()?;
                Ok(r)
            })? {
                let (pid, rid, v) = row;
                let (vtot, vpago, status) = with_conn(|conn| {
                    let t = conn.query_row(
                        "SELECT valor, valor_pago, status FROM contas_pagar_local WHERE local_uuid=?1",
                        params![rid], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?)),
                    )?;
                    Ok(t)
                })?;
                let rest = ((vtot - vpago).max(0.0) * 100.0).round() / 100.0;
                return Ok(BaixarPagarResult {
                    local_uuid: pid, idempotente: true,
                    pagar_local_uuid: rid, valor: v,
                    valor_pago_total: vpago, valor_restante: rest, status,
                });
            }
        }
    }

    let pagar_local_uuid = with_conn(|conn| resolve_pagar_local_uuid(conn, &input.pagar_id))?
        .ok_or_else(|| DbError(format!("título a pagar não encontrado: {}", input.pagar_id)))?;

    let dt_pag = input.data_pagamento_ms.unwrap_or(now_ms);
    let pag_uuid = random_uuid_v4();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let (valor_total, valor_pago_atual, status_atual, fornecedor_id): (f64, f64, String, Option<String>) =
            tx.query_row(
                "SELECT valor, valor_pago, status, fornecedor_id
                   FROM contas_pagar_local WHERE local_uuid=?1",
                params![pagar_local_uuid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?;
        if status_atual == "cancelado" {
            return Err(DbError("título cancelado — não permite baixa".into()).into());
        }
        let novo_pago = ((valor_pago_atual + input.valor) * 100.0).round() / 100.0;
        if novo_pago > valor_total + 0.005 {
            return Err(DbError(format!(
                "baixa excede o restante (restante={:.2}, baixa={:.2})",
                (valor_total - valor_pago_atual).max(0.0), input.valor
            )).into());
        }
        let novo_status = if novo_pago + 0.005 >= valor_total { "pago" } else { "aberto" };

        tx.execute(
            "INSERT INTO contas_pagar_pagtos_local(
                local_uuid, client_uuid, pagar_local_uuid, valor,
                forma_pagamento, data_pagamento_ms, observacao,
                operador_id, terminal_id, origem, sync_status, created_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'servidor','pending',?10)",
            params![
                pag_uuid, input.client_uuid, pagar_local_uuid, input.valor,
                input.forma_pagamento, dt_pag, input.observacao,
                input.operador_id, input.terminal_id, now_ms,
            ],
        )?;
        tx.execute(
            "UPDATE contas_pagar_local
                SET valor_pago = ?1,
                    status = ?2,
                    sync_status = CASE WHEN sync_status='synced' THEN 'pending' ELSE sync_status END,
                    updated_at_ms = ?3
              WHERE local_uuid = ?4",
            params![novo_pago, novo_status, now_ms, pagar_local_uuid],
        )?;
        let valor_restante = ((valor_total - novo_pago).max(0.0) * 100.0).round() / 100.0;
        tx.execute(
            "INSERT INTO financeiro_audit_local(
                ts_ms, evento, entidade, entidade_uuid, mov_local_uuid,
                client_uuid, cliente_id, fornecedor_id, operador_id, terminal_id,
                forma_pagamento, valor, valor_pago, valor_restante,
                status_anterior, status_atual, motivo, origem, sync_status
             ) VALUES (?1,'pagamento','pagar',?2,?3,?4,NULL,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'servidor','pending')",
            params![
                now_ms, pagar_local_uuid, pag_uuid, input.client_uuid,
                fornecedor_id, input.operador_id, input.terminal_id,
                input.forma_pagamento, input.valor, novo_pago, valor_restante,
                status_atual, novo_status, input.observacao,
            ],
        )?;
        tx.commit()?;
        Ok(BaixarPagarResult {
            local_uuid: pag_uuid, idempotente: false,
            pagar_local_uuid,
            valor: input.valor,
            valor_pago_total: novo_pago,
            valor_restante,
            status: novo_status.to_string(),
        })
    })
}

#[derive(Debug, Deserialize)]
pub struct CancelarPagarInput {
    pub pagar_id: String,
    #[serde(default)]
    pub motivo: Option<String>,
    #[serde(default)]
    pub operador_id: Option<String>,
    #[serde(default)]
    pub terminal_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CancelarPagarResult {
    pub pagar_local_uuid: String,
    pub idempotente: bool,
    pub status: String,
}

pub fn cancelar_pagar_local(
    input: CancelarPagarInput,
    now_ms: i64,
) -> DbResult<CancelarPagarResult> {
    let pagar_local_uuid = with_conn(|conn| resolve_pagar_local_uuid(conn, &input.pagar_id))?
        .ok_or_else(|| DbError(format!("título a pagar não encontrado: {}", input.pagar_id)))?;
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let (status_atual, fornecedor_id): (String, Option<String>) = tx.query_row(
            "SELECT status, fornecedor_id FROM contas_pagar_local WHERE local_uuid=?1",
            params![pagar_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if status_atual == "cancelado" {
            return Ok(CancelarPagarResult {
                pagar_local_uuid, idempotente: true, status: status_atual,
            });
        }
        tx.execute(
            "UPDATE contas_pagar_local
                SET status='cancelado',
                    sync_status = CASE WHEN sync_status='synced' THEN 'pending' ELSE sync_status END,
                    updated_at_ms = ?1
              WHERE local_uuid = ?2",
            params![now_ms, pagar_local_uuid],
        )?;
        tx.execute(
            "INSERT INTO financeiro_audit_local(
                ts_ms, evento, entidade, entidade_uuid, mov_local_uuid,
                client_uuid, cliente_id, fornecedor_id, operador_id, terminal_id,
                forma_pagamento, valor, valor_pago, valor_restante,
                status_anterior, status_atual, motivo, origem, sync_status
             ) VALUES (?1,'cancelamento','pagar',?2,NULL,NULL,NULL,?3,?4,?5,NULL,NULL,NULL,NULL,?6,'cancelado',?7,'servidor','pending')",
            params![
                now_ms, pagar_local_uuid, fornecedor_id,
                input.operador_id, input.terminal_id, status_atual, input.motivo,
            ],
        )?;
        tx.commit()?;
        Ok(CancelarPagarResult {
            pagar_local_uuid, idempotente: false, status: "cancelado".into(),
        })
    })
}



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
                           FROM caixa_local WHERE client_uuid = ?1",
                        params![cu],
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
                  WHERE status='aberto' AND operador_id = ?1
               ORDER BY data_abertura_ms DESC LIMIT 1",
                params![op],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)),
            )
        } else {
            conn.query_row(
                "SELECT local_uuid, valor_inicial FROM caixa_local
                  WHERE status='aberto' AND operador_id IS NULL
               ORDER BY data_abertura_ms DESC LIMIT 1",
                [],
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
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO caixa_local(
                local_uuid, client_uuid, remote_id, status, valor_inicial,
                observacao_abertura, operador_id, terminal_id,
                data_abertura_ms, created_at_ms, updated_at_ms
             ) VALUES (?1,?2,NULL,'aberto',?3,?4,?5,?6,?7,?7,?7)",
            params![
                local_uuid,
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
                local_uuid, client_uuid, action, caixa_local_uuid, payload,
                status, attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,'abrir',?3,?4,'pending',0,NULL,NULL,?5,?5,NULL,NULL)",
            params![local_uuid, input.client_uuid, local_uuid, payload_json, now_ms],
        )?;
        // v20 — auditoria local (mesma transação).
        tx.execute(
            "INSERT INTO caixa_audit_local(
                ts_ms, evento, caixa_local_uuid, mov_local_uuid, client_uuid,
                operador_id, terminal_id, valor, motivo, valor_informado,
                diferenca, origem, sync_status
             ) VALUES (?1,'abertura',?2,NULL,?3,?4,?5,?6,?7,NULL,NULL,'servidor','pending')",
            params![
                now_ms, local_uuid, input.client_uuid, input.operador_id,
                input.terminal_id, input.valor_inicial, input.observacao,
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

fn resolve_caixa_local_uuid(conn: &Connection, caixa_id: &str) -> DbResult<Option<String>> {
    // Tenta direto pelo local_uuid.
    let by_local: Option<String> = conn
        .query_row(
            "SELECT local_uuid FROM caixa_local WHERE local_uuid = ?1",
            params![caixa_id],
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
            "SELECT local_uuid FROM caixa_local WHERE remote_id = ?1",
            params![caixa_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    Ok(by_remote)
}

pub fn registrar_mov_caixa_local(
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
                           FROM caixa_movs_local WHERE client_uuid = ?1",
                        params![cu],
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

    let caixa_local_uuid = with_conn(|conn| resolve_caixa_local_uuid(conn, &input.caixa_id))?
        .ok_or_else(|| DbError(format!("caixa não encontrado localmente: {}", input.caixa_id)))?;

    // Verifica que o caixa ainda está aberto.
    let status: Option<String> = with_conn(|conn| {
        let s = conn
            .query_row(
                "SELECT status FROM caixa_local WHERE local_uuid = ?1",
                params![caixa_local_uuid],
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
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO caixa_movs_local(
                local_uuid, client_uuid, caixa_local_uuid, tipo, valor,
                motivo, operador_id, remote_id, created_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,?8)",
            params![
                local_uuid,
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
                local_uuid, client_uuid, action, caixa_local_uuid, payload,
                status, attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,'movimento',?3,?4,'pending',0,NULL,NULL,?5,?5,NULL,NULL)",
            params![
                local_uuid,
                input.client_uuid,
                caixa_local_uuid,
                payload_json,
                now_ms,
            ],
        )?;
        tx.execute(
            "UPDATE caixa_local SET updated_at_ms=?1 WHERE local_uuid=?2",
            params![now_ms, caixa_local_uuid],
        )?;
        // v20 — auditoria local (mesma transação).
        tx.execute(
            "INSERT INTO caixa_audit_local(
                ts_ms, evento, caixa_local_uuid, mov_local_uuid, client_uuid,
                operador_id, terminal_id, valor, motivo, valor_informado,
                diferenca, origem, sync_status
             ) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,?8,NULL,NULL,'servidor','pending')",
            params![
                now_ms,
                input.tipo,            // 'suprimento' ou 'sangria'
                caixa_local_uuid,
                local_uuid,
                input.client_uuid,
                input.operador_id,
                input.valor,
                input.motivo,
            ],
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
    pub idempotente: bool,
    pub valor_informado: f64,
}

pub fn fechar_caixa_local(
    input: LocalFecharCaixaInput,
    now_ms: i64,
) -> DbResult<LocalFecharCaixaResult> {
    if input.valor_informado < 0.0 {
        return Err(DbError("valor_informado não pode ser negativo".into()));
    }

    let caixa_local_uuid = with_conn(|conn| resolve_caixa_local_uuid(conn, &input.caixa_id))?
        .ok_or_else(|| DbError(format!("caixa não encontrado localmente: {}", input.caixa_id)))?;

    // Idempotência por client_uuid (no nível da outbox de fechamento).
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some(local_uuid) = with_conn(|conn| {
                let r = conn
                    .query_row(
                        "SELECT local_uuid FROM outbox_caixa
                          WHERE client_uuid=?1 AND action='fechar'",
                        params![cu],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?;
                Ok(r)
            })? {
                return Ok(LocalFecharCaixaResult {
                    local_uuid,
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
                "SELECT status FROM caixa_local WHERE local_uuid = ?1",
                params![caixa_local_uuid],
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
              WHERE local_uuid=?4",
            params![
                input.valor_informado,
                input.observacao,
                now_ms,
                caixa_local_uuid,
            ],
        )?;
        tx.execute(
            "INSERT INTO outbox_caixa(
                local_uuid, client_uuid, action, caixa_local_uuid, payload,
                status, attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,'fechar',?3,?4,'pending',0,NULL,NULL,?5,?5,NULL,NULL)",
            params![
                local_uuid,
                input.client_uuid,
                caixa_local_uuid,
                payload_json,
                now_ms,
            ],
        )?;

        // Lançamentos financeiros locais derivados.
        // Idempotente: limpa e reinsere sempre que o caixa é fechado.
        gerar_lancamentos_locais_para_caixa(&tx, &caixa_local_uuid, now_ms)?;

        // v20 — auditoria local de fechamento (mesma transação).
        // diferenca é a coluna do próprio caixa_local após o UPDATE acima
        // (não computamos esperado aqui — caixa_resumo_local faz isso).
        let oper: Option<String> = tx.query_row(
            "SELECT operador_id FROM caixa_local WHERE local_uuid=?1",
            params![caixa_local_uuid],
            |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let term: Option<String> = tx.query_row(
            "SELECT terminal_id FROM caixa_local WHERE local_uuid=?1",
            params![caixa_local_uuid],
            |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        tx.execute(
            "INSERT INTO caixa_audit_local(
                ts_ms, evento, caixa_local_uuid, mov_local_uuid, client_uuid,
                operador_id, terminal_id, valor, motivo, valor_informado,
                diferenca, origem, sync_status
             ) VALUES (?1,'fechamento',?2,?3,?4,?5,?6,NULL,?7,?8,NULL,'servidor','pending')",
            params![
                now_ms, caixa_local_uuid, local_uuid, input.client_uuid,
                oper, term, input.observacao, input.valor_informado,
            ],
        )?;

        tx.commit()?;
        Ok(LocalFecharCaixaResult {
            local_uuid,
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
        if (*valor).abs() < 0.005 { continue; }
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
            params![lid, caixa_local_uuid, categoria, forma, valor, descricao, now_ms],
        )?;
    }

    // 2) Suprimentos / sangrias — totais agregados.
    let (total_sup, total_san): (f64, f64) = tx.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN tipo='sangria'    THEN valor ELSE 0 END),0)
           FROM caixa_movs_local WHERE caixa_local_uuid=?1",
        params![caixa_local_uuid],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap_or((0.0, 0.0));

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
        gerar_lancamentos_locais_para_caixa(&tx, caixa_local_uuid, chrono::Utc::now().timestamp_millis())?;
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
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

// ---------------------------------------------------------------------------
// v11 — Financeiro local: listagem geral com filtros, resumo e CRUD manual
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
pub struct FinanceiroFiltro {
    pub tipo: Option<String>,            // 'entrada' | 'saida'
    pub categoria: Option<String>,
    pub origem: Option<String>,          // 'fechamento_caixa' | 'manual' | ...
    pub status: Option<String>,          // 'confirmado' | 'pendente' | 'cancelado'
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
        push_str_filter!(sql, args, &filtro.status, " AND COALESCE(status,'confirmado')=?{}");
        push_str_filter!(sql, args, &filtro.caixa_local_uuid, " AND caixa_local_uuid=?{}");
        push_str_filter!(sql, args, &filtro.venda_local_uuid, " AND venda_local_uuid=?{}");
        push_i64_filter!(sql, args, filtro.desde_ms, " AND COALESCE(data_competencia_ms,created_at_ms)>=?{}");
        push_i64_filter!(sql, args, filtro.ate_ms, " AND COALESCE(data_competencia_ms,created_at_ms)<=?{}");
        sql.push_str(" ORDER BY COALESCE(data_competencia_ms,created_at_ms) DESC, created_at_ms DESC");
        let limit = filtro.limit.unwrap_or(500).clamp(1, 5000);
        sql.push_str(&format!(" LIMIT {}", limit));

        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), map_lanc_row)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
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
    let rows = lancamentos_local_listar(&FinanceiroFiltro { limit: Some(5000), ..clone_filtro(filtro) })?;
    let mut r = FinanceiroResumo::default();
    use std::collections::BTreeMap;
    let mut por_cat: BTreeMap<(String, String), (f64, i64)> = BTreeMap::new();
    let mut por_ori: BTreeMap<(String, String), (f64, i64)> = BTreeMap::new();
    for l in rows.iter() {
        if l.status == "cancelado" { continue; }
        if l.tipo == "entrada" {
            r.total_entradas += l.valor;
            r.qtd_entradas += 1;
        } else if l.tipo == "saida" {
            r.total_saidas += l.valor;
            r.qtd_saidas += 1;
        }
        r.qtd_lancamentos += 1;
        let kc = (l.categoria.clone(), l.tipo.clone());
        let e = por_cat.entry(kc).or_insert((0.0, 0)); e.0 += l.valor; e.1 += 1;
        let ko = (l.origem.clone(), l.tipo.clone());
        let e = por_ori.entry(ko).or_insert((0.0, 0)); e.0 += l.valor; e.1 += 1;
    }
    r.saldo = r.total_entradas - r.total_saidas;
    r.por_categoria = por_cat.into_iter().map(|((chave, tipo), (valor, qtd))| FinanceiroResumoCat { chave, tipo, valor, qtd }).collect();
    r.por_origem = por_ori.into_iter().map(|((chave, tipo), (valor, qtd))| FinanceiroResumoCat { chave, tipo, valor, qtd }).collect();
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
    pub tipo: String,                       // 'entrada' | 'saida'
    pub categoria: String,
    pub valor: f64,
    pub forma_pagamento: Option<String>,
    pub descricao: Option<String>,
    pub status: Option<String>,             // default 'confirmado'
    pub caixa_local_uuid: Option<String>,
    pub venda_local_uuid: Option<String>,
    pub cliente_id: Option<String>,
    pub fornecedor_id: Option<String>,
    pub data_competencia_ms: Option<i64>,
    pub data_vencimento_ms: Option<i64>,
    pub data_pagamento_ms: Option<i64>,
    pub operador_id: Option<String>,
    pub client_uuid: Option<String>,        // idempotência
}

#[derive(Debug, Serialize)]
pub struct LancamentoManualResult {
    pub local_uuid: String,
    pub idempotente: bool,
}

pub fn lancamento_manual_inserir(input: &LancamentoManualInput) -> DbResult<LancamentoManualResult> {
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
    let status = input.status.clone().unwrap_or_else(|| "confirmado".to_string());
    let competencia = input.data_competencia_ms.unwrap_or(now_ms);

    with_conn(|conn| {
        // Idempotência via client_uuid (UNIQUE parcial).
        if let Some(cu) = input.client_uuid.as_deref() {
            let existing: Option<String> = conn.query_row(
                "SELECT local_uuid FROM lancamentos_financeiros_local WHERE client_uuid=?1",
                params![cu], |r| r.get(0),
            ).optional()?;
            if let Some(lu) = existing {
                return Ok(LancamentoManualResult { local_uuid: lu, idempotente: true });
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
                lid, caixa, input.tipo, input.categoria, input.forma_pagamento,
                input.valor, input.descricao, now_ms,
                status, input.venda_local_uuid, input.cliente_id, input.fornecedor_id,
                competencia, input.data_vencimento_ms, input.data_pagamento_ms,
                input.client_uuid, input.operador_id
            ],
        )?;

        // v12 — enfileira na outbox financeira para sync com o upstream.
        // Mapeia tipo local → tipo upstream (entrada→receita, saida→despesa).
        let tipo_upstream = if input.tipo == "entrada" { "receita" } else { "despesa" };
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
            params![outbox_id, input.client_uuid, lid, payload.to_string(), now_ms],
        )?;
        tx.commit()?;
        Ok(LancamentoManualResult { local_uuid: lid, idempotente: false })
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
    /// Quantidade de itens da outbox de caixa ainda não confirmados na nuvem
    /// (abertura/movimentos/fechamento) para este caixa. 0 = totalmente sincronizado.
    pub sync_pending: i64,
    /// Resumo textual do estado de sincronização: 'synced'|'pending'|'error'.
    pub sync_status: String,
}

pub fn caixa_resumo_local(caixa_local_uuid: &str) -> DbResult<Option<CaixaResumoLocal>> {
    with_conn(|conn| {
        // Cabeçalho do caixa.
        let cab: Option<(String, Option<String>, String, i64, Option<i64>,
            Option<String>, Option<String>, f64, Option<f64>)> = conn.query_row(
            "SELECT local_uuid, remote_id, status, data_abertura_ms, data_fechamento_ms,
                    operador_id, terminal_id, valor_inicial, valor_informado
               FROM caixa_local WHERE local_uuid=?1",
            params![caixa_local_uuid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                    r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
        ).optional()?;
        let Some(cab) = cab else { return Ok(None) };
        let (clu, remote_id, status, dt_ab, dt_fc, oper, term, valor_inicial, valor_informado) = cab;

        // Totais por forma de pagamento (pagamentos detalhados).
        let mut stmt = conn.prepare(
            "SELECT COALESCE(NULLIF(p.forma_pagamento,''),'indefinido') AS forma,
                    ROUND(SUM(p.valor),2) AS total,
                    COUNT(DISTINCT v.local_uuid) AS qtd
               FROM venda_pagamentos_local p
               JOIN vendas_local v ON v.local_uuid = p.venda_local_uuid
              WHERE v.caixa_local_uuid = ?1
            AND COALESCE(v.status,'ativa') <> 'cancelada'
              GROUP BY forma",
        )?;
        let mut por_forma_map: std::collections::BTreeMap<String, (f64, i64)> =
            std::collections::BTreeMap::new();
        for row in stmt.query_map(params![caixa_local_uuid], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, i64>(2)?))
        })? {
            let (f, t, q) = row?;
            let e = por_forma_map.entry(f).or_insert((0.0, 0));
            e.0 += t; e.1 += q;
        }
        drop(stmt);
        // Fallback cabeçalho.
        let mut stmt = conn.prepare(
            "SELECT COALESCE(NULLIF(v.forma_pagamento,''),'indefinido') AS forma,
                    ROUND(SUM(v.total),2) AS total,
                    COUNT(*) AS qtd
               FROM vendas_local v
              WHERE v.caixa_local_uuid = ?1
            AND COALESCE(v.status,'ativa') <> 'cancelada'
                AND NOT EXISTS (
                    SELECT 1 FROM venda_pagamentos_local p
                     WHERE p.venda_local_uuid = v.local_uuid
                )
              GROUP BY forma",
        )?;
        for row in stmt.query_map(params![caixa_local_uuid], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, i64>(2)?))
        })? {
            let (f, t, q) = row?;
            let e = por_forma_map.entry(f).or_insert((0.0, 0));
            e.0 += t; e.1 += q;
        }
        drop(stmt);

        let por_forma: Vec<CaixaResumoFormaRow> = por_forma_map
            .into_iter()
            .map(|(forma, (total, q))| CaixaResumoFormaRow { forma_pagamento: forma, total, qtd_vendas: q })
            .collect();

        // Total geral + qtd vendas.
        let (total_vendido, qtd_vendas): (f64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(total),0), COUNT(*)
               FROM vendas_local WHERE caixa_local_uuid = ?1
                 AND COALESCE(status,'ativa') <> 'cancelada'",
            params![caixa_local_uuid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap_or((0.0, 0));

        // Suprimentos / sangrias.
        let (total_sup, total_san): (f64, f64) = conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN tipo='sangria'    THEN valor ELSE 0 END),0)
               FROM caixa_movs_local WHERE caixa_local_uuid=?1",
            params![caixa_local_uuid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap_or((0.0, 0.0));

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

        // v20 — sync status (outbox de caixa para este caixa_local).
        let (pend, err_cnt): (i64, i64) = conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END),0)
               FROM outbox_caixa WHERE caixa_local_uuid=?1",
            params![caixa_local_uuid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap_or((0, 0));
        let sync_status = if err_cnt > 0 { "error" }
            else if pend > 0 { "pending" } else { "synced" }.to_string();

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
            sync_pending: pend,
            sync_status,
        }))
    })
}

/// Resolve um identificador (local_uuid OU remote_id) de caixa para o
/// `local_uuid` interno. Útil para os handlers HTTP aceitarem qualquer um.
pub fn resolve_caixa_id_publico(any_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| resolve_caixa_local_uuid(conn, any_id))
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

pub fn caixa_local_aberto(operador_id: Option<&str>) -> DbResult<Option<CaixaLocalRow>> {
    with_conn(|conn| {
        let row_opt: Option<(String, Option<String>, Option<String>, String, f64,
            Option<f64>, Option<f64>, Option<f64>, Option<String>, Option<String>,
            Option<String>, Option<String>, i64, Option<i64>)> = if let Some(op) = operador_id {
            conn.query_row(
                "SELECT local_uuid, remote_id, client_uuid, status, valor_inicial,
                        valor_informado, valor_esperado, diferenca,
                        observacao_abertura, observacao_fechamento,
                        operador_id, terminal_id,
                        data_abertura_ms, data_fechamento_ms
                   FROM caixa_local
                  WHERE status='aberto' AND operador_id = ?1
               ORDER BY data_abertura_ms DESC LIMIT 1",
                params![op],
                |r| Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                    r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
                    r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                )),
            ).optional()?
        } else {
            conn.query_row(
                "SELECT local_uuid, remote_id, client_uuid, status, valor_inicial,
                        valor_informado, valor_esperado, diferenca,
                        observacao_abertura, observacao_fechamento,
                        operador_id, terminal_id,
                        data_abertura_ms, data_fechamento_ms
                   FROM caixa_local
                  WHERE status='aberto'
               ORDER BY data_abertura_ms DESC LIMIT 1",
                [],
                |r| Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                    r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
                    r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                )),
            ).optional()?
        };
        let Some(row) = row_opt else { return Ok(None) };
        let (local_uuid, remote_id, client_uuid, status, valor_inicial,
             valor_informado, valor_esperado, diferenca,
             obs_ab, obs_fc, oper, term, dt_ab, dt_fc) = row;
        let (qtd, sup, san): (i64, f64, f64) = conn.query_row(
            "SELECT
                COUNT(*),
                COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN tipo='sangria' THEN valor ELSE 0 END),0)
               FROM caixa_movs_local WHERE caixa_local_uuid=?1",
            params![local_uuid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).unwrap_or((0, 0.0, 0.0));
        Ok(Some(CaixaLocalRow {
            local_uuid, remote_id, client_uuid, status, valor_inicial,
            valor_informado, valor_esperado, diferenca,
            observacao_abertura: obs_ab,
            observacao_fechamento: obs_fc,
            operador_id: oper, terminal_id: term,
            data_abertura_ms: dt_ab, data_fechamento_ms: dt_fc,
            qtd_movimentos: qtd, total_suprimentos: sup, total_sangrias: san,
        }))
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

pub fn outbox_caixa_stats() -> DbResult<OutboxCaixaStats> {
    with_conn(|conn| {
        let mut s = OutboxCaixaStats::default();
        let mut stmt = conn
            .prepare("SELECT status, COUNT(*) FROM outbox_caixa GROUP BY status")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
        let mut stmt = conn
            .prepare("SELECT action, COUNT(*) FROM outbox_caixa
                       WHERE status='pending' GROUP BY action")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for r in rows {
            let (act, n) = r?;
            match act.as_str() {
                "abrir" => s.pending_abrir = n,
                "movimento" => s.pending_movimento = n,
                "fechar" => s.pending_fechar = n,
                _ => {}
            }
        }
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_caixa WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_caixa
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_caixa
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1",
            params![now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_caixa WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
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
    kind: &str, now_ms: i64, attempted: i64, sent: i64, failed: i64,
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
        client_uuid: r.get(1)?,
        action: r.get(2)?,
        caixa_local_uuid: r.get(3)?,
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

pub fn outbox_caixa_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxCaixaItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let mut stmt = conn.prepare(
                "SELECT local_uuid, client_uuid, action, caixa_local_uuid, payload,
                        status, attempts, last_error, remote_id,
                        created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_caixa WHERE status = ?1
                  ORDER BY created_at_ms DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![st, limit], map_caixa_item)?;
            for r in rows { out.push(r?); }
        } else {
            let mut stmt = conn.prepare(
                "SELECT local_uuid, client_uuid, action, caixa_local_uuid, payload,
                        status, attempts, last_error, remote_id,
                        created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_caixa ORDER BY created_at_ms DESC LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], map_caixa_item)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

/// Próximo lote elegível ao scheduler — ordenado por created_at e respeitando
/// o backoff. Para preservar a ordem causal (abrir → movimento → fechar) de um
/// MESMO caixa, o scheduler envia em série e só prossegue para o próximo
/// item do MESMO caixa quando o anterior terminou.
pub fn outbox_caixa_pending_batch(limit: i64) -> DbResult<Vec<OutboxCaixaItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, action, caixa_local_uuid, payload,
                    status, attempts, last_error, remote_id,
                    created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_caixa
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1
              ORDER BY created_at_ms ASC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![now, limit], map_caixa_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_caixa_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxCaixaItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, action, caixa_local_uuid, payload,
                    status, attempts, last_error, remote_id,
                    created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_caixa WHERE status='pending'
              ORDER BY created_at_ms ASC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], map_caixa_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_caixa_get(local_uuid: &str) -> DbResult<Option<OutboxCaixaItem>> {
    with_conn(|conn| {
        let r = conn.query_row(
            "SELECT local_uuid, client_uuid, action, caixa_local_uuid, payload,
                    status, attempts, last_error, remote_id,
                    created_at_ms, updated_at_ms, sent_at_ms
               FROM outbox_caixa WHERE local_uuid=?1",
            params![local_uuid], map_caixa_item,
        ).optional()?;
        Ok(r)
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
        let action: Option<String> = tx.query_row(
            "SELECT action FROM outbox_caixa WHERE local_uuid=?1",
            params![local_uuid], |r| r.get::<_, String>(0),
        ).optional()?;
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
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_caixa WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?.unwrap_or(1);
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

pub fn outbox_caixa_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_caixa
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
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
    input: LocalCancelarVendaInput,
    now_ms: i64,
) -> DbResult<LocalCancelarVendaResult> {
    if input.venda_local_uuid.is_empty() {
        return Err(DbError("venda_local_uuid obrigatório".into()));
    }

    // Resolve venda. Aceita tanto local_uuid quanto client_uuid (sincronizado
    // ou não) — facilita o frontend que pode ter qualquer um dos dois.
    let venda_row: Option<(String, String, Option<String>, Option<String>)> = with_conn(|conn| {
        let r = conn.query_row(
            "SELECT local_uuid, COALESCE(status,'ativa'), caixa_local_uuid,
                    cancelamento_local_uuid
               FROM vendas_local
              WHERE local_uuid = ?1 OR client_uuid = ?1
              LIMIT 1",
            params![input.venda_local_uuid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).optional()?;
        Ok(r)
    })?;
    let (venda_uuid, status_atual, caixa_local_uuid, prev_canc) = venda_row
        .ok_or_else(|| DbError(format!("venda local não encontrada: {}", input.venda_local_uuid)))?;

    // Idempotente: já cancelada → devolve resumo anterior.
    if status_atual == "cancelada" {
        let canc_uuid = prev_canc.unwrap_or_default();
        let (qtd_itens, qtd_total) = with_conn(|conn| {
            let r = conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(quantidade),0)
                   FROM venda_itens_local WHERE venda_local_uuid = ?1",
                params![venda_uuid],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)),
            ).optional()?;
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
                let r = conn.query_row(
                    "SELECT local_uuid FROM outbox_cancelamentos_venda
                       WHERE client_uuid = ?1",
                    params![cu],
                    |r| r.get::<_, String>(0),
                ).optional()?;
                Ok(r)
            })? {
                let (qtd_itens, qtd_total) = with_conn(|conn| {
                    let r = conn.query_row(
                        "SELECT COUNT(*), COALESCE(SUM(quantidade),0)
                           FROM venda_itens_local WHERE venda_local_uuid = ?1",
                        params![venda_uuid],
                        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)),
                    ).optional()?;
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
        let r = conn.query_row(
            "SELECT remote_id FROM outbox_vendas WHERE local_uuid = ?1",
            params![venda_uuid],
            |r| r.get::<_, Option<String>>(0),
        ).optional()?;
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
    }).to_string();

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
              WHERE local_uuid=?6",
            params![
                now_ms,
                input.motivo,
                input.operador_id,
                input.client_uuid,
                cancelamento_local_uuid,
                venda_uuid,
            ],
        )?;

        // 2) Estorno de estoque — 1 movimentação 'devolucao' por item.
        let mut stmt = tx.prepare(
            "SELECT produto_id, quantidade
               FROM venda_itens_local
              WHERE venda_local_uuid = ?1
              ORDER BY id ASC",
        )?;
        let itens: Vec<(String, f64)> = stmt
            .query_map(params![venda_uuid], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        drop(stmt);

        let mut qtd_itens: i64 = 0;
        let mut qtd_total: f64 = 0.0;
        for (idx, (produto_id, quantidade)) in itens.iter().enumerate() {
            let mov_id = format!("{}-c{}", venda_uuid, idx);
            let variacao_id = String::new();
            let saldo_anterior = read_saldo_atual(&tx, produto_id, &variacao_id)?;
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
            }).to_string();
            tx.execute(
                "INSERT OR IGNORE INTO estoque_movimentacoes_local(
                    id, produto_id, variacao_id, tipo, quantidade,
                    saldo_anterior, saldo_posterior, custo_unitario,
                    origem, observacoes, data_movimentacao_ms,
                    payload, synced_at_ms
                 ) VALUES (?1,?2,?3,'devolucao',?4,?5,?6,NULL,'cancelamento_venda',
                           NULL,?7,?8,?7)",
                params![
                    mov_id,
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
                &tx, produto_id, &variacao_id,
                Some("devolucao"), *quantidade, now_ms,
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
                local_uuid, client_uuid, venda_local_uuid, venda_remote_id,
                motivo, operador_id, payload, status, attempts,
                last_error, remote_response,
                created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',0,NULL,NULL,?8,?8,NULL,NULL)",
            params![
                cancelamento_local_uuid,
                input.client_uuid,
                venda_uuid,
                venda_remote_id,
                input.motivo,
                input.operador_id,
                payload_json,
                now_ms,
            ],
        )?;

        // 5) Cancela quaisquer contas a receber locais geradas por esta venda.
        //    Não duplica estorno: usa a chave estável (venda_local_uuid) e só
        //    transiciona 'aberto' → 'cancelado'.
        tx.execute(
            "UPDATE contas_receber_local
                SET status='cancelado', updated_at_ms=?1
              WHERE venda_local_uuid=?2 AND status='aberto'",
            params![now_ms, venda_uuid],
        )?;

        // 6) Auditoria local do cancelamento (v19).
        tx.execute(
            "INSERT INTO vendas_audit_local(
                ts_ms, evento, venda_local_uuid, client_uuid, cliente_id,
                operador_id, terminal_id, forma_pagamento, qtd_itens, total,
                motivo, origem, sync_status
             ) VALUES (?1,'cancelada',?2,?3,NULL,?4,NULL,NULL,?5,?6,?7,'cancelamento','pending')",
            params![
                now_ms,
                venda_uuid,
                input.client_uuid,
                input.operador_id,
                qtd_itens,
                qtd_total,
                input.motivo,
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

pub fn outbox_cancel_stats() -> DbResult<OutboxCancelStats> {
    with_conn(|conn| {
        let mut s = OutboxCancelStats::default();
        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM outbox_cancelamentos_venda GROUP BY status",
        )?;
        for r in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
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
            "SELECT MAX(sent_at_ms) FROM outbox_cancelamentos_venda WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).unwrap_or(None);
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_cancelamentos_venda
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).unwrap_or(None);
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_cancelamentos_venda
              WHERE status='pending'
                AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms <= ?1)",
            params![chrono::Utc::now().timestamp_millis()], |r| r.get::<_, i64>(0),
        ).unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(next_attempt_at_ms) FROM outbox_cancelamentos_venda
              WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).unwrap_or(None);
        // Cancelamentos pendentes cuja venda ainda não foi sincronizada.
        s.waiting_venda_sync = conn.query_row(
            "SELECT COUNT(*)
               FROM outbox_cancelamentos_venda c
              WHERE c.status='pending'
                AND (c.venda_remote_id IS NULL OR c.venda_remote_id = '')
                AND NOT EXISTS (
                    SELECT 1 FROM outbox_vendas v
                     WHERE v.local_uuid = c.venda_local_uuid
                       AND v.status='sent'
                       AND v.remote_id IS NOT NULL
                )",
            [], |r| r.get::<_, i64>(0),
        ).unwrap_or(0);
        Ok(s)
    })
}

#[derive(Debug, Serialize)]
pub struct OutboxCancelItem {
    pub local_uuid: String,
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
        client_uuid: r.get(1)?,
        venda_local_uuid: r.get(2)?,
        venda_remote_id: r.get(3)?,
        motivo: r.get(4)?,
        status: r.get(5)?,
        attempts: r.get(6)?,
        last_error: r.get(7)?,
        created_at_ms: r.get(8)?,
        updated_at_ms: r.get(9)?,
        sent_at_ms: r.get(10)?,
        next_attempt_at_ms: r.get(11)?,
    })
}

pub fn outbox_cancel_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxCancelItem>> {
    with_conn(|conn| {
        let (sql, has_status) = match only_status {
            Some(_) => (
                "SELECT local_uuid, client_uuid, venda_local_uuid, venda_remote_id,
                        motivo, status, attempts, last_error,
                        created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
                   FROM outbox_cancelamentos_venda
                  WHERE status = ?1
               ORDER BY created_at_ms DESC LIMIT ?2",
                true,
            ),
            None => (
                "SELECT local_uuid, client_uuid, venda_local_uuid, venda_remote_id,
                        motivo, status, attempts, last_error,
                        created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
                   FROM outbox_cancelamentos_venda
               ORDER BY created_at_ms DESC LIMIT ?1",
                false,
            ),
        };
        let mut stmt = conn.prepare(sql)?;
        let mut out = Vec::new();
        if has_status {
            let st = only_status.unwrap();
            for r in stmt.query_map(params![st, limit], map_cancel_item)? {
                out.push(r?);
            }
        } else {
            for r in stmt.query_map(params![limit], map_cancel_item)? {
                out.push(r?);
            }
        }
        Ok(out)
    })
}

pub fn outbox_cancel_pending_batch(limit: i64) -> DbResult<Vec<OutboxCancelItem>> {
    with_conn(|conn| {
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, venda_local_uuid, venda_remote_id,
                    motivo, status, attempts, last_error,
                    created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
               FROM outbox_cancelamentos_venda
              WHERE status='pending'
                AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms <= ?1)
           ORDER BY created_at_ms ASC LIMIT ?2",
        )?;
        let mut out = Vec::new();
        for r in stmt.query_map(params![now, limit], map_cancel_item)? {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn outbox_cancel_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxCancelItem>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT local_uuid, client_uuid, venda_local_uuid, venda_remote_id,
                    motivo, status, attempts, last_error,
                    created_at_ms, updated_at_ms, sent_at_ms, next_attempt_at_ms
               FROM outbox_cancelamentos_venda
              WHERE status='pending'
           ORDER BY created_at_ms ASC LIMIT ?1",
        )?;
        let mut out = Vec::new();
        for r in stmt.query_map(params![limit], map_cancel_item)? {
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
pub fn cancel_resolve_venda_remote(local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let stored: Option<String> = conn.query_row(
            "SELECT venda_remote_id FROM outbox_cancelamentos_venda WHERE local_uuid=?1",
            params![local_uuid],
            |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        if let Some(s) = stored {
            if !s.is_empty() { return Ok(Some(s)); }
        }
        let venda_local: Option<String> = conn.query_row(
            "SELECT venda_local_uuid FROM outbox_cancelamentos_venda WHERE local_uuid=?1",
            params![local_uuid],
            |r| r.get::<_, String>(0),
        ).optional()?;
        let Some(vl) = venda_local else { return Ok(None) };
        let remote: Option<String> = conn.query_row(
            "SELECT remote_id FROM outbox_vendas
              WHERE local_uuid=?1 AND status='sent'",
            params![vl],
            |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
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
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_cancelamentos_venda WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).unwrap_or(0);
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

pub fn outbox_cancel_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_cancelamentos_venda
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
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
        client_uuid: r.get(1)?,
        lanc_local_uuid: r.get(2)?,
        payload: r.get(3)?,
        status: r.get(4)?,
        attempts: r.get(5)?,
        last_error: r.get(6)?,
        remote_id: r.get(7)?,
        created_at_ms: r.get(8)?,
        updated_at_ms: r.get(9)?,
        sent_at_ms: r.get(10)?,
    })
}

const FIN_COLS: &str =
    "local_uuid, client_uuid, lanc_local_uuid, payload, status, attempts,
     last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

pub fn outbox_financeiro_stats() -> DbResult<OutboxFinanceiroStats> {
    with_conn(|conn| {
        let mut s = OutboxFinanceiroStats::default();
        let mut stmt = conn
            .prepare("SELECT status, COUNT(*) FROM outbox_financeiro GROUP BY status")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_financeiro WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_financeiro
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_financeiro
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1",
            params![now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_financeiro WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
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
    kind: &str, now_ms: i64, attempted: i64, sent: i64, failed: i64,
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

pub fn outbox_financeiro_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxFinanceiroItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let sql = format!(
                "SELECT {cols} FROM outbox_financeiro WHERE status=?1
                 ORDER BY created_at_ms DESC LIMIT ?2",
                cols = FIN_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![st, limit], map_fin_item)?;
            for r in rows { out.push(r?); }
        } else {
            let sql = format!(
                "SELECT {cols} FROM outbox_financeiro
                 ORDER BY created_at_ms DESC LIMIT ?1",
                cols = FIN_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![limit], map_fin_item)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

pub fn outbox_financeiro_pending_batch(limit: i64) -> DbResult<Vec<OutboxFinanceiroItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "SELECT {cols} FROM outbox_financeiro
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1
              ORDER BY created_at_ms ASC LIMIT ?2",
            cols = FIN_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![now, limit], map_fin_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_financeiro_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxFinanceiroItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = format!(
            "SELECT {cols} FROM outbox_financeiro WHERE status='pending'
             ORDER BY created_at_ms ASC LIMIT ?1",
            cols = FIN_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit], map_fin_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_financeiro_get(local_uuid: &str) -> DbResult<Option<OutboxFinanceiroItem>> {
    with_conn(|conn| {
        let sql = format!(
            "SELECT {cols} FROM outbox_financeiro WHERE local_uuid=?1",
            cols = FIN_COLS,
        );
        let r = conn.query_row(&sql, params![local_uuid], map_fin_item).optional()?;
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

pub fn outbox_financeiro_mark_sent(local_uuid: &str, remote_id: &str, response: &str, now_ms: i64) -> DbResult<()> {
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
        let lanc: Option<String> = tx.query_row(
            "SELECT lanc_local_uuid FROM outbox_financeiro WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
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
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_financeiro WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?.unwrap_or(1);
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

pub fn outbox_financeiro_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_financeiro
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
        )?;
        Ok(n as i64)
    })
}

// ============================================================================
// v18 — Outbox de clientes (cadastro offline-first)
// ============================================================================
//
// Modelo de dados:
//   * `clientes_local` — cache + projeção local da entidade. Para clientes
//     criados offline, o `id` recebe o `local_uuid` e `remote_id` fica NULL
//     até o push da outbox concluir.
//   * `outbox_clientes` — fila de operações pendentes por cliente.
//
// Colapso de operações pendentes (idempotência local):
//   - `criar` + `editar(s)` ainda na fila → patch no payload de `criar`,
//     sem novo item na fila.
//   - `criar` + `excluir` ainda na fila → ambos removidos (no-op).
//   - Qualquer `excluir` cancela `editar`/`alterar_status` pendentes do
//     mesmo cliente.
//   - `editar` consecutivos sobre cliente JÁ sincronizado → mantém apenas
//     o último (substitui payload).
//   - `alterar_status` consecutivos → mantém apenas o último.

#[derive(Debug, Serialize)]
pub struct ClienteLocalSnapshot {
    pub local_uuid: String,
    pub remote_id: Option<String>,
    pub id: String,
    pub sync_status: String,
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
    pub last_auto_flush_sent_ms: Option<i64>,
    pub last_auto_attempted: Option<i64>,
    pub last_auto_sent: Option<i64>,
    pub last_auto_failed: Option<i64>,
    pub last_manual_flush_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct OutboxClientesItem {
    pub local_uuid: String,
    pub client_uuid: Option<String>,
    pub cliente_local_uuid: String,
    pub cliente_remote_id: Option<String>,
    pub action: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

const CLI_COLS: &str =
    "local_uuid, client_uuid, cliente_local_uuid, cliente_remote_id, action, payload,
     status, attempts, last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

fn map_cli_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxClientesItem> {
    Ok(OutboxClientesItem {
        local_uuid: r.get(0)?,
        client_uuid: r.get(1)?,
        cliente_local_uuid: r.get(2)?,
        cliente_remote_id: r.get(3)?,
        action: r.get(4)?,
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

#[derive(Debug, Serialize)]
pub struct ClienteEnqueueResult {
    /// `local_uuid` do cliente (igual ao `id` quando criado offline; igual
    /// ao remote_id quando o cliente já existe na nuvem).
    pub cliente_local_uuid: String,
    /// `remote_id` se já conhecido (cliente vindo de snapshot), senão NULL.
    pub cliente_remote_id: Option<String>,
    /// `true` quando a operação foi colapsada com uma já pendente.
    pub idempotente: bool,
}

/// Helper: extrai um campo string opcional de um JSON value.
fn json_str_opt(v: &serde_json::Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// Cria cliente offline. Gera local_uuid, popula `clientes_local` e enfileira.
pub fn cliente_criar_local(payload: serde_json::Value) -> DbResult<ClienteEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        // Idempotência por client_uuid (mesma chamada repetida).
        let client_uuid = json_str_opt(&payload, "_client_uuid");
        if let Some(cu) = &client_uuid {
            let existing: Option<(String, Option<String>)> = tx.query_row(
                "SELECT cliente_local_uuid, cliente_remote_id
                   FROM outbox_clientes WHERE client_uuid=?1",
                params![cu], |r| Ok((r.get(0)?, r.get(1)?)),
            ).optional()?;
            if let Some((lid, rid)) = existing {
                tx.commit()?;
                return Ok(ClienteEnqueueResult {
                    cliente_local_uuid: lid,
                    cliente_remote_id: rid,
                    idempotente: true,
                });
            }
        }

        let local_uuid = random_uuid_v4();

        // Projeção mínima em clientes_local — usa `id = local_uuid` para que
        // a UI e leituras locais consigam referenciar imediatamente.
        let nome = json_str_opt(&payload, "_nome").unwrap_or_default();
        let nome_fantasia = json_str_opt(&payload, "_nome_fantasia");
        let documento = json_str_opt(&payload, "_documento");
        let status = json_str_opt(&payload, "_status").unwrap_or_else(|| "ativo".into());

        // Payload completo armazenado para a UI ler como se fosse um cliente real.
        let mut full = serde_json::json!({
            "id": &local_uuid,
            "local_uuid": &local_uuid,
            "remote_id": serde_json::Value::Null,
            "tipo": payload.get("_tipo").cloned().unwrap_or(serde_json::Value::Null),
            "nome": &nome,
            "nome_fantasia": &nome_fantasia,
            "documento": &documento,
            "inscricao_estadual": payload.get("_inscricao_estadual").cloned().unwrap_or(serde_json::Value::Null),
            "email": payload.get("_email").cloned().unwrap_or(serde_json::Value::Null),
            "telefone": payload.get("_telefone").cloned().unwrap_or(serde_json::Value::Null),
            "celular": payload.get("_celular").cloned().unwrap_or(serde_json::Value::Null),
            "data_nascimento": payload.get("_data_nascimento").cloned().unwrap_or(serde_json::Value::Null),
            "cep": payload.get("_cep").cloned().unwrap_or(serde_json::Value::Null),
            "logradouro": payload.get("_logradouro").cloned().unwrap_or(serde_json::Value::Null),
            "numero": payload.get("_numero").cloned().unwrap_or(serde_json::Value::Null),
            "complemento": payload.get("_complemento").cloned().unwrap_or(serde_json::Value::Null),
            "bairro": payload.get("_bairro").cloned().unwrap_or(serde_json::Value::Null),
            "cidade": payload.get("_cidade").cloned().unwrap_or(serde_json::Value::Null),
            "estado": payload.get("_estado").cloned().unwrap_or(serde_json::Value::Null),
            "observacoes": payload.get("_observacoes").cloned().unwrap_or(serde_json::Value::Null),
            "status": &status,
            "sync_status": "pending",
            "created_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms)
                .map(|d| d.to_rfc3339()).unwrap_or_default(),
        });
        if let Some(o) = full.as_object_mut() {
            o.entry("updated_at").or_insert(serde_json::Value::Null);
        }

        tx.execute(
            "INSERT INTO clientes_local(
                id, nome, nome_fantasia, documento, status, payload,
                updated_at_remote_ms, synced_at_ms, deleted_at_ms,
                local_uuid, remote_id, sync_status, last_error, created_offline_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6, NULL, ?7, NULL, ?1, NULL, 'pending', NULL, ?7)",
            params![local_uuid, nome, nome_fantasia, documento, status, full.to_string(), now_ms],
        )?;

        // Inserir no outbox. _client_uuid da RPC = local_uuid (idempotência ponta-a-ponta).
        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            o.insert("_client_uuid".into(), serde_json::Value::String(local_uuid.clone()));
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_clientes(
                local_uuid, client_uuid, cliente_local_uuid, cliente_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,NULL,'criar',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, client_uuid, local_uuid, rpc_payload.to_string(), now_ms],
        )?;

        tx.commit()?;
        Ok(ClienteEnqueueResult {
            cliente_local_uuid: local_uuid,
            cliente_remote_id: None,
            idempotente: false,
        })
    })
}

/// Edita cliente offline. Colapsa com `criar` pendente quando aplicável.
pub fn cliente_editar_local(
    cliente_local_uuid: &str,
    payload: serde_json::Value,
) -> DbResult<ClienteEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        // Resolve remote_id atual.
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM clientes_local WHERE local_uuid=?1",
            params![cliente_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        // Atualiza projeção local (payload completo).
        update_cliente_local_payload(&tx, cliente_local_uuid, &payload, now_ms)?;

        // 1) Há um `criar` pendente? → patch no payload do criar, sem novo item.
        let criar_pending: Option<(String, String)> = tx.query_row(
            "SELECT local_uuid, payload FROM outbox_clientes
              WHERE cliente_local_uuid=?1 AND action='criar'
                AND status IN ('pending','error')
              ORDER BY created_at_ms ASC LIMIT 1",
            params![cliente_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        if let Some((cid, raw)) = criar_pending {
            let mut prev: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
            if let (Some(prev_obj), Some(new_obj)) = (prev.as_object_mut(), payload.as_object()) {
                for (k, v) in new_obj {
                    if k == "_cliente_id" || k == "_client_uuid" { continue; }
                    prev_obj.insert(k.clone(), v.clone());
                }
            }
            tx.execute(
                "UPDATE outbox_clientes
                    SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![cid, prev.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(ClienteEnqueueResult {
                cliente_local_uuid: cliente_local_uuid.to_string(),
                cliente_remote_id: remote_id,
                idempotente: true,
            });
        }

        // 2) Editar consecutivo sobre cliente sincronizado: substitui o payload do
        //    último editar pendente (se existir).
        let edit_pending: Option<String> = tx.query_row(
            "SELECT local_uuid FROM outbox_clientes
              WHERE cliente_local_uuid=?1 AND action='editar'
                AND status IN ('pending','error')
              ORDER BY created_at_ms DESC LIMIT 1",
            params![cliente_local_uuid], |r| r.get(0),
        ).optional()?;
        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            if let Some(rid) = &remote_id {
                o.insert("_cliente_id".into(), serde_json::Value::String(rid.clone()));
            }
        }
        if let Some(eid) = edit_pending {
            tx.execute(
                "UPDATE outbox_clientes
                    SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![eid, rpc_payload.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(ClienteEnqueueResult {
                cliente_local_uuid: cliente_local_uuid.to_string(),
                cliente_remote_id: remote_id,
                idempotente: true,
            });
        }

        // 3) Insere novo editar.
        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_clientes(
                local_uuid, client_uuid, cliente_local_uuid, cliente_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'editar',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, cliente_local_uuid, remote_id, rpc_payload.to_string(), now_ms],
        )?;
        // Marca cliente como pending na projeção.
        tx.execute(
            "UPDATE clientes_local SET sync_status='pending' WHERE local_uuid=?1",
            params![cliente_local_uuid],
        )?;
        tx.commit()?;
        Ok(ClienteEnqueueResult {
            cliente_local_uuid: cliente_local_uuid.to_string(),
            cliente_remote_id: remote_id,
            idempotente: false,
        })
    })
}

/// Atualiza payload do cliente local mesclando os campos vindos do RPC payload.
fn update_cliente_local_payload(
    tx: &rusqlite::Connection,
    cliente_local_uuid: &str,
    payload: &serde_json::Value,
    now_ms: i64,
) -> DbResult<()> {
    let row: Option<String> = tx.query_row(
        "SELECT payload FROM clientes_local WHERE local_uuid=?1",
        params![cliente_local_uuid], |r| r.get(0),
    ).optional()?;
    let mut full: serde_json::Value = row
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    // Mapa _campo → campo
    if let (Some(o), Some(p)) = (full.as_object_mut(), payload.as_object()) {
        for (k, v) in p {
            if let Some(stripped) = k.strip_prefix('_') {
                if stripped == "client_uuid" || stripped == "cliente_id" { continue; }
                o.insert(stripped.to_string(), v.clone());
            }
        }
        o.insert("sync_status".into(), serde_json::Value::String("pending".into()));
    }
    let nome = full.get("nome").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let nome_fantasia = full.get("nome_fantasia").and_then(|v| v.as_str()).map(String::from);
    let documento = full.get("documento").and_then(|v| v.as_str()).map(String::from);
    let status = full.get("status").and_then(|v| v.as_str()).unwrap_or("ativo").to_string();
    tx.execute(
        "UPDATE clientes_local
            SET nome=?1, nome_fantasia=?2, documento=?3, status=?4,
                payload=?5, synced_at_ms=?6
          WHERE local_uuid=?7",
        params![nome, nome_fantasia, documento, status, full.to_string(), now_ms, cliente_local_uuid],
    )?;
    Ok(())
}

/// Alterar status (ativo/inativo) offline. Colapsa com criar/alterar_status pendentes.
pub fn cliente_alterar_status_local(
    cliente_local_uuid: &str,
    novo_status: &str,
) -> DbResult<ClienteEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM clientes_local WHERE local_uuid=?1",
            params![cliente_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        // Atualiza status na projeção.
        let row: Option<String> = tx.query_row(
            "SELECT payload FROM clientes_local WHERE local_uuid=?1",
            params![cliente_local_uuid], |r| r.get(0),
        ).optional()?;
        if let Some(raw) = row {
            let mut full: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
            if let Some(o) = full.as_object_mut() {
                o.insert("status".into(), serde_json::Value::String(novo_status.to_string()));
                o.insert("sync_status".into(), serde_json::Value::String("pending".into()));
            }
            tx.execute(
                "UPDATE clientes_local SET status=?1, payload=?2, sync_status='pending', synced_at_ms=?3
                  WHERE local_uuid=?4",
                params![novo_status, full.to_string(), now_ms, cliente_local_uuid],
            )?;
        }

        // Colapso com criar pendente: patcha _status no criar.
        let criar_pending: Option<(String, String)> = tx.query_row(
            "SELECT local_uuid, payload FROM outbox_clientes
              WHERE cliente_local_uuid=?1 AND action='criar' AND status IN ('pending','error')
              LIMIT 1",
            params![cliente_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        if let Some((cid, raw)) = criar_pending {
            let mut prev: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
            if let Some(o) = prev.as_object_mut() {
                o.insert("_status".into(), serde_json::Value::String(novo_status.to_string()));
            }
            tx.execute(
                "UPDATE outbox_clientes SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![cid, prev.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(ClienteEnqueueResult {
                cliente_local_uuid: cliente_local_uuid.to_string(),
                cliente_remote_id: remote_id,
                idempotente: true,
            });
        }

        // Colapso com alterar_status pendente: substitui payload.
        let last_st: Option<String> = tx.query_row(
            "SELECT local_uuid FROM outbox_clientes
              WHERE cliente_local_uuid=?1 AND action='alterar_status'
                AND status IN ('pending','error')
              ORDER BY created_at_ms DESC LIMIT 1",
            params![cliente_local_uuid], |r| r.get(0),
        ).optional()?;
        let rpc_payload = serde_json::json!({
            "_cliente_id": remote_id.clone().unwrap_or_default(),
            "_status": novo_status,
        });
        if let Some(sid) = last_st {
            tx.execute(
                "UPDATE outbox_clientes SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![sid, rpc_payload.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(ClienteEnqueueResult {
                cliente_local_uuid: cliente_local_uuid.to_string(),
                cliente_remote_id: remote_id,
                idempotente: true,
            });
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_clientes(
                local_uuid, client_uuid, cliente_local_uuid, cliente_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'alterar_status',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, cliente_local_uuid, remote_id, rpc_payload.to_string(), now_ms],
        )?;
        tx.commit()?;
        Ok(ClienteEnqueueResult {
            cliente_local_uuid: cliente_local_uuid.to_string(),
            cliente_remote_id: remote_id,
            idempotente: false,
        })
    })
}

/// Excluir cliente offline. Cancela criar/editar/alterar_status pendentes.
pub fn cliente_excluir_local(cliente_local_uuid: &str) -> DbResult<ClienteEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM clientes_local WHERE local_uuid=?1",
            params![cliente_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        // 1) Há `criar` pendente? → cancela criar e edits, marca cliente como deletado e nada vai pro servidor.
        let has_criar: bool = tx.query_row(
            "SELECT 1 FROM outbox_clientes
              WHERE cliente_local_uuid=?1 AND action='criar'
                AND status IN ('pending','error') LIMIT 1",
            params![cliente_local_uuid], |_| Ok(true),
        ).optional()?.is_some();

        // Cancela todas as ações pendentes/error desse cliente (criar/editar/status).
        tx.execute(
            "DELETE FROM outbox_clientes
              WHERE cliente_local_uuid=?1
                AND action IN ('criar','editar','alterar_status')
                AND status IN ('pending','error')",
            params![cliente_local_uuid],
        )?;

        if has_criar && remote_id.is_none() {
            // Cliente nunca chegou ao servidor — remoção local pura.
            tx.execute(
                "UPDATE clientes_local SET deleted_at_ms=?1, sync_status='synced', synced_at_ms=?1
                  WHERE local_uuid=?2",
                params![now_ms, cliente_local_uuid],
            )?;
            tx.commit()?;
            return Ok(ClienteEnqueueResult {
                cliente_local_uuid: cliente_local_uuid.to_string(),
                cliente_remote_id: None,
                idempotente: true,
            });
        }

        // 2) Cliente existe no servidor — enfileira excluir.
        let payload = serde_json::json!({
            "_cliente_id": remote_id.clone().unwrap_or_default(),
        });
        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_clientes(
                local_uuid, client_uuid, cliente_local_uuid, cliente_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'excluir',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, cliente_local_uuid, remote_id, payload.to_string(), now_ms],
        )?;
        // Marca como deletado localmente (UI esconde imediatamente).
        tx.execute(
            "UPDATE clientes_local SET deleted_at_ms=?1, sync_status='pending', synced_at_ms=?1
              WHERE local_uuid=?2",
            params![now_ms, cliente_local_uuid],
        )?;
        tx.commit()?;
        Ok(ClienteEnqueueResult {
            cliente_local_uuid: cliente_local_uuid.to_string(),
            cliente_remote_id: remote_id,
            idempotente: false,
        })
    })
}

// --------- Reads / push lifecycle ---------

pub fn outbox_clientes_get(local_uuid: &str) -> DbResult<Option<OutboxClientesItem>> {
    with_conn(|conn| {
        let sql = format!(
            "SELECT {cols} FROM outbox_clientes WHERE local_uuid=?1",
            cols = CLI_COLS,
        );
        let r = conn.query_row(&sql, params![local_uuid], map_cli_item).optional()?;
        Ok(r)
    })
}

pub fn outbox_clientes_pending_batch(limit: i64) -> DbResult<Vec<OutboxClientesItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "SELECT {cols} FROM outbox_clientes
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1
              ORDER BY created_at_ms ASC LIMIT ?2",
            cols = CLI_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![now, limit], map_cli_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_clientes_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxClientesItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = format!(
            "SELECT {cols} FROM outbox_clientes WHERE status='pending'
             ORDER BY created_at_ms ASC LIMIT ?1",
            cols = CLI_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit], map_cli_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_clientes_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxClientesItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let sql = format!(
                "SELECT {cols} FROM outbox_clientes WHERE status=?1
                 ORDER BY created_at_ms DESC LIMIT ?2",
                cols = CLI_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![st, limit], map_cli_item)?;
            for r in rows { out.push(r?); }
        } else {
            let sql = format!(
                "SELECT {cols} FROM outbox_clientes
                 ORDER BY created_at_ms DESC LIMIT ?1",
                cols = CLI_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![limit], map_cli_item)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

pub fn outbox_clientes_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_clientes
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

/// Sucesso. Para `criar`, propaga `remote_id` em `clientes_local` E nas linhas
/// pendentes do outbox que dependem desse cliente (editar/alterar_status/excluir).
pub fn outbox_clientes_mark_sent(
    local_uuid: &str,
    remote_id: &str,
    response: &str,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let item: Option<(String, String, Option<String>)> = tx.query_row(
            "SELECT cliente_local_uuid, action, cliente_remote_id
               FROM outbox_clientes WHERE local_uuid=?1",
            params![local_uuid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?;
        tx.execute(
            "UPDATE outbox_clientes
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, remote_response=?4, last_error=NULL,
                    next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id, response],
        )?;
        if let Some((cli_lid, action, _)) = item {
            if action == "criar" {
                // Propaga remote_id no cliente local.
                tx.execute(
                    "UPDATE clientes_local
                        SET remote_id=?1, sync_status='synced', last_error=NULL
                      WHERE local_uuid=?2",
                    params![remote_id, cli_lid],
                )?;
                // Atualiza ações dependentes que ainda não conheciam o remote_id.
                tx.execute(
                    "UPDATE outbox_clientes
                        SET cliente_remote_id=?1
                      WHERE cliente_local_uuid=?2 AND cliente_remote_id IS NULL",
                    params![remote_id, cli_lid],
                )?;
                // Patch _cliente_id em payloads de editar/alterar_status/excluir pendentes.
                let pendentes: Vec<(String, String, String)> = {
                    let mut stmt = tx.prepare(
                        "SELECT local_uuid, action, payload FROM outbox_clientes
                          WHERE cliente_local_uuid=?1 AND action <> 'criar'
                            AND status IN ('pending','error','sending')",
                    )?;
                    let rows = stmt.query_map(params![cli_lid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
                    let mut out = Vec::new();
                    for r in rows { out.push(r?); }
                    out
                };
                for (lid, _act, raw) in pendentes {
                    let mut p: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
                    if let Some(o) = p.as_object_mut() {
                        o.insert("_cliente_id".into(), serde_json::Value::String(remote_id.to_string()));
                    }
                    tx.execute(
                        "UPDATE outbox_clientes SET payload=?2 WHERE local_uuid=?1",
                        params![lid, p.to_string()],
                    )?;
                }
            } else {
                // editar / alterar_status / excluir → marca cliente como synced
                // (a menos que outras ações ainda estejam pendentes).
                let pendentes_outros: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM outbox_clientes
                      WHERE cliente_local_uuid=?1 AND status IN ('pending','sending')",
                    params![cli_lid], |r| r.get(0),
                ).optional()?.unwrap_or(0);
                if pendentes_outros == 0 {
                    tx.execute(
                        "UPDATE clientes_local SET sync_status='synced', last_error=NULL
                          WHERE local_uuid=?1",
                        params![cli_lid],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_clientes_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_clientes WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?.unwrap_or(1);
        let cli_lid: Option<String> = conn.query_row(
            "SELECT cliente_local_uuid FROM outbox_clientes WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_clientes
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
            if let Some(lid) = cli_lid {
                let _ = conn.execute(
                    "UPDATE clientes_local SET sync_status='error', last_error=?1
                      WHERE local_uuid=?2",
                    params![err, lid],
                );
            }
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_clientes
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_clientes_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_clientes
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
        )?;
        let _ = conn.execute(
            "UPDATE clientes_local SET sync_status='pending', last_error=NULL
              WHERE sync_status='error'",
            [],
        );
        Ok(n as i64)
    })
}

pub fn outbox_clientes_stats() -> DbResult<OutboxClientesStats> {
    with_conn(|conn| {
        let mut s = OutboxClientesStats::default();
        let mut stmt = conn.prepare("SELECT status, COUNT(*) FROM outbox_clientes GROUP BY status")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_clientes WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_clientes
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_clientes
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1",
            params![now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_clientes WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_cli_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_cli_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_cli_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_cli_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_cli_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_cli_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_clientes_record_flush_round(
    kind: &str, now_ms: i64, attempted: i64, sent: i64, failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_cli_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_cli_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_cli_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_cli_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_cli_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_cli_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

/// Resolve `local_uuid` a partir de qualquer id (local OU remoto). Útil pro adapter,
/// que recebe `cliente_id` da UI (que pode ser tanto local quanto remoto).
pub fn cliente_resolve_local_uuid(any_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let lid: Option<String> = conn.query_row(
            "SELECT local_uuid FROM clientes_local
              WHERE local_uuid=?1 OR remote_id=?1 OR id=?1
              LIMIT 1",
            params![any_id], |r| r.get(0),
        ).optional()?;
        Ok(lid)
    })
}

pub fn cliente_remote_id_for(local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let r: Option<Option<String>> = conn.query_row(
            "SELECT remote_id FROM clientes_local WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        Ok(r.flatten())
    })
}

// ============================================================================
// v19 — Outbox de fornecedores (cadastro offline-first)
// ============================================================================
// Espelha o padrão do v18 (clientes). Mesmas regras de colapso, propagação
// de remote_id e ordem causal (criar → editar/alterar_status/excluir).

#[derive(Debug, Serialize, Default)]
pub struct OutboxFornecedoresStats {
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
pub struct OutboxFornecedoresItem {
    pub local_uuid: String,
    pub client_uuid: Option<String>,
    pub fornecedor_local_uuid: String,
    pub fornecedor_remote_id: Option<String>,
    pub action: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

const FOR_COLS: &str =
    "local_uuid, client_uuid, fornecedor_local_uuid, fornecedor_remote_id, action, payload,
     status, attempts, last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

fn map_for_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxFornecedoresItem> {
    Ok(OutboxFornecedoresItem {
        local_uuid: r.get(0)?,
        client_uuid: r.get(1)?,
        fornecedor_local_uuid: r.get(2)?,
        fornecedor_remote_id: r.get(3)?,
        action: r.get(4)?,
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

#[derive(Debug, Serialize)]
pub struct FornecedorEnqueueResult {
    pub fornecedor_local_uuid: String,
    pub fornecedor_remote_id: Option<String>,
    pub idempotente: bool,
}

pub fn fornecedor_criar_local(payload: serde_json::Value) -> DbResult<FornecedorEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        let client_uuid = json_str_opt(&payload, "_client_uuid");
        if let Some(cu) = &client_uuid {
            let existing: Option<(String, Option<String>)> = tx.query_row(
                "SELECT fornecedor_local_uuid, fornecedor_remote_id
                   FROM outbox_fornecedores WHERE client_uuid=?1",
                params![cu], |r| Ok((r.get(0)?, r.get(1)?)),
            ).optional()?;
            if let Some((lid, rid)) = existing {
                tx.commit()?;
                return Ok(FornecedorEnqueueResult {
                    fornecedor_local_uuid: lid,
                    fornecedor_remote_id: rid,
                    idempotente: true,
                });
            }
        }

        let local_uuid = random_uuid_v4();
        let razao_social = json_str_opt(&payload, "_razao_social").unwrap_or_default();
        let nome_fantasia = json_str_opt(&payload, "_nome_fantasia");
        let documento = json_str_opt(&payload, "_documento");
        let status = json_str_opt(&payload, "_status").unwrap_or_else(|| "ativo".into());

        let mut full = serde_json::json!({
            "id": &local_uuid,
            "local_uuid": &local_uuid,
            "remote_id": serde_json::Value::Null,
            "tipo": payload.get("_tipo").cloned().unwrap_or(serde_json::Value::Null),
            "razao_social": &razao_social,
            "nome_fantasia": &nome_fantasia,
            "documento": &documento,
            "inscricao_estadual": payload.get("_inscricao_estadual").cloned().unwrap_or(serde_json::Value::Null),
            "email": payload.get("_email").cloned().unwrap_or(serde_json::Value::Null),
            "telefone": payload.get("_telefone").cloned().unwrap_or(serde_json::Value::Null),
            "contato_nome": payload.get("_contato_nome").cloned().unwrap_or(serde_json::Value::Null),
            "cep": payload.get("_cep").cloned().unwrap_or(serde_json::Value::Null),
            "logradouro": payload.get("_logradouro").cloned().unwrap_or(serde_json::Value::Null),
            "numero": payload.get("_numero").cloned().unwrap_or(serde_json::Value::Null),
            "complemento": payload.get("_complemento").cloned().unwrap_or(serde_json::Value::Null),
            "bairro": payload.get("_bairro").cloned().unwrap_or(serde_json::Value::Null),
            "cidade": payload.get("_cidade").cloned().unwrap_or(serde_json::Value::Null),
            "estado": payload.get("_estado").cloned().unwrap_or(serde_json::Value::Null),
            "observacoes": payload.get("_observacoes").cloned().unwrap_or(serde_json::Value::Null),
            "status": &status,
            "sync_status": "pending",
            "created_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms)
                .map(|d| d.to_rfc3339()).unwrap_or_default(),
        });
        if let Some(o) = full.as_object_mut() {
            o.entry("updated_at").or_insert(serde_json::Value::Null);
        }

        tx.execute(
            "INSERT INTO fornecedores_local(
                id, razao_social, nome_fantasia, documento, status, payload,
                updated_at_remote_ms, synced_at_ms, deleted_at_ms,
                local_uuid, remote_id, sync_status, last_error, created_offline_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6, NULL, ?7, NULL, ?1, NULL, 'pending', NULL, ?7)",
            params![local_uuid, razao_social, nome_fantasia, documento, status, full.to_string(), now_ms],
        )?;

        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            o.insert("_client_uuid".into(), serde_json::Value::String(local_uuid.clone()));
        }
        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_fornecedores(
                local_uuid, client_uuid, fornecedor_local_uuid, fornecedor_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,NULL,'criar',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, client_uuid, local_uuid, rpc_payload.to_string(), now_ms],
        )?;
        tx.commit()?;
        Ok(FornecedorEnqueueResult {
            fornecedor_local_uuid: local_uuid,
            fornecedor_remote_id: None,
            idempotente: false,
        })
    })
}

fn update_fornecedor_local_payload(
    tx: &rusqlite::Connection,
    fornecedor_local_uuid: &str,
    payload: &serde_json::Value,
    now_ms: i64,
) -> DbResult<()> {
    let row: Option<String> = tx.query_row(
        "SELECT payload FROM fornecedores_local WHERE local_uuid=?1",
        params![fornecedor_local_uuid], |r| r.get(0),
    ).optional()?;
    let mut full: serde_json::Value = row
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let (Some(o), Some(p)) = (full.as_object_mut(), payload.as_object()) {
        for (k, v) in p {
            if let Some(stripped) = k.strip_prefix('_') {
                if stripped == "client_uuid" || stripped == "fornecedor_id" { continue; }
                o.insert(stripped.to_string(), v.clone());
            }
        }
        o.insert("sync_status".into(), serde_json::Value::String("pending".into()));
    }
    let razao_social = full.get("razao_social").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let nome_fantasia = full.get("nome_fantasia").and_then(|v| v.as_str()).map(String::from);
    let documento = full.get("documento").and_then(|v| v.as_str()).map(String::from);
    let status = full.get("status").and_then(|v| v.as_str()).unwrap_or("ativo").to_string();
    tx.execute(
        "UPDATE fornecedores_local
            SET razao_social=?1, nome_fantasia=?2, documento=?3, status=?4,
                payload=?5, synced_at_ms=?6
          WHERE local_uuid=?7",
        params![razao_social, nome_fantasia, documento, status, full.to_string(), now_ms, fornecedor_local_uuid],
    )?;
    Ok(())
}

pub fn fornecedor_editar_local(
    fornecedor_local_uuid: &str,
    payload: serde_json::Value,
) -> DbResult<FornecedorEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM fornecedores_local WHERE local_uuid=?1",
            params![fornecedor_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        update_fornecedor_local_payload(&tx, fornecedor_local_uuid, &payload, now_ms)?;

        let criar_pending: Option<(String, String)> = tx.query_row(
            "SELECT local_uuid, payload FROM outbox_fornecedores
              WHERE fornecedor_local_uuid=?1 AND action='criar'
                AND status IN ('pending','error')
              ORDER BY created_at_ms ASC LIMIT 1",
            params![fornecedor_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        if let Some((cid, raw)) = criar_pending {
            let mut prev: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
            if let (Some(prev_obj), Some(new_obj)) = (prev.as_object_mut(), payload.as_object()) {
                for (k, v) in new_obj {
                    if k == "_fornecedor_id" || k == "_client_uuid" { continue; }
                    prev_obj.insert(k.clone(), v.clone());
                }
            }
            tx.execute(
                "UPDATE outbox_fornecedores
                    SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![cid, prev.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(FornecedorEnqueueResult {
                fornecedor_local_uuid: fornecedor_local_uuid.to_string(),
                fornecedor_remote_id: remote_id,
                idempotente: true,
            });
        }

        let edit_pending: Option<String> = tx.query_row(
            "SELECT local_uuid FROM outbox_fornecedores
              WHERE fornecedor_local_uuid=?1 AND action='editar'
                AND status IN ('pending','error')
              ORDER BY created_at_ms DESC LIMIT 1",
            params![fornecedor_local_uuid], |r| r.get(0),
        ).optional()?;
        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            if let Some(rid) = &remote_id {
                o.insert("_fornecedor_id".into(), serde_json::Value::String(rid.clone()));
            }
        }
        if let Some(eid) = edit_pending {
            tx.execute(
                "UPDATE outbox_fornecedores
                    SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![eid, rpc_payload.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(FornecedorEnqueueResult {
                fornecedor_local_uuid: fornecedor_local_uuid.to_string(),
                fornecedor_remote_id: remote_id,
                idempotente: true,
            });
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_fornecedores(
                local_uuid, client_uuid, fornecedor_local_uuid, fornecedor_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'editar',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, fornecedor_local_uuid, remote_id, rpc_payload.to_string(), now_ms],
        )?;
        tx.execute(
            "UPDATE fornecedores_local SET sync_status='pending' WHERE local_uuid=?1",
            params![fornecedor_local_uuid],
        )?;
        tx.commit()?;
        Ok(FornecedorEnqueueResult {
            fornecedor_local_uuid: fornecedor_local_uuid.to_string(),
            fornecedor_remote_id: remote_id,
            idempotente: false,
        })
    })
}

pub fn fornecedor_alterar_status_local(
    fornecedor_local_uuid: &str,
    novo_status: &str,
) -> DbResult<FornecedorEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM fornecedores_local WHERE local_uuid=?1",
            params![fornecedor_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        let row: Option<String> = tx.query_row(
            "SELECT payload FROM fornecedores_local WHERE local_uuid=?1",
            params![fornecedor_local_uuid], |r| r.get(0),
        ).optional()?;
        if let Some(raw) = row {
            let mut full: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
            if let Some(o) = full.as_object_mut() {
                o.insert("status".into(), serde_json::Value::String(novo_status.to_string()));
                o.insert("sync_status".into(), serde_json::Value::String("pending".into()));
            }
            tx.execute(
                "UPDATE fornecedores_local SET status=?1, payload=?2, sync_status='pending', synced_at_ms=?3
                  WHERE local_uuid=?4",
                params![novo_status, full.to_string(), now_ms, fornecedor_local_uuid],
            )?;
        }

        let criar_pending: Option<(String, String)> = tx.query_row(
            "SELECT local_uuid, payload FROM outbox_fornecedores
              WHERE fornecedor_local_uuid=?1 AND action='criar' AND status IN ('pending','error')
              LIMIT 1",
            params![fornecedor_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        if let Some((cid, raw)) = criar_pending {
            let mut prev: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
            if let Some(o) = prev.as_object_mut() {
                o.insert("_status".into(), serde_json::Value::String(novo_status.to_string()));
            }
            tx.execute(
                "UPDATE outbox_fornecedores SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![cid, prev.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(FornecedorEnqueueResult {
                fornecedor_local_uuid: fornecedor_local_uuid.to_string(),
                fornecedor_remote_id: remote_id,
                idempotente: true,
            });
        }

        let last_st: Option<String> = tx.query_row(
            "SELECT local_uuid FROM outbox_fornecedores
              WHERE fornecedor_local_uuid=?1 AND action='alterar_status'
                AND status IN ('pending','error')
              ORDER BY created_at_ms DESC LIMIT 1",
            params![fornecedor_local_uuid], |r| r.get(0),
        ).optional()?;
        let rpc_payload = serde_json::json!({
            "_fornecedor_id": remote_id.clone().unwrap_or_default(),
            "_status": novo_status,
        });
        if let Some(sid) = last_st {
            tx.execute(
                "UPDATE outbox_fornecedores SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![sid, rpc_payload.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(FornecedorEnqueueResult {
                fornecedor_local_uuid: fornecedor_local_uuid.to_string(),
                fornecedor_remote_id: remote_id,
                idempotente: true,
            });
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_fornecedores(
                local_uuid, client_uuid, fornecedor_local_uuid, fornecedor_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'alterar_status',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, fornecedor_local_uuid, remote_id, rpc_payload.to_string(), now_ms],
        )?;
        tx.commit()?;
        Ok(FornecedorEnqueueResult {
            fornecedor_local_uuid: fornecedor_local_uuid.to_string(),
            fornecedor_remote_id: remote_id,
            idempotente: false,
        })
    })
}

pub fn fornecedor_excluir_local(fornecedor_local_uuid: &str) -> DbResult<FornecedorEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM fornecedores_local WHERE local_uuid=?1",
            params![fornecedor_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        let has_criar: bool = tx.query_row(
            "SELECT 1 FROM outbox_fornecedores
              WHERE fornecedor_local_uuid=?1 AND action='criar'
                AND status IN ('pending','error') LIMIT 1",
            params![fornecedor_local_uuid], |_| Ok(true),
        ).optional()?.is_some();

        tx.execute(
            "DELETE FROM outbox_fornecedores
              WHERE fornecedor_local_uuid=?1
                AND action IN ('criar','editar','alterar_status')
                AND status IN ('pending','error')",
            params![fornecedor_local_uuid],
        )?;

        if has_criar && remote_id.is_none() {
            tx.execute(
                "UPDATE fornecedores_local SET deleted_at_ms=?1, sync_status='synced', synced_at_ms=?1
                  WHERE local_uuid=?2",
                params![now_ms, fornecedor_local_uuid],
            )?;
            tx.commit()?;
            return Ok(FornecedorEnqueueResult {
                fornecedor_local_uuid: fornecedor_local_uuid.to_string(),
                fornecedor_remote_id: None,
                idempotente: true,
            });
        }

        let payload = serde_json::json!({
            "_fornecedor_id": remote_id.clone().unwrap_or_default(),
        });
        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_fornecedores(
                local_uuid, client_uuid, fornecedor_local_uuid, fornecedor_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'excluir',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, fornecedor_local_uuid, remote_id, payload.to_string(), now_ms],
        )?;
        tx.execute(
            "UPDATE fornecedores_local SET deleted_at_ms=?1, sync_status='pending', synced_at_ms=?1
              WHERE local_uuid=?2",
            params![now_ms, fornecedor_local_uuid],
        )?;
        tx.commit()?;
        Ok(FornecedorEnqueueResult {
            fornecedor_local_uuid: fornecedor_local_uuid.to_string(),
            fornecedor_remote_id: remote_id,
            idempotente: false,
        })
    })
}

pub fn outbox_fornecedores_get(local_uuid: &str) -> DbResult<Option<OutboxFornecedoresItem>> {
    with_conn(|conn| {
        let sql = format!(
            "SELECT {cols} FROM outbox_fornecedores WHERE local_uuid=?1",
            cols = FOR_COLS,
        );
        let r = conn.query_row(&sql, params![local_uuid], map_for_item).optional()?;
        Ok(r)
    })
}

pub fn outbox_fornecedores_pending_batch(limit: i64) -> DbResult<Vec<OutboxFornecedoresItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "SELECT {cols} FROM outbox_fornecedores
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1
              ORDER BY created_at_ms ASC LIMIT ?2",
            cols = FOR_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![now, limit], map_for_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_fornecedores_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxFornecedoresItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = format!(
            "SELECT {cols} FROM outbox_fornecedores WHERE status='pending'
             ORDER BY created_at_ms ASC LIMIT ?1",
            cols = FOR_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit], map_for_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_fornecedores_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxFornecedoresItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let sql = format!(
                "SELECT {cols} FROM outbox_fornecedores WHERE status=?1
                 ORDER BY created_at_ms DESC LIMIT ?2",
                cols = FOR_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![st, limit], map_for_item)?;
            for r in rows { out.push(r?); }
        } else {
            let sql = format!(
                "SELECT {cols} FROM outbox_fornecedores
                 ORDER BY created_at_ms DESC LIMIT ?1",
                cols = FOR_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![limit], map_for_item)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

pub fn outbox_fornecedores_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_fornecedores
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_fornecedores_mark_sent(
    local_uuid: &str,
    remote_id: &str,
    response: &str,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let item: Option<(String, String, Option<String>)> = tx.query_row(
            "SELECT fornecedor_local_uuid, action, fornecedor_remote_id
               FROM outbox_fornecedores WHERE local_uuid=?1",
            params![local_uuid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?;
        tx.execute(
            "UPDATE outbox_fornecedores
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, remote_response=?4, last_error=NULL,
                    next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id, response],
        )?;
        if let Some((for_lid, action, _)) = item {
            if action == "criar" {
                tx.execute(
                    "UPDATE fornecedores_local
                        SET remote_id=?1, sync_status='synced', last_error=NULL
                      WHERE local_uuid=?2",
                    params![remote_id, for_lid],
                )?;
                tx.execute(
                    "UPDATE outbox_fornecedores
                        SET fornecedor_remote_id=?1
                      WHERE fornecedor_local_uuid=?2 AND fornecedor_remote_id IS NULL",
                    params![remote_id, for_lid],
                )?;
                let pendentes: Vec<(String, String, String)> = {
                    let mut stmt = tx.prepare(
                        "SELECT local_uuid, action, payload FROM outbox_fornecedores
                          WHERE fornecedor_local_uuid=?1 AND action <> 'criar'
                            AND status IN ('pending','error','sending')",
                    )?;
                    let rows = stmt.query_map(params![for_lid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
                    let mut out = Vec::new();
                    for r in rows { out.push(r?); }
                    out
                };
                for (lid, _act, raw) in pendentes {
                    let mut p: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
                    if let Some(o) = p.as_object_mut() {
                        o.insert("_fornecedor_id".into(), serde_json::Value::String(remote_id.to_string()));
                    }
                    tx.execute(
                        "UPDATE outbox_fornecedores SET payload=?2 WHERE local_uuid=?1",
                        params![lid, p.to_string()],
                    )?;
                }
            } else {
                let pendentes_outros: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM outbox_fornecedores
                      WHERE fornecedor_local_uuid=?1 AND status IN ('pending','sending')",
                    params![for_lid], |r| r.get(0),
                ).optional()?.unwrap_or(0);
                if pendentes_outros == 0 {
                    tx.execute(
                        "UPDATE fornecedores_local SET sync_status='synced', last_error=NULL
                          WHERE local_uuid=?1",
                        params![for_lid],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_fornecedores_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_fornecedores WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?.unwrap_or(1);
        let for_lid: Option<String> = conn.query_row(
            "SELECT fornecedor_local_uuid FROM outbox_fornecedores WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_fornecedores
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
            if let Some(lid) = for_lid {
                let _ = conn.execute(
                    "UPDATE fornecedores_local SET sync_status='error', last_error=?1
                      WHERE local_uuid=?2",
                    params![err, lid],
                );
            }
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_fornecedores
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_fornecedores_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_fornecedores
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
        )?;
        let _ = conn.execute(
            "UPDATE fornecedores_local SET sync_status='pending', last_error=NULL
              WHERE sync_status='error'",
            [],
        );
        Ok(n as i64)
    })
}

pub fn outbox_fornecedores_stats() -> DbResult<OutboxFornecedoresStats> {
    with_conn(|conn| {
        let mut s = OutboxFornecedoresStats::default();
        let mut stmt = conn.prepare("SELECT status, COUNT(*) FROM outbox_fornecedores GROUP BY status")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_fornecedores WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_fornecedores
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_fornecedores
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1",
            params![now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_fornecedores WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_for_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_for_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_for_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_for_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_for_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_for_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_fornecedores_record_flush_round(
    kind: &str, now_ms: i64, attempted: i64, sent: i64, failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_for_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_for_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_for_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_for_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_for_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_for_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

pub fn fornecedor_resolve_local_uuid(any_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let lid: Option<String> = conn.query_row(
            "SELECT local_uuid FROM fornecedores_local
              WHERE local_uuid=?1 OR remote_id=?1 OR id=?1
              LIMIT 1",
            params![any_id], |r| r.get(0),
        ).optional()?;
        Ok(lid)
    })
}

pub fn fornecedor_remote_id_for(local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let r: Option<Option<String>> = conn.query_row(
            "SELECT remote_id FROM fornecedores_local WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        Ok(r.flatten())
    })
}

// =====================================================================
// COMPRAS — offline-first (Fase 2)
// =====================================================================
//
// Modelo: cada compra tem cabeçalho (`compras_local`) + N itens
// (`compra_itens_local`). A criação enfileira UM item de outbox `criar`
// com o payload completo (cabeçalho + itens), espelhando a RPC
// `cloudAdapter.compras.criar`. Demais ações (alterar_status,
// editar_metadados, excluir, receber, receber_itens) são enfileiradas
// individualmente, com colapso quando ainda existe `criar` pendente.

#[derive(Debug, Serialize)]
pub struct CompraEnqueueResult {
    pub compra_local_uuid: String,
    pub compra_remote_id: Option<String>,
    pub idempotente: bool,
}

fn json_num_opt(v: &serde_json::Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}

fn compra_recompute_payload(
    tx: &rusqlite::Connection,
    compra_local_uuid: &str,
    now_ms: i64,
) -> DbResult<()> {
    // Recalcula subtotal/total e regera o payload JSON usado por
    // read_compras (que lê `compras_local.payload` direto).
    let raw: Option<String> = tx.query_row(
        "SELECT payload FROM compras_local WHERE local_uuid=?1",
        params![compra_local_uuid], |r| r.get(0),
    ).optional()?;
    let mut full: serde_json::Value = raw
        .as_deref().and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    // Soma a partir de compra_itens_local
    let mut stmt = tx.prepare(
        "SELECT local_uuid, remote_id, produto_id, variacao_id, descricao,
                quantidade, quantidade_recebida, preco_unitario, desconto, total
           FROM compra_itens_local WHERE compra_local_uuid=?1
          ORDER BY created_at_ms ASC",
    )?;
    let mut subtotal = 0f64;
    let mut itens_arr: Vec<serde_json::Value> = Vec::new();
    let rows = stmt.query_map(params![compra_local_uuid], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, f64>(5)?,
            r.get::<_, f64>(6)?,
            r.get::<_, f64>(7)?,
            r.get::<_, f64>(8)?,
            r.get::<_, f64>(9)?,
        ))
    })?;
    for row in rows {
        let (lid, rid, pid, var, desc, qtd, qrec, preco, desc_v, total) = row?;
        subtotal += total;
        itens_arr.push(serde_json::json!({
            "id": rid.clone().unwrap_or_else(|| lid.clone()),
            "local_uuid": lid,
            "produto_id": pid,
            "variacao_id": var,
            "descricao": desc,
            "quantidade": qtd,
            "quantidade_recebida": qrec,
            "preco_unitario": preco,
            "desconto": desc_v,
            "total": total,
        }));
    }
    let desconto = full.get("desconto").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let frete = full.get("frete").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let outros = full.get("outros").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let total = (subtotal - desconto + frete + outros).max(0.0);
    if let Some(o) = full.as_object_mut() {
        o.insert("subtotal".into(), serde_json::json!(subtotal));
        o.insert("total".into(), serde_json::json!(total));
        o.insert("itens".into(), serde_json::Value::Array(itens_arr));
        o.insert("sync_status".into(), serde_json::Value::String(
            o.get("sync_status").and_then(|v| v.as_str()).unwrap_or("pending").into(),
        ));
    }
    let status = full.get("status").and_then(|v| v.as_str()).unwrap_or("pendente").to_string();
    let numero = full.get("numero").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let fornecedor_id = full.get("fornecedor_id").and_then(|v| v.as_str()).map(String::from);
    let data_emissao_ms = full.get("data_emissao").and_then(|v| v.as_str()).and_then(parse_date_only_to_ms);
    tx.execute(
        "UPDATE compras_local
            SET numero=?1, fornecedor_id=?2, status=?3, data_emissao_ms=?4,
                payload=?5, synced_at_ms=?6
          WHERE local_uuid=?7",
        params![numero, fornecedor_id, status, data_emissao_ms, full.to_string(), now_ms, compra_local_uuid],
    )?;
    Ok(())
}

pub fn compra_criar_local(payload: serde_json::Value) -> DbResult<CompraEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        // Idempotência por client_uuid
        let client_uuid = json_str_opt(&payload, "_client_uuid");
        if let Some(cu) = &client_uuid {
            let existing: Option<(String, Option<String>)> = tx.query_row(
                "SELECT compra_local_uuid, compra_remote_id
                   FROM outbox_compras WHERE client_uuid=?1",
                params![cu], |r| Ok((r.get(0)?, r.get(1)?)),
            ).optional()?;
            if let Some((lid, rid)) = existing {
                tx.commit()?;
                return Ok(CompraEnqueueResult {
                    compra_local_uuid: lid,
                    compra_remote_id: rid,
                    idempotente: true,
                });
            }
        }

        let local_uuid = random_uuid_v4();
        let numero = json_str_opt(&payload, "_numero").unwrap_or_default();
        let fornecedor_id = json_str_opt(&payload, "_fornecedor_id");
        let data_emissao = json_str_opt(&payload, "_data_emissao")
            .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
        let data_prevista = json_str_opt(&payload, "_data_prevista");
        let data_vencimento = json_str_opt(&payload, "_data_vencimento");
        let numero_nf = json_str_opt(&payload, "_numero_nf");
        let serie_nf = json_str_opt(&payload, "_serie_nf");
        let observacoes = json_str_opt(&payload, "_observacoes");
        let desconto = json_num_opt(&payload, "_desconto").unwrap_or(0.0);
        let frete = json_num_opt(&payload, "_frete").unwrap_or(0.0);
        let outros = json_num_opt(&payload, "_outros").unwrap_or(0.0);
        let data_emissao_ms = parse_date_only_to_ms(&data_emissao);

        // Itens vêm em "_itens" como array de objetos.
        let itens_raw = payload.get("_itens").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if itens_raw.is_empty() {
            return Err(DbError("compra_criar_local: itens vazio".into()));
        }

        let mut subtotal = 0f64;
        let mut itens_full: Vec<serde_json::Value> = Vec::new();
        for it in &itens_raw {
            let item_local = random_uuid_v4();
            let produto_id = it.get("produto_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if produto_id.is_empty() { continue; }
            let variacao_id = it.get("variacao_id").and_then(|v| v.as_str()).map(String::from);
            let descricao = it.get("descricao").and_then(|v| v.as_str()).map(String::from);
            let quantidade = it.get("quantidade").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let preco_unitario = it.get("preco_unitario").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let desconto_item = it.get("desconto").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let total_item = (quantidade * preco_unitario - desconto_item).max(0.0);
            subtotal += total_item;

            tx.execute(
                "INSERT INTO compra_itens_local(
                    local_uuid, remote_id, compra_local_uuid, compra_remote_id,
                    produto_id, variacao_id, descricao,
                    quantidade, quantidade_recebida, preco_unitario, desconto, total,
                    sync_status, created_at_ms, updated_at_ms
                 ) VALUES (?1,NULL,?2,NULL,?3,?4,?5,?6,0,?7,?8,?9,'pending',?10,?10)",
                params![
                    item_local, local_uuid, produto_id, variacao_id, descricao,
                    quantidade, preco_unitario, desconto_item, total_item, now_ms
                ],
            )?;
            itens_full.push(serde_json::json!({
                "id": item_local,
                "local_uuid": item_local,
                "produto_id": produto_id,
                "variacao_id": variacao_id,
                "descricao": descricao,
                "quantidade": quantidade,
                "quantidade_recebida": 0,
                "preco_unitario": preco_unitario,
                "desconto": desconto_item,
                "total": total_item,
            }));
        }
        let total = (subtotal - desconto + frete + outros).max(0.0);

        // Fornecedor embutido (mantém formato da listagem cloud)
        let fornecedor_obj: serde_json::Value = if let Some(fid) = &fornecedor_id {
            let row: Option<(String, Option<String>)> = tx.query_row(
                "SELECT razao_social, nome_fantasia FROM fornecedores_local
                  WHERE remote_id=?1 OR local_uuid=?1 OR id=?1 LIMIT 1",
                params![fid], |r| Ok((r.get(0)?, r.get(1)?)),
            ).optional()?;
            match row {
                Some((rs, nf)) => serde_json::json!({
                    "id": fid, "razao_social": rs, "nome_fantasia": nf
                }),
                None => serde_json::json!({
                    "id": fid, "razao_social": "", "nome_fantasia": null
                }),
            }
        } else { serde_json::Value::Null };

        let full = serde_json::json!({
            "id": &local_uuid,
            "local_uuid": &local_uuid,
            "remote_id": serde_json::Value::Null,
            "numero": &numero,
            "fornecedor_id": &fornecedor_id,
            "data_emissao": &data_emissao,
            "data_prevista": &data_prevista,
            "data_vencimento": &data_vencimento,
            "data_recebimento": serde_json::Value::Null,
            "numero_nf": &numero_nf,
            "serie_nf": &serie_nf,
            "subtotal": subtotal,
            "desconto": desconto,
            "frete": frete,
            "outros": outros,
            "total": total,
            "status": "pendente",
            "observacoes": &observacoes,
            "fornecedor": fornecedor_obj,
            "itens": serde_json::Value::Array(itens_full),
            "sync_status": "pending",
            "created_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms)
                .map(|d| d.to_rfc3339()).unwrap_or_default(),
            "updated_at": serde_json::Value::Null,
        });

        tx.execute(
            "INSERT INTO compras_local(
                id, numero, fornecedor_id, status, data_emissao_ms,
                payload, updated_at_remote_ms, synced_at_ms, deleted_at_ms,
                local_uuid, remote_id, sync_status, last_error, created_offline_at_ms
             ) VALUES (?1,?2,?3,'pendente',?4,?5,NULL,?6,NULL,?1,NULL,'pending',NULL,?6)",
            params![local_uuid, numero, fornecedor_id, data_emissao_ms, full.to_string(), now_ms],
        )?;

        // Outbox 'criar' carrega o payload original (com `_client_uuid`
        // preenchido para idempotência ponta-a-ponta).
        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            o.insert("_client_uuid".into(), serde_json::Value::String(local_uuid.clone()));
        }
        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_compras(
                local_uuid, client_uuid, compra_local_uuid, compra_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,NULL,'criar',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, client_uuid, local_uuid, rpc_payload.to_string(), now_ms],
        )?;

        tx.commit()?;
        Ok(CompraEnqueueResult {
            compra_local_uuid: local_uuid,
            compra_remote_id: None,
            idempotente: false,
        })
    })
}

pub fn compra_resolve_local_uuid(any_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let lid: Option<String> = conn.query_row(
            "SELECT local_uuid FROM compras_local
              WHERE local_uuid=?1 OR remote_id=?1 OR id=?1
              LIMIT 1",
            params![any_id], |r| r.get(0),
        ).optional()?;
        Ok(lid)
    })
}

pub fn compra_remote_id_for(local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let r: Option<Option<String>> = conn.query_row(
            "SELECT remote_id FROM compras_local WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        Ok(r.flatten())
    })
}

#[allow(dead_code)]
fn compra_recompute_payload_safe(
    tx: &rusqlite::Connection, compra_local_uuid: &str, now_ms: i64,
) -> DbResult<()> {
    compra_recompute_payload(tx, compra_local_uuid, now_ms)
}

// -----------------------------------------------------------------
// Etapa 3 — editar_metadados, alterar_status, excluir
// -----------------------------------------------------------------
//
// Mesmo padrão usado em fornecedores: se ainda existe `criar` pendente,
// fundimos a mudança no payload do criar (colapso) e nunca enfileiramos
// uma segunda action. Caso contrário, colapsamos contra a última ação
// do mesmo tipo pendente; se nenhuma existir, enfileiramos uma nova.

/// Patch parcial em metadados editáveis da compra. Espelha
/// `cloudAdapter.compras.atualizarMetadados`. Os campos opcionais usam
/// `Option<Option<T>>` para distinguir "não enviado" de "definir como
/// null". O input vem como JSON com chaves `_data_vencimento`,
/// `_data_prevista`, `_fornecedor_id`, `_numero_nf`, `_serie_nf`,
/// `_observacoes` (presença = patch).
pub fn compra_editar_metadados_local(
    compra_local_uuid: &str,
    payload: serde_json::Value,
) -> DbResult<CompraEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM compras_local WHERE local_uuid=?1",
            params![compra_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        // Aplica patch local em compras_local.payload (e nas colunas
        // espelhadas relevantes).
        let raw: Option<String> = tx.query_row(
            "SELECT payload FROM compras_local WHERE local_uuid=?1",
            params![compra_local_uuid], |r| r.get(0),
        ).optional()?;
        if let Some(rs) = raw {
            let mut full: serde_json::Value = serde_json::from_str(&rs).unwrap_or(serde_json::json!({}));
            if let Some(o) = full.as_object_mut() {
                if let Some(v) = payload.get("_data_vencimento") {
                    o.insert("data_vencimento".into(), v.clone());
                }
                if let Some(v) = payload.get("_data_prevista") {
                    o.insert("data_prevista".into(), v.clone());
                }
                if let Some(v) = payload.get("_fornecedor_id") {
                    o.insert("fornecedor_id".into(), v.clone());
                    // Reembute fornecedor (best effort)
                    let fid = v.as_str().map(String::from);
                    let forn_obj: serde_json::Value = if let Some(fid) = fid.as_deref() {
                        let row: Option<(String, Option<String>)> = tx.query_row(
                            "SELECT razao_social, nome_fantasia FROM fornecedores_local
                              WHERE remote_id=?1 OR local_uuid=?1 OR id=?1 LIMIT 1",
                            params![fid], |r| Ok((r.get(0)?, r.get(1)?)),
                        ).optional()?;
                        match row {
                            Some((rs, nf)) => serde_json::json!({
                                "id": fid, "razao_social": rs, "nome_fantasia": nf
                            }),
                            None => serde_json::json!({
                                "id": fid, "razao_social": "", "nome_fantasia": null
                            }),
                        }
                    } else { serde_json::Value::Null };
                    o.insert("fornecedor".into(), forn_obj);
                }
                if let Some(v) = payload.get("_numero_nf") { o.insert("numero_nf".into(), v.clone()); }
                if let Some(v) = payload.get("_serie_nf") { o.insert("serie_nf".into(), v.clone()); }
                if let Some(v) = payload.get("_observacoes") { o.insert("observacoes".into(), v.clone()); }
                o.insert("sync_status".into(), serde_json::Value::String("pending".into()));
            }
            let numero = full.get("numero").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let fornecedor_id_col = full.get("fornecedor_id").and_then(|v| v.as_str()).map(String::from);
            let status_col = full.get("status").and_then(|v| v.as_str()).unwrap_or("pendente").to_string();
            let data_emissao_ms = full.get("data_emissao").and_then(|v| v.as_str()).and_then(parse_date_only_to_ms);
            tx.execute(
                "UPDATE compras_local
                    SET numero=?1, fornecedor_id=?2, status=?3, data_emissao_ms=?4,
                        payload=?5, sync_status='pending', synced_at_ms=?6
                  WHERE local_uuid=?7",
                params![numero, fornecedor_id_col, status_col, data_emissao_ms,
                        full.to_string(), now_ms, compra_local_uuid],
            )?;
        }

        // Colapso 1: se `criar` está pendente, mescla os _campos no payload do criar.
        let criar_pending: Option<(String, String)> = tx.query_row(
            "SELECT local_uuid, payload FROM outbox_compras
              WHERE compra_local_uuid=?1 AND action='criar'
                AND status IN ('pending','error')
              ORDER BY created_at_ms ASC LIMIT 1",
            params![compra_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        if let Some((cid, raw)) = criar_pending {
            let mut prev: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
            if let (Some(prev_obj), Some(new_obj)) = (prev.as_object_mut(), payload.as_object()) {
                for (k, v) in new_obj {
                    if k == "_compra_id" { continue; }
                    prev_obj.insert(k.clone(), v.clone());
                }
            }
            tx.execute(
                "UPDATE outbox_compras
                    SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![cid, prev.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(CompraEnqueueResult {
                compra_local_uuid: compra_local_uuid.to_string(),
                compra_remote_id: remote_id,
                idempotente: true,
            });
        }

        // Colapso 2: se já há `editar_metadados` pendente, mescla.
        let edit_pending: Option<(String, String)> = tx.query_row(
            "SELECT local_uuid, payload FROM outbox_compras
              WHERE compra_local_uuid=?1 AND action='editar_metadados'
                AND status IN ('pending','error')
              ORDER BY created_at_ms DESC LIMIT 1",
            params![compra_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            if let Some(rid) = &remote_id {
                o.insert("_compra_id".into(), serde_json::Value::String(rid.clone()));
            }
        }
        if let Some((eid, raw)) = edit_pending {
            let mut prev: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
            if let (Some(prev_obj), Some(new_obj)) = (prev.as_object_mut(), rpc_payload.as_object()) {
                for (k, v) in new_obj {
                    prev_obj.insert(k.clone(), v.clone());
                }
            }
            tx.execute(
                "UPDATE outbox_compras
                    SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![eid, prev.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(CompraEnqueueResult {
                compra_local_uuid: compra_local_uuid.to_string(),
                compra_remote_id: remote_id,
                idempotente: true,
            });
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_compras(
                local_uuid, client_uuid, compra_local_uuid, compra_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'editar_metadados',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, compra_local_uuid, remote_id, rpc_payload.to_string(), now_ms],
        )?;
        tx.commit()?;
        Ok(CompraEnqueueResult {
            compra_local_uuid: compra_local_uuid.to_string(),
            compra_remote_id: remote_id,
            idempotente: false,
        })
    })
}

/// Altera o status da compra. Payload upstream esperado:
/// `{ _id, _status }` (espelha `cloudAdapter.compras.atualizarStatus`).
pub fn compra_alterar_status_local(
    compra_local_uuid: &str,
    novo_status: &str,
) -> DbResult<CompraEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM compras_local WHERE local_uuid=?1",
            params![compra_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        // Aplica localmente
        let raw: Option<String> = tx.query_row(
            "SELECT payload FROM compras_local WHERE local_uuid=?1",
            params![compra_local_uuid], |r| r.get(0),
        ).optional()?;
        if let Some(rs) = raw {
            let mut full: serde_json::Value = serde_json::from_str(&rs).unwrap_or(serde_json::json!({}));
            if let Some(o) = full.as_object_mut() {
                o.insert("status".into(), serde_json::Value::String(novo_status.to_string()));
                o.insert("sync_status".into(), serde_json::Value::String("pending".into()));
            }
            tx.execute(
                "UPDATE compras_local SET status=?1, payload=?2, sync_status='pending', synced_at_ms=?3
                  WHERE local_uuid=?4",
                params![novo_status, full.to_string(), now_ms, compra_local_uuid],
            )?;
        }

        // Colapso 1: criar pendente → patch no _status do criar (e no
        // espelho status do payload completo, se presente).
        let criar_pending: Option<(String, String)> = tx.query_row(
            "SELECT local_uuid, payload FROM outbox_compras
              WHERE compra_local_uuid=?1 AND action='criar'
                AND status IN ('pending','error')
              LIMIT 1",
            params![compra_local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        if let Some((cid, raw)) = criar_pending {
            let mut prev: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
            if let Some(o) = prev.as_object_mut() {
                o.insert("_status".into(), serde_json::Value::String(novo_status.to_string()));
            }
            tx.execute(
                "UPDATE outbox_compras SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![cid, prev.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(CompraEnqueueResult {
                compra_local_uuid: compra_local_uuid.to_string(),
                compra_remote_id: remote_id,
                idempotente: true,
            });
        }

        // Colapso 2: substitui último alterar_status pendente.
        let last_st: Option<String> = tx.query_row(
            "SELECT local_uuid FROM outbox_compras
              WHERE compra_local_uuid=?1 AND action='alterar_status'
                AND status IN ('pending','error')
              ORDER BY created_at_ms DESC LIMIT 1",
            params![compra_local_uuid], |r| r.get(0),
        ).optional()?;
        let rpc_payload = serde_json::json!({
            "_id": remote_id.clone().unwrap_or_default(),
            "_status": novo_status,
        });
        if let Some(sid) = last_st {
            tx.execute(
                "UPDATE outbox_compras SET payload=?2, updated_at_ms=?3, last_error=NULL,
                        next_attempt_at_ms=NULL,
                        status=CASE WHEN status='error' THEN 'pending' ELSE status END
                  WHERE local_uuid=?1",
                params![sid, rpc_payload.to_string(), now_ms],
            )?;
            tx.commit()?;
            return Ok(CompraEnqueueResult {
                compra_local_uuid: compra_local_uuid.to_string(),
                compra_remote_id: remote_id,
                idempotente: true,
            });
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_compras(
                local_uuid, client_uuid, compra_local_uuid, compra_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'alterar_status',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, compra_local_uuid, remote_id, rpc_payload.to_string(), now_ms],
        )?;
        tx.commit()?;
        Ok(CompraEnqueueResult {
            compra_local_uuid: compra_local_uuid.to_string(),
            compra_remote_id: remote_id,
            idempotente: false,
        })
    })
}

/// Exclui a compra. Se o `criar` ainda está pendente (e não há
/// remote_id), apenas removemos as ações pendentes e marcamos como
/// excluído localmente — nunca chega ao upstream.
pub fn compra_excluir_local(compra_local_uuid: &str) -> DbResult<CompraEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM compras_local WHERE local_uuid=?1",
            params![compra_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        let has_criar: bool = tx.query_row(
            "SELECT 1 FROM outbox_compras
              WHERE compra_local_uuid=?1 AND action='criar'
                AND status IN ('pending','error') LIMIT 1",
            params![compra_local_uuid], |_| Ok(true),
        ).optional()?.is_some();

        // Cancela todas as ações pendentes que se tornaram redundantes.
        // Recebimentos pendentes também caem (a compra deixa de existir).
        tx.execute(
            "DELETE FROM outbox_compras
              WHERE compra_local_uuid=?1
                AND action IN ('criar','editar_metadados','alterar_status',
                               'receber','receber_itens')
                AND status IN ('pending','error')",
            params![compra_local_uuid],
        )?;

        if has_criar && remote_id.is_none() {
            // Compra nasceu offline e está sendo descartada antes de subir.
            tx.execute(
                "UPDATE compras_local SET deleted_at_ms=?1, sync_status='synced', synced_at_ms=?1
                  WHERE local_uuid=?2",
                params![now_ms, compra_local_uuid],
            )?;
            // Itens vão junto (cleanup local; ainda não existem no remoto).
            tx.execute(
                "DELETE FROM compra_itens_local WHERE compra_local_uuid=?1",
                params![compra_local_uuid],
            )?;
            tx.commit()?;
            return Ok(CompraEnqueueResult {
                compra_local_uuid: compra_local_uuid.to_string(),
                compra_remote_id: None,
                idempotente: true,
            });
        }

        let payload = serde_json::json!({
            "_compra_id": remote_id.clone().unwrap_or_default(),
        });
        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_compras(
                local_uuid, client_uuid, compra_local_uuid, compra_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'excluir',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, compra_local_uuid, remote_id, payload.to_string(), now_ms],
        )?;
        tx.execute(
            "UPDATE compras_local SET deleted_at_ms=?1, sync_status='pending', synced_at_ms=?1
              WHERE local_uuid=?2",
            params![now_ms, compra_local_uuid],
        )?;
        tx.commit()?;
        Ok(CompraEnqueueResult {
            compra_local_uuid: compra_local_uuid.to_string(),
            compra_remote_id: remote_id,
            idempotente: false,
        })
    })
}

// -----------------------------------------------------------------
// Etapa 4 — receber + receber_itens (com derivação local de estoque)
// -----------------------------------------------------------------
//
// Estratégia:
//   1. Atualiza `quantidade_recebida` no(s) item(ns) afetados.
//   2. Aplica `apply_mov_to_saldo(entrada)` para cada delta recebido,
//      registrando uma linha em `estoque_movimentacoes_local` com
//      `id = local_uuid` (estável, com `_pending: true`). Quando o
//      upstream replicar a movimentação real, ela vem com outro id e
//      a UI converge na próxima ingestão.
//   3. Recalcula status local (recebida / recebida_parcial), reembala
//      `payload` via `compra_recompute_payload`.
//   4. Enfileira `receber` ou `receber_itens` em `outbox_compras`. O
//      scheduler só envia depois que o `criar` resolver `remote_id`
//      (causalidade) — nada vai upstream se a compra ainda nasceu offline.
//   5. NÃO geramos lançamento financeiro local: ao executar `receber`
//      no upstream, a RPC `receber_compra` / `receber_compra_itens` cria
//      o lançamento. Quando a próxima ingestão de financeiro rodar, a
//      UI passa a enxergá-lo. Isso evita duplicidade durante o sync.

#[derive(Debug, Serialize)]
pub struct CompraReceberItem {
    pub item_id: String,        // pode ser local_uuid ou remote_id
    pub quantidade: f64,
}

fn compra_item_resolve_local_uuid(
    tx: &rusqlite::Transaction<'_>,
    compra_local_uuid: &str,
    any_id: &str,
) -> DbResult<Option<(String, String, String, f64, f64)>> {
    // Retorna (local_uuid, produto_id, variacao_id, quantidade, quantidade_recebida)
    let row: Option<(String, String, Option<String>, f64, f64)> = tx.query_row(
        "SELECT local_uuid, produto_id, variacao_id, quantidade, quantidade_recebida
           FROM compra_itens_local
          WHERE compra_local_uuid=?1 AND (local_uuid=?2 OR remote_id=?2)
          LIMIT 1",
        params![compra_local_uuid, any_id], |r| Ok((
            r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
        )),
    ).optional()?;
    Ok(row.map(|(lid, pid, var, qtd, qrec)| (
        lid, pid, var.unwrap_or_default(), qtd, qrec,
    )))
}

fn compra_apply_recebimento_item(
    tx: &rusqlite::Transaction<'_>,
    compra_local_uuid: &str,
    item_local_uuid: &str,
    produto_id: &str,
    variacao_id: &str,
    quantidade_a_receber: f64,
    custo_unit: Option<f64>,
    now_ms: i64,
) -> DbResult<()> {
    if quantidade_a_receber <= 0.0 { return Ok(()); }

    // 1) Soma quantidade_recebida no item.
    tx.execute(
        "UPDATE compra_itens_local
            SET quantidade_recebida = quantidade_recebida + ?1,
                sync_status='pending', updated_at_ms=?2
          WHERE local_uuid=?3",
        params![quantidade_a_receber, now_ms, item_local_uuid],
    )?;

    // 2) Aplica saldo + registra movimentação local (entrada).
    let saldo_anterior = read_saldo_atual(tx, produto_id, variacao_id)?;
    let saldo_posterior = saldo_anterior + quantidade_a_receber;
    let mov_local_uuid = random_uuid_v4();
    let item_payload = serde_json::json!({
        "id": &mov_local_uuid,
        "produto_id": produto_id,
        "variacao_id": if variacao_id.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(variacao_id.into()) },
        "tipo": "entrada",
        "quantidade": quantidade_a_receber,
        "saldo_anterior": saldo_anterior,
        "saldo_posterior": saldo_posterior,
        "custo_unitario": custo_unit,
        "origem": "compra",
        "observacoes": format!("compra:{}", compra_local_uuid),
        "data_movimentacao": iso_from_ms_z_pub(now_ms),
        "_pending": true,
    }).to_string();
    tx.execute(
        "INSERT OR IGNORE INTO estoque_movimentacoes_local(
            id, produto_id, variacao_id, tipo, quantidade,
            saldo_anterior, saldo_posterior, custo_unitario,
            origem, observacoes, data_movimentacao_ms,
            payload, synced_at_ms
         ) VALUES (?1,?2,?3,'entrada',?4,?5,?6,?7,'compra',?8,?9,?10,?9)",
        params![
            mov_local_uuid, produto_id, variacao_id, quantidade_a_receber,
            saldo_anterior, saldo_posterior, custo_unit,
            format!("compra:{}", compra_local_uuid), now_ms, item_payload,
        ],
    )?;
    apply_mov_to_saldo(tx, produto_id, variacao_id, Some("entrada"), quantidade_a_receber, now_ms)?;
    Ok(())
}

fn compra_recompute_status(
    tx: &rusqlite::Transaction<'_>,
    compra_local_uuid: &str,
    data_recebimento: Option<&str>,
    now_ms: i64,
) -> DbResult<String> {
    // Calcula status agregado a partir dos itens.
    let mut stmt = tx.prepare(
        "SELECT quantidade, quantidade_recebida FROM compra_itens_local
          WHERE compra_local_uuid=?1",
    )?;
    let rows = stmt.query_map(params![compra_local_uuid], |r| Ok((
        r.get::<_, f64>(0)?, r.get::<_, f64>(1)?,
    )))?;
    let mut total_q = 0f64;
    let mut total_r = 0f64;
    for row in rows {
        let (q, r) = row?;
        total_q += q;
        total_r += r;
    }
    let status = if total_r <= 0.0 {
        // sem recebimento — mantém o atual
        let cur: Option<String> = tx.query_row(
            "SELECT status FROM compras_local WHERE local_uuid=?1",
            params![compra_local_uuid], |r| r.get(0),
        ).optional()?;
        cur.unwrap_or_else(|| "pendente".into())
    } else if total_r + 1e-9 >= total_q {
        "recebida".to_string()
    } else {
        "recebida_parcial".to_string()
    };

    // Atualiza payload com data_recebimento + status
    let raw: Option<String> = tx.query_row(
        "SELECT payload FROM compras_local WHERE local_uuid=?1",
        params![compra_local_uuid], |r| r.get(0),
    ).optional()?;
    if let Some(rs) = raw {
        let mut full: serde_json::Value = serde_json::from_str(&rs).unwrap_or(serde_json::json!({}));
        if let Some(o) = full.as_object_mut() {
            o.insert("status".into(), serde_json::Value::String(status.clone()));
            if status == "recebida" {
                if let Some(dr) = data_recebimento {
                    o.insert("data_recebimento".into(), serde_json::Value::String(dr.to_string()));
                }
            }
            o.insert("sync_status".into(), serde_json::Value::String("pending".into()));
        }
        tx.execute(
            "UPDATE compras_local SET status=?1, payload=?2, sync_status='pending', synced_at_ms=?3
              WHERE local_uuid=?4",
            params![status, full.to_string(), now_ms, compra_local_uuid],
        )?;
    }
    // Recalcula payload completo (subtotal/total/itens com quantidade_recebida atualizada)
    compra_recompute_payload(tx, compra_local_uuid, now_ms)?;
    Ok(status)
}

/// Recebimento total da compra. Aplica entrada de estoque para todo o
/// pendente de cada item e enfileira `receber` no upstream.
pub fn compra_receber_local(
    compra_local_uuid: &str,
    data_recebimento: &str,
    gerar_financeiro: bool,
    data_vencimento: Option<&str>,
) -> DbResult<CompraEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM compras_local WHERE local_uuid=?1",
            params![compra_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        // Itens com pendente > 0
        let mut stmt = tx.prepare(
            "SELECT local_uuid, produto_id, variacao_id, quantidade, quantidade_recebida, preco_unitario
               FROM compra_itens_local WHERE compra_local_uuid=?1",
        )?;
        let rows: Vec<(String, String, String, f64, f64, f64)> = stmt
            .query_map(params![compra_local_uuid], |r| Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                r.get::<_, f64>(3)?,
                r.get::<_, f64>(4)?,
                r.get::<_, f64>(5)?,
            )))?
            .collect::<rusqlite::Result<_>>()?;
        drop(stmt);

        for (lid, pid, var, qtd, qrec, custo) in rows {
            let pendente = (qtd - qrec).max(0.0);
            if pendente > 0.0 {
                compra_apply_recebimento_item(
                    &tx, compra_local_uuid, &lid, &pid, &var,
                    pendente, Some(custo), now_ms,
                )?;
            }
        }

        let _status = compra_recompute_status(&tx, compra_local_uuid, Some(data_recebimento), now_ms)?;

        // v22 (Etapa 9): gera contas a pagar local quando a compra for
        // a prazo (vencimento informado) e o usuário pedir financeiro.
        // Idempotente via uq_contas_pagar_origem_compra.
        if gerar_financeiro {
            let venc_ms = data_vencimento.and_then(parse_date_only_to_ms);
            if venc_ms.is_some() {
                let _ = criar_pagar_from_compra_tx(&tx, compra_local_uuid, venc_ms, now_ms)?;
            }
        }


        // Outbox: 'receber' (causal — só sai quando remote_id existe).
        let mut payload = serde_json::json!({
            "_compra_id": remote_id.clone().unwrap_or_default(),
            "_data_recebimento": data_recebimento,
            "_gerar_financeiro": gerar_financeiro,
        });
        if let Some(dv) = data_vencimento {
            payload.as_object_mut().unwrap()
                .insert("_data_vencimento".into(), serde_json::Value::String(dv.into()));
        }
        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_compras(
                local_uuid, client_uuid, compra_local_uuid, compra_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'receber',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, compra_local_uuid, remote_id, payload.to_string(), now_ms],
        )?;

        tx.commit()?;
        Ok(CompraEnqueueResult {
            compra_local_uuid: compra_local_uuid.to_string(),
            compra_remote_id: remote_id,
            idempotente: false,
        })
    })
}

/// Recebimento parcial — recebe quantidades específicas por item.
pub fn compra_receber_itens_local(
    compra_local_uuid: &str,
    itens: Vec<CompraReceberItem>,
    data_recebimento: &str,
    gerar_financeiro: bool,
    data_vencimento: Option<&str>,
) -> DbResult<CompraEnqueueResult> {
    if itens.is_empty() {
        return Err(DbError("compra_receber_itens_local: itens vazio".into()));
    }
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;
        let remote_id: Option<String> = tx.query_row(
            "SELECT remote_id FROM compras_local WHERE local_uuid=?1",
            params![compra_local_uuid], |r| r.get(0),
        ).optional()?.flatten();

        // Resolve cada item, valida pendente, aplica recebimento.
        let mut itens_payload: Vec<serde_json::Value> = Vec::new();
        for it in &itens {
            if it.quantidade <= 0.0 { continue; }
            let resolved = compra_item_resolve_local_uuid(&tx, compra_local_uuid, &it.item_id)?;
            let (lid, pid, var, qtd, qrec) = match resolved {
                Some(t) => t,
                None => return Err(DbError(format!(
                    "compra_receber_itens_local: item {} não encontrado", it.item_id
                ))),
            };
            let pendente = (qtd - qrec).max(0.0);
            let receber = it.quantidade.min(pendente);
            if receber <= 0.0 { continue; }
            // custo = preco_unitario do item
            let custo: Option<f64> = tx.query_row(
                "SELECT preco_unitario FROM compra_itens_local WHERE local_uuid=?1",
                params![lid], |r| r.get(0),
            ).optional()?;
            compra_apply_recebimento_item(
                &tx, compra_local_uuid, &lid, &pid, &var, receber, custo, now_ms,
            )?;
            // Para o upstream, manda o item_id como local_uuid quando sem
            // remote_id; o scheduler troca por remote_id no momento do envio.
            let remote_item_id: Option<String> = tx.query_row(
                "SELECT remote_id FROM compra_itens_local WHERE local_uuid=?1",
                params![lid], |r| r.get(0),
            ).optional()?.flatten();
            itens_payload.push(serde_json::json!({
                "item_id": remote_item_id.clone().unwrap_or_else(|| lid.clone()),
                "_local_uuid": lid,
                "quantidade": receber,
            }));
        }

        let status = compra_recompute_status(&tx, compra_local_uuid, Some(data_recebimento), now_ms)?;

        // v22 (Etapa 9): só gera pagar quando integralmente recebida E gerar_financeiro com vencimento.
        if gerar_financeiro && status == "recebida" {
            let venc_ms = data_vencimento.and_then(parse_date_only_to_ms);
            if venc_ms.is_some() {
                let _ = criar_pagar_from_compra_tx(&tx, compra_local_uuid, venc_ms, now_ms)?;
            }
        }

        // Outbox: 'receber_itens'
        let mut payload = serde_json::json!({
            "_compra_id": remote_id.clone().unwrap_or_default(),
            "_itens": itens_payload,
            "_data_recebimento": data_recebimento,
            "_gerar_financeiro": gerar_financeiro && status == "recebida",
        });
        if let Some(dv) = data_vencimento {
            payload.as_object_mut().unwrap()
                .insert("_data_vencimento".into(), serde_json::Value::String(dv.into()));
        }
        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_compras(
                local_uuid, client_uuid, compra_local_uuid, compra_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,NULL,?2,?3,'receber_itens',?4,'pending',0,?5,?5,NULL)",
            params![outbox_id, compra_local_uuid, remote_id, payload.to_string(), now_ms],
        )?;

        tx.commit()?;
        Ok(CompraEnqueueResult {
            compra_local_uuid: compra_local_uuid.to_string(),
            compra_remote_id: remote_id,
            idempotente: false,
        })
    })
}

// =====================================================================
// COMPRAS — Outbox plumbing (stats / list / push helpers)
// =====================================================================

#[derive(Debug, Serialize, Default)]
pub struct OutboxComprasStats {
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
pub struct OutboxComprasItem {
    pub local_uuid: String,
    pub client_uuid: Option<String>,
    pub compra_local_uuid: String,
    pub compra_remote_id: Option<String>,
    pub action: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

const COMPRA_COLS: &str =
    "local_uuid, client_uuid, compra_local_uuid, compra_remote_id, action, payload,
     status, attempts, last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

fn map_compra_outbox(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxComprasItem> {
    Ok(OutboxComprasItem {
        local_uuid: r.get(0)?,
        client_uuid: r.get(1)?,
        compra_local_uuid: r.get(2)?,
        compra_remote_id: r.get(3)?,
        action: r.get(4)?,
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

pub fn outbox_compras_get(local_uuid: &str) -> DbResult<Option<OutboxComprasItem>> {
    with_conn(|conn| {
        let sql = format!("SELECT {cols} FROM outbox_compras WHERE local_uuid=?1", cols = COMPRA_COLS);
        let r = conn.query_row(&sql, params![local_uuid], map_compra_outbox).optional()?;
        Ok(r)
    })
}

/// Pending elegíveis (backoff vencido) ordenados por idade.
pub fn outbox_compras_pending_batch(limit: i64) -> DbResult<Vec<OutboxComprasItem>> {
    with_conn(|conn| {
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "SELECT {cols} FROM outbox_compras
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1
              ORDER BY created_at_ms ASC LIMIT ?2",
            cols = COMPRA_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![now, limit], map_compra_outbox)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_compras_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxComprasItem>> {
    with_conn(|conn| {
        let sql = format!(
            "SELECT {cols} FROM outbox_compras WHERE status='pending'
              ORDER BY created_at_ms ASC LIMIT ?1",
            cols = COMPRA_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit], map_compra_outbox)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_compras_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxComprasItem>> {
    with_conn(|conn| {
        if let Some(st) = only_status {
            let sql = format!(
                "SELECT {cols} FROM outbox_compras WHERE status=?1
                  ORDER BY created_at_ms DESC LIMIT ?2",
                cols = COMPRA_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![st, limit], map_compra_outbox)?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        } else {
            let sql = format!(
                "SELECT {cols} FROM outbox_compras
                  ORDER BY created_at_ms DESC LIMIT ?1",
                cols = COMPRA_COLS,
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![limit], map_compra_outbox)?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        }
    })
}

pub fn outbox_compras_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_compras
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

/// Marca como enviado e propaga `remote_id`:
///   * action='criar': grava `remote_id` no cabeçalho (`compras_local`),
///     reescreve `compra_remote_id` em todas as ações pendentes da mesma
///     compra, atualiza `_compra_id` no payload de cada uma, e tenta
///     mapear `remote_id` dos itens via `parsed.itens[*].local_uuid` (a
///     RPC `criar_compra` retorna a compra completa com itens).
///   * outras ações: se for `receber`/`receber_itens`, propaga
///     `remote_id` para os itens via `_local_uuid` quando presente no
///     payload (vide `compra_receber_itens_local`).
pub fn outbox_compras_mark_sent(
    local_uuid: &str,
    remote_id: &str,
    response: &str,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let item: Option<(String, String, String)> = tx.query_row(
            "SELECT compra_local_uuid, action, payload
               FROM outbox_compras WHERE local_uuid=?1",
            params![local_uuid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?;
        tx.execute(
            "UPDATE outbox_compras
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, remote_response=?4, last_error=NULL,
                    next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id, response],
        )?;
        if let Some((compra_lid, action, _payload_in)) = item {
            if action == "criar" {
                // Cabeçalho
                tx.execute(
                    "UPDATE compras_local
                        SET remote_id=?1, sync_status='synced', last_error=NULL
                      WHERE local_uuid=?2",
                    params![remote_id, compra_lid],
                )?;
                // Propaga para outras ações pendentes da mesma compra.
                tx.execute(
                    "UPDATE outbox_compras
                        SET compra_remote_id=?1
                      WHERE compra_local_uuid=?2 AND compra_remote_id IS NULL",
                    params![remote_id, compra_lid],
                )?;
                let pendentes: Vec<(String, String)> = {
                    let mut stmt = tx.prepare(
                        "SELECT local_uuid, payload FROM outbox_compras
                          WHERE compra_local_uuid=?1 AND action <> 'criar'
                            AND status IN ('pending','error','sending')",
                    )?;
                    let rows = stmt.query_map(params![compra_lid], |r| Ok((r.get(0)?, r.get(1)?)))?;
                    let mut out = Vec::new();
                    for r in rows { out.push(r?); }
                    out
                };
                for (lid, raw) in pendentes {
                    let mut p: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
                    if let Some(o) = p.as_object_mut() {
                        if o.get("_compra_id").map(|v| v.as_str().unwrap_or("")).unwrap_or("").is_empty() {
                            o.insert("_compra_id".into(), serde_json::Value::String(remote_id.into()));
                        }
                    }
                    tx.execute(
                        "UPDATE outbox_compras SET payload=?2 WHERE local_uuid=?1",
                        params![lid, p.to_string()],
                    )?;
                }

                // Tenta resolver remote_id dos itens a partir do response.
                // Espera-se um array `itens` com `id` e (idealmente) o
                // `local_uuid` original (passado no _itens do `criar`).
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(response) {
                    let itens = parsed.get("itens").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                    for it in itens {
                        let rid = it.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if rid.is_empty() { continue; }
                        // Match por local_uuid quando o backend devolver,
                        // senão por (produto_id, variacao_id, quantidade).
                        if let Some(lid) = it.get("local_uuid").and_then(|v| v.as_str()) {
                            tx.execute(
                                "UPDATE compra_itens_local
                                    SET remote_id=?1, compra_remote_id=?2,
                                        sync_status='synced', updated_at_ms=?3
                                  WHERE local_uuid=?4",
                                params![rid, remote_id, now_ms, lid],
                            )?;
                            continue;
                        }
                        let pid = it.get("produto_id").and_then(|v| v.as_str()).unwrap_or("");
                        let var = it.get("variacao_id").and_then(|v| v.as_str()).unwrap_or("");
                        let qtd = it.get("quantidade").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        tx.execute(
                            "UPDATE compra_itens_local
                                SET remote_id=COALESCE(remote_id, ?1),
                                    compra_remote_id=?2,
                                    sync_status='synced',
                                    updated_at_ms=?3
                              WHERE compra_local_uuid=?4 AND produto_id=?5
                                AND COALESCE(variacao_id,'')=?6 AND quantidade=?7
                                AND remote_id IS NULL",
                            params![rid, remote_id, now_ms, compra_lid, pid, var, qtd],
                        )?;
                    }
                }

                // Reescreve _itens das ações receber_itens pendentes para
                // usar remote_id real do item (se já resolvido).
                let receber_pendentes: Vec<(String, String)> = {
                    let mut stmt = tx.prepare(
                        "SELECT local_uuid, payload FROM outbox_compras
                          WHERE compra_local_uuid=?1 AND action='receber_itens'
                            AND status IN ('pending','error','sending')",
                    )?;
                    let rows = stmt.query_map(params![compra_lid], |r| Ok((r.get(0)?, r.get(1)?)))?;
                    let mut out = Vec::new();
                    for r in rows { out.push(r?); }
                    out
                };
                for (lid, raw) in receber_pendentes {
                    let mut p: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
                    if let Some(itens) = p.get_mut("_itens").and_then(|v| v.as_array_mut()) {
                        for it in itens.iter_mut() {
                            let lu = it.get("_local_uuid").and_then(|v| v.as_str()).map(String::from);
                            if let Some(lu) = lu {
                                let rid: Option<Option<String>> = tx.query_row(
                                    "SELECT remote_id FROM compra_itens_local WHERE local_uuid=?1",
                                    params![lu], |r| r.get(0),
                                ).optional()?;
                                if let Some(Some(rid)) = rid {
                                    if let Some(o) = it.as_object_mut() {
                                        o.insert("item_id".into(), serde_json::Value::String(rid));
                                    }
                                }
                            }
                        }
                    }
                    tx.execute(
                        "UPDATE outbox_compras SET payload=?2 WHERE local_uuid=?1",
                        params![lid, p.to_string()],
                    )?;
                }
            } else {
                // Conclusão de ação não-criar: se nada mais pendente, marca compra synced.
                let pendentes_outros: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM outbox_compras
                      WHERE compra_local_uuid=?1 AND status IN ('pending','sending')",
                    params![compra_lid], |r| r.get(0),
                ).optional()?.unwrap_or(0);
                if pendentes_outros == 0 {
                    tx.execute(
                        "UPDATE compras_local SET sync_status='synced', last_error=NULL
                          WHERE local_uuid=?1",
                        params![compra_lid],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_compras_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_compras WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?.unwrap_or(1);
        let compra_lid: Option<String> = conn.query_row(
            "SELECT compra_local_uuid FROM outbox_compras WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_compras
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
            if let Some(lid) = compra_lid {
                let _ = conn.execute(
                    "UPDATE compras_local SET sync_status='error', last_error=?1
                      WHERE local_uuid=?2",
                    params![err, lid],
                );
            }
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_compras
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_compras_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_compras
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
        )?;
        let _ = conn.execute(
            "UPDATE compras_local SET sync_status='pending', last_error=NULL
              WHERE sync_status='error'",
            [],
        );
        Ok(n as i64)
    })
}

pub fn outbox_compras_stats() -> DbResult<OutboxComprasStats> {
    with_conn(|conn| {
        let mut s = OutboxComprasStats::default();
        let mut stmt = conn.prepare("SELECT status, COUNT(*) FROM outbox_compras GROUP BY status")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_compras WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_compras
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_compras
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1",
            params![now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_compras WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_compras_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_compras_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_compras_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_compras_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_compras_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_compras_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_compras_record_flush_round(
    kind: &str, now_ms: i64, attempted: i64, sent: i64, failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_compras_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_compras_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_compras_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_compras_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_compras_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_compras_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

// ============================================================================
// Sub-etapa 4.1 — Operadores offline (verificador local seguro de PIN)
// ============================================================================
//
// Estas funções tratam apenas de leitura/gravação SQLite. A regra de hash
// PBKDF2-HMAC-SHA256 vive em `local_server.rs` (handler de
// /api/auth/aquecer-pin e /api/auth/validar-pin) — assim este módulo não
// passa a depender de crates de cripto.
//
// IMPORTANTE: nada aqui aceita ou armazena PIN em texto puro. O caller já
// converte (salt, hash) em base64 antes de chamar `operador_offline_upsert`.

#[derive(Debug, Clone)]
pub struct OperadorOfflineRow {
    pub funcionario_id: String,
    pub empresa_id: Option<String>,
    pub nome: String,
    pub login: String,
    pub role: String,
    pub ativo: bool,
    pub algorithm: String,
    pub iterations: i64,
    pub salt_b64: String,
    pub hash_b64: String,
    pub failed_attempts: Vec<i64>,
    pub locked_until_ms: i64,
    pub updated_at_ms: i64,
}

pub fn operador_offline_get(funcionario_id: &str) -> DbResult<Option<OperadorOfflineRow>> {
    with_conn(|conn| {
        conn.query_row(
            "SELECT funcionario_id, empresa_id, nome, login, role, ativo,
                    algorithm, iterations, salt_b64, hash_b64,
                    failed_attempts, locked_until_ms, updated_at_ms
               FROM operadores_offline WHERE funcionario_id = ?1",
            params![funcionario_id],
            |r| {
                let attempts_json: String = r.get(10)?;
                let failed_attempts: Vec<i64> =
                    serde_json::from_str(&attempts_json).unwrap_or_default();
                Ok(OperadorOfflineRow {
                    funcionario_id: r.get(0)?,
                    empresa_id: r.get(1)?,
                    nome: r.get(2)?,
                    login: r.get(3)?,
                    role: r.get(4)?,
                    ativo: r.get::<_, i64>(5)? != 0,
                    algorithm: r.get(6)?,
                    iterations: r.get(7)?,
                    salt_b64: r.get(8)?,
                    hash_b64: r.get(9)?,
                    failed_attempts,
                    locked_until_ms: r.get(11)?,
                    updated_at_ms: r.get(12)?,
                })
            },
        )
        .optional()
        .map_err(DbError::from)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn operador_offline_upsert(
    funcionario_id: &str,
    empresa_id: Option<&str>,
    nome: &str,
    login: &str,
    role: &str,
    ativo: bool,
    algorithm: &str,
    iterations: i64,
    salt_b64: &str,
    hash_b64: &str,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO operadores_offline(
                funcionario_id, empresa_id, nome, login, role, ativo,
                algorithm, iterations, salt_b64, hash_b64,
                failed_attempts, locked_until_ms, updated_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'[]',0,?11)
             ON CONFLICT(funcionario_id) DO UPDATE SET
                empresa_id    = excluded.empresa_id,
                nome          = excluded.nome,
                login         = excluded.login,
                role          = excluded.role,
                ativo         = excluded.ativo,
                algorithm     = excluded.algorithm,
                iterations    = excluded.iterations,
                salt_b64      = excluded.salt_b64,
                hash_b64      = excluded.hash_b64,
                updated_at_ms = excluded.updated_at_ms",
            params![
                funcionario_id, empresa_id, nome, login, role,
                if ativo { 1i64 } else { 0i64 },
                algorithm, iterations, salt_b64, hash_b64, now_ms
            ],
        )?;
        Ok(())
    })
}

pub fn operador_offline_record_failure(
    funcionario_id: &str,
    now_ms: i64,
    fail_window_ms: i64,
    max_fails: usize,
    lockout_ms: i64,
) -> DbResult<(usize, i64)> {
    with_conn(|conn| {
        let attempts_json: Option<String> = conn
            .query_row(
                "SELECT failed_attempts FROM operadores_offline WHERE funcionario_id = ?1",
                params![funcionario_id],
                |r| r.get(0),
            )
            .optional()?;
        let mut attempts: Vec<i64> = attempts_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        attempts.retain(|t| now_ms - *t < fail_window_ms);
        attempts.push(now_ms);
        let mut locked_until = 0i64;
        if attempts.len() >= max_fails {
            locked_until = now_ms + lockout_ms;
            attempts.clear();
        }
        let new_json = serde_json::to_string(&attempts).unwrap_or_else(|_| "[]".into());
        conn.execute(
            "UPDATE operadores_offline
                SET failed_attempts = ?2, locked_until_ms = ?3, updated_at_ms = ?4
              WHERE funcionario_id = ?1",
            params![funcionario_id, new_json, locked_until, now_ms],
        )?;
        Ok((attempts.len(), locked_until))
    })
}

pub fn operador_offline_clear_failures(funcionario_id: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE operadores_offline
                SET failed_attempts = '[]', locked_until_ms = 0, updated_at_ms = ?2
              WHERE funcionario_id = ?1",
            params![funcionario_id, now_ms],
        )?;
        Ok(())
    })
}

// ============================================================================
// Etapa 5 (continuação): Rebuild & Health Check do estoque local
//
// Funções defensivas para resiliência offline-first. NÃO mexem na cloud.
//   * rebuild_local_stock()       — recalcula `estoque_saldos_local` a partir
//                                    do histórico `estoque_movimentacoes_local`.
//   * verify_local_stock_health() — diagnostica saldos negativos, movimentações
//                                    órfãs, duplicidades e divergências.
// ============================================================================

#[derive(Debug, Serialize)]
pub struct RebuildStockResult {
    pub produtos_recalculados: i64,
    pub saldos_corrigidos: i64,
    pub now_ms: i64,
}

/// Recalcula a tabela materializada `estoque_saldos_local` somando o sinal
/// (entrada/devolucao = +1, saida/transferencia = -1, ajuste = +1) das
/// quantidades de `estoque_movimentacoes_local`. Executa em UMA transação
/// (truncate + reinsert) para nunca deixar o saldo num estado intermediário.
pub fn rebuild_local_stock(now_ms: i64) -> DbResult<RebuildStockResult> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        // Saldo recomposto: SUM(signal * quantidade) por (produto, variacao).
        let mut stmt = tx.prepare(
            "SELECT produto_id, IFNULL(variacao_id, '') AS variacao_id,
                    SUM(CASE
                            WHEN tipo IN ('entrada','devolucao') THEN  quantidade
                            WHEN tipo IN ('saida','transferencia') THEN -quantidade
                            ELSE quantidade
                        END) AS saldo
               FROM estoque_movimentacoes_local
              GROUP BY produto_id, IFNULL(variacao_id, '')",
        )?;
        let rows: Vec<(String, String, f64)> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?)))?
            .collect::<Result<_, _>>()?;
        drop(stmt);

        tx.execute("DELETE FROM estoque_saldos_local", [])?;

        let mut saldos_corrigidos = 0i64;
        for (produto_id, variacao_id, saldo) in &rows {
            tx.execute(
                "INSERT INTO estoque_saldos_local(
                    produto_id, variacao_id, tipo, quantidade, payload, synced_at_ms
                 ) VALUES (?1, ?2, NULL, ?3, '{}', ?4)",
                params![produto_id, variacao_id, saldo, now_ms],
            )?;
            saldos_corrigidos += 1;
        }

        tx.commit()?;
        Ok(RebuildStockResult {
            produtos_recalculados: rows.len() as i64,
            saldos_corrigidos,
            now_ms,
        })
    })
}

#[derive(Debug, Serialize)]
pub struct StockHealthReport {
    pub now_ms: i64,
    pub total_saldos: i64,
    pub total_movimentacoes: i64,
    pub saldos_negativos: i64,
    pub movimentacoes_orfas: i64,
    pub saldos_orfaos: i64,
    pub movimentacoes_duplicadas: i64,
    pub outbox_pendentes: i64,
    pub outbox_erros: i64,
    pub auditoria_total: i64,
    pub last_audit_ms: Option<i64>,
    pub status: String, // "ok" | "warning" | "error"
}

/// Verificador de saúde local. NÃO altera dados — só lê e classifica.
pub fn verify_local_stock_health(now_ms: i64) -> DbResult<StockHealthReport> {
    with_conn(|conn| {
        let total_saldos: i64 = conn
            .query_row("SELECT COUNT(*) FROM estoque_saldos_local", [], |r| r.get(0))
            .unwrap_or(0);
        let total_movimentacoes: i64 = conn
            .query_row("SELECT COUNT(*) FROM estoque_movimentacoes_local", [], |r| r.get(0))
            .unwrap_or(0);
        let saldos_negativos: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM estoque_saldos_local WHERE quantidade < 0",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        // Movimentações cujo produto_id não tem entrada em produtos_local.
        // Usa LEFT JOIN tolerante (a tabela produtos_local pode não existir
        // ainda no caso de instalação muito antiga — protege com try).
        let movimentacoes_orfas: i64 = conn
            .query_row(
                "SELECT COUNT(*)
                   FROM estoque_movimentacoes_local m
                   LEFT JOIN produtos_local p ON p.id = m.produto_id
                  WHERE p.id IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let saldos_orfaos: i64 = conn
            .query_row(
                "SELECT COUNT(*)
                   FROM estoque_saldos_local s
                   LEFT JOIN produtos_local p ON p.id = s.produto_id
                  WHERE p.id IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        // Duplicidade real seria PRIMARY KEY violation; aqui contamos linhas
        // de auditoria com o mesmo local_uuid (sinal de re-execução).
        let movimentacoes_duplicadas: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM (
                   SELECT local_uuid, COUNT(*) AS c
                     FROM estoque_audit_local
                    WHERE local_uuid IS NOT NULL
                    GROUP BY local_uuid HAVING c > 1
                 )",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let outbox_pendentes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM outbox_estoque_movs WHERE status='pending'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let outbox_erros: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM outbox_estoque_movs WHERE status='error'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let auditoria_total: i64 = conn
            .query_row("SELECT COUNT(*) FROM estoque_audit_local", [], |r| r.get(0))
            .unwrap_or(0);
        let last_audit_ms: Option<i64> = conn
            .query_row(
                "SELECT MAX(ts_ms) FROM estoque_audit_local",
                [],
                |r| r.get::<_, Option<i64>>(0),
            )
            .unwrap_or(None);

        let status = if saldos_negativos > 0 || movimentacoes_duplicadas > 0 || outbox_erros > 0 {
            "error"
        } else if movimentacoes_orfas > 0 || saldos_orfaos > 0 || outbox_pendentes > 50 {
            "warning"
        } else {
            "ok"
        }
        .to_string();

        Ok(StockHealthReport {
            now_ms,
            total_saldos,
            total_movimentacoes,
            saldos_negativos,
            movimentacoes_orfas,
            saldos_orfaos,
            movimentacoes_duplicadas,
            outbox_pendentes,
            outbox_erros,
            auditoria_total,
            last_audit_ms,
            status,
        })
    })
}

// ============================================================================
// ETAPA 11 — Visão agregada de sincronização (todas as outboxes)
// ============================================================================
//
// Junta as 8 filas em uma única consulta para o painel "Sincronização" do FE,
// mapeando o vocabulário interno (`pending|sending|sent|error`) para o
// padrão da etapa 11 (`pending|processing|synced|error|conflict|skipped`).
// `conflict` e `skipped` ficam reservados (=0) até o pipeline de
// reconciliação marcar registros divergentes.

#[derive(Debug, Default, serde::Serialize, Clone)]
pub struct SyncDomainStats {
    pub domain: String,
    pub pending: i64,
    pub processing: i64,
    pub synced: i64,
    pub error: i64,
    pub conflict: i64,
    pub skipped: i64,
    pub last_error: Option<String>,
    pub last_sent_at_ms: Option<i64>,
}

#[derive(Debug, Default, serde::Serialize, Clone)]
pub struct SyncOverview {
    pub now_ms: i64,
    pub pending: i64,
    pub processing: i64,
    pub synced: i64,
    pub error: i64,
    pub conflict: i64,
    pub skipped: i64,
    pub last_sent_at_ms: Option<i64>,
    pub domains: Vec<SyncDomainStats>,
}

const SYNC_DOMAINS: &[(&str, &str)] = &[
    ("estoque",        "outbox_estoque_movs"),
    ("vendas",         "outbox_vendas"),
    ("cancelamentos",  "outbox_cancelamentos_venda"),
    ("caixa",          "outbox_caixa"),
    ("financeiro",     "outbox_financeiro"),
    ("clientes",       "outbox_clientes"),
    ("fornecedores",   "outbox_fornecedores"),
    ("compras",        "outbox_compras"),
];

pub fn sync_overview() -> DbResult<SyncOverview> {
    with_conn(|conn| {
        let mut ov = SyncOverview {
            now_ms: chrono::Utc::now().timestamp_millis(),
            ..Default::default()
        };
        for (name, table) in SYNC_DOMAINS {
            let mut d = SyncDomainStats { domain: (*name).to_string(), ..Default::default() };
            let sql = format!("SELECT status, COUNT(*) FROM {table} GROUP BY status");
            if let Ok(mut stmt) = conn.prepare(&sql) {
                let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)));
                if let Ok(rows) = rows {
                    for r in rows.flatten() {
                        let (st, n) = r;
                        match st.as_str() {
                            "pending"    => d.pending    += n,
                            "sending" | "processing" => d.processing += n,
                            "sent"    | "synced"     => d.synced     += n,
                            "error"      => d.error      += n,
                            "conflict"   => d.conflict   += n,
                            "skipped"    => d.skipped    += n,
                            _ => {}
                        }
                    }
                }
            }
            // last_error
            let sql = format!(
                "SELECT last_error FROM {table}
                  WHERE status='error' AND last_error IS NOT NULL
                  ORDER BY COALESCE(updated_at_ms, created_at_ms) DESC LIMIT 1"
            );
            d.last_error = conn.query_row(&sql, [], |r| r.get::<_, Option<String>>(0))
                .optional().unwrap_or(None).flatten();
            // last_sent_at_ms
            let sql = format!(
                "SELECT MAX(sent_at_ms) FROM {table} WHERE status IN ('sent','synced')"
            );
            d.last_sent_at_ms = conn.query_row(&sql, [], |r| r.get::<_, Option<i64>>(0))
                .optional().unwrap_or(None).flatten();

            ov.pending    += d.pending;
            ov.processing += d.processing;
            ov.synced     += d.synced;
            ov.error      += d.error;
            ov.conflict   += d.conflict;
            ov.skipped    += d.skipped;
            if let Some(t) = d.last_sent_at_ms {
                ov.last_sent_at_ms = Some(ov.last_sent_at_ms.map(|x| x.max(t)).unwrap_or(t));
            }
            ov.domains.push(d);
        }
        Ok(ov)
    })
}

// ============================================================================
// Etapa 12 — SQLite health check
// ============================================================================
//
// Diagnóstico leve da integridade do banco local. Não bloqueia escrita.
// Usado pelo card "Saúde do servidor local" e pelo diagnóstico exportável.

#[derive(Debug, Serialize)]
pub struct SqliteHealth {
    pub schema_version: i64,
    pub integrity_ok: bool,
    pub integrity_detail: String,
    pub quick_ok: bool,
    pub quick_detail: String,
    pub journal_mode: String,
    pub page_size: i64,
    pub page_count: i64,
    pub db_size_bytes: i64,
    pub wal_size_bytes: i64,
    pub db_path: String,
    pub checked_at_ms: i64,
}

pub fn sqlite_health() -> DbResult<SqliteHealth> {
    let path = db_file();
    let db_size_bytes = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
    let wal_path = {
        let mut p = path.clone();
        let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        p.set_file_name(format!("{name}-wal"));
        p
    };
    let wal_size_bytes = std::fs::metadata(&wal_path).map(|m| m.len() as i64).unwrap_or(0);

    with_conn(|conn| {
        let integrity_detail: String = conn
            .query_row("PRAGMA integrity_check(1)", [], |r| r.get(0))
            .unwrap_or_else(|e| format!("erro: {e}"));
        let quick_detail: String = conn
            .query_row("PRAGMA quick_check(1)", [], |r| r.get(0))
            .unwrap_or_else(|e| format!("erro: {e}"));
        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap_or_else(|_| "?".into());
        let page_size: i64 = conn
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .unwrap_or(0);
        let page_count: i64 = conn
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .unwrap_or(0);
        Ok(SqliteHealth {
            schema_version: SCHEMA_VERSION,
            integrity_ok: integrity_detail.eq_ignore_ascii_case("ok"),
            integrity_detail,
            quick_ok: quick_detail.eq_ignore_ascii_case("ok"),
            quick_detail,
            journal_mode,
            page_size,
            page_count,
            db_size_bytes,
            wal_size_bytes,
            db_path: path.to_string_lossy().to_string(),
            checked_at_ms: chrono::Utc::now().timestamp_millis(),
        })
    })
}

// =====================================================================
// FUNCIONÁRIOS — offline-first (v23)
// =====================================================================
//
// Cache + identidade local em `funcionarios_remote_cache` (estendida com
// local_uuid/remote_id/sync_status/last_error). Outbox em
// `outbox_funcionarios`. Ações: criar | editar | resetar_pin |
// alterar_status | excluir.
//
// Causalidade: editar/resetar_pin/alterar_status/excluir só vão upstream
// depois do criar resolver o remote_id (mesmo padrão de fornecedores).

#[derive(Debug, Serialize, Default)]
pub struct OutboxFuncionariosStats {
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
pub struct OutboxFuncionariosItem {
    pub local_uuid: String,
    pub client_uuid: Option<String>,
    pub funcionario_local_uuid: String,
    pub funcionario_remote_id: Option<String>,
    pub action: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

const FUN_COLS: &str =
    "local_uuid, client_uuid, funcionario_local_uuid, funcionario_remote_id, action, payload,
     status, attempts, last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

fn map_fun_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxFuncionariosItem> {
    Ok(OutboxFuncionariosItem {
        local_uuid: r.get(0)?,
        client_uuid: r.get(1)?,
        funcionario_local_uuid: r.get(2)?,
        funcionario_remote_id: r.get(3)?,
        action: r.get(4)?,
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

#[derive(Debug, Serialize)]
pub struct FuncionarioEnqueueResult {
    pub funcionario_local_uuid: String,
    pub funcionario_remote_id: Option<String>,
    pub idempotente: bool,
}

pub fn funcionario_criar_local(payload: serde_json::Value) -> DbResult<FuncionarioEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        let client_uuid = json_str_opt(&payload, "_client_uuid");
        if let Some(cu) = &client_uuid {
            let existing: Option<(String, Option<String>)> = tx.query_row(
                "SELECT funcionario_local_uuid, funcionario_remote_id
                   FROM outbox_funcionarios WHERE client_uuid=?1",
                params![cu], |r| Ok((r.get(0)?, r.get(1)?)),
            ).optional()?;
            if let Some((lid, rid)) = existing {
                tx.commit()?;
                return Ok(FuncionarioEnqueueResult {
                    funcionario_local_uuid: lid,
                    funcionario_remote_id: rid,
                    idempotente: true,
                });
            }
        }

        // Aceita _funcionario_id (UUID gerado no cliente) para consistência
        // com o RPC funcionario_criar — mesmo ID em SQLite e no Supabase.
        let local_uuid = json_str_opt(&payload, "_funcionario_id")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(random_uuid_v4);
        let nome = json_str_opt(&payload, "_nome").unwrap_or_default();
        let login = json_str_opt(&payload, "_login").unwrap_or_default();
        let role = json_str_opt(&payload, "_role").unwrap_or_else(|| "caixa".into());

        let full = serde_json::json!({
            "id": &local_uuid,
            "local_uuid": &local_uuid,
            "remote_id": serde_json::Value::Null,
            "nome": &nome,
            "login": &login,
            "role": &role,
            "ativo": true,
            "ultimo_acesso": serde_json::Value::Null,
            "created_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms)
                .map(|d| d.to_rfc3339()).unwrap_or_default(),
            "sync_status": "pending",
        });

        tx.execute(
            "INSERT INTO funcionarios_remote_cache(
                id, nome, ativo, payload,
                updated_at_remote_ms, synced_at_ms, deleted_at_ms,
                local_uuid, remote_id, sync_status, last_error, created_offline_at_ms
             ) VALUES (?1,?2,1,?3, NULL, ?4, NULL, ?1, NULL, 'pending', NULL, ?4)",
            params![local_uuid, nome, full.to_string(), now_ms],
        )?;

        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            o.insert("_funcionario_id".into(), serde_json::Value::String(local_uuid.clone()));
            o.entry("_client_uuid").or_insert(serde_json::Value::String(local_uuid.clone()));
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_funcionarios(
                local_uuid, client_uuid, funcionario_local_uuid, funcionario_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,NULL,'criar',?4,'pending',0,?5,?5,NULL)",
            params![
                outbox_id,
                client_uuid.unwrap_or_else(|| local_uuid.clone()),
                local_uuid,
                rpc_payload.to_string(),
                now_ms
            ],
        )?;
        tx.commit()?;
        Ok(FuncionarioEnqueueResult {
            funcionario_local_uuid: local_uuid,
            funcionario_remote_id: None,
            idempotente: false,
        })
    })
}

pub fn outbox_funcionarios_get(local_uuid: &str) -> DbResult<Option<OutboxFuncionariosItem>> {
    with_conn(|conn| {
        let sql = format!("SELECT {cols} FROM outbox_funcionarios WHERE local_uuid=?1", cols = FUN_COLS);
        let r = conn.query_row(&sql, params![local_uuid], map_fun_item).optional()?;
        Ok(r)
    })
}

pub fn outbox_funcionarios_pending_batch(limit: i64) -> DbResult<Vec<OutboxFuncionariosItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "SELECT {cols} FROM outbox_funcionarios
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1
              ORDER BY created_at_ms ASC LIMIT ?2",
            cols = FUN_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![now, limit], map_fun_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_funcionarios_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxFuncionariosItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = format!(
            "SELECT {cols} FROM outbox_funcionarios WHERE status='pending'
             ORDER BY created_at_ms ASC LIMIT ?1",
            cols = FUN_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit], map_fun_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_funcionarios_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxFuncionariosItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let sql = format!(
                "SELECT {cols} FROM outbox_funcionarios WHERE status=?1
                 ORDER BY created_at_ms DESC LIMIT ?2", cols = FUN_COLS);
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![st, limit], map_fun_item)?;
            for r in rows { out.push(r?); }
        } else {
            let sql = format!(
                "SELECT {cols} FROM outbox_funcionarios
                 ORDER BY created_at_ms DESC LIMIT ?1", cols = FUN_COLS);
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![limit], map_fun_item)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

pub fn outbox_funcionarios_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_funcionarios
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_funcionarios_mark_sent(
    local_uuid: &str,
    remote_id: &str,
    response: &str,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let item: Option<(String, String)> = tx.query_row(
            "SELECT funcionario_local_uuid, action FROM outbox_funcionarios WHERE local_uuid=?1",
            params![local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        tx.execute(
            "UPDATE outbox_funcionarios
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, remote_response=?4, last_error=NULL,
                    next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id, response],
        )?;
        if let Some((fun_lid, action)) = item {
            if action == "criar" {
                tx.execute(
                    "UPDATE funcionarios_remote_cache
                        SET remote_id=?1, sync_status='synced', last_error=NULL
                      WHERE local_uuid=?2",
                    params![remote_id, fun_lid],
                )?;
                tx.execute(
                    "UPDATE outbox_funcionarios
                        SET funcionario_remote_id=?1
                      WHERE funcionario_local_uuid=?2 AND funcionario_remote_id IS NULL",
                    params![remote_id, fun_lid],
                )?;
                // Propaga _funcionario_id resolvido às demais ações pendentes
                let pendentes: Vec<(String, String)> = {
                    let mut stmt = tx.prepare(
                        "SELECT local_uuid, payload FROM outbox_funcionarios
                          WHERE funcionario_local_uuid=?1 AND action <> 'criar'
                            AND status IN ('pending','error','sending')",
                    )?;
                    let rows = stmt.query_map(params![fun_lid], |r| Ok((r.get(0)?, r.get(1)?)))?;
                    let mut out = Vec::new();
                    for r in rows { out.push(r?); }
                    out
                };
                for (lid, raw) in pendentes {
                    let mut p: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
                    if let Some(o) = p.as_object_mut() {
                        o.insert("_funcionario_id".into(), serde_json::Value::String(remote_id.to_string()));
                    }
                    tx.execute(
                        "UPDATE outbox_funcionarios SET payload=?2 WHERE local_uuid=?1",
                        params![lid, p.to_string()],
                    )?;
                }
            } else {
                let pendentes_outros: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM outbox_funcionarios
                      WHERE funcionario_local_uuid=?1 AND status IN ('pending','sending')",
                    params![fun_lid], |r| r.get(0),
                ).optional()?.unwrap_or(0);
                if pendentes_outros == 0 {
                    tx.execute(
                        "UPDATE funcionarios_remote_cache SET sync_status='synced', last_error=NULL
                          WHERE local_uuid=?1",
                        params![fun_lid],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_funcionarios_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_funcionarios WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?.unwrap_or(1);
        let fun_lid: Option<String> = conn.query_row(
            "SELECT funcionario_local_uuid FROM outbox_funcionarios WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_funcionarios
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
            if let Some(lid) = fun_lid {
                let _ = conn.execute(
                    "UPDATE funcionarios_remote_cache SET sync_status='error', last_error=?1
                      WHERE local_uuid=?2",
                    params![err, lid],
                );
            }
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_funcionarios
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_funcionarios_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_funcionarios
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
        )?;
        let _ = conn.execute(
            "UPDATE funcionarios_remote_cache SET sync_status='pending', last_error=NULL
              WHERE sync_status='error'",
            [],
        );
        Ok(n as i64)
    })
}

pub fn outbox_funcionarios_stats() -> DbResult<OutboxFuncionariosStats> {
    with_conn(|conn| {
        let mut s = OutboxFuncionariosStats::default();
        let mut stmt = conn.prepare("SELECT status, COUNT(*) FROM outbox_funcionarios GROUP BY status")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_funcionarios WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_funcionarios
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_funcionarios
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1",
            params![now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_funcionarios WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_fun_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_fun_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_fun_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_fun_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_fun_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_fun_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_funcionarios_record_flush_round(
    kind: &str, now_ms: i64, attempted: i64, sent: i64, failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_fun_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_fun_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_fun_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_fun_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_fun_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_fun_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

pub fn funcionario_remote_id_for(local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let r: Option<Option<String>> = conn.query_row(
            "SELECT remote_id FROM funcionarios_remote_cache WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        Ok(r.flatten())
    })
}

pub fn funcionario_resolve_local_uuid(any_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let lid: Option<String> = conn.query_row(
            "SELECT local_uuid FROM funcionarios_remote_cache
              WHERE local_uuid=?1 OR remote_id=?1 OR id=?1
              LIMIT 1",
            params![any_id], |r| r.get(0),
        ).optional()?;
        Ok(lid)
    })
}

// ---------------------------------------------------------------------------
// Funcionários — enfileiramento genérico para editar/resetar_pin/
// alterar_status/excluir. O cache local é atualizado de forma otimista
// (sync_status='pending') e a ação vai para `outbox_funcionarios`.
// `_funcionario_id` no payload já é o local_uuid (o RPC criar é idempotente
// pelo id; ações dependentes esperam o criar resolver o remote_id, mas se já
// houver remote_id conhecido a ação parte direto com ele).
// ---------------------------------------------------------------------------
pub fn funcionario_enqueue_action(
    target_local_uuid: &str,
    action: &str,
    payload: serde_json::Value,
    cache_patch: Option<serde_json::Value>,
    soft_delete: bool,
) -> DbResult<FuncionarioEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        // Resolve o local_uuid real (aceita também remote_id ou id legacy).
        let row: Option<(String, Option<String>, Option<String>)> = tx.query_row(
            "SELECT local_uuid, remote_id, payload
               FROM funcionarios_remote_cache
              WHERE local_uuid=?1 OR remote_id=?1 OR id=?1
              LIMIT 1",
            params![target_local_uuid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?;
        let (fun_lid, remote_id, current_payload) = row.ok_or_else(|| {
            DbError::from(rusqlite::Error::QueryReturnedNoRows)
        })?;

        // Patch otimista no cache.
        if let Some(patch) = cache_patch.as_ref() {
            let mut cur: serde_json::Value =
                serde_json::from_str(current_payload.as_deref().unwrap_or("{}"))
                    .unwrap_or(serde_json::json!({}));
            if let (Some(co), Some(po)) = (cur.as_object_mut(), patch.as_object()) {
                for (k, v) in po { co.insert(k.clone(), v.clone()); }
            }
            let new_nome = cur.get("nome").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let new_ativo = cur.get("ativo").and_then(|v| v.as_bool()).unwrap_or(true);
            let final_ativo = if soft_delete { false } else { new_ativo };
            tx.execute(
                "UPDATE funcionarios_remote_cache
                    SET nome=?2,
                        ativo=CASE WHEN ?3 THEN 1 ELSE 0 END,
                        payload=?4, sync_status='pending', last_error=NULL,
                        deleted_at_ms=CASE WHEN ?5 THEN ?6 ELSE deleted_at_ms END
                  WHERE local_uuid=?1",
                params![fun_lid, new_nome, final_ativo, cur.to_string(), soft_delete, now_ms],
            )?;
        } else if soft_delete {
            tx.execute(
                "UPDATE funcionarios_remote_cache
                    SET ativo=0, deleted_at_ms=?2, sync_status='pending', last_error=NULL
                  WHERE local_uuid=?1",
                params![fun_lid, now_ms],
            )?;
        } else {
            tx.execute(
                "UPDATE funcionarios_remote_cache
                    SET sync_status='pending', last_error=NULL
                  WHERE local_uuid=?1",
                params![fun_lid],
            )?;
        }

        // Monta payload do RPC. Usa remote_id se já conhecido; senão local_uuid
        // (que vira o id real após o criar resolver).
        let effective_id = remote_id.clone().unwrap_or_else(|| fun_lid.clone());
        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            o.insert("_funcionario_id".into(), serde_json::Value::String(effective_id));
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_funcionarios(
                local_uuid, client_uuid, funcionario_local_uuid, funcionario_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1, ?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6, ?6, NULL)",
            params![
                outbox_id, fun_lid, remote_id,
                action, rpc_payload.to_string(), now_ms,
            ],
        )?;
        tx.commit()?;
        Ok(FuncionarioEnqueueResult {
            funcionario_local_uuid: fun_lid,
            funcionario_remote_id: remote_id,
            idempotente: false,
        })
    })
}

// =====================================================================
// PRODUTOS — offline-first (v24)
// =====================================================================
//
// Cache + identidade local em `produtos_local` (estendida com
// local_uuid/remote_id/sync_status/last_error). Outbox em
// `outbox_produtos`. Ações: criar | editar | alterar_status | excluir.
//
// Causalidade: editar/alterar_status/excluir só vão upstream depois do
// criar resolver o remote_id — mesmo padrão de funcionários.

#[derive(Debug, Serialize, Default)]
pub struct OutboxProdutosStats {
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
pub struct OutboxProdutosItem {
    pub local_uuid: String,
    pub client_uuid: Option<String>,
    pub produto_local_uuid: String,
    pub produto_remote_id: Option<String>,
    pub action: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

const PROD_COLS: &str =
    "local_uuid, client_uuid, produto_local_uuid, produto_remote_id, action, payload,
     status, attempts, last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

fn map_prod_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxProdutosItem> {
    Ok(OutboxProdutosItem {
        local_uuid: r.get(0)?,
        client_uuid: r.get(1)?,
        produto_local_uuid: r.get(2)?,
        produto_remote_id: r.get(3)?,
        action: r.get(4)?,
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

#[derive(Debug, Serialize)]
pub struct ProdutoEnqueueResult {
    pub produto_local_uuid: String,
    pub produto_remote_id: Option<String>,
    pub idempotente: bool,
}

pub fn produto_criar_local(payload: serde_json::Value) -> DbResult<ProdutoEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        let client_uuid = json_str_opt(&payload, "_client_uuid");
        if let Some(cu) = &client_uuid {
            let existing: Option<(String, Option<String>)> = tx.query_row(
                "SELECT produto_local_uuid, produto_remote_id
                   FROM outbox_produtos WHERE client_uuid=?1",
                params![cu], |r| Ok((r.get(0)?, r.get(1)?)),
            ).optional()?;
            if let Some((lid, rid)) = existing {
                tx.commit()?;
                return Ok(ProdutoEnqueueResult {
                    produto_local_uuid: lid,
                    produto_remote_id: rid,
                    idempotente: true,
                });
            }
        }

        // Aceita _produto_id (UUID gerado no cliente) para id consistente
        // entre SQLite local e Supabase (RPC criar_produto é idempotente
        // pelo id).
        let local_uuid = json_str_opt(&payload, "_produto_id")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(random_uuid_v4);

        let sku = json_str_opt(&payload, "_sku").unwrap_or_default();
        let nome = json_str_opt(&payload, "_nome").unwrap_or_default();
        let status = json_str_opt(&payload, "_status").unwrap_or_else(|| "ativo".into());
        let categoria_id = json_str_opt(&payload, "_categoria_id");
        let preco_venda = payload.get("_preco_venda").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let estoque_inicial = payload.get("_estoque_inicial").and_then(|v| v.as_f64()).unwrap_or(0.0);

        // Resolve nome da categoria se já houver no cache.
        let categoria_nome: Option<String> = if let Some(cid) = categoria_id.as_ref() {
            tx.query_row(
                "SELECT nome FROM categorias_produto_local
                  WHERE local_uuid=?1 OR remote_id=?1 OR id=?1 LIMIT 1",
                params![cid], |r| r.get::<_, Option<String>>(0),
            ).optional()?.flatten()
        } else { None };

        let full = serde_json::json!({
            "id": &local_uuid,
            "local_uuid": &local_uuid,
            "remote_id": serde_json::Value::Null,
            "sku": &sku,
            "nome": &nome,
            "status": &status,
            "categoria_id": categoria_id.clone(),
            "categoria": categoria_nome.as_ref().map(|n| serde_json::json!({"id": categoria_id, "nome": n})),
            "preco_custo": payload.get("_preco_custo").cloned().unwrap_or(serde_json::Value::Null),
            "preco_venda": preco_venda,
            "estoque_minimo": payload.get("_estoque_minimo").cloned().unwrap_or(serde_json::Value::Null),
            "estoque_atual": estoque_inicial,
            "unidade": payload.get("_unidade").cloned().unwrap_or(serde_json::Value::Null),
            "codigo_barras": payload.get("_codigo_barras").cloned().unwrap_or(serde_json::Value::Null),
            "qr_code": payload.get("_qr_code").cloned().unwrap_or(serde_json::Value::Null),
            "codigo_interno": payload.get("_codigo_interno").cloned().unwrap_or(serde_json::Value::Null),
            "tipo_identificacao_principal": payload.get("_tipo_identificacao_principal").cloned().unwrap_or(serde_json::Value::Null),
            "observacao_tecnica": payload.get("_observacao_tecnica").cloned().unwrap_or(serde_json::Value::Null),
            "descricao": payload.get("_descricao").cloned().unwrap_or(serde_json::Value::Null),
            "marca": payload.get("_marca").cloned().unwrap_or(serde_json::Value::Null),
            "ncm": payload.get("_ncm").cloned().unwrap_or(serde_json::Value::Null),
            "vendido_por_peso": payload.get("_vendido_por_peso").cloned().unwrap_or(serde_json::Value::Bool(false)),
            "plu": payload.get("_plu").cloned().unwrap_or(serde_json::Value::Null),
            "aceita_etiqueta_balanca": payload.get("_aceita_etiqueta_balanca").cloned().unwrap_or(serde_json::Value::Bool(false)),
            "casas_decimais_quantidade": payload.get("_casas_decimais_quantidade").cloned().unwrap_or(serde_json::json!(3)),
            "created_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms)
                .map(|d| d.to_rfc3339()).unwrap_or_default(),
            "sync_status": "pending",
        });

        tx.execute(
            "INSERT INTO produtos_local(
                id, sku, nome, status, categoria_id, categoria_nome,
                preco_venda, estoque_atual, payload,
                updated_at_remote_ms, synced_at_ms, deleted_at_ms,
                local_uuid, remote_id, sync_status, last_error, created_offline_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9, NULL, ?10, NULL, ?1, NULL, 'pending', NULL, ?10)",
            params![local_uuid, sku, nome, status, categoria_id, categoria_nome,
                    preco_venda, estoque_inicial, full.to_string(), now_ms],
        )?;

        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            o.insert("_produto_id".into(), serde_json::Value::String(local_uuid.clone()));
            o.entry("_client_uuid").or_insert(serde_json::Value::String(local_uuid.clone()));
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_produtos(
                local_uuid, client_uuid, produto_local_uuid, produto_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,NULL,'criar',?4,'pending',0,?5,?5,NULL)",
            params![
                outbox_id,
                client_uuid.unwrap_or_else(|| local_uuid.clone()),
                local_uuid,
                rpc_payload.to_string(),
                now_ms
            ],
        )?;
        tx.commit()?;
        Ok(ProdutoEnqueueResult {
            produto_local_uuid: local_uuid,
            produto_remote_id: None,
            idempotente: false,
        })
    })
}

pub fn outbox_produtos_get(local_uuid: &str) -> DbResult<Option<OutboxProdutosItem>> {
    with_conn(|conn| {
        let sql = format!("SELECT {cols} FROM outbox_produtos WHERE local_uuid=?1", cols = PROD_COLS);
        let r = conn.query_row(&sql, params![local_uuid], map_prod_item).optional()?;
        Ok(r)
    })
}

pub fn outbox_produtos_pending_batch(limit: i64) -> DbResult<Vec<OutboxProdutosItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "SELECT {cols} FROM outbox_produtos
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1
              ORDER BY created_at_ms ASC LIMIT ?2",
            cols = PROD_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![now, limit], map_prod_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_produtos_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxProdutosItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = format!(
            "SELECT {cols} FROM outbox_produtos WHERE status='pending'
             ORDER BY created_at_ms ASC LIMIT ?1",
            cols = PROD_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit], map_prod_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_produtos_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxProdutosItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let sql = format!(
                "SELECT {cols} FROM outbox_produtos WHERE status=?1
                 ORDER BY created_at_ms DESC LIMIT ?2", cols = PROD_COLS);
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![st, limit], map_prod_item)?;
            for r in rows { out.push(r?); }
        } else {
            let sql = format!(
                "SELECT {cols} FROM outbox_produtos
                 ORDER BY created_at_ms DESC LIMIT ?1", cols = PROD_COLS);
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![limit], map_prod_item)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

pub fn outbox_produtos_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_produtos
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_produtos_mark_sent(
    local_uuid: &str,
    remote_id: &str,
    response: &str,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let item: Option<(String, String)> = tx.query_row(
            "SELECT produto_local_uuid, action FROM outbox_produtos WHERE local_uuid=?1",
            params![local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        tx.execute(
            "UPDATE outbox_produtos
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, remote_response=?4, last_error=NULL,
                    next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id, response],
        )?;
        if let Some((prod_lid, action)) = item {
            if action == "criar" {
                tx.execute(
                    "UPDATE produtos_local
                        SET remote_id=?1, sync_status='synced', last_error=NULL
                      WHERE local_uuid=?2",
                    params![remote_id, prod_lid],
                )?;
                tx.execute(
                    "UPDATE outbox_produtos
                        SET produto_remote_id=?1
                      WHERE produto_local_uuid=?2 AND produto_remote_id IS NULL",
                    params![remote_id, prod_lid],
                )?;
                let pendentes: Vec<(String, String)> = {
                    let mut stmt = tx.prepare(
                        "SELECT local_uuid, payload FROM outbox_produtos
                          WHERE produto_local_uuid=?1 AND action <> 'criar'
                            AND status IN ('pending','error','sending')",
                    )?;
                    let rows = stmt.query_map(params![prod_lid], |r| Ok((r.get(0)?, r.get(1)?)))?;
                    let mut out = Vec::new();
                    for r in rows { out.push(r?); }
                    out
                };
                for (lid, raw) in pendentes {
                    let mut p: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
                    if let Some(o) = p.as_object_mut() {
                        o.insert("_produto_id".into(), serde_json::Value::String(remote_id.to_string()));
                    }
                    tx.execute(
                        "UPDATE outbox_produtos SET payload=?2 WHERE local_uuid=?1",
                        params![lid, p.to_string()],
                    )?;
                }
            } else {
                let pendentes_outros: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM outbox_produtos
                      WHERE produto_local_uuid=?1 AND status IN ('pending','sending')",
                    params![prod_lid], |r| r.get(0),
                ).optional()?.unwrap_or(0);
                if pendentes_outros == 0 {
                    tx.execute(
                        "UPDATE produtos_local SET sync_status='synced', last_error=NULL
                          WHERE local_uuid=?1",
                        params![prod_lid],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_produtos_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_produtos WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?.unwrap_or(1);
        let prod_lid: Option<String> = conn.query_row(
            "SELECT produto_local_uuid FROM outbox_produtos WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_produtos
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
            if let Some(lid) = prod_lid {
                let _ = conn.execute(
                    "UPDATE produtos_local SET sync_status='error', last_error=?1
                      WHERE local_uuid=?2",
                    params![err, lid],
                );
            }
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_produtos
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_produtos_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_produtos
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
        )?;
        let _ = conn.execute(
            "UPDATE produtos_local SET sync_status='pending', last_error=NULL
              WHERE sync_status='error'",
            [],
        );
        Ok(n as i64)
    })
}

pub fn outbox_produtos_stats() -> DbResult<OutboxProdutosStats> {
    with_conn(|conn| {
        let mut s = OutboxProdutosStats::default();
        let mut stmt = conn.prepare("SELECT status, COUNT(*) FROM outbox_produtos GROUP BY status")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_produtos WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_produtos
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_produtos
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1",
            params![now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_produtos WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_prod_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_prod_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_prod_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_prod_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_prod_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_prod_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_produtos_record_flush_round(
    kind: &str, now_ms: i64, attempted: i64, sent: i64, failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_prod_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_prod_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_prod_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_prod_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_prod_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_prod_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

pub fn produto_remote_id_for(local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let r: Option<Option<String>> = conn.query_row(
            "SELECT remote_id FROM produtos_local WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        Ok(r.flatten())
    })
}

pub fn produto_resolve_local_uuid(any_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let lid: Option<String> = conn.query_row(
            "SELECT local_uuid FROM produtos_local
              WHERE local_uuid=?1 OR remote_id=?1 OR id=?1
              LIMIT 1",
            params![any_id], |r| r.get(0),
        ).optional()?;
        Ok(lid)
    })
}

// Enfileiramento genérico para editar/alterar_status/excluir.
// Cache patch atualiza o snapshot otimista; soft_delete marca deleted_at_ms
// e status='inativo' para sumir da lista até a sync confirmar.
pub fn produto_enqueue_action(
    target_local_uuid: &str,
    action: &str,
    payload: serde_json::Value,
    cache_patch: Option<serde_json::Value>,
    soft_delete: bool,
) -> DbResult<ProdutoEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        let row: Option<(String, Option<String>, String)> = tx.query_row(
            "SELECT local_uuid, remote_id, payload
               FROM produtos_local
              WHERE local_uuid=?1 OR remote_id=?1 OR id=?1
              LIMIT 1",
            params![target_local_uuid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?;
        let (prod_lid, remote_id, current_payload) = row.ok_or_else(|| {
            DbError::from(rusqlite::Error::QueryReturnedNoRows)
        })?;

        if let Some(patch) = cache_patch.as_ref() {
            let mut cur: serde_json::Value =
                serde_json::from_str(&current_payload)
                    .unwrap_or(serde_json::json!({}));
            if let (Some(co), Some(po)) = (cur.as_object_mut(), patch.as_object()) {
                for (k, v) in po { co.insert(k.clone(), v.clone()); }
            }
            let new_sku = cur.get("sku").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let new_nome = cur.get("nome").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let new_status_raw = cur.get("status").and_then(|v| v.as_str()).unwrap_or("ativo").to_string();
            let new_status = if soft_delete { "inativo".to_string() } else { new_status_raw };
            let new_categoria_id = cur.get("categoria_id").and_then(|v| v.as_str()).map(|s| s.to_string());
            let new_categoria_nome = cur.get("categoria")
                .and_then(|c| c.get("nome"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let new_preco_venda = cur.get("preco_venda").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let new_estoque_atual = cur.get("estoque_atual").and_then(|v| v.as_f64()).unwrap_or(0.0);
            tx.execute(
                "UPDATE produtos_local
                    SET sku=?2, nome=?3, status=?4,
                        categoria_id=?5, categoria_nome=?6,
                        preco_venda=?7, estoque_atual=?8,
                        payload=?9, sync_status='pending', last_error=NULL,
                        deleted_at_ms=CASE WHEN ?10 THEN ?11 ELSE deleted_at_ms END
                  WHERE local_uuid=?1",
                params![prod_lid, new_sku, new_nome, new_status,
                        new_categoria_id, new_categoria_nome,
                        new_preco_venda, new_estoque_atual,
                        cur.to_string(), soft_delete, now_ms],
            )?;
        } else if soft_delete {
            tx.execute(
                "UPDATE produtos_local
                    SET status='inativo', deleted_at_ms=?2,
                        sync_status='pending', last_error=NULL
                  WHERE local_uuid=?1",
                params![prod_lid, now_ms],
            )?;
        } else {
            tx.execute(
                "UPDATE produtos_local
                    SET sync_status='pending', last_error=NULL
                  WHERE local_uuid=?1",
                params![prod_lid],
            )?;
        }

        let effective_id = remote_id.clone().unwrap_or_else(|| prod_lid.clone());
        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            o.insert("_produto_id".into(), serde_json::Value::String(effective_id));
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_produtos(
                local_uuid, client_uuid, produto_local_uuid, produto_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1, ?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6, ?6, NULL)",
            params![
                outbox_id, prod_lid, remote_id,
                action, rpc_payload.to_string(), now_ms,
            ],
        )?;
        tx.commit()?;
        Ok(ProdutoEnqueueResult {
            produto_local_uuid: prod_lid,
            produto_remote_id: remote_id,
            idempotente: false,
        })
    })
}

// =====================================================================
// CATEGORIAS DE PRODUTO — offline-first (v24)
// =====================================================================

#[derive(Debug, Serialize, Default)]
pub struct OutboxCategoriasProdutoStats {
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
pub struct OutboxCategoriasProdutoItem {
    pub local_uuid: String,
    pub client_uuid: Option<String>,
    pub categoria_local_uuid: String,
    pub categoria_remote_id: Option<String>,
    pub action: String,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

const CAT_COLS: &str =
    "local_uuid, client_uuid, categoria_local_uuid, categoria_remote_id, action, payload,
     status, attempts, last_error, remote_id, created_at_ms, updated_at_ms, sent_at_ms";

fn map_cat_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxCategoriasProdutoItem> {
    Ok(OutboxCategoriasProdutoItem {
        local_uuid: r.get(0)?,
        client_uuid: r.get(1)?,
        categoria_local_uuid: r.get(2)?,
        categoria_remote_id: r.get(3)?,
        action: r.get(4)?,
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

#[derive(Debug, Serialize)]
pub struct CategoriaProdutoEnqueueResult {
    pub categoria_local_uuid: String,
    pub categoria_remote_id: Option<String>,
    pub idempotente: bool,
}

pub fn categoria_produto_criar_local(payload: serde_json::Value) -> DbResult<CategoriaProdutoEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        let client_uuid = json_str_opt(&payload, "_client_uuid");
        if let Some(cu) = &client_uuid {
            let existing: Option<(String, Option<String>)> = tx.query_row(
                "SELECT categoria_local_uuid, categoria_remote_id
                   FROM outbox_categorias_produto WHERE client_uuid=?1",
                params![cu], |r| Ok((r.get(0)?, r.get(1)?)),
            ).optional()?;
            if let Some((lid, rid)) = existing {
                tx.commit()?;
                return Ok(CategoriaProdutoEnqueueResult {
                    categoria_local_uuid: lid,
                    categoria_remote_id: rid,
                    idempotente: true,
                });
            }
        }

        let local_uuid = json_str_opt(&payload, "_categoria_id_in")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(random_uuid_v4);
        let nome = json_str_opt(&payload, "_nome").unwrap_or_default();
        let parent_id = json_str_opt(&payload, "_parent_id");

        let full = serde_json::json!({
            "id": &local_uuid,
            "local_uuid": &local_uuid,
            "remote_id": serde_json::Value::Null,
            "nome": &nome,
            "parent_id": parent_id,
            "ativo": true,
            "descricao": payload.get("_descricao").cloned().unwrap_or(serde_json::Value::Null),
            "created_at": chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms)
                .map(|d| d.to_rfc3339()).unwrap_or_default(),
            "sync_status": "pending",
        });

        tx.execute(
            "INSERT INTO categorias_produto_local(
                id, nome, parent_id, ativo, payload,
                updated_at_remote_ms, synced_at_ms, deleted_at_ms,
                local_uuid, remote_id, sync_status, last_error, created_offline_at_ms
             ) VALUES (?1,?2,?3,1,?4, NULL, ?5, NULL, ?1, NULL, 'pending', NULL, ?5)",
            params![local_uuid, nome, parent_id, full.to_string(), now_ms],
        )?;

        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            o.insert("_categoria_id_in".into(), serde_json::Value::String(local_uuid.clone()));
            o.entry("_client_uuid").or_insert(serde_json::Value::String(local_uuid.clone()));
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_categorias_produto(
                local_uuid, client_uuid, categoria_local_uuid, categoria_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1,?2,?3,NULL,'criar',?4,'pending',0,?5,?5,NULL)",
            params![
                outbox_id,
                client_uuid.unwrap_or_else(|| local_uuid.clone()),
                local_uuid,
                rpc_payload.to_string(),
                now_ms
            ],
        )?;
        tx.commit()?;
        Ok(CategoriaProdutoEnqueueResult {
            categoria_local_uuid: local_uuid,
            categoria_remote_id: None,
            idempotente: false,
        })
    })
}

pub fn outbox_categorias_produto_get(local_uuid: &str) -> DbResult<Option<OutboxCategoriasProdutoItem>> {
    with_conn(|conn| {
        let sql = format!("SELECT {cols} FROM outbox_categorias_produto WHERE local_uuid=?1", cols = CAT_COLS);
        let r = conn.query_row(&sql, params![local_uuid], map_cat_item).optional()?;
        Ok(r)
    })
}

pub fn outbox_categorias_produto_pending_batch(limit: i64) -> DbResult<Vec<OutboxCategoriasProdutoItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "SELECT {cols} FROM outbox_categorias_produto
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1
              ORDER BY created_at_ms ASC LIMIT ?2",
            cols = CAT_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![now, limit], map_cat_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_categorias_produto_pending_batch_all(limit: i64) -> DbResult<Vec<OutboxCategoriasProdutoItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let sql = format!(
            "SELECT {cols} FROM outbox_categorias_produto WHERE status='pending'
             ORDER BY created_at_ms ASC LIMIT ?1",
            cols = CAT_COLS,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit], map_cat_item)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

pub fn outbox_categorias_produto_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxCategoriasProdutoItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let mut out = Vec::new();
        if let Some(st) = only_status {
            let sql = format!(
                "SELECT {cols} FROM outbox_categorias_produto WHERE status=?1
                 ORDER BY created_at_ms DESC LIMIT ?2", cols = CAT_COLS);
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![st, limit], map_cat_item)?;
            for r in rows { out.push(r?); }
        } else {
            let sql = format!(
                "SELECT {cols} FROM outbox_categorias_produto
                 ORDER BY created_at_ms DESC LIMIT ?1", cols = CAT_COLS);
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![limit], map_cat_item)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

pub fn outbox_categorias_produto_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_categorias_produto
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_categorias_produto_mark_sent(
    local_uuid: &str,
    remote_id: &str,
    response: &str,
    now_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let item: Option<(String, String)> = tx.query_row(
            "SELECT categoria_local_uuid, action FROM outbox_categorias_produto WHERE local_uuid=?1",
            params![local_uuid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        tx.execute(
            "UPDATE outbox_categorias_produto
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, remote_response=?4, last_error=NULL,
                    next_attempt_at_ms=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id, response],
        )?;
        if let Some((cat_lid, action)) = item {
            if action == "criar" {
                tx.execute(
                    "UPDATE categorias_produto_local
                        SET remote_id=?1, sync_status='synced', last_error=NULL
                      WHERE local_uuid=?2",
                    params![remote_id, cat_lid],
                )?;
                tx.execute(
                    "UPDATE outbox_categorias_produto
                        SET categoria_remote_id=?1
                      WHERE categoria_local_uuid=?2 AND categoria_remote_id IS NULL",
                    params![remote_id, cat_lid],
                )?;
                let pendentes: Vec<(String, String)> = {
                    let mut stmt = tx.prepare(
                        "SELECT local_uuid, payload FROM outbox_categorias_produto
                          WHERE categoria_local_uuid=?1 AND action <> 'criar'
                            AND status IN ('pending','error','sending')",
                    )?;
                    let rows = stmt.query_map(params![cat_lid], |r| Ok((r.get(0)?, r.get(1)?)))?;
                    let mut out = Vec::new();
                    for r in rows { out.push(r?); }
                    out
                };
                for (lid, raw) in pendentes {
                    let mut p: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
                    if let Some(o) = p.as_object_mut() {
                        o.insert("_categoria_id".into(), serde_json::Value::String(remote_id.to_string()));
                    }
                    tx.execute(
                        "UPDATE outbox_categorias_produto SET payload=?2 WHERE local_uuid=?1",
                        params![lid, p.to_string()],
                    )?;
                }
                // Propaga remote_id da categoria a produtos pendentes que
                // ainda apontam para o local_uuid antigo.
                let _ = tx.execute(
                    "UPDATE produtos_local
                        SET categoria_id=?1
                      WHERE categoria_id=?2",
                    params![remote_id, cat_lid],
                );
            } else {
                let pendentes_outros: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM outbox_categorias_produto
                      WHERE categoria_local_uuid=?1 AND status IN ('pending','sending')",
                    params![cat_lid], |r| r.get(0),
                ).optional()?.unwrap_or(0);
                if pendentes_outros == 0 {
                    tx.execute(
                        "UPDATE categorias_produto_local SET sync_status='synced', last_error=NULL
                          WHERE local_uuid=?1",
                        params![cat_lid],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn outbox_categorias_produto_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        let attempts: i64 = conn.query_row(
            "SELECT attempts FROM outbox_categorias_produto WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?.unwrap_or(1);
        let cat_lid: Option<String> = conn.query_row(
            "SELECT categoria_local_uuid FROM outbox_categorias_produto WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        if attempts >= MAX_AUTO_ATTEMPTS {
            conn.execute(
                "UPDATE outbox_categorias_produto
                    SET status='error', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=NULL
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms],
            )?;
            if let Some(lid) = cat_lid {
                let _ = conn.execute(
                    "UPDATE categorias_produto_local SET sync_status='error', last_error=?1
                      WHERE local_uuid=?2",
                    params![err, lid],
                );
            }
        } else {
            let next = now_ms + backoff_ms_for_attempts(attempts);
            conn.execute(
                "UPDATE outbox_categorias_produto
                    SET status='pending', last_error=?2, updated_at_ms=?3,
                        next_attempt_at_ms=?4
                  WHERE local_uuid=?1",
                params![local_uuid, err, now_ms, next],
            )?;
        }
        Ok(())
    })
}

pub fn outbox_categorias_produto_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_categorias_produto
                SET status='pending', updated_at_ms=?1,
                    next_attempt_at_ms=NULL, last_error=NULL
              WHERE status IN ('error','pending') AND last_error IS NOT NULL",
            params![now_ms],
        )?;
        let _ = conn.execute(
            "UPDATE categorias_produto_local SET sync_status='pending', last_error=NULL
              WHERE sync_status='error'",
            [],
        );
        Ok(n as i64)
    })
}

pub fn outbox_categorias_produto_stats() -> DbResult<OutboxCategoriasProdutoStats> {
    with_conn(|conn| {
        let mut s = OutboxCategoriasProdutoStats::default();
        let mut stmt = conn.prepare("SELECT status, COUNT(*) FROM outbox_categorias_produto GROUP BY status")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
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
        s.last_sent_at_ms = conn.query_row(
            "SELECT MAX(sent_at_ms) FROM outbox_categorias_produto WHERE status='sent'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_error = conn.query_row(
            "SELECT last_error FROM outbox_categorias_produto
              WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
            [], |r| r.get::<_, Option<String>>(0),
        ).optional()?.flatten();
        let now = chrono::Utc::now().timestamp_millis();
        s.due_now = conn.query_row(
            "SELECT COUNT(*) FROM outbox_categorias_produto
              WHERE status='pending' AND COALESCE(next_attempt_at_ms,0) <= ?1",
            params![now], |r| r.get::<_, i64>(0),
        ).optional()?.unwrap_or(0);
        s.next_attempt_at_ms = conn.query_row(
            "SELECT MIN(COALESCE(next_attempt_at_ms,0))
               FROM outbox_categorias_produto WHERE status='pending'",
            [], |r| r.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        s.last_auto_flush_ms = meta_get_i64(conn, "outbox_cat_prod_last_auto_flush_ms")?;
        s.last_auto_flush_sent_ms = meta_get_i64(conn, "outbox_cat_prod_last_auto_flush_sent_ms")?;
        s.last_auto_attempted = meta_get_i64(conn, "outbox_cat_prod_last_auto_attempted")?;
        s.last_auto_sent = meta_get_i64(conn, "outbox_cat_prod_last_auto_sent")?;
        s.last_auto_failed = meta_get_i64(conn, "outbox_cat_prod_last_auto_failed")?;
        s.last_manual_flush_ms = meta_get_i64(conn, "outbox_cat_prod_last_manual_flush_ms")?;
        Ok(s)
    })
}

pub fn outbox_categorias_produto_record_flush_round(
    kind: &str, now_ms: i64, attempted: i64, sent: i64, failed: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        if kind == "auto" {
            meta_set_i64(conn, "outbox_cat_prod_last_auto_flush_ms", now_ms)?;
            meta_set_i64(conn, "outbox_cat_prod_last_auto_attempted", attempted)?;
            meta_set_i64(conn, "outbox_cat_prod_last_auto_sent", sent)?;
            meta_set_i64(conn, "outbox_cat_prod_last_auto_failed", failed)?;
            if sent > 0 {
                meta_set_i64(conn, "outbox_cat_prod_last_auto_flush_sent_ms", now_ms)?;
            }
        } else {
            meta_set_i64(conn, "outbox_cat_prod_last_manual_flush_ms", now_ms)?;
        }
        Ok(())
    })
}

pub fn categoria_produto_remote_id_for(local_uuid: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let r: Option<Option<String>> = conn.query_row(
            "SELECT remote_id FROM categorias_produto_local WHERE local_uuid=?1",
            params![local_uuid], |r| r.get(0),
        ).optional()?;
        Ok(r.flatten())
    })
}

pub fn categoria_produto_resolve_local_uuid(any_id: &str) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let lid: Option<String> = conn.query_row(
            "SELECT local_uuid FROM categorias_produto_local
              WHERE local_uuid=?1 OR remote_id=?1 OR id=?1
              LIMIT 1",
            params![any_id], |r| r.get(0),
        ).optional()?;
        Ok(lid)
    })
}

pub fn categoria_produto_enqueue_action(
    target_local_uuid: &str,
    action: &str,
    payload: serde_json::Value,
    cache_patch: Option<serde_json::Value>,
    soft_delete: bool,
) -> DbResult<CategoriaProdutoEnqueueResult> {
    with_conn(|conn| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = conn.unchecked_transaction()?;

        let row: Option<(String, Option<String>, String)> = tx.query_row(
            "SELECT local_uuid, remote_id, payload
               FROM categorias_produto_local
              WHERE local_uuid=?1 OR remote_id=?1 OR id=?1
              LIMIT 1",
            params![target_local_uuid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?;
        let (cat_lid, remote_id, current_payload) = row.ok_or_else(|| {
            DbError::from(rusqlite::Error::QueryReturnedNoRows)
        })?;

        if let Some(patch) = cache_patch.as_ref() {
            let mut cur: serde_json::Value =
                serde_json::from_str(&current_payload)
                    .unwrap_or(serde_json::json!({}));
            if let (Some(co), Some(po)) = (cur.as_object_mut(), patch.as_object()) {
                for (k, v) in po { co.insert(k.clone(), v.clone()); }
            }
            let new_nome = cur.get("nome").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let new_parent = cur.get("parent_id").and_then(|v| v.as_str()).map(|s| s.to_string());
            let new_ativo = cur.get("ativo").and_then(|v| v.as_bool()).unwrap_or(true);
            let final_ativo = if soft_delete { false } else { new_ativo };
            tx.execute(
                "UPDATE categorias_produto_local
                    SET nome=?2, parent_id=?3,
                        ativo=CASE WHEN ?4 THEN 1 ELSE 0 END,
                        payload=?5, sync_status='pending', last_error=NULL,
                        deleted_at_ms=CASE WHEN ?6 THEN ?7 ELSE deleted_at_ms END
                  WHERE local_uuid=?1",
                params![cat_lid, new_nome, new_parent, final_ativo, cur.to_string(), soft_delete, now_ms],
            )?;
        } else if soft_delete {
            tx.execute(
                "UPDATE categorias_produto_local
                    SET ativo=0, deleted_at_ms=?2,
                        sync_status='pending', last_error=NULL
                  WHERE local_uuid=?1",
                params![cat_lid, now_ms],
            )?;
        } else {
            tx.execute(
                "UPDATE categorias_produto_local
                    SET sync_status='pending', last_error=NULL
                  WHERE local_uuid=?1",
                params![cat_lid],
            )?;
        }

        let effective_id = remote_id.clone().unwrap_or_else(|| cat_lid.clone());
        let mut rpc_payload = payload.clone();
        if let Some(o) = rpc_payload.as_object_mut() {
            o.insert("_categoria_id".into(), serde_json::Value::String(effective_id));
        }

        let outbox_id = random_uuid_v4();
        tx.execute(
            "INSERT INTO outbox_categorias_produto(
                local_uuid, client_uuid, categoria_local_uuid, categoria_remote_id,
                action, payload, status, attempts, created_at_ms, updated_at_ms, next_attempt_at_ms
             ) VALUES (?1, ?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6, ?6, NULL)",
            params![
                outbox_id, cat_lid, remote_id,
                action, rpc_payload.to_string(), now_ms,
            ],
        )?;
        tx.commit()?;
        Ok(CategoriaProdutoEnqueueResult {
            categoria_local_uuid: cat_lid,
            categoria_remote_id: remote_id,
            idempotente: false,
        })
    })
}
