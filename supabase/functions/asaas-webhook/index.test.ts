// @vitest-environment node
/**
 * Regressão do ramo OVERDUE do asaas-webhook (index.ts).
 *
 * Problema: o ramo OVERDUE usava `.neq("status", "pago")` e por isso também reabria
 * pagamento `cancelado` como `atrasado`. Com os índices únicos de mensalidade
 * (uq_pagamentos_mensalidade_pendente) e de competência (uq_pagamentos_empresa_competencia,
 * migration 20260918160000) isso vira 23505 -> HTTP 500 -> reentrega do evento.
 * Regra: só `pendente`/`atrasado` ficam/viram `atrasado`; cancelado, pago e qualquer outro
 * estado nunca regridem.
 *
 * Também cobre PAYMENT_DELETED (cobrança excluída no Asaas). O GET /payments/{id} de uma cobrança
 * excluída segue devolvendo o status de antes (PENDING/OVERDUE); decidir só pelo status deixava a
 * mensalidade `pendente` com QR morto e a competência ocupada (o índice de mensalidade aberta
 * impedia gerar outra). Regra: o evento cancela localmente só `pendente`/`atrasado` (nunca `pago`),
 * sem tocar em assinatura/módulos; a linha fica no histórico e a competência volta a ficar livre.
 * O mesmo fluxo contra o banco real (solicitar_mensalidade() incluída) está em
 * supabase/tests/asaas_webhook_payment_deleted_test.sql.
 *
 * Como funciona: o teste importa o handler REAL (index.ts). Só as bordas são trocadas:
 *   - `Deno.env` / `Deno.serve`  -> stubs (o handler é capturado em `Deno.serve`);
 *   - `createClient` (esm.sh)    -> cliente em memória que modela as tabelas usadas e os
 *     índices únicos, com a semântica de filtro do PostgREST (eq / neq / in);
 *   - `fetch`                    -> API do Asaas simulada.
 * O modelo dos índices é confirmado contra um banco real em
 * supabase/tests/asaas_webhook_overdue_test.sql (mesmos cenários, com o SQL que o PostgREST gera).
 *
 * Se a versão do supabase-js importada em index.ts mudar, atualize a URL no `vi.mock` abaixo.
 * Rode com `npm test`.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

type Linha = Record<string, unknown>;
type Filtro = { op: "eq" | "neq" | "in"; col: string; val: unknown };
type Resposta = { data: unknown; error: { code: string; message: string } | null };

// --- modelo mínimo do banco ------------------------------------------------------------

const ABERTOS = ["pendente", "atrasado"];
const VALIDOS = ["pendente", "atrasado", "pago"];

class BancoFalso {
  pagamentos: Linha[] = [];
  eventos: Linha[] = [];
  config: Linha = { asaas_enabled: true, asaas_ambiente: "sandbox" };
  escritas: { tabela: string; patch: Linha; afetadas: number }[] = [];
  rpcs: { nome: string; args: Linha }[] = [];
  /** Injeta uma falha de banco (ex.: queda transitória) nos UPDATEs da tabela informada. */
  falhaEmUpdate: { tabela: string; code: string; message: string } | null = null;

  pagamento(id: string): Linha {
    const linha = this.pagamentos.find((p) => p.id === id);
    if (!linha) throw new Error(`pagamento ${id} inexistente`);
    return linha;
  }

  escritasEm(tabela: string): number {
    return this.escritas.filter((e) => e.tabela === tabela).length;
  }
}

/**
 * Espelha os índices únicos parciais das migrations:
 *  - uq_pagamentos_empresa_competencia (20260918160000): (empresa_id, competencia) para
 *    status pendente/atrasado/pago, competencia informada e sem competencia_duplicada_de;
 *  - uq_pagamentos_mensalidade_pendente (20260825120000): uma mensalidade aberta por empresa
 *    (referencia 'outro', pendente/atrasado, descricao 'Mensalidade%').
 */
function indiceViolado(tabela: Linha[], linha: Linha): string | null {
  const outras = tabela.filter((o) => o !== linha && o.empresa_id === linha.empresa_id);
  const valida = (l: Linha) =>
    VALIDOS.includes(String(l.status)) &&
    l.competencia != null &&
    l.competencia_duplicada_de == null;
  if (valida(linha) && outras.some((o) => valida(o) && o.competencia === linha.competencia)) {
    return "uq_pagamentos_empresa_competencia";
  }
  const mensalidadeAberta = (l: Linha) =>
    l.referencia_tipo === "outro" &&
    ABERTOS.includes(String(l.status)) &&
    String(l.descricao).startsWith("Mensalidade");
  if (mensalidadeAberta(linha) && outras.some(mensalidadeAberta)) {
    return "uq_pagamentos_mensalidade_pendente";
  }
  return null;
}

function casa(linha: Linha, filtro: Filtro): boolean {
  const valor = linha[filtro.col];
  if (filtro.op === "eq") return valor === filtro.val;
  if (filtro.op === "neq") return valor !== filtro.val;
  return Array.isArray(filtro.val) && filtro.val.includes(valor);
}

