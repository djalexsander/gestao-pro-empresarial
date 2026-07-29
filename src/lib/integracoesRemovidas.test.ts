import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizarTabConfiguracoes } from "./configuracoes-tabs";

const raiz = process.cwd();
const ler = (caminho: string) => readFileSync(resolve(raiz, caminho), "utf8");

describe("configurações após remoção das integrações descartadas", () => {
  const pix = ler("src/components/configuracoes/CobrancaPixTab.tsx");
  const rota = ler("src/routes/configuracoes.tsx");
  const navegacao = ler("src/components/layout/navigation.ts");

  it("mantém somente a configuração Pix na tela", () => {
    expect(pix).toContain('eq("tipo_integracao", "pix")');
    expect(pix).toContain('tipo_integracao: "pix"');
    expect(pix).toContain("Configuração de cobrança Pix");
    expect(pix).not.toMatch(/iFood|Mercado Livre|Shopee|WhatsApp Cobranças/i);
    expect(existsSync(resolve(raiz, "src/components/configuracoes/IntegracoesTab.tsx"))).toBe(false);
  });

  it("não lê nem grava configurações genéricas ou segredos de provedores", () => {
    const cobrancaManual = ler("src/components/financeiro/LancamentoDetalheDialog.tsx");
    expect(pix).not.toContain('.select("*")');
    expect(pix).not.toMatch(/access[_-]?token|client[_-]?secret|api[_-]?key|webhook[_-]?secret/i);
    expect(pix.match(/tipo_integracao:/g)).toHaveLength(1);
    expect(pix).toContain('tipo_integracao: "pix"');
    expect(cobrancaManual).toContain('.eq("tipo_integracao", "pix")');
    expect(cobrancaManual).not.toMatch(/tipo_integracao[^;\n]*whatsapp/i);
  });

  it("renomeia a navegação e mantém um destino seguro para a URL antiga", () => {
    expect(rota).toContain('value="cobranca-pix"');
    expect(navegacao).toContain("tab=cobranca-pix");
    expect(navegacao).toContain("Cobrança Pix");
    expect(normalizarTabConfiguracoes("integracoes")).toBe("cobranca-pix");
    expect(normalizarTabConfiguracoes("desconhecida")).toBe("empresa");
  });

  it("usa layout responsivo sem modal de integração", () => {
    expect(pix).toContain("max-w-3xl");
    expect(pix).toContain("sm:grid-cols-2");
    expect(pix).not.toContain("<Dialog");
  });
});

describe("fluxos preservados e integrações operacionais removidas", () => {
  it("remove a conciliação exclusiva e as opções descartadas de criação", () => {
    const finalizarVenda = ler("src/components/pdv/FinalizarVendaDialog.tsx");
    const pagamento = ler("src/components/financeiro/RegistrarPagamentoDialog.tsx");
    const lancamento = ler("src/components/financeiro/LancamentoFormDialog.tsx");
    const financeiro = ler("src/routes/financeiro.tsx");

    expect(existsSync(resolve(raiz, "src/components/financeiro/ConciliarIfoodDialog.tsx"))).toBe(false);
    for (const fonte of [finalizarVenda, pagamento, lancamento]) {
      expect(fonte).not.toMatch(/value=["']ifood["']|key:\s*["']ifood["']/i);
    }
    expect(financeiro).not.toMatch(/Conciliar repasse|a repassar|aguardando conciliação/i);
  });

  it("preserva cobrança manual por WhatsApp, histórico, Pix e abertura nativa", () => {
    const modal = ler("src/components/financeiro/LancamentoDetalheDialog.tsx");
    const whatsapp = ler("src/lib/whatsappCobranca.ts");
    const tauriConfig = ler("src-tauri/tauri.conf.json");

    expect(modal).toContain("Cobrança amigável");
    expect(modal).toContain("Cobrança em atraso");
    expect(modal).toContain("Enviar Pix");
    expect(modal).toContain("Copiar Pix");
    expect(modal).toContain("Histórico de cobranças");
    expect(whatsapp).toContain("whatsapp://send");
    expect(whatsapp).toContain("https://wa.me/");
    expect(tauriConfig).toContain("whatsapp://send");
    expect(tauriConfig).toContain("https://wa");
  });

  it("preserva a configuração e o fluxo Asaas separados da cobrança Pix", () => {
    const asaas = ler("src/routes/admin.config-comercial.tsx");
    expect(asaas).toMatch(/Asaas/);
    expect(asaas).toMatch(/sandbox|production/);
  });
});
