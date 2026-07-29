export interface CobrancaWhatsAppItem {
  nome?: string | null;
  variacaoNome?: string | null;
  quantidade?: number | null;
  valor?: number | null;
}

export interface CobrancaWhatsAppBase {
  clienteNome?: string | null;
  vendaNumero?: string | null;
  parcelaNumero?: number | null;
  totalParcelas?: number | null;
  valorOriginal?: number | null;
  valorPago?: number | null;
  saldoAberto?: number | null;
  vencimento?: string | null;
  itens?: CobrancaWhatsAppItem[] | null;
  nomeEmpresa?: string | null;
}

export interface CobrancaPixWhatsApp extends CobrancaWhatsAppBase {
  pixCopiaCola: string;
}

export type AcaoHistoricoCobranca =
  | "cobranca_amigavel"
  | "cobranca_atraso"
  | "pix_whatsapp"
  | "pix_copiado";

export type CanalHistoricoCobranca =
  | "whatsapp_desktop"
  | "whatsapp_web"
  | "clipboard";

export interface MetadadosHistoricoCobranca {
  versao: 1;
  acao: AcaoHistoricoCobranca;
  canal: CanalHistoricoCobranca;
  empresa_nome: string;
  venda_numero: string | null;
  operador_id: string | null;
  operador_nome: string | null;
}

export interface EscopoHistoricoCobranca {
  empresaId: string;
  lancamentoId: string;
}

export interface AbrirConversaWhatsAppDeps {
  isTauri?: () => boolean;
  protocoloNativoRegistrado?: () => Promise<boolean>;
  openTauri?: (url: string) => Promise<void>;
  openWeb?: (url: string) => unknown;
}

export type ResultadoAberturaWhatsApp =
  | {
      sucesso: true;
      destino: "whatsapp_desktop" | "whatsapp_web";
      telefone: string;
      url: string;
      fallbackUtilizado: boolean;
    }
  | {
      sucesso: false;
      motivo: "telefone_invalido" | "falha_total";
      fallbackUtilizado: boolean;
    };

export interface CachePix {
  obterAtual: () => string | null;
  obterOuGerar: (gerar: () => string | Promise<string>) => Promise<string>;
}

function textoPreenchido(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return texto ? texto : null;
}

function numeroValido(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function formatarBRL(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatarQuantidade(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const runtime = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    isTauri?: boolean;
  };
  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__ || runtime.isTauri);
}

function adicionarIdentificacaoCobranca(
  linhas: string[],
  input: CobrancaWhatsAppBase,
  rotuloSaldo: string,
): void {
  const vendaNumero = textoPreenchido(input.vendaNumero);
  if (vendaNumero) linhas.push(`📄 Venda: ${vendaNumero}`);

  const parcelaNumero = numeroValido(input.parcelaNumero);
  const totalParcelas = numeroValido(input.totalParcelas);
  if (parcelaNumero && totalParcelas && totalParcelas > 1) {
    linhas.push(`💳 Parcela: ${parcelaNumero}/${totalParcelas}`);
  }

  const valorOriginal = numeroValido(input.valorOriginal);
  const valorPago = numeroValido(input.valorPago) ?? 0;
  const saldoAberto = numeroValido(input.saldoAberto);
  if (valorPago > 0) {
    if (valorOriginal !== null) linhas.push(`💰 Valor original: ${formatarBRL(valorOriginal)}`);
    linhas.push(`✅ Pago: ${formatarBRL(valorPago)}`);
    if (saldoAberto !== null) linhas.push(`💰 Saldo em aberto: ${formatarBRL(saldoAberto)}`);
  } else if (saldoAberto !== null) {
    linhas.push(`💰 ${rotuloSaldo}: ${formatarBRL(saldoAberto)}`);
  } else if (valorOriginal !== null) {
    linhas.push(`💰 ${rotuloSaldo}: ${formatarBRL(valorOriginal)}`);
  }

  const vencimento = textoPreenchido(input.vencimento);
  if (vencimento) linhas.push(`📅 Vencimento: ${vencimento}`);
}

function adicionarItens(linhas: string[], itensInput: CobrancaWhatsAppItem[] | null | undefined) {
  const itens = (itensInput ?? []).filter((item) => textoPreenchido(item.nome));
  if (itens.length === 0) return;

  linhas.push("", "Itens da venda:");
  for (const item of itens.slice(0, 10)) {
    const nome = textoPreenchido(item.nome)!;
    const variacao = textoPreenchido(item.variacaoNome);
    const quantidade = numeroValido(item.quantidade) ?? 0;
    const valor = numeroValido(item.valor);
    const descricao = variacao ? `${nome} — ${variacao}` : nome;
    const sufixoValor = valor !== null ? ` — ${formatarBRL(valor)}` : "";
    linhas.push(`• ${formatarQuantidade(quantidade)}x ${descricao}${sufixoValor}`);
  }

  const restantes = itens.length - 10;
  if (restantes > 0) linhas.push(`• e mais ${restantes} item(ns)`);
}

