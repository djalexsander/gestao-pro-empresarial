// @vitest-environment node
/**
 * Contrato da resposta da Edge asaas-criar-cobranca (`formatResult` em index.ts).
 *
 * Problema: a v1.2.0 (commit 345ab5ba) renomeou a resposta para invoiceUrl / qr_code / vencimento,
 * mas o hook (useSaasCliente.ts -> criarCobrancaAsaas: `{ ...data, pagamento_id }`) e o modal
 * (CobrancaPixDialog.tsx) dos apps desktop já instalados continuam lendo invoice_url / pix_qrcode /
 * due_date. Em "Pagar mensalidade", planos e módulos isso dava: sem QR Code, "Vencimento: Não
 * informado" e sem o botão "Abrir fatura". Só o CartDrawer traduz os nomes novos.
 * Além disso, `vencimento` vinha do expirationDate do QR Code (validade de ~12 meses após o
 * vencimento, no formato "YYYY-MM-DD HH:mm:ss"), e não do vencimento da cobrança.
 *
 * A resposta tem que servir aos dois consumidores ao mesmo tempo:
 *   - legado (apps instalados): asaas_payment_id, invoice_url, pix_qrcode, pix_copia_cola, due_date;
 *   - atual (CartDrawer.tsx:126-143): asaas_payment_id, invoiceUrl, qr_code, pix_copia_cola, vencimento.
 * `qr_expiracao` guarda a validade do QR Code separadamente.
 *
 * Como funciona: o teste importa o handler REAL (index.ts). Só as bordas são trocadas:
 *   - `Deno.env` / `Deno.serve` -> stubs (o handler é capturado em `Deno.serve`);
 *   - `createClient` (esm.sh)   -> cliente em memória com as tabelas que a função lê e grava;
 *   - `fetch`                   -> API do Asaas simulada (só POST /payments e GET .../pixQrCode).
 *
 * Se a versão do supabase-js importada em index.ts mudar, atualize a URL no `vi.mock` abaixo.
 * Rode com `npm test`.
 */
import { Buffer } from "node:buffer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;
type Filtro = { op: "eq" | "is"; col: string; val: unknown };
type Resposta = { data: Linha | null; error: null };

const CAMPOS_LEGADOS = [
  "asaas_payment_id",
  "invoice_url",
  "pix_qrcode",
  "pix_copia_cola",
  "due_date",
] as const;
const CAMPOS_ATUAIS = [
  "asaas_payment_id",
  "invoiceUrl",
  "qr_code",
  "pix_copia_cola",
  "vencimento",
] as const;

// --- dados de teste ---------------------------------------------------------------------

const PAGAMENTO_ID = "4d38aec8-4744-440a-9125-3df7b8f8b6d0";
const EMPRESA_ID = "empresa-1";
const USUARIO_ID = "usuario-1";
const ID_ASAAS = "pay_teste123";
const FATURA = "https://www.asaas.com/i/teste123";
const PAYLOAD =
  "00020101021226730014br.gov.bcb.pix2551pix.asaas.com/qr/cobv/teste5204000053039865802BR5905ASAAS6304ABCD";
/** "Hoje" simulado (a função envia D+3 como dueDate ao criar a cobrança). */
const HOJE = "2026-09-19T15:00:00Z";
const VENCIMENTO_ENVIADO = "2026-09-22";
/**
 * Vencimento da COBRANÇA devolvido pelo Asaas (dueDate do POST /payments). Difere do D+3 enviado
 * de propósito: a resposta tem que refletir o valor do Asaas, o mesmo que fica em data_vencimento.
 */
const VENCIMENTO_COBRANCA = "2026-09-23";
/** Validade do QR Code (expirationDate do GET pixQrCode), no formato documentado pelo Asaas. */
const VALIDADE_QR = "2027-09-23 23:59:59";
/**
 * PNG (848 bytes) em Base64 PURO, sem "data:", como o Asaas devolve em encodedImage. Os bytes são
 * variados para a string conter "+", "/" e "=": qualquer recodificação, trim ou prefixo aparece.
 */
const PNG_B64 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(Array.from({ length: 840 }, (_, i) => (i * 37 + 11) % 256)),
]).toString("base64");

// --- modelo mínimo do banco -------------------------------------------------------------

class BancoFalso {
  config: Linha = { asaas_enabled: true, asaas_ambiente: "sandbox" };
  empresa: Linha = {
    id: EMPRESA_ID,
    owner_id: USUARIO_ID,
    nome: "Empresa Teste",
    email: null,
    telefone: null,
    documento: "12345678000199",
    asaas_customer_id: "cus_teste",
  };
  pagamento: Linha = pagamentoNovo();
  escritas: { tabela: string; patch: Linha; filtros: Filtro[] }[] = [];