const erro = (code: string, message: string): Resposta => ({
  data: null,
  error: { code, message },
});

/** Builder encadeável no formato do supabase-js (thenable), só com o que o webhook usa. */
class Consulta implements PromiseLike<Resposta> {
  private acao: "select" | "insert" | "update" = "select";
  private corpo: Linha = {};
  private filtros: Filtro[] = [];
  private unico = false;

  constructor(
    private banco: BancoFalso,
    private tabela: string,
  ) {}

  select(_colunas?: string) {
    return this;
  }
  insert(corpo: Linha) {
    this.acao = "insert";
    this.corpo = corpo;
    return this;
  }
  update(corpo: Linha) {
    this.acao = "update";
    this.corpo = corpo;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filtros.push({ op: "eq", col, val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.filtros.push({ op: "neq", col, val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.filtros.push({ op: "in", col, val });
    return this;
  }
  maybeSingle() {
    this.unico = true;
    return this;
  }

  then<R1 = Resposta, R2 = never>(
    onfulfilled?: ((value: Resposta) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.executar()).then(onfulfilled, onrejected);
  }

  private executar(): Resposta {
    const { banco, tabela } = this;
    const linhas =
      tabela === "pagamentos"
        ? banco.pagamentos
        : tabela === "asaas_webhook_eventos"
          ? banco.eventos
          : tabela === "config_comercial"
            ? [banco.config]
            : null;
    if (!linhas) throw new Error(`tabela não modelada: ${tabela}`);

    if (this.acao === "insert") {
      if (tabela !== "asaas_webhook_eventos") throw new Error(`insert não modelado em ${tabela}`);
      if (linhas.some((e) => e.event_id === this.corpo.event_id)) {
        return erro(
          "23505",
          'duplicate key value violates unique constraint "uq_asaas_webhook_event_id"',
        );
      }
      linhas.push({ processado_em: null, ...this.corpo });
      return { data: null, error: null };
    }

    const alvo = linhas.filter((l) => this.filtros.every((f) => casa(l, f)));

    if (this.acao === "update") {
      if (banco.falhaEmUpdate?.tabela === tabela) {
        return erro(banco.falhaEmUpdate.code, banco.falhaEmUpdate.message);
      }
      // Atômico como um UPDATE: valida os índices no estado resultante e só então grava.
      const novas = new Map(alvo.map((l) => [l, { ...l, ...this.corpo }]));
      if (tabela === "pagamentos") {
        const depois = linhas.map((l) => novas.get(l) ?? l);
        for (const nova of novas.values()) {
          const indice = indiceViolado(depois, nova);
          if (indice)
            return erro("23505", `duplicate key value violates unique constraint "${indice}"`);
        }
      }
      for (const [antiga, nova] of novas) {
        Object.assign(antiga, nova);
        // Todo UPDATE reescreve a linha (nova versão), mesmo com o mesmo valor.
        if (tabela === "pagamentos") antiga.versao = Number(antiga.versao ?? 0) + 1;
      }
      banco.escritas.push({ tabela, patch: this.corpo, afetadas: alvo.length });
      return { data: null, error: null };
    }

    if (this.unico) {
      if (alvo.length > 1) return erro("PGRST116", "mais de uma linha para maybeSingle");
      return { data: alvo[0] ?? null, error: null };
    }
    return { data: alvo, error: null };
  }
}

function criarCliente(banco: BancoFalso) {
  return {
    from: (tabela: string) => new Consulta(banco, tabela),
    rpc: async (nome: string, args: Linha) => {
      banco.rpcs.push({ nome, args });
      return { data: { ok: true }, error: null };
    },
  };
}

// --- bordas do handler -----------------------------------------------------------------

const estado = vi.hoisted(() => ({ criarCliente: null as null | (() => unknown) }));

vi.mock("https://esm.sh/@supabase/supabase-js@2.45.0", () => ({
  createClient: () => estado.criarCliente?.(),
}));

const TOKEN = "token-de-teste";
let banco: BancoFalso;
let asaas: Map<string, Linha>;
let asaasIndisponivel = false;
let handler: (request: Request) => Promise<Response>;
let sequencia = 0;
const logErro = vi.spyOn(console, "error").mockImplementation(() => {});

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    ASAAS_API_KEY: "asaas-key",
    ASAAS_WEBHOOK_TOKEN: TOKEN,
  };
  vi.stubGlobal("Deno", {
    env: { get: (chave: string) => env[chave] },
    serve: (funcao: typeof handler) => {
      handler = funcao;
    },
  });
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const id = decodeURIComponent(String(url).split("/payments/")[1] ?? "");
    const corpo = asaas.get(id);
    if (asaasIndisponivel || !corpo) return new Response("erro", { status: 500 });
    return new Response(JSON.stringify(corpo), { status: 200 });
  });
  await import("./index");
});

afterAll(() => {
  vi.unstubAllGlobals();
  logErro.mockRestore();
});

