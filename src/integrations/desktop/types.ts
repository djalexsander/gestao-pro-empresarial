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
  /** Quando o papel é `terminal`, a config de conexão com o servidor local. */
  terminal?: TerminalConexaoConfig;
  /** Marca de tempo do último ajuste (ms). */
  atualizadoEm?: number;
  /** Versão do schema — útil para migrações futuras. */
  schemaVersion: 1;
}

export const DESKTOP_CONFIG_DEFAULT: DesktopConfig = {
  role: "unset",
  schemaVersion: 1,
};
