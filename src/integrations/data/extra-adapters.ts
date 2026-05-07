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

export interface AtualizarPermissoesTerminalInput {
  id: string;
  pode_pdv: boolean;
  pode_erp: boolean;
  pode_financeiro: boolean;
  pode_configuracoes: boolean;
  pode_relatorios: boolean;
  pode_cadastros: boolean;
}

export interface TerminaisAdapter {
  list(): Promise<TerminalDomain[]>;
  criar(input: CriarTerminalInput): Promise<string>;
  atualizar(input: AtualizarTerminalInput): Promise<void>;
  alterarStatus(input: { id: string; ativo: boolean }): Promise<void>;
  excluir(terminalId: string): Promise<void>;
  gerarToken(terminalId: string): Promise<string>;
  definirServidor(terminalId: string): Promise<void>;
  atualizarPermissoes(input: AtualizarPermissoesTerminalInput): Promise<void>;
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

// =============== Onda 5: Admin / SaaS / QA / UserRoles / TerminalRuntime ===============

// --- User roles ---
export type AppRoleDomain =
  | "super_admin"
  | "admin"
  | "gerente"
  | "caixa"
  | "vendedor"
  | "financeiro";

export interface UserRolesAdapter {
  listar(userId: string): Promise<AppRoleDomain[]>;
}

// --- Admin (super admin global) ---
export type EmpresaStatusAdminDomain = "ativa" | "inativa" | "bloqueada";
export type EmpresaPlanoAdminDomain = "free" | "starter" | "pro" | "enterprise";

export interface AdminUserDomain {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  roles: string[];
  empresa_id: string | null;
  empresa_nome: string | null;
  empresa_status: EmpresaStatusAdminDomain | null;
  empresa_plano: EmpresaPlanoAdminDomain | null;
  total_produtos: number;
  total_vendas: number;
  total_compras: number;
}

export interface AdminEmpresaDomain {
  id: string;
  owner_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  documento: string | null;
  status: EmpresaStatusAdminDomain;
  plano: EmpresaPlanoAdminDomain;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
  total_usuarios: number;
  total_produtos: number;
  total_vendas: number;
  total_compras: number;
  total_movimentacoes: number;
  volume_vendas: number;
  volume_compras: number;
}

export interface AdminStatsDomain {
  total_usuarios: number;
  usuarios_30d: number;
  usuarios_7d: number;
  usuarios_confirmados: number;
  usuarios_ativos_30d: number;
  total_empresas: number;
  empresas_ativas: number;
  empresas_inativas: number;
  empresas_bloqueadas: number;
  empresas_30d: number;
  empresas_7d: number;
  total_produtos: number;
  total_clientes: number;
  total_fornecedores: number;
  total_vendas: number;
  total_compras: number;
  total_movimentacoes: number;
  volume_vendas_total: number;
  volume_compras_total: number;
}

export interface AuditLogDomain {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface SerieCrescimentoDomain {
  data: string;
  novos_usuarios: number;
  novas_empresas: number;
  total_usuarios_acum: number;
  total_empresas_acum: number;
}

export interface AdminAdapter {
  isSuperAdmin(userId: string): Promise<boolean>;
  stats(): Promise<AdminStatsDomain>;
  serieCrescimento(dias: number): Promise<SerieCrescimentoDomain[]>;
  listarUsuarios(): Promise<AdminUserDomain[]>;
  setUserRole(input: { userId: string; role: string; grant: boolean }): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  listarEmpresas(): Promise<AdminEmpresaDomain[]>;
  upsertEmpresa(input: {
    id: string;
    nome: string;
    email?: string | null;
    telefone?: string | null;
    documento?: string | null;
    plano?: EmpresaPlanoAdminDomain;
    observacoes?: string | null;
  }): Promise<void>;
  setEmpresaStatus(input: { id: string; status: EmpresaStatusAdminDomain; motivo?: string }): Promise<void>;
  deleteEmpresa(id: string): Promise<void>;
  auditLogs(limit: number): Promise<AuditLogDomain[]>;
  registrarAuditLog(input: {
    action: string;
    target_type?: string;
    target_id?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

// --- SaaS Admin (planos/módulos/assinaturas/etc) ---
export type PlanoTipoCobrancaDomain = "mensal" | "anual" | "vitalicio";
export type AssinaturaStatusDomain = "trial" | "ativo" | "vencido" | "cancelado";
export type EmpresaModuloStatusDomain = "ativo" | "pendente" | "cancelado";
export type PagamentoStatusDomain = "pago" | "pendente" | "atrasado" | "cancelado";
export type PagamentoReferenciaDomain = "plano" | "modulo" | "outro";
export type SystemModeTipoDomain = "admin" | "operador";

export interface SaasAdminAdapter {
  // planos
  listarPlanos(): Promise<unknown[]>;
  upsertPlano(input: Record<string, unknown>): Promise<void>;
  deletePlano(id: string): Promise<void>;
  // módulos
  listarModulos(): Promise<unknown[]>;
  upsertModulo(input: Record<string, unknown>): Promise<void>;
  deleteModulo(id: string): Promise<void>;
  // assinaturas
  listarAssinaturas(): Promise<unknown[]>;
  setAssinatura(input: Record<string, unknown>): Promise<void>;
  // empresa-módulos
  listarEmpresaModulos(empresaId: string | null): Promise<unknown[]>;
  setEmpresaModulo(input: Record<string, unknown>): Promise<void>;
  removerEmpresaModulo(id: string): Promise<void>;
  // pagamentos
  listarPagamentos(empresaId: string | null): Promise<unknown[]>;
  upsertPagamento(input: Record<string, unknown>): Promise<void>;
  deletePagamento(id: string): Promise<void>;
  // config comercial
  obterConfigComercial(): Promise<unknown>;
  setConfigComercial(input: Record<string, unknown>): Promise<void>;
  // minha assinatura / meus módulos
  minhaAssinatura(): Promise<unknown>;
  meusModulos(): Promise<unknown[]>;
  // modos
  listarModos(): Promise<unknown[]>;
  modosDisponiveis(): Promise<unknown[]>;
  upsertModo(input: Record<string, unknown>): Promise<string>;
  deleteModo(id: string): Promise<void>;
  setModoModulos(input: { mode_id: string; module_ids: string[] }): Promise<void>;
}

// --- SaaS Cliente (auto-serviço empresa) ---
export interface CobrancaCriadaDomain {
  pagamento_id: string;
  asaas_payment_id: string;
  invoice_url?: string | null;
  pix_qrcode?: string | null;
  pix_copia_cola?: string | null;
  due_date?: string | null;
}

export interface SaasClienteAdapter {
  planosDisponiveis(): Promise<unknown[]>;
  modulosDisponiveisCliente(): Promise<unknown[]>;
  /** Solicita plano. Retorna { pagamentoId, cobranca? }. */
  solicitarPlano(planoId: string): Promise<{ pagamentoId: string; cobranca: CobrancaCriadaDomain | null }>;
  solicitarModulo(moduloId: string): Promise<{ pagamentoId: string; cobranca: CobrancaCriadaDomain | null }>;
  resetarDadosEmpresa(): Promise<void>;
}

// --- QA (super admin) ---
export type QaSeveridadeDomain = "critico" | "medio" | "leve";
export type QaStatusAvaliacaoDomain = "nao_testado" | "ok" | "leve" | "medio" | "critico";
export type QaValidacaoStatusDomain = "em_andamento" | "finalizada";

export interface QaModuloDomain {
  id: string;
  chave: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  ativo: boolean;
}

export interface QaItemDomain {
  id: string;
  modulo_id: string;
  titulo: string;
  descricao: string | null;
  severidade: QaSeveridadeDomain;
  critico: boolean;
  rota_link: string | null;
  ordem: number;
  ativo: boolean;
}

export interface QaValidacaoDomain {
  id: string;
  titulo: string;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  status: QaValidacaoStatusDomain;
  iniciada_em: string;
  finalizada_em: string | null;
  observacao_final: string | null;
  resumo: Record<string, unknown> | null;
}

export interface QaAvaliacaoDomain {
  id: string;
  validacao_id: string;
  item_id: string;
  status: QaStatusAvaliacaoDomain;
  observacao: string | null;
  evidencia_url: string | null;
  testado_em: string | null;
  testado_por: string | null;
  testado_por_nome: string | null;
  updated_at: string;
}

export interface QaAdapter {
  listarModulos(): Promise<QaModuloDomain[]>;
  listarItens(): Promise<QaItemDomain[]>;
  listarValidacoes(): Promise<QaValidacaoDomain[]>;
  validacaoAtiva(): Promise<QaValidacaoDomain | null>;
  listarAvaliacoes(validacaoId: string): Promise<QaAvaliacaoDomain[]>;
  criarValidacao(input: {
    titulo: string;
    responsavel_id: string;
    responsavel_nome: string;
  }): Promise<QaValidacaoDomain>;
  finalizarValidacao(input: {
    id: string;
    observacao_final: string | null;
    resumo: Record<string, unknown> | null;
  }): Promise<void>;
  salvarAvaliacao(input: {
    validacao_id: string;
    item_id: string;
    status: QaStatusAvaliacaoDomain;
    observacao: string | null;
    evidencia_url: string | null;
    testado_por: string;
    testado_por_nome: string;
  }): Promise<void>;
  uploadEvidencia(input: { file: File; validacao_id: string }): Promise<string>;
  signedUrlEvidencia(path: string): Promise<string | null>;
}

// --- Terminal runtime (heartbeat / ping / limpar operador) ---
export interface TerminalRuntimeAdapter {
  heartbeat(input: {
    terminal_id: string;
    operador_id: string | null;
    operador_nome: string | null;
    user_agent: string | null;
    ip_local: string | null;
  }): Promise<void>;
  limparOperador(terminalId: string): Promise<void>;
  ping(): Promise<void>;
}
