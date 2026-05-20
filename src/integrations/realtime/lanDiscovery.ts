// Descoberta de servidores Gestão Pro na LAN via mDNS.
// Disponível somente no app desktop (Tauri). No browser web, retorna [].

export type DiscoveredServer = {
  server_id: string | null;
  server_name: string | null;
  hostname: string | null;
  version: string | null;
  host: string;
  port: number;
  base_url: string;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function discoverLanServers(timeoutMs = 2000): Promise<DiscoveredServer[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const list = await invoke<DiscoveredServer[]>("mdns_discover_servers", {
      timeoutMs,
    });
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn("[lanDiscovery] mDNS falhou:", err);
    return [];
  }
}
