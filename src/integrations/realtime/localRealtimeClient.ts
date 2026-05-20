/**
 * Cliente realtime local — conecta no SSE `GET /api/events/stream` do servidor
 * Rust, com reconexão exponencial e coalescing de invalidações.
 */
import type { QueryClient } from "@tanstack/react-query";
import { invalidateAll, invalidateForDomain } from "./invalidationMap";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

export interface LocalRealtimeEvent {
  id: string;
  type: string;
  domain: string;
  action: string;
  entity_id?: string | null;
  empresa_id?: string | null;
  terminal_id?: string | null;
  operator_id?: string | null;
  timestamp: number;
  source: string;
  version: number;
}

type Listener = (status: RealtimeStatus) => void;

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const COALESCE_MS = 50;

class LocalRealtimeClient {
  private es: EventSource | null = null;
  private qc: QueryClient | null = null;
  private baseUrl: string | null = null;
  private empresaId: string | null = null;
  private status: RealtimeStatus = "idle";
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private pendingDomains = new Set<string>();
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  connect(baseUrl: string, empresaId: string | null, qc: QueryClient) {
    if (
      this.es &&
      this.baseUrl === baseUrl &&
      this.empresaId === empresaId &&
      this.qc === qc
    ) {
      return;
    }
    this.disconnect();
    this.baseUrl = baseUrl;
    this.empresaId = empresaId;
    this.qc = qc;
    this.stopped = false;
    this.open();
  }

  disconnect() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.coalesceTimer) clearTimeout(this.coalesceTimer);
    this.coalesceTimer = null;
    this.pendingDomains.clear();
    if (this.es) {
      try {
        this.es.close();
      } catch {
        /* ignore */
      }
    }
    this.es = null;
    this.setStatus("idle");
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  private setStatus(s: RealtimeStatus) {
    if (this.status === s) return;
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }

  private open() {
    if (!this.baseUrl || this.stopped) return;
    if (typeof EventSource === "undefined") {
      console.warn("[LOCAL_REALTIME] EventSource indisponível neste runtime");
      this.setStatus("disconnected");
      return;
    }
    const params = new URLSearchParams();
    if (this.empresaId) params.set("empresa_id", this.empresaId);
    const url = `${this.baseUrl}/api/events/stream${params.toString() ? `?${params}` : ""}`;
    console.debug("[LOCAL_REALTIME] conectando", url);
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    try {
      this.es = new EventSource(url);
    } catch (e) {
      console.warn("[LOCAL_REALTIME] falha ao criar EventSource", e);
      this.scheduleReconnect();
      return;
    }

    this.es.onopen = () => {
      console.debug("[LOCAL_REALTIME] conectado");
      this.attempt = 0;
      this.setStatus("connected");
    };

    this.es.onmessage = (msg) => {
      let evt: LocalRealtimeEvent | null = null;
      try {
        evt = JSON.parse(msg.data) as LocalRealtimeEvent;
      } catch {
        return;
      }
      if (!evt) return;
      console.debug("[REALTIME_EVENT]", evt.domain, evt.action, evt.entity_id ?? "");

      if (evt.type === "realtime.lagged") {
        if (this.qc) invalidateAll(this.qc);
        return;
      }
      if (evt.type === "realtime.hello") return;
      this.queueDomain(evt.domain);
    };

    this.es.onerror = () => {
      console.debug("[REALTIME_SSE] erro/desconectado, agendando reconnect");
      try {
        this.es?.close();
      } catch {
        /* ignore */
      }
      this.es = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.setStatus(this.attempt >= 3 ? "disconnected" : "reconnecting");
    const delay =
      BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] +
      Math.floor(Math.random() * 500);
    this.attempt += 1;
    console.debug("[REALTIME_RECONNECT] em", delay, "ms (tentativa", this.attempt, ")");
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private queueDomain(domain: string) {
    this.pendingDomains.add(domain);
    if (this.coalesceTimer) return;
    this.coalesceTimer = setTimeout(() => {
      const domains = Array.from(this.pendingDomains);
      this.pendingDomains.clear();
      this.coalesceTimer = null;
      if (!this.qc) return;
      domains.forEach((d) => invalidateForDomain(this.qc!, d));
    }, COALESCE_MS);
  }
}

export const localRealtimeClient = new LocalRealtimeClient();
