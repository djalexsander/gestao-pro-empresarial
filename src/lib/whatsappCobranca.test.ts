import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  abrirConversaWhatsApp,
  copiarCodigoPix,
  criarCachePix,
  criarEscopoHistoricoCobranca,
  lerMetadadosHistoricoCobranca,
  montarMensagemCobrancaAmigavel,
  montarMensagemCobrancaAtraso,
  montarMensagemPixWhatsApp,
  montarMetadadosHistoricoCobranca,
  montarUrlsConversaWhatsApp,
  normalizarTelefoneWhatsApp,
  resolverNomeEmpresa,
} from "./whatsappCobranca";

const base = {
  clienteNome: "Alex Sandro Xavier Vieira",
  vendaNumero: "VND-000012",
  parcelaNumero: 1,
  totalParcelas: 2,
  valorOriginal: 9.2,
  valorPago: 0,
  saldoAberto: 9.2,
  vencimento: "29/07/2026",
  nomeEmpresa: "AlexPro Comércio",
};

describe("normalizarTelefoneWhatsApp", () => {
  it("normaliza telefone brasileiro com máscara e caracteres extras", () => {
    expect(normalizarTelefoneWhatsApp("Cel: (44) 99880-7633")).toBe("5544998807633");
    expect(normalizarTelefoneWhatsApp("(44) 3322-1100")).toBe("554433221100");
  });

  it("não duplica o código 55", () => {
    expect(normalizarTelefoneWhatsApp("+55 (44) 99880-7633")).toBe("5544998807633");
  });

  it("rejeita telefone vazio ou inválido", () => {
    expect(normalizarTelefoneWhatsApp("  ")).toBeNull();
    expect(normalizarTelefoneWhatsApp("99880-7633")).toBeNull();
    expect(normalizarTelefoneWhatsApp("551234")).toBeNull();
  });
});

describe("mensagens de cobrança", () => {
  it("cobrança amigável não inclui o Pix e informa o envio separado", () => {
    const mensagem = montarMensagemCobrancaAmigavel(base);
    expect(mensagem).not.toContain("00020126PIX");
    expect(mensagem).not.toContain("Pix Copia e Cola:");
    expect(mensagem).toContain("podemos enviar o código de pagamento nesta conversa");
  });

  it("não mostra parcela quando o título é 1/1", () => {
    const mensagem = montarMensagemCobrancaAmigavel({
      ...base,
      parcelaNumero: 1,
      totalParcelas: 1,
    });
    expect(mensagem).not.toContain("Parcela:");
  });

  it("cobrança em atraso usa texto adequado para título vencido", () => {
    const mensagem = montarMensagemCobrancaAtraso({ ...base, tituloVencido: true });
    expect(mensagem).toContain("parcela abaixo está vencida");
    expect(mensagem).toContain("Caso o pagamento já tenha sido realizado");
  });

  it("cobrança em atraso não afirma vencimento quando o título ainda não venceu", () => {
    const mensagem = montarMensagemCobrancaAtraso({ ...base, tituloVencido: false });
    expect(mensagem).not.toContain("está vencida");
    expect(mensagem).toContain("parcela em aberto");
  });

  it("mensagem de Pix é curta e mantém apenas o payload em linha própria", () => {
    const pix = "00020126PIXSEMFORMATACAO";
    const mensagem = montarMensagemPixWhatsApp({ ...base, pixCopiaCola: pix });
    expect(mensagem).not.toContain("Itens da venda:");
    expect(mensagem).not.toContain("Vencimento:");
    expect(mensagem).toContain(`Copie somente o código abaixo:\n\n${pix}\n\nApós o pagamento`);
    expect(mensagem).not.toContain(`\`${pix}\``);
    expect(mensagem.split("\n").filter((linha) => linha === pix)).toHaveLength(1);
  });

  it("pagamento parcial mostra original, pago e saldo", () => {
    const mensagem = montarMensagemCobrancaAmigavel({
      ...base,
      valorOriginal: 1_200,
      valorPago: 400,
      saldoAberto: 800,
    });
    expect(mensagem).toContain("Valor original: R$ 1.200,00");
    expect(mensagem).toContain("Pago: R$ 400,00");
    expect(mensagem).toContain("Saldo em aberto: R$ 800,00");
    expect(mensagem).not.toContain("Valor a pagar: R$ 1.200,00");
  });

  it("usa o nome real da empresa e aplica fallback final", () => {
    expect(
      resolverNomeEmpresa({
        nomeFantasia: "Loja Fantasia",
        razaoSocial: "Razão Social Ltda.",
        nomeCadastrado: "Empresa cadastrada",
      }),
    ).toBe("Loja Fantasia");
    expect(resolverNomeEmpresa({ razaoSocial: "Razão Social Ltda." })).toBe(
      "Razão Social Ltda.",
    );
    expect(resolverNomeEmpresa({ nomeCadastrado: "Empresa cadastrada" })).toBe(
      "Empresa cadastrada",
    );
    expect(resolverNomeEmpresa({})).toBe("Gestão Pro");
    expect(montarMensagemCobrancaAmigavel(base).endsWith("AlexPro Comércio")).toBe(true);
  });

  it("limita itens a 10, informa restantes e mostra variações", () => {
    const itens = Array.from({ length: 13 }, (_, index) => ({
      nome: index === 0 ? "Sabonete íntimo" : `Produto ${index + 1}`,
      variacaoNome: index === 0 ? "Melancia" : null,
      quantidade: 1,
      valor: index + 1,
    }));
    const mensagem = montarMensagemCobrancaAmigavel({ ...base, itens });
    expect(mensagem).toContain("• 1x Sabonete íntimo — Melancia — R$ 1,00");
    expect(mensagem).toContain("Produto 10");
    expect(mensagem).not.toContain("Produto 11");
    expect(mensagem).toContain("• e mais 3 item(ns)");
  });

  it("não produz null, undefined nem linhas vazias de campos", () => {
    const mensagem = montarMensagemCobrancaAmigavel({
      clienteNome: null,
      vendaNumero: undefined,
      itens: [{ nome: null, quantidade: null, valor: null }],
    });
    expect(mensagem).not.toMatch(/undefined|null/);
    expect(mensagem).not.toContain("Venda:");
    expect(mensagem).not.toContain("Itens da venda:");
  });
});

