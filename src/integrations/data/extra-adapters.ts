/**
 * Adapters adicionais introduzidos na Onda 4 (terminais, notificações,
 * autorizações, empresa/config, balança, códigos de produto).
 *
 * Mantidos em arquivo separado para evitar inflar `adapter.ts` durante
 * a migração incremental. As interfaces são compostas em `DataAdapter`.
 */

// =============== Terminais ===============
export interface TerminalDomain {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  identificador_dispositivo: string | null;
  pareamento_token: string | null;
  ultimo_uso: string | null;
  caixa_aberto_id: string | null;
  created_at: string;
  papel: "servidor" | "terminal";
  heartbeat_at: string | null;
  operador_atual_id: string | null;
  operador_atual_nome: string | null;
  user_agent: string | null;
  ip_local: string | null;
  pode_pdv: boolean;
  pode_erp: boolean;
  pode_financeiro: boolean;
  pode_configuracoes: boolean;
  pode_relatorios: boolean;
  pode_cadastros: boolean;
}

export interface CriarTerminalInput {
  nome: string;
  descricao?: string | null;
  identificador_dispositivo?: string | null;
}

export interface AtualizarTerminalInput {
  id: string;
  nome?: string;
  descricao?: string | null;
  identificador_dispositivo?: string | null;
}

export interface TerminaisAdapter {
  list(): Promise<TerminalDomain[]>;
  criar(input: CriarTerminalInput): Promise<string>;
  atualizar(input: AtualizarTerminalInput): Promise<void>;
  alterarStatus(input: { id: string; ativo: boolean }): Promise<void>;
  excluir(terminalId: string): Promise<void>;
  gerarToken(terminalId: string): Promise<string>;
  definirServidor(terminalId: string): Promise<void>;
}

// =============== Notificações ===============
export interface FinanceiroVencidoLite {
  id: string;
  descricao: string | null;
  valor: number;
  data_vencimento: string;
  tipo: string;
}

export interface ProdutoEstoqueMinimoLite {
  id: string;
  nome: string;
  estoque_minimo: number;
}

export interface MovimentacaoEstoqueLite {
  produto_id: string;
  tipo: string;
  quantidade: number;
}

export interface NotificacaoEstadoLite {
  notificacao_key: string;
  read: boolean;
  read_at: string | null;
  deleted: boolean;
}

export interface NotificacoesAdapter {
  vencidas(): Promise<FinanceiroVencidoLite[]>;
  vencendoHoje(): Promise<FinanceiroVencidoLite[]>;
  produtosEstoqueMinimo(): Promise<ProdutoEstoqueMinimoLite[]>;
  movimentosEstoqueResumo(): Promise<MovimentacaoEstoqueLite[]>;
  estadosUsuario(userId: string): Promise<NotificacaoEstadoLite[]>;
  marcarLida(input: { user_id: string; notificacao_key: string }): Promise<void>;
  excluir(input: { user_id: string; notificacao_key: string }): Promise<void>;
  marcarVariasLidas(input: { user_id: string; chaves: string[] }): Promise<void>;
}

// =============== Autorizações ===============
export type AutorizacaoAcaoDomain =
  | "fechar_caixa_divergencia"
  | "fechar_caixa_qualquer"
  | "remover_item_venda"
  | "cancelar_venda"
  | "cancelar_compra"
  | "excluir_lancamento_financeiro"
  | "alterar_valor_confirmado"
  | "reabrir_caixa";

export type AutorizacaoMetodoDomain = "pin_funcionario" | "senha_master" | "codigo_qr";