  escritasEm(tabela: string) {
    return this.escritas.filter((e) => e.tabela === tabela);
  }
}

function pagamentoNovo(): Linha {
  return {
    id: PAGAMENTO_ID,
    empresa_id: EMPRESA_ID,
    status: "pendente",
    valor: "150.00",
    descricao: "Mensalidade Plano Base",
    referencia_tipo: "outro",
    data_vencimento: null,
    asaas_payment_id: null,
    asaas_invoice_url: null,
    asaas_pix_qrcode: null,
    asaas_pix_copia_cola: null,
  };
}

/** Cobrança que já foi criada no Asaas (a função só recupera/devolve os dados). */
function pagamentoJaCriado(extra: Linha = {}): Linha {
  return {
    ...pagamentoNovo(),
    asaas_payment_id: ID_ASAAS,
    asaas_invoice_url: FATURA,
    asaas_pix_qrcode: PNG_B64,
    asaas_pix_copia_cola: PAYLOAD,
    data_vencimento: VENCIMENTO_COBRANCA,
    ...extra,
  };
}

function casa(linha: Linha, filtro: Filtro): boolean {
  const valor = linha[filtro.col];
  return filtro.op === "is" && filtro.val === null ? valor == null : valor === filtro.val;
}

/** Builder encadeável no formato do supabase-js (thenable), só com o que a função usa. */
class Consulta implements PromiseLike<Resposta> {
  private patch: Linha | null = null;
  private filtros: Filtro[] = [];

  constructor(
    private banco: BancoFalso,
    private tabela: string,
  ) {}

  select(_colunas?: string) {
    return this;
  }
  update(patch: Linha) {
    this.patch = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filtros.push({ op: "eq", col, val });
    return this;
  }
  is(col: string, val: unknown) {
    this.filtros.push({ op: "is", col, val });
    return this;
  }
  maybeSingle(): Promise<Resposta> {
    const linha = this.linha();
    const achou = linha && this.filtros.every((f) => casa(linha, f));
    return Promise.resolve({ data: achou ? linha : null, error: null });
  }

  then<R1 = Resposta, R2 = never>(
    onfulfilled?: ((value: Resposta) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.executarUpdate()).then(onfulfilled, onrejected);
  }

  private linha(): Linha | null {
    const { banco, tabela } = this;
    if (tabela === "config_comercial") return banco.config;
    if (tabela === "pagamentos") return banco.pagamento;
    if (tabela === "empresas") return banco.empresa;
    if (tabela === "configuracoes_empresa") return null;
    throw new Error(`tabela não modelada: ${tabela}`);
  }

  /** UPDATE condicional: só grava quando todos os filtros casam com a linha (como no Postgres). */
  private executarUpdate(): Resposta {
    if (!this.patch) throw new Error(`consulta sem update aguardada em ${this.tabela}`);
    const linha = this.linha();
    this.banco.escritas.push({ tabela: this.tabela, patch: this.patch, filtros: this.filtros });
    if (linha && this.filtros.every((f) => casa(linha, f))) Object.assign(linha, this.patch);
    return { data: null, error: null };
  }
}

// --- bordas do handler -----------------------------------------------------------------

const estado = vi.hoisted(() => ({ criarCliente: null as null | (() => unknown) }));

vi.mock("https://esm.sh/@supabase/supabase-js@2.45.0", () => ({
  createClient: () => estado.criarCliente?.(),
}));

const BASE_ASAAS = "https://api-sandbox.asaas.com/v3";
let banco: BancoFalso;
let chamadasAsaas: { metodo: string; url: string; corpo: Linha | null }[];
let respostaPagamento: Linha;
let respostaPix: Linha;
let handler: (request: Request) => Promise<Response>;