describe("histórico de cobrança", () => {
  it("mantém escopo explícito por empresa e lançamento", () => {
    expect(criarEscopoHistoricoCobranca("empresa-a", "titulo-1")).toEqual({
      empresaId: "empresa-a",
      lancamentoId: "titulo-1",
    });
    expect(() => criarEscopoHistoricoCobranca("", "titulo-1")).toThrow();
  });

  it("registra metadados sem armazenar o código Pix", () => {
    const serializado = montarMetadadosHistoricoCobranca({
      acao: "pix_whatsapp",
      canal: "whatsapp_desktop",
      nomeEmpresa: "AlexPro Comércio",
      vendaNumero: "VND-000012",
      operadorId: "operador-1",
      operadorNome: "Juliana",
    });
    expect(serializado).not.toContain("00020126");
    expect(lerMetadadosHistoricoCobranca(serializado)).toEqual({
      versao: 1,
      acao: "pix_whatsapp",
      canal: "whatsapp_desktop",
      empresa_nome: "AlexPro Comércio",
      venda_numero: "VND-000012",
      operador_id: "operador-1",
      operador_nome: "Juliana",
    });
  });
});

describe("reutilização e cópia do Pix", () => {
  it("copia somente o payload Pix puro", async () => {
    const escrever = vi.fn(async () => undefined);
    await copiarCodigoPix("00020126PIXPURO", escrever);
    expect(escrever).toHaveBeenCalledOnce();
    expect(escrever).toHaveBeenCalledWith("00020126PIXPURO");
  });

  it("reutiliza o Pix existente", async () => {
    const gerar = vi.fn(() => "00020126PIXREUTILIZADO");
    const cache = criarCachePix();
    expect(await cache.obterOuGerar(gerar)).toBe("00020126PIXREUTILIZADO");
    expect(await cache.obterOuGerar(gerar)).toBe("00020126PIXREUTILIZADO");
    expect(gerar).toHaveBeenCalledOnce();
  });

  it("duplo clique concorrente não gera dois códigos Pix", async () => {
    let liberar!: (codigo: string) => void;
    const geracao = new Promise<string>((resolve) => {
      liberar = resolve;
    });
    const gerar = vi.fn(() => geracao);
    const cache = criarCachePix();
    const primeiro = cache.obterOuGerar(gerar);
    const segundo = cache.obterOuGerar(gerar);
    liberar("00020126PIXUNICO");
    await expect(Promise.all([primeiro, segundo])).resolves.toEqual([
      "00020126PIXUNICO",
      "00020126PIXUNICO",
    ]);
    expect(gerar).toHaveBeenCalledOnce();
  });
});