export interface AutorizacoesConfigDomain {
  owner_id: string;
  exigir_fechar_caixa_divergencia: boolean;
  exigir_fechar_caixa_qualquer: boolean;
  exigir_remover_item_venda: boolean;
  exigir_cancelar_venda: boolean;
  exigir_cancelar_compra: boolean;
  exigir_excluir_lancamento_financeiro: boolean;
  exigir_alterar_valor_confirmado: boolean;
  exigir_reabrir_caixa: boolean;
  metodo_pin_habilitado: boolean;
  metodo_senha_master_habilitado: boolean;
  metodo_codigo_qr_habilitado: boolean;
  senha_master_hash: string | null;
  codigo_qr_hash: string | null;
  codigo_qr_label: string | null;
  papeis_autorizadores: string[];
}

export interface AutorizacaoLogDomain {
  id: string;
  acao: AutorizacaoAcaoDomain;
  metodo: AutorizacaoMetodoDomain;
  status: "autorizado" | "negado";
  contexto: string;
  autorizador_nome: string | null;
  valor_envolvido: number | null;
  diferenca_caixa: number | null;
  motivo_negacao: string | null;
  created_at: string;
}

export interface ValidarAutorizacaoInputDomain {
  acao: AutorizacaoAcaoDomain;
  metodo: AutorizacaoMetodoDomain;
  payload: Record<string, string>;
  contexto: string;
  contexto_dados?: Record<string, unknown>;
  valor_envolvido?: number | null;
  diferenca_caixa?: number | null;
  referencia_tipo?: string | null;
  referencia_id?: string | null;
  solicitante_funcionario_id?: string | null;
  terminal_id?: string | null;
  user_agent?: string | null;
}

export interface ValidarAutorizacaoResultDomain {
  autorizado: boolean;
  motivo: string | null;
  autorizador_nome: string | null;
}

export interface AutorizacoesAdapter {
  obterConfig(): Promise<AutorizacoesConfigDomain>;
  salvarConfig(payload: Record<string, unknown>): Promise<AutorizacoesConfigDomain>;
  log(limit?: number): Promise<AutorizacaoLogDomain[]>;
  validar(input: ValidarAutorizacaoInputDomain): Promise<ValidarAutorizacaoResultDomain>;
}

// =============== Empresa (multi-empresa) ===============
export type EmpresaPapelDomain = "owner" | "admin" | "gerente_operacional";

export interface EmpresaAcessivelDomain {
  id: string;
  nome: string;
  owner_id: string;
  papel: EmpresaPapelDomain;
}

export interface EmpresaAdapter {
  acessiveis(userId: string): Promise<EmpresaAcessivelDomain[]>;
}

// =============== Configuração da empresa (cabeçalho fiscal) ===============
export interface ConfigEmpresaDomain {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string | null;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  telefone: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  logo_url: string | null;
}

export type ConfigEmpresaInputDomain = Omit<ConfigEmpresaDomain, "id"> & { id?: string };

export interface ConfigEmpresaAdapter {
  obter(): Promise<ConfigEmpresaDomain | null>;
  salvar(input: Partial<ConfigEmpresaInputDomain> & { id?: string }): Promise<ConfigEmpresaDomain>;
  uploadLogo(input: { file: File; userId: string }): Promise<string>;
  removerLogo(url: string | null): Promise<void>;
}

// =============== Balança ===============
export interface BalancaConfigRowDomain {
  owner_id: string;
  observacoes: string | null;
  updated_at: string;
  // Campos do BalancaConfig são genéricos — mantemos como Record para não acoplar.
  [key: string]: unknown;
}

export interface BalancaAdapter {
  obter(userId: string): Promise<BalancaConfigRowDomain | null>;
  salvar(input: Partial<BalancaConfigRowDomain> & { owner_id: string }): Promise<BalancaConfigRowDomain>;
}

// =============== Códigos auxiliares de produto (listagem) ===============
import type { CodigoTipo } from "./types";

export interface ProdutoCodigoDomain {
  id: string;
  produto_id: string;
  variacao_id: string | null;
  tipo_codigo: CodigoTipo;
  valor_codigo: string;
  observacao: string | null;
  created_at: string;
}

export interface ProdutoCodigosAdapter {
  list(produtoId: string): Promise<ProdutoCodigoDomain[]>;
}
