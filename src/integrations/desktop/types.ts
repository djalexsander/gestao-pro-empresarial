/**
 * ============================================================================
 * Desktop runtime — Papel da máquina
 * ============================================================================
 *
 * Conceitualmente SEPARADO do `DataMode` (cloud/local-server/local-terminal/hybrid):
 *
 *  - `DesktopRole` decide UX, navegação e regras de uso da máquina.
 *  - `DataMode` (em `integrations/data/mode.ts`) decide a fonte de dados.
 *
 * Hoje, mesmo um `desktop-server` ou `desktop-terminal` pode estar usando
 * `cloud` por baixo. No futuro, quando o backend local entrar:
 *   - server  → local-server (banco local na própria máquina)
 *   - terminal → local-terminal (consome API do server da LAN)
 *
 * Sem precisar mexer em nenhum componente de UI.
 */

export type DesktopRole = "unset" | "server" | "terminal";

export type PrintIntensity = "baixa" | "normal" | "alta" | "muito_alta";

/** Configuração de conexão usada quando o papel é `terminal`. */
export interface TerminalConexaoConfig {
  /** Host/IP do servidor local (ex.: 192.168.0.10 ou servidor.local) */
  host: string;
  /** Porta do backend local (ex.: 7400). */
  porta: number;
  /** Identificador estável deste terminal (slug). */
  terminalId: string;
  /** Nome amigável exibido na UI ("Caixa 01", "Balcão"...). */
  terminalNome: string;
}

export interface DesktopConfig {
  /** Papel da máquina. `unset` = ainda não passou pelo wizard. */
  role: DesktopRole;
  /**
   * Identificador estável desta MÁQUINA (independente do papel).
   * Gerado uma única vez na primeira abertura. Sobrevive a trocas de papel.
   */
  machineId: string;
  /**
   * Identificador estável do SERVIDOR — usado quando role = "server".
   * Permite que terminais validem que estão falando com o servidor certo
   * mesmo se o IP/porta mudarem.
   */
  serverId?: string;
  /** Nome amigável do servidor (ex.: "Servidor Loja Centro"). */
  serverNome?: string;
  /** Quando o papel é `terminal`, a config de conexão com o servidor local. */
  terminal?: TerminalConexaoConfig;
  /**
   * Impressora padrão DESTA MÁQUINA (server ou terminal). Cada máquina tem
   * a sua, então um caixa nunca imprime na impressora de outro caixa.
   * Nome exatamente como reportado pelo SO (Get-Printer / lpstat).
   */
  defaultPrinter?: string | null;
  /**
   * Impressora padrão de ETIQUETAS desta máquina (separada da de cupom).
   * Permite ter uma POS-80 para cupom e uma térmica/zebra para etiqueta.
   */
  defaultLabelPrinter?: string | null;
  /**
   * Intensidade da impressão térmica (densidade/escurecimento do papel).
   * Controla heating-time/double-strike no ESC/POS.
   */
  printIntensity?: PrintIntensity;
  /** Marca de tempo do último ajuste (ms). */
  atualizadoEm?: number;
  /** Versão do schema — útil para migrações futuras. */
  schemaVersion: 1;
}

function gerarId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export const DESKTOP_CONFIG_DEFAULT: DesktopConfig = {
  role: "unset",
  machineId: "",
  schemaVersion: 1,
};

/** Cria uma config inicial com machineId já preenchido. */
export function criarDesktopConfigInicial(): DesktopConfig {
  return {
    role: "unset",
    machineId: gerarId("mac"),
    schemaVersion: 1,
  };
}

export function novoServerId(): string {
  return gerarId("srv");
}