const jsonAsaas = (corpo: Linha) => new Response(JSON.stringify(corpo), { status: 200 });

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    ASAAS_API_KEY: "asaas-key",
  };
  vi.stubGlobal("Deno", {
    env: { get: (chave: string) => env[chave] },
    serve: (funcao: typeof handler) => {
      handler = funcao;
    },
  });
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    const corpo = init?.body ? (JSON.parse(String(init.body)) as Linha) : null;
    chamadasAsaas.push({ metodo, url: String(url), corpo });
    if (metodo === "POST" && String(url) === `${BASE_ASAAS}/payments`) {
      return jsonAsaas(respostaPagamento);
    }
    if (metodo === "GET" && String(url) === `${BASE_ASAAS}/payments/${ID_ASAAS}/pixQrCode`) {
      return jsonAsaas(respostaPix);
    }
    throw new Error(`chamada inesperada ao Asaas: ${metodo} ${String(url)}`);
  });
  await import("./index");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(HOJE));
  banco = new BancoFalso();
  chamadasAsaas = [];
  respostaPagamento = { id: ID_ASAAS, invoiceUrl: FATURA, dueDate: VENCIMENTO_COBRANCA };
  respostaPix = { encodedImage: PNG_B64, payload: PAYLOAD, expirationDate: VALIDADE_QR };
  estado.criarCliente = () => ({
    auth: { getUser: async () => ({ data: { user: { id: USUARIO_ID } }, error: null }) },
    from: (tabela: string) => new Consulta(banco, tabela),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// --- auxiliares dos cenários -----------------------------------------------------------

async function chamar(): Promise<{ status: number; corpo: Linha }> {
  const resposta = await handler(
    new Request("https://edge.test/", {
      method: "POST",
      headers: { Authorization: "Bearer jwt-de-teste", "Content-Type": "application/json" },
      body: JSON.stringify({ pagamento_id: PAGAMENTO_ID, billing_type: "PIX" }),
    }),
  );
  return { status: resposta.status, corpo: (await resposta.json()) as Linha };
}

/** Cobrança ainda não criada no Asaas: a função faz POST /payments e GET pixQrCode. */
async function cobrancaNova() {
  banco.pagamento = pagamentoNovo();
  return chamar();
}

/** Cobrança já criada no Asaas (reutilizada). */
async function cobrancaReutilizada(extra: Linha = {}) {
  banco.pagamento = pagamentoJaCriado(extra);
  return chamar();
}

// --- testes ----------------------------------------------------------------------------

describe("asaas-criar-cobranca — contrato da resposta", () => {
  it("a fixture do QR é Base64 puro com +, / e = (para o teste de integridade valer)", () => {
    expect(PNG_B64).toMatch(/^[A-Za-z0-9+/]+=$/);
    expect(PNG_B64).toContain("+");
    expect(PNG_B64).toContain("/");
    expect(PNG_B64.startsWith("iVBORw0KGgo")).toBe(true);
  });

  describe("cobrança nova", () => {
    it("cria a cobrança no Asaas como antes (D+3, Pix) e busca o QR Code", async () => {
      const { status } = await cobrancaNova();

      expect(status).toBe(200);
      expect(chamadasAsaas.map((c) => `${c.metodo} ${c.url.replace(BASE_ASAAS, "")}`)).toEqual([
        "POST /payments",
        `GET /payments/${ID_ASAAS}/pixQrCode`,
      ]);
      expect(chamadasAsaas[0].corpo).toMatchObject({
        customer: "cus_teste",
        billingType: "PIX",
        value: 150,
        dueDate: VENCIMENTO_ENVIADO,
        externalReference: `gestaopro|pagamento|${PAGAMENTO_ID}`,
      });
    });

    it("mantém os campos atuais (frontend atual / CartDrawer)", async () => {
      const { corpo } = await cobrancaNova();

      expect(corpo.asaas_payment_id).toBe(ID_ASAAS);
      expect(corpo.invoiceUrl).toBe(FATURA);
      expect(corpo.qr_code).toBe(PNG_B64);
      expect(corpo.pix_copia_cola).toBe(PAYLOAD);
      expect(corpo.vencimento).toBe(VENCIMENTO_COBRANCA);
      expect(corpo.reutilizada).toBe(false);
    });

    it("acrescenta os aliases legados (apps desktop já instalados)", async () => {
      const { corpo } = await cobrancaNova();

      expect(corpo.invoice_url).toBe(FATURA);
      expect(corpo.pix_qrcode).toBe(PNG_B64);
      expect(corpo.due_date).toBe(VENCIMENTO_COBRANCA);
      // pix_copia_cola e asaas_payment_id nunca mudaram de nome: o legado também os lê.
      expect(corpo.pix_copia_cola).toBe(PAYLOAD);
      expect(corpo.asaas_payment_id).toBe(ID_ASAAS);
    });

    it("entrega todos os campos que cada consumidor lê, preenchidos", async () => {
      const { corpo } = await cobrancaNova();

      for (const campo of [...CAMPOS_LEGADOS, ...CAMPOS_ATUAIS]) {
        expect(corpo[campo], campo).toEqual(expect.any(String));
        expect(corpo[campo], campo).not.toBe("");
      }
    });

    it("vencimento é o vencimento da cobrança, nunca o expirationDate do QR Code", async () => {
      const { corpo } = await cobrancaNova();

      expect(corpo.vencimento).toBe(VENCIMENTO_COBRANCA);
      expect(corpo.due_date).toBe(VENCIMENTO_COBRANCA);
      expect(corpo.vencimento).not.toBe(VALIDADE_QR);
      // É o mesmo valor que o banco guarda e que "Ver QR Code / Pix" e "Cobranças" exibem.
      expect(banco.pagamento.data_vencimento).toBe(VENCIMENTO_COBRANCA);
    });

    it("preserva o expirationDate do QR Code em qr_expiracao", async () => {
      const { corpo } = await cobrancaNova();

      expect(corpo.qr_expiracao).toBe(VALIDADE_QR);
    });

    it("não modifica o Base64 do QR (resposta e banco), sem prefixo data:", async () => {
      const { corpo } = await cobrancaNova();

      expect(corpo.qr_code).toBe(PNG_B64);
      expect(corpo.pix_qrcode).toBe(PNG_B64);
      expect(String(corpo.qr_code)).not.toMatch(/^data:/);
      expect(banco.pagamento.asaas_pix_qrcode).toBe(PNG_B64);
      expect(banco.pagamento.asaas_pix_copia_cola).toBe(PAYLOAD);
    });

    it("sem dueDate na resposta do Asaas, usa o D+3 enviado e não o expirationDate", async () => {
      respostaPagamento = { id: ID_ASAAS, invoiceUrl: FATURA };

      const { corpo } = await cobrancaNova();

      expect(corpo.vencimento).toBe(VENCIMENTO_ENVIADO);
      expect(corpo.due_date).toBe(VENCIMENTO_ENVIADO);
      expect(corpo.qr_expiracao).toBe(VALIDADE_QR);
      expect(banco.pagamento.data_vencimento).toBe(VENCIMENTO_ENVIADO);
    });
  });

  describe("cobrança reutilizada", () => {
    it("devolve o mesmo contrato da cobrança nova, sem chamar o Asaas", async () => {
      const nova = await cobrancaNova();
      chamadasAsaas = [];
      const reuso = await cobrancaReutilizada();

      expect(reuso.status).toBe(200);
      expect(chamadasAsaas).toEqual([]);
      expect(Object.keys(reuso.corpo).sort()).toEqual(Object.keys(nova.corpo).sort());
      for (const campo of [...CAMPOS_LEGADOS, ...CAMPOS_ATUAIS, "qr_expiracao", "reutilizada"]) {
        expect(reuso.corpo, campo).toHaveProperty(campo);
      }
      expect(reuso.corpo.reutilizada).toBe(true);
      expect(nova.corpo.reutilizada).toBe(false);
    });

    it("entrega aos dois frontends os dados gravados, com o Base64 sem modificação", async () => {
      const { corpo } = await cobrancaReutilizada();

      // legado
      expect(corpo.invoice_url).toBe(FATURA);
      expect(corpo.pix_qrcode).toBe(PNG_B64);
      expect(corpo.due_date).toBe(VENCIMENTO_COBRANCA);
      // atual
      expect(corpo.invoiceUrl).toBe(FATURA);
      expect(corpo.qr_code).toBe(PNG_B64);
      expect(corpo.pix_copia_cola).toBe(PAYLOAD);
      expect(corpo.vencimento).toBe(VENCIMENTO_COBRANCA);
      // a validade do QR não é gravada: sem consulta ao Asaas ela não existe
      expect(corpo.qr_expiracao).toBeNull();
      expect(banco.escritas).toEqual([]);
    });

    it("sem QR gravado, busca o QR no Asaas, grava sem modificar e mantém o contrato", async () => {
      const { corpo } = await cobrancaReutilizada({
        asaas_pix_qrcode: null,
        asaas_pix_copia_cola: null,
      });

      expect(chamadasAsaas.map((c) => `${c.metodo} ${c.url.replace(BASE_ASAAS, "")}`)).toEqual([
        `GET /payments/${ID_ASAAS}/pixQrCode`,
      ]);
      expect(corpo.qr_code).toBe(PNG_B64);
      expect(corpo.pix_qrcode).toBe(PNG_B64);
      expect(corpo.pix_copia_cola).toBe(PAYLOAD);
      expect(corpo.invoice_url).toBe(FATURA);
      expect(corpo.vencimento).toBe(VENCIMENTO_COBRANCA);
      expect(corpo.due_date).toBe(VENCIMENTO_COBRANCA);
      expect(corpo.qr_expiracao).toBe(VALIDADE_QR);
      expect(corpo.reutilizada).toBe(true);
      expect(banco.pagamento.asaas_pix_qrcode).toBe(PNG_B64);
      expect(banco.pagamento.asaas_pix_copia_cola).toBe(PAYLOAD);
    });

    it("sem data_vencimento no banco, vencimento e due_date ficam nulos (não viram o expirationDate)", async () => {
      const { corpo } = await cobrancaReutilizada({
        data_vencimento: null,
        asaas_pix_qrcode: null,
        asaas_pix_copia_cola: null,
      });

      expect(corpo.vencimento).toBeNull();
      expect(corpo.due_date).toBeNull();
      expect(corpo.qr_expiracao).toBe(VALIDADE_QR);
    });
  });
});