export function resolverNomeEmpresa(input: {
  nomeFantasia?: string | null;
  razaoSocial?: string | null;
  nomeCadastrado?: string | null;
}): string {
  return (
    textoPreenchido(input.nomeFantasia) ??
    textoPreenchido(input.razaoSocial) ??
    textoPreenchido(input.nomeCadastrado) ??
    "Gestão Pro"
  );
}

export function normalizarTelefoneWhatsApp(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (!digitos) return null;

  if (digitos.startsWith("55")) {
    const numeroNacional = digitos.slice(2);
    return numeroNacional.length === 10 || numeroNacional.length === 11 ? digitos : null;
  }

  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }

  return null;
}

export function tituloEstaVencido(
  dataVencimento: string | null | undefined,
  agora = new Date(),
): boolean {
  const data = textoPreenchido(dataVencimento);
  if (!data) return false;
  const vencimento = new Date(`${data.slice(0, 10)}T23:59:59.999`);
  return Number.isFinite(vencimento.getTime()) && vencimento.getTime() < agora.getTime();
}

export function montarMensagemCobrancaAmigavel(input: CobrancaWhatsAppBase): string {
  const clienteNome = textoPreenchido(input.clienteNome);
  const linhas = [
    clienteNome ? `Olá, ${clienteNome}! 👋` : "Olá! 👋",
    "",
    "Esperamos que esteja tudo bem.",
    "",
    "Identificamos uma parcela em aberto referente à sua compra.",
    "",
  ];
  adicionarIdentificacaoCobranca(linhas, input, "Valor a pagar");
  adicionarItens(linhas, input.itens);
  linhas.push(
    "",
    "Caso prefira pagar por Pix, podemos enviar o código de pagamento nesta conversa.",
    "",
    "Após o pagamento, envie o comprovante por aqui para que possamos dar baixa.",
    "",
    "Obrigado!",
    "",
    resolverNomeEmpresa({ nomeCadastrado: input.nomeEmpresa }),
  );
  return linhas.join("\n");
}

export function montarMensagemCobrancaAtraso(
  input: CobrancaWhatsAppBase & { tituloVencido: boolean },
): string {
  const clienteNome = textoPreenchido(input.clienteNome);
  const linhas = [
    clienteNome ? `Olá, ${clienteNome}.` : "Olá.",
    "",
    input.tituloVencido
      ? "Identificamos que a parcela abaixo está vencida."
      : "Identificamos uma parcela em aberto referente à sua compra.",
    "",
  ];
  adicionarIdentificacaoCobranca(linhas, input, "Valor em aberto");
  linhas.push("");
  if (input.tituloVencido) {
    linhas.push("Caso o pagamento já tenha sido realizado, desconsidere esta mensagem.", "");
  }
  linhas.push(
    "Se ainda estiver pendente, podemos enviar o Pix para pagamento.",
    "",
    "Após o pagamento, envie o comprovante por esta conversa.",
    "",
    resolverNomeEmpresa({ nomeCadastrado: input.nomeEmpresa }),
  );
  return linhas.join("\n");
}

export function montarMensagemPixWhatsApp(input: CobrancaPixWhatsApp): string {
  const clienteNome = textoPreenchido(input.clienteNome);
  const pix = textoPreenchido(input.pixCopiaCola);
  if (!pix) throw new Error("Código Pix indisponível.");

  const linhas = [
    clienteNome ? `Olá, ${clienteNome}!` : "Olá!",
    "",
    "Segue o Pix Copia e Cola referente à:",
    "",
  ];
  const vendaNumero = textoPreenchido(input.vendaNumero);
  if (vendaNumero) linhas.push(`Venda: ${vendaNumero}`);
  const parcelaNumero = numeroValido(input.parcelaNumero);
  const totalParcelas = numeroValido(input.totalParcelas);
  if (parcelaNumero && totalParcelas && totalParcelas > 1) {
    linhas.push(`Parcela: ${parcelaNumero}/${totalParcelas}`);
  }
  const saldo = numeroValido(input.saldoAberto) ?? numeroValido(input.valorOriginal);
  if (saldo !== null) linhas.push(`Valor: ${formatarBRL(saldo)}`);
  linhas.push(
    "",
    "Copie somente o código abaixo:",
    "",
    pix,
    "",
    "Após o pagamento, envie o comprovante por esta conversa.",
    "",
    resolverNomeEmpresa({ nomeCadastrado: input.nomeEmpresa }),
  );
  return linhas.join("\n");
}

export function criarEscopoHistoricoCobranca(
  empresaId: string,
  lancamentoId: string,
): EscopoHistoricoCobranca {
  const empresa = textoPreenchido(empresaId);
  const lancamento = textoPreenchido(lancamentoId);
  if (!empresa || !lancamento) throw new Error("Escopo do histórico de cobrança inválido.");
  return { empresaId: empresa, lancamentoId: lancamento };
}