beforeEach(() => {
  banco = new BancoFalso();
  asaas = new Map();
  asaasIndisponivel = false;
  estado.criarCliente = () => criarCliente(banco);
  logErro.mockClear();
});

// --- auxiliares dos cenários -----------------------------------------------------------

type Semente = Partial<Linha> & { id: string; asaas_payment_id: string };

/** Cria o pagamento local e a cobrança correspondente no Asaas (com o status informado). */
function semear(semente: Semente, statusNoAsaas = "OVERDUE"): Linha {
  const linha: Linha = {
    empresa_id: "empresa-1",
    valor: 150,
    status: "pendente",
    external_reference: null,
    referencia_tipo: "outro",
    descricao: "Carrinho: 1 plano(s) e 0 modulo(s)",
    competencia: null,
    competencia_duplicada_de: null,
    versao: 0,
    ...semente,
  };
  banco.pagamentos.push(linha);
  asaas.set(semente.asaas_payment_id, {
    id: semente.asaas_payment_id,
    status: statusNoAsaas,
    value: 150,
    externalReference: `gestaopro|pagamento|${semente.id}`,
  });
  return linha;
}

function evento(
  paymentId: string,
  opcoes: { id?: string | null; tipo?: string; status?: string } = {},
): Request {
  const corpo: Linha = {
    event: opcoes.tipo ?? "PAYMENT_OVERDUE",
    payment: { id: paymentId, status: opcoes.status ?? "OVERDUE" },
  };
  if (opcoes.id !== null) corpo.id = opcoes.id ?? `evt_${++sequencia}`;
  return new Request("https://webhook.test/asaas-webhook", {
    method: "POST",
    headers: { "asaas-access-token": TOKEN, "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

async function enviar(request: Request): Promise<{ status: number; corpo: Linha }> {
  const resposta = await handler(request);
  return { status: resposta.status, corpo: (await resposta.json()) as Linha };
}

// --- cenários --------------------------------------------------------------------------

describe("asaas-webhook: PAYMENT_OVERDUE", () => {
  it("1) pendente + OVERDUE -> atrasado", async () => {
    semear({ id: "pg-1", asaas_payment_id: "pay_1", status: "pendente" });

    const r = await enviar(evento("pay_1"));

    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ received: true, processed: true });
    expect(banco.pagamento("pg-1").status).toBe("atrasado");
    expect(logErro).not.toHaveBeenCalled();
    expect(banco.eventos).toHaveLength(1);
    expect(banco.eventos[0].processado_em).not.toBeNull();
    expect(banco.rpcs).toHaveLength(0);
  });

  it("2) atrasado + OVERDUE -> continua atrasado (idempotente, sem erro)", async () => {
    semear({ id: "pg-1", asaas_payment_id: "pay_1", status: "atrasado" });

    const r = await enviar(evento("pay_1"));

    expect(r.status).toBe(200);
    expect(banco.pagamento("pg-1").status).toBe("atrasado");
    expect(logErro).not.toHaveBeenCalled();
  });

  it("3) cancelado + OVERDUE -> continua cancelado (não é reaberto)", async () => {
    semear({ id: "pg-1", asaas_payment_id: "pay_1", status: "cancelado" });

    const r = await enviar(evento("pay_1"));

    expect(r.status).toBe(200);
    expect(banco.pagamento("pg-1")).toMatchObject({ status: "cancelado", versao: 0 });
    expect(logErro).not.toHaveBeenCalled();
    expect(banco.eventos[0].processado_em).not.toBeNull();
  });

  it("4) pago + OVERDUE -> continua pago (não regride)", async () => {
    semear({ id: "pg-1", asaas_payment_id: "pay_1", status: "pago", data_pagamento: "2025-02-05" });

    const r = await enviar(evento("pay_1"));

    expect(r.status).toBe(200);
    expect(banco.pagamento("pg-1")).toMatchObject({
      status: "pago",
      data_pagamento: "2025-02-05",
      versao: 0,
    });
    expect(logErro).not.toHaveBeenCalled();
  });

  it("4b) qualquer outro estado (lista de permissão) também não regride", async () => {
    // Estados que não existem hoje no enum; a regra é "só pendente/atrasado", não "tudo menos pago".
    semear({ id: "pg-1", asaas_payment_id: "pay_1", status: "estornado" });
    semear({ id: "pg-2", asaas_payment_id: "pay_2", status: "em_analise" });

    expect((await enviar(evento("pay_1"))).status).toBe(200);
    expect((await enviar(evento("pay_2"))).status).toBe(200);

    expect(banco.pagamento("pg-1")).toMatchObject({ status: "estornado", versao: 0 });
    expect(banco.pagamento("pg-2")).toMatchObject({ status: "em_analise", versao: 0 });
  });

  describe("5) cobrança cancelada de uma competência + nova cobrança válida da mesma competência", () => {
    const mensalidade = { referencia_tipo: "outro", descricao: "Mensalidade Plano A" };

    it("5a) nova PENDENTE: OVERDUE da antiga não gera 23505 e não toca na nova", async () => {
      semear({
        id: "pg-antiga",
        asaas_payment_id: "pay_antiga",
        status: "cancelado",
        competencia: "2025-02-10",
        ...mensalidade,
      });
      const nova = semear(
        {
          id: "pg-nova",
          asaas_payment_id: "pay_nova",
          status: "pendente",
          competencia: "2025-02-10",
          ...mensalidade,
        },
        "PENDING",
      );

      const r = await enviar(evento("pay_antiga"));

      expect(r.status).toBe(200);
      expect(logErro).not.toHaveBeenCalled();
      expect(banco.pagamento("pg-antiga")).toMatchObject({ status: "cancelado", versao: 0 });
      expect(nova).toMatchObject({ status: "pendente", versao: 0 });
    });

    it("5b) nova PAGA (ocupa a competência): OVERDUE da antiga não gera 23505 e não toca na nova", async () => {
      semear({
        id: "pg-antiga",
        asaas_payment_id: "pay_antiga",
        status: "cancelado",
        competencia: "2025-02-10",
        ...mensalidade,
      });
      const nova = semear(
        {
          id: "pg-nova",
          asaas_payment_id: "pay_nova",
          status: "pago",
          competencia: "2025-02-10",
          data_pagamento: "2025-02-05",
          ...mensalidade,
        },
        "RECEIVED",
      );

      const r = await enviar(evento("pay_antiga"));

      expect(r.status).toBe(200);
      expect(logErro).not.toHaveBeenCalled();
      expect(banco.pagamento("pg-antiga")).toMatchObject({ status: "cancelado", versao: 0 });
      expect(nova).toMatchObject({ status: "pago", versao: 0 });
    });

    it("5c) histórico sem competência (índice antigo, uma mensalidade aberta por empresa)", async () => {
      semear({
        id: "pg-antiga",
        asaas_payment_id: "pay_antiga",
        status: "cancelado",
        ...mensalidade,
      });
      const nova = semear(
        { id: "pg-nova", asaas_payment_id: "pay_nova", status: "pendente", ...mensalidade },
        "PENDING",
      );

      const r = await enviar(evento("pay_antiga"));

      expect(r.status).toBe(200);
      expect(logErro).not.toHaveBeenCalled();
      expect(banco.pagamento("pg-antiga")).toMatchObject({ status: "cancelado", versao: 0 });
      expect(nova).toMatchObject({ status: "pendente", versao: 0 });
    });

    it("5d) controle do modelo: com o filtro ANTIGO (neq pago) o 23505 aconteceria", async () => {
      semear({
        id: "pg-antiga",
        asaas_payment_id: "pay_antiga",
        status: "cancelado",
        competencia: "2025-02-10",
        ...mensalidade,
      });
      semear({
        id: "pg-nova",
        asaas_payment_id: "pay_nova",
        status: "pago",
        competencia: "2025-02-10",
        ...mensalidade,
      });
      semear({
        id: "pg-h1",
        asaas_payment_id: "pay_h1",
        status: "cancelado",
        empresa_id: "empresa-2",
        ...mensalidade,
      });
      semear({
        id: "pg-h2",
        asaas_payment_id: "pay_h2",
        status: "pendente",
        empresa_id: "empresa-2",
        ...mensalidade,
      });
      const cliente = criarCliente(banco);

      const porCompetencia = await cliente
        .from("pagamentos")
        .update({ status: "atrasado" })
        .eq("id", "pg-antiga")
        .neq("status", "pago");
      const porDescricao = await cliente
        .from("pagamentos")
        .update({ status: "atrasado" })
        .eq("id", "pg-h1")
        .neq("status", "pago");

      expect(porCompetencia.error?.code).toBe("23505");
      expect(porCompetencia.error?.message).toContain("uq_pagamentos_empresa_competencia");
      expect(porDescricao.error?.code).toBe("23505");
      expect(porDescricao.error?.message).toContain("uq_pagamentos_mensalidade_pendente");
      // e o UPDATE que falha não grava nada
      expect(banco.pagamento("pg-antiga").status).toBe("cancelado");
      expect(banco.pagamento("pg-h1").status).toBe("cancelado");
    });
  });

  describe("6) reentrega e idempotência do evento", () => {
    it("6a) mesmo evento já processado: responde duplicate e não escreve nem reabre nada", async () => {
      semear({ id: "pg-1", asaas_payment_id: "pay_1", status: "pendente" });
      const primeira = await enviar(evento("pay_1", { id: "evt_dup" }));
      expect(primeira.corpo).toMatchObject({ received: true, processed: true });
      expect(banco.pagamento("pg-1").status).toBe("atrasado");
      const escritasAntes = banco.escritas.length;

      // entre as duas entregas a cobrança é cancelada (ex.: pelo Master)
      banco.pagamento("pg-1").status = "cancelado";
      const segunda = await enviar(evento("pay_1", { id: "evt_dup" }));

      expect(segunda.status).toBe(200);
      expect(segunda.corpo).toEqual({ received: true, duplicate: true });
      expect(banco.escritas).toHaveLength(escritasAntes);
      expect(banco.pagamento("pg-1").status).toBe("cancelado");
      expect(banco.eventos).toHaveLength(1);
    });

    it("6b) evento não concluído (Asaas indisponível) é reprocessado na reentrega, sem duplicar efeito", async () => {
      semear({ id: "pg-1", asaas_payment_id: "pay_1", status: "pendente" });
      asaasIndisponivel = true;

      const falha = await enviar(evento("pay_1", { id: "evt_retry" }));
      expect(falha.status).toBe(500);
      expect(banco.pagamento("pg-1").status).toBe("pendente");
      expect(banco.eventos[0].processado_em).toBeNull();

      asaasIndisponivel = false;
      const retry = await enviar(evento("pay_1", { id: "evt_retry" }));
      expect(retry.status).toBe(200);
      expect(retry.corpo).toMatchObject({ processed: true });
      expect(banco.pagamento("pg-1").status).toBe("atrasado");
      expect(banco.eventos).toHaveLength(1);
      expect(banco.eventos[0].processado_em).not.toBeNull();

      const depois = await enviar(evento("pay_1", { id: "evt_retry" }));
      expect(depois.corpo).toEqual({ received: true, duplicate: true });
    });

    it("6c) evento sem id: a chave determinística (sha256 do corpo) também deduplica", async () => {
      semear({ id: "pg-1", asaas_payment_id: "pay_1", status: "pendente" });

      const a = await enviar(evento("pay_1", { id: null }));
      const b = await enviar(evento("pay_1", { id: null }));

      expect(a.corpo).toMatchObject({ processed: true });
      expect(b.corpo).toEqual({ received: true, duplicate: true });
      expect(banco.eventos).toHaveLength(1);
      expect(banco.pagamento("pg-1").status).toBe("atrasado");
    });

    it("6d) OVERDUE novo (outro id) para cobrança já cancelada não a reabre", async () => {
      semear({ id: "pg-1", asaas_payment_id: "pay_1", status: "pendente" });
      await enviar(evento("pay_1", { id: "evt_a" }));
      banco.pagamento("pg-1").status = "cancelado";

      const r = await enviar(evento("pay_1", { id: "evt_b" }));

      expect(r.status).toBe(200);
      expect(banco.pagamento("pg-1").status).toBe("cancelado");
    });
  });
});

describe("asaas-webhook: os outros ramos não reabrem cobrança cancelada", () => {
  it("cancelamento (REFUNDED): pendente -> cancelado; cancelado e pago não mudam", async () => {
    semear({ id: "pg-p", asaas_payment_id: "pay_p", status: "pendente" }, "REFUNDED");
    semear({ id: "pg-c", asaas_payment_id: "pay_c", status: "cancelado" }, "REFUNDED");
    semear({ id: "pg-g", asaas_payment_id: "pay_g", status: "pago" }, "REFUNDED");

    for (const id of ["pay_p", "pay_c", "pay_g"]) {
      expect(
        (await enviar(evento(id, { tipo: "PAYMENT_REFUNDED", status: "REFUNDED" }))).status,
      ).toBe(200);
    }

    expect(banco.pagamento("pg-p").status).toBe("cancelado");
    expect(banco.pagamento("pg-c").status).toBe("cancelado");
    expect(banco.pagamento("pg-g").status).toBe("pago");
  });

  it("status desconhecido/pendente no Asaas não escreve em pagamentos", async () => {
    semear({ id: "pg-c", asaas_payment_id: "pay_c", status: "cancelado" }, "PENDING");

    const r = await enviar(evento("pay_c", { tipo: "PAYMENT_UPDATED", status: "PENDING" }));

    expect(r.corpo).toMatchObject({
      processed: true,
      result: { status: "PENDING", changed: false },
    });
    expect(banco.escritasEm("pagamentos")).toBe(0);
    expect(banco.pagamento("pg-c").status).toBe("cancelado");
  });

  it("confirmação (RECEIVED) delega ao RPC confirmar_pagamento_asaas e não escreve status direto", async () => {
    // Único caminho que leva um cancelado a "pago" (dinheiro recebido): o RPC decide
    // (aplica, registra duplicidade ou plano divergente) sem violar os índices.
    semear({ id: "pg-c", asaas_payment_id: "pay_c", status: "cancelado" }, "RECEIVED");

    const r = await enviar(evento("pay_c", { tipo: "PAYMENT_RECEIVED", status: "RECEIVED" }));

    expect(r.status).toBe(200);
    expect(banco.rpcs).toHaveLength(1);
    expect(banco.rpcs[0].nome).toBe("confirmar_pagamento_asaas");
    expect(banco.rpcs[0].args).toMatchObject({ _pagamento_id: "pg-c" });
    expect(banco.escritasEm("pagamentos")).toBe(0);
  });
});

describe("asaas-webhook: PAYMENT_DELETED (cobrança excluída no Asaas)", () => {
  let logAviso: MockInstance;
  beforeAll(() => {
    logAviso = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  beforeEach(() => logAviso.mockClear());
  afterAll(() => logAviso.mockRestore());

  const mensalidade = {
    referencia_tipo: "outro",
    descricao: "Mensalidade Plano A",
    competencia: "2025-02-10",
  };

  /** Cobrança excluída: o GET /payments/{id} devolve o status de ANTES (PENDING/OVERDUE) + deleted. */
  function semearExcluida(
    semente: Semente,
    statusNoAsaas: string,
    extra: Linha = { deleted: true },
  ): Linha {
    const linha = semear(semente, statusNoAsaas);
    Object.assign(asaas.get(semente.asaas_payment_id) as Linha, extra);
    return linha;
  }

  function excluir(
    paymentId: string,
    opcoes: { id?: string | null; status?: string } = {},
  ): Request {
    return evento(paymentId, { tipo: "PAYMENT_DELETED", status: "PENDING", ...opcoes });
  }

  const escritasEmPagamentos = () => banco.escritas.filter((e) => e.tabela === "pagamentos");
  const cancelaUmaLinha = { tabela: "pagamentos", patch: { status: "cancelado" }, afetadas: 1 };

  it("1) pendente + PAYMENT_DELETED -> cancelado; a linha fica no histórico e só o status muda", async () => {
    semearExcluida(
      {
        id: "pg-1",
        asaas_payment_id: "pay_1",
        status: "pendente",
        asaas_pix_qrcode: "QR-BASE64",
        asaas_pix_copia_cola: "00020101021226",
        data_vencimento: "2025-02-13",
        ...mensalidade,
      },
      "PENDING",
    );

    const r = await enviar(excluir("pay_1"));

    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({
      received: true,
      processed: true,
      result: { status: "cancelado", changed: true },
    });
    expect(logErro).not.toHaveBeenCalled();
    // não exclui a linha: o registro cancelado permanece (asaas_payment_id, QR e competência intactos)
    expect(banco.pagamentos).toHaveLength(1);
    expect(banco.pagamento("pg-1")).toMatchObject({
      status: "cancelado",
      asaas_payment_id: "pay_1",
      asaas_pix_qrcode: "QR-BASE64",
      asaas_pix_copia_cola: "00020101021226",
      data_vencimento: "2025-02-13",
      competencia: "2025-02-10",
      valor: 150,
      versao: 1,
    });
    // única escrita em pagamentos: só o status, em uma linha. Sem RPC (assinatura/módulos) e sem
    // nenhuma outra tabela (o modelo lança em tabela não modelada, o que viraria HTTP 500).
    expect(escritasEmPagamentos()).toEqual([cancelaUmaLinha]);
    expect(banco.rpcs).toHaveLength(0);
    expect(new Set(banco.escritas.map((e) => e.tabela))).toEqual(
      new Set(["pagamentos", "asaas_webhook_eventos"]),
    );
    expect(banco.eventos).toHaveLength(1);
    expect(banco.eventos[0]).toMatchObject({ evento: "PAYMENT_DELETED", status: "PENDING" });
    expect(banco.eventos[0].processado_em).not.toBeNull();
  });

  it("2) atrasado + PAYMENT_DELETED (o Asaas ainda mostra OVERDUE) -> cancelado, não fica atrasado", async () => {
    semearExcluida(
      { id: "pg-1", asaas_payment_id: "pay_1", status: "atrasado", ...mensalidade },
      "OVERDUE",
    );

    const r = await enviar(excluir("pay_1", { status: "OVERDUE" }));

    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ result: { status: "cancelado", changed: true } });
    expect(banco.pagamento("pg-1")).toMatchObject({ status: "cancelado", versao: 1 });
    expect(escritasEmPagamentos()).toEqual([cancelaUmaLinha]);
    expect(logErro).not.toHaveBeenCalled();
  });

  describe("3) pago + PAYMENT_DELETED -> continua pago", () => {
    it("3a) o Asaas ainda mostra a cobrança aberta (ex.: baixa manual do Master): não regride", async () => {
      semearExcluida(
        {
          id: "pg-1",
          asaas_payment_id: "pay_1",
          status: "pago",
          data_pagamento: "2025-02-05",
          ...mensalidade,
        },
        "PENDING",
      );

      const r = await enviar(excluir("pay_1"));

      expect(r.status).toBe(200);
      expect(r.corpo).toMatchObject({ result: { status: "pago", changed: false } });
      expect(banco.pagamento("pg-1")).toMatchObject({
        status: "pago",
        data_pagamento: "2025-02-05",
        versao: 0,
      });
      // o UPDATE existe, mas o filtro (só pendente/atrasado) não casa com nenhuma linha
      expect(escritasEmPagamentos()).toEqual([{ ...cancelaUmaLinha, afetadas: 0 }]);
      expect(banco.rpcs).toHaveLength(0);
      expect(logErro).not.toHaveBeenCalled();
    });

    it("3b) o Asaas informa RECEIVED (dinheiro recebido): segue a confirmação e nunca cancela", async () => {
      semearExcluida(
        { id: "pg-1", asaas_payment_id: "pay_1", status: "pago", ...mensalidade },
        "RECEIVED",
      );

      const r = await enviar(excluir("pay_1", { status: "RECEIVED" }));

      expect(r.status).toBe(200);
      expect(banco.pagamento("pg-1")).toMatchObject({ status: "pago", versao: 0 });
      expect(banco.escritasEm("pagamentos")).toBe(0);
      expect(banco.rpcs.map((c) => c.nome)).toEqual(["confirmar_pagamento_asaas"]);
    });
  });

  it("4) cancelado + PAYMENT_DELETED -> continua cancelado e a linha nem é reescrita", async () => {
    semearExcluida(
      { id: "pg-1", asaas_payment_id: "pay_1", status: "cancelado", ...mensalidade },
      "PENDING",
    );

    const r = await enviar(excluir("pay_1"));

    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ result: { status: "cancelado", changed: false } });
    expect(banco.pagamento("pg-1")).toMatchObject({ status: "cancelado", versao: 0 });
    expect(logErro).not.toHaveBeenCalled();
  });

  describe("5) idempotência do evento", () => {
    it("5a) mesmo evento reenviado: responde duplicate e não escreve de novo", async () => {
      semearExcluida(
        { id: "pg-1", asaas_payment_id: "pay_1", status: "pendente", ...mensalidade },
        "PENDING",
      );
      const primeira = await enviar(excluir("pay_1", { id: "evt_del" }));
      expect(primeira.corpo).toMatchObject({ processed: true });
      const escritasAntes = banco.escritas.length;

      const segunda = await enviar(excluir("pay_1", { id: "evt_del" }));

      expect(segunda.status).toBe(200);
      expect(segunda.corpo).toEqual({ received: true, duplicate: true });
      expect(banco.escritas).toHaveLength(escritasAntes);
      expect(banco.pagamento("pg-1")).toMatchObject({ status: "cancelado", versao: 1 });
      expect(banco.eventos).toHaveLength(1);
    });

    it("5b) a mesma exclusão com OUTRO id de evento: sem erro, sem reescrever e sem reabrir", async () => {
      semearExcluida(
        { id: "pg-1", asaas_payment_id: "pay_1", status: "pendente", ...mensalidade },
        "PENDING",
      );
      await enviar(excluir("pay_1", { id: "evt_a" }));
      expect(banco.pagamento("pg-1")).toMatchObject({ status: "cancelado", versao: 1 });

      const r = await enviar(excluir("pay_1", { id: "evt_b" }));

      expect(r.status).toBe(200);
      expect(r.corpo).toMatchObject({ processed: true, result: { changed: false } });
      expect(banco.pagamento("pg-1")).toMatchObject({ status: "cancelado", versao: 1 });
      expect(escritasEmPagamentos()).toEqual([
        cancelaUmaLinha,
        { ...cancelaUmaLinha, afetadas: 0 },
      ]);
      expect(logErro).not.toHaveBeenCalled();
    });

    it("5c) evento não concluído (Asaas indisponível) é reprocessado na reentrega e cancela uma única vez", async () => {
      semearExcluida(
        { id: "pg-1", asaas_payment_id: "pay_1", status: "pendente", ...mensalidade },
        "PENDING",
      );
      asaasIndisponivel = true;

      const falha = await enviar(excluir("pay_1", { id: "evt_retry" }));
      expect(falha.status).toBe(500);
      expect(banco.pagamento("pg-1").status).toBe("pendente");
      expect(banco.eventos[0].processado_em).toBeNull();

      asaasIndisponivel = false;
      const retry = await enviar(excluir("pay_1", { id: "evt_retry" }));
      expect(retry.status).toBe(200);
      expect(banco.pagamento("pg-1")).toMatchObject({ status: "cancelado", versao: 1 });
      expect(banco.eventos).toHaveLength(1);
      expect(banco.eventos[0].processado_em).not.toBeNull();

      const depois = await enviar(excluir("pay_1", { id: "evt_retry" }));
      expect(depois.corpo).toEqual({ received: true, duplicate: true });
    });
  });

  it("6) o Asaas informa deleted=false (evento antigo de cobrança já restaurada): não cancela", async () => {
    semearExcluida(
      { id: "pg-1", asaas_payment_id: "pay_1", status: "pendente", ...mensalidade },
      "PENDING",
      { deleted: false },
    );

    const r = await enviar(excluir("pay_1"));

    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({
      processed: true,
      result: { status: "PENDING", changed: false, reason: "exclusao_nao_confirmada" },
    });
    expect(banco.pagamento("pg-1")).toMatchObject({ status: "pendente", versao: 0 });
    expect(banco.escritasEm("pagamentos")).toBe(0);
    expect(logAviso).toHaveBeenCalledTimes(1);
    // o evento é concluído (não fica em loop de reentrega)
    expect(banco.eventos[0].processado_em).not.toBeNull();
  });

  it("7) resposta do Asaas sem o campo deleted: vale o evento e a cobrança em aberto é cancelada", async () => {
    semear(
      { id: "pg-1", asaas_payment_id: "pay_1", status: "pendente", ...mensalidade },
      "PENDING",
    );

    const r = await enviar(excluir("pay_1"));

    expect(r.status).toBe(200);
    expect(banco.pagamento("pg-1")).toMatchObject({ status: "cancelado", versao: 1 });
    expect(logAviso).not.toHaveBeenCalled();
  });

  it("8) outros eventos não cancelam: a cobrança pendente normal segue intacta", async () => {
    semear(
      { id: "pg-1", asaas_payment_id: "pay_1", status: "pendente", ...mensalidade },
      "PENDING",
    );

    for (const tipo of ["PAYMENT_CREATED", "PAYMENT_UPDATED"]) {
      const r = await enviar(evento("pay_1", { tipo, status: "PENDING" }));
      expect(r.status).toBe(200);
      expect(r.corpo).toMatchObject({ result: { status: "PENDING", changed: false } });
    }

    expect(banco.pagamento("pg-1")).toMatchObject({ status: "pendente", versao: 0 });
    expect(banco.escritasEm("pagamentos")).toBe(0);
  });

  describe("9) cobrança cancelada + nova cobrança da MESMA competência", () => {
    it("9a) PAYMENT_DELETED reenviado da ANTIGA não toca na nova pendente (sem 23505)", async () => {
      semearExcluida(
        { id: "pg-antiga", asaas_payment_id: "pay_antiga", status: "cancelado", ...mensalidade },
        "PENDING",
      );
      const nova = semear(
        { id: "pg-nova", asaas_payment_id: "pay_nova", status: "pendente", ...mensalidade },
        "PENDING",
      );

      const r = await enviar(excluir("pay_antiga", { id: "evt_reentrega" }));

      expect(r.status).toBe(200);
      expect(logErro).not.toHaveBeenCalled();
      expect(banco.pagamento("pg-antiga")).toMatchObject({ status: "cancelado", versao: 0 });
      expect(nova).toMatchObject({ status: "pendente", versao: 0 });
    });

    it("9b) PAYMENT_DELETED da NOVA cancela só ela; a antiga (histórico) não muda", async () => {
      const antiga = semearExcluida(
        { id: "pg-antiga", asaas_payment_id: "pay_antiga", status: "cancelado", ...mensalidade },
        "PENDING",
      );
      semearExcluida(
        { id: "pg-nova", asaas_payment_id: "pay_nova", status: "pendente", ...mensalidade },
        "PENDING",
      );

      const r = await enviar(excluir("pay_nova"));

      expect(r.status).toBe(200);
      expect(banco.pagamento("pg-nova")).toMatchObject({ status: "cancelado", versao: 1 });
      expect(antiga).toMatchObject({ status: "cancelado", versao: 0 });
    });
  });

  it("10) após o cancelamento a competência fica livre para uma nova mensalidade (modelo dos índices)", async () => {
    semearExcluida(
      { id: "pg-1", asaas_payment_id: "pay_1", status: "pendente", ...mensalidade },
      "PENDING",
    );
    // a mensalidade que o cliente geraria de novo (solicitar_mensalidade): mesma empresa e competência
    const nova: Linha = {
      id: "pg-2",
      empresa_id: "empresa-1",
      status: "pendente",
      asaas_payment_id: null,
      competencia_duplicada_de: null,
      ...mensalidade,
    };
    // controle: enquanto a excluída segue "pendente" ela ocupa a competência e barra a nova
    expect(indiceViolado([...banco.pagamentos, nova], nova)).toBe(
      "uq_pagamentos_empresa_competencia",
    );

    await enviar(excluir("pay_1"));

    expect(banco.pagamento("pg-1").status).toBe("cancelado");
    expect(indiceViolado([...banco.pagamentos, nova], nova)).toBeNull();
  });

  it("11) erro do banco ao cancelar: HTTP 500 e o evento segue reprocessável (a exclusão não se perde)", async () => {
    semearExcluida(
      { id: "pg-1", asaas_payment_id: "pay_1", status: "pendente", ...mensalidade },
      "PENDING",
    );
    banco.falhaEmUpdate = { tabela: "pagamentos", code: "57P03", message: "banco indisponível" };

    const falha = await enviar(excluir("pay_1", { id: "evt_db" }));

    expect(falha.status).toBe(500);
    expect(banco.pagamento("pg-1")).toMatchObject({ status: "pendente", versao: 0 });
    // processado_em nulo: o Asaas reenvia o evento e o cancelamento acontece na próxima entrega
    expect(banco.eventos[0].processado_em).toBeNull();

    banco.falhaEmUpdate = null;
    const retry = await enviar(excluir("pay_1", { id: "evt_db" }));

    expect(retry.status).toBe(200);
    expect(banco.pagamento("pg-1")).toMatchObject({ status: "cancelado", versao: 1 });
    expect(banco.eventos[0].processado_em).not.toBeNull();
  });
});