describe("URL e abertura do WhatsApp", () => {
  it("monta URLs nativa e web com telefone normalizado e mensagem codificada", () => {
    const mensagem = "Olá, João & Maria!\nValor: R$ 9,20";
    const urls = montarUrlsConversaWhatsApp("5544998807633", mensagem);
    expect(urls.nativa).toBe(
      `whatsapp://send?phone=5544998807633&text=${encodeURIComponent(mensagem)}`,
    );
    expect(urls.web).toBe(`https://wa.me/5544998807633?text=${encodeURIComponent(mensagem)}`);
    expect(decodeURIComponent(urls.nativa.split("&text=")[1])).toBe(mensagem);
    expect(`${urls.nativa}${urls.web}`).not.toContain("api.whatsapp.com");
  });

  it("no Tauri tenta whatsapp:// primeiro e não abre o navegador após sucesso", async () => {
    const openTauri = vi.fn(async (_url: string) => undefined);
    const openWeb = vi.fn();
    const resultado = await abrirConversaWhatsApp(
      { telefone: "(44) 99880-7633", mensagem: "Olá!" },
      {
        isTauri: () => true,
        protocoloNativoRegistrado: async () => true,
        openTauri,
        openWeb,
      },
    );
    expect(resultado).toMatchObject({
      sucesso: true,
      destino: "whatsapp_desktop",
      telefone: "5544998807633",
      fallbackUtilizado: false,
    });
    expect(openTauri).toHaveBeenCalledOnce();
    expect(openTauri.mock.calls[0][0]).toMatch(
      /^whatsapp:\/\/send\?phone=5544998807633&text=/,
    );
    expect(openWeb).not.toHaveBeenCalled();
  });

  it("falha nativa usa https://wa.me como fallback, na ordem correta", async () => {
    const openTauri = vi
      .fn<(url: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("protocolo indisponível"))
      .mockResolvedValueOnce(undefined);
    const openWeb = vi.fn();
    const resultado = await abrirConversaWhatsApp(
      { telefone: "5544998807633", mensagem: "Olá!" },
      {
        isTauri: () => true,
        protocoloNativoRegistrado: async () => true,
        openTauri,
        openWeb,
      },
    );
    expect(resultado).toMatchObject({
      sucesso: true,
      destino: "whatsapp_web",
      fallbackUtilizado: true,
    });
    expect(openTauri).toHaveBeenCalledTimes(2);
    expect(openTauri.mock.calls[0][0]).toMatch(/^whatsapp:\/\//);
    expect(openTauri.mock.calls[1][0]).toMatch(/^https:\/\/wa\.me\//);
    expect(openWeb).not.toHaveBeenCalled();
  });

  it("protocolo não registrado usa somente o fallback HTTPS no Tauri", async () => {
    const openTauri = vi.fn(async (_url: string) => undefined);
    const resultado = await abrirConversaWhatsApp(
      { telefone: "5544998807633", mensagem: "Olá!" },
      {
        isTauri: () => true,
        protocoloNativoRegistrado: async () => false,
        openTauri,
      },
    );
    expect(resultado).toMatchObject({ sucesso: true, destino: "whatsapp_web" });
    expect(openTauri).toHaveBeenCalledOnce();
    expect(openTauri.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\//);
  });

  it("ambiente web usa somente https://wa.me", async () => {
    const openTauri = vi.fn(async (_url: string) => undefined);
    const openWeb = vi.fn((_url: string) => ({}));
    const resultado = await abrirConversaWhatsApp(
      { telefone: "5544998807633", mensagem: "Olá!" },
      { isTauri: () => false, openTauri, openWeb },
    );
    expect(resultado).toMatchObject({
      sucesso: true,
      destino: "whatsapp_web",
      fallbackUtilizado: false,
    });
    expect(openWeb).toHaveBeenCalledOnce();
    expect(openWeb.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\//);
    expect(openTauri).not.toHaveBeenCalled();
  });

  it("telefone inválido não tenta abrir nenhuma URL", async () => {
    const openTauri = vi.fn(async (_url: string) => undefined);
    const openWeb = vi.fn();
    const resultado = await abrirConversaWhatsApp(
      { telefone: "99880-7633", mensagem: "Olá!" },
      { isTauri: () => true, openTauri, openWeb },
    );
    expect(resultado).toEqual({
      sucesso: false,
      motivo: "telefone_invalido",
      fallbackUtilizado: false,
    });
    expect(openTauri).not.toHaveBeenCalled();
    expect(openWeb).not.toHaveBeenCalled();
  });

  it("falha total retorna erro e não indica destino aberto", async () => {
    const openTauri = vi.fn(async () => {
      throw new Error("falha");
    });
    const resultado = await abrirConversaWhatsApp(
      { telefone: "5544998807633", mensagem: "Olá!" },
      {
        isTauri: () => true,
        protocoloNativoRegistrado: async () => true,
        openTauri,
      },
    );
    expect(resultado).toEqual({
      sucesso: false,
      motivo: "falha_total",
      fallbackUtilizado: true,
    });
    expect(openTauri).toHaveBeenCalledTimes(2);
  });
});

describe("integração central e permissões do WhatsApp", () => {
  const componente = readFileSync(
    "src/components/financeiro/LancamentoDetalheDialog.tsx",
    "utf8",
  );
  const configuracaoTauri = JSON.parse(
    readFileSync("src-tauri/tauri.conf.json", "utf8"),
  ) as { plugins: { shell: { open: string } } };
  const escopoOpen = new RegExp(configuracaoTauri.plugins.shell.open);

  it("a permissão aceita somente whatsapp://send e o fallback no host wa.me", () => {
    expect(escopoOpen.test("whatsapp://send?phone=5544998807633&text=Ol%C3%A1")).toBe(true);
    expect(escopoOpen.test("https://wa.me/5544998807633?text=Ol%C3%A1")).toBe(true);
    expect(escopoOpen.test("https://api.whatsapp.com/send?phone=5544998807633")).toBe(false);
    expect(escopoOpen.test("https://example.com/5544998807633?text=Oi")).toBe(false);
    expect(escopoOpen.test("whatsapp://settings?text=Oi")).toBe(false);
  });

  it("as três ações usam o mesmo ponto central de abertura", () => {
    expect(componente.match(/abrirConversaWhatsApp\(/g)).toHaveLength(1);
    expect(componente).toContain(
      'montarMensagemCobrancaAmigavel(dadosMensagem),\n              "cobranca_amigavel"',
    );
    expect(componente).toContain(
      'montarMensagemCobrancaAtraso({ ...dadosMensagem, tituloVencido }),\n              "cobranca_atraso"',
    );
    expect(componente).toContain(
      'await abrirMensagemWhatsApp(mensagem, "pix_whatsapp")',
    );
  });

  it("histórico diferencia desktop e web", () => {
    const desktop = montarMetadadosHistoricoCobranca({
      acao: "cobranca_amigavel",
      canal: "whatsapp_desktop",
      nomeEmpresa: "Empresa",
    });
    const web = montarMetadadosHistoricoCobranca({
      acao: "cobranca_amigavel",
      canal: "whatsapp_web",
      nomeEmpresa: "Empresa",
    });
    expect(lerMetadadosHistoricoCobranca(desktop)?.canal).toBe("whatsapp_desktop");
    expect(lerMetadadosHistoricoCobranca(web)?.canal).toBe("whatsapp_web");
  });

  it("a interface registra histórico somente após resultado de sucesso", () => {
    const indiceSucesso = componente.indexOf("if (!resultado.sucesso)");
    const indiceRegistro = componente.indexOf(
      "await registrarHistorico(acao, resultado.destino, resultado.telefone)",
    );
    expect(indiceSucesso).toBeGreaterThan(-1);
    expect(indiceRegistro).toBeGreaterThan(indiceSucesso);
  });
});