export function criarCachePix(): CachePix {
  let codigo: string | null = null;
  let geracaoPendente: Promise<string> | null = null;

  return {
    obterAtual: () => codigo,
    obterOuGerar: async (gerar) => {
      if (codigo) return codigo;
      if (geracaoPendente) return geracaoPendente;

      geracaoPendente = Promise.resolve()
        .then(gerar)
        .then((novoCodigo) => {
          const pix = textoPreenchido(novoCodigo);
          if (!pix) throw new Error("Não foi possível gerar o código Pix.");
          codigo = pix;
          return pix;
        });
      try {
        return await geracaoPendente;
      } finally {
        geracaoPendente = null;
      }
    },
  };
}

export async function copiarCodigoPix(
  codigo: string,
  escrever: (texto: string) => Promise<void>,
): Promise<void> {
  const pix = textoPreenchido(codigo);
  if (!pix) throw new Error("Código Pix indisponível.");
  await escrever(pix);
}

export function montarMetadadosHistoricoCobranca(input: {
  acao: AcaoHistoricoCobranca;
  canal: CanalHistoricoCobranca;
  nomeEmpresa: string;
  vendaNumero?: string | null;
  operadorId?: string | null;
  operadorNome?: string | null;
}): string {
  const metadados: MetadadosHistoricoCobranca = {
    versao: 1,
    acao: input.acao,
    canal: input.canal,
    empresa_nome: resolverNomeEmpresa({ nomeCadastrado: input.nomeEmpresa }),
    venda_numero: textoPreenchido(input.vendaNumero),
    operador_id: textoPreenchido(input.operadorId),
    operador_nome: textoPreenchido(input.operadorNome),
  };
  return JSON.stringify(metadados);
}

export function lerMetadadosHistoricoCobranca(
  valor: string,
): MetadadosHistoricoCobranca | null {
  try {
    const parsed = JSON.parse(valor) as Partial<MetadadosHistoricoCobranca>;
    if (
      parsed.versao !== 1 ||
      !["cobranca_amigavel", "cobranca_atraso", "pix_whatsapp", "pix_copiado"].includes(
        parsed.acao ?? "",
      )
    ) {
      return null;
    }
    return parsed as MetadadosHistoricoCobranca;
  } catch {
    return null;
  }
}

export function montarUrlsConversaWhatsApp(telefoneNormalizado: string, mensagem: string) {
  const mensagemCodificada = encodeURIComponent(mensagem);
  return {
    nativa: `whatsapp://send?phone=${telefoneNormalizado}&text=${mensagemCodificada}`,
    web: `https://wa.me/${telefoneNormalizado}?text=${mensagemCodificada}`,
  };
}

export async function abrirConversaWhatsApp(
  input: { telefone: string | null | undefined; mensagem: string },
  deps: AbrirConversaWhatsAppDeps = {},
): Promise<ResultadoAberturaWhatsApp> {
  const telefone = normalizarTelefoneWhatsApp(input.telefone);
  if (!telefone) {
    return { sucesso: false, motivo: "telefone_invalido", fallbackUtilizado: false };
  }

  const urls = montarUrlsConversaWhatsApp(telefone, input.mensagem);
  const tauri = deps.isTauri?.() ?? isTauriRuntime();
  if (tauri) {
    const openTauri =
      deps.openTauri ??
      (async (target: string) => {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(target);
      });

    let protocoloRegistrado = true;
    try {
      const verificarProtocolo =
        deps.protocoloNativoRegistrado ??
        (async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          return invoke<boolean>("whatsapp_protocol_registered");
        });
      protocoloRegistrado = await verificarProtocolo();
    } catch {
      // Se a verificação não estiver disponível, ainda é seguro tentar o
      // protocolo e usar o erro real do plugin como sinal para o fallback.
    }

    if (protocoloRegistrado) {
      try {
        await openTauri(urls.nativa);
        return {
          sucesso: true,
          destino: "whatsapp_desktop",
          telefone,
          url: urls.nativa,
          fallbackUtilizado: false,
        };
      } catch {
        // Falha real ao invocar o protocolo: segue para o fallback HTTPS.
      }
    }

    try {
      await openTauri(urls.web);
      return {
        sucesso: true,
        destino: "whatsapp_web",
        telefone,
        url: urls.web,
        fallbackUtilizado: true,
      };
    } catch {
      return { sucesso: false, motivo: "falha_total", fallbackUtilizado: true };
    }
  }

  const openWeb =
    deps.openWeb ??
    ((target: string) => {
      const aberta = window.open(target, "_blank", "noopener,noreferrer");
      if (!aberta) throw new Error("O navegador bloqueou a abertura do WhatsApp.");
      return aberta;
    });
  try {
    openWeb(urls.web);
    return {
      sucesso: true,
      destino: "whatsapp_web",
      telefone,
      url: urls.web,
      fallbackUtilizado: false,
    };
  } catch {
    return { sucesso: false, motivo: "falha_total", fallbackUtilizado: false };
  }
}
