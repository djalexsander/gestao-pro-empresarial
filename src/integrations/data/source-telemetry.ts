/**
 * ============================================================================
 * Telemetria da fonte de dados ativa
 * ============================================================================
 *
 * Permite que adapters reportem qual backend efetivamente serviu uma chamada
 * (cloud, local-server, local-terminal) e que a UI exiba isso em tempo real.
 *
 * Não bloqueia o fluxo de dados: é puramente observacional.
 */

export type DataSource = "cloud" | "local-server" | "local-terminal";

export interface DataSourceEvent {
  source: DataSource;
  domain: string;
  method: string;
  /** True quando a chamada caiu para cloud por falha do local. */
  fallback: boolean;
  at: number;
}

type Listener = (ev: DataSourceEvent) => void;
const listeners = new Set<Listener>();

let lastEvent: DataSourceEvent | null = null;

export function reportDataSource(ev: Omit<DataSourceEvent, "at">) {
  const full: DataSourceEvent = { ...ev, at: Date.now() };
  lastEvent = full;
  if (typeof console !== "undefined" && import.meta.env.DEV) {
    const icon = ev.fallback
      ? "⚠️  fallback→cloud"
      : ev.source === "cloud"
        ? "☁️ "
        : ev.source === "local-server"
          ? "🖥️ "
          : "💻";
    // eslint-disable-next-line no-console
    console.debug(
      `[dataSource] ${icon} ${ev.source} · ${ev.domain}.${ev.method}`,
    );
  }
  for (const l of listeners) {
    try {
      l(full);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function subscribeDataSource(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLastDataSource(): DataSourceEvent | null {
  return lastEvent;
}
