// Edge function para WhatsApp: testar conexão / enviar mensagem
// Suporta: evolution, zapi, meta_cloud
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReqBody {
  action: "test_connection" | "send_message" | "get_qr";
  empresa_id: string;
  to?: string; // E.164 sem +
  message?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Não autenticado" }, 401);
    }

    const body = (await req.json()) as ReqBody;
    if (!body?.empresa_id || !body?.action) {
      return json({ error: "Parâmetros inválidos" }, 400);
    }

    // Carregar integração WhatsApp da empresa (RLS aplica)
    const { data: integ, error: iErr } = await supabase
      .from("empresa_integracoes")
      .select("*")
      .eq("empresa_id", body.empresa_id)
      .eq("tipo_integracao", "whatsapp")
      .maybeSingle();

    if (iErr) return json({ error: iErr.message }, 500);
    if (!integ) return json({ error: "Integração WhatsApp não configurada" }, 404);

    const cfg = (integ.configuracoes ?? {}) as Record<string, any>;
    const provider = cfg.provider ?? cfg.tipo_api ?? "none";

    if (body.action === "test_connection") {
      const result = await testConnection(provider, cfg);
      // Atualiza status
      await supabase
        .from("empresa_integracoes")
        .update({
          status: result.ok ? "connected" : "error",
          erro_ultimo_sync: result.ok ? null : result.error ?? "Falha",
          ultimo_sync_at: new Date().toISOString(),
        })
        .eq("id", integ.id);
      return json(result, result.ok ? 200 : 400);
    }

    if (body.action === "get_qr") {
      const result = await getQrCode(provider, cfg);
      return json(result, result.ok ? 200 : 400);
    }

    if (body.action === "send_message") {
      if (!body.to || !body.message) return json({ error: "to e message obrigatórios" }, 400);
      const result = await sendMessage(provider, cfg, body.to, body.message);
      return json(result, result.ok ? 200 : 400);
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function testConnection(provider: string, cfg: Record<string, any>) {
  try {
    if (provider === "evolution") {
      const url = (cfg.api_url ?? "").replace(/\/$/, "");
      const instance = cfg.instance ?? "";
      const apiKey = cfg.api_key ?? "";
      if (!url || !instance || !apiKey) return { ok: false, error: "Preencha URL, instância e API key" };
      const res = await fetch(`${url}/instance/connectionState/${encodeURIComponent(instance)}`, {
        headers: { apikey: apiKey },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.message ?? `HTTP ${res.status}` };
      const state = data?.instance?.state ?? data?.state;
      return { ok: state === "open", state, raw: data };
    }
    if (provider === "zapi") {
      const instance = cfg.instance_id ?? "";
      const token = cfg.token ?? "";
      const clientToken = cfg.client_token ?? "";
      if (!instance || !token) return { ok: false, error: "Preencha instance ID e token" };
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (clientToken) headers["Client-Token"] = clientToken;
      const res = await fetch(`https://api.z-api.io/instances/${instance}/token/${token}/status`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
      return { ok: !!data?.connected, connected: data?.connected, raw: data };
    }
    if (provider === "meta_cloud") {
      const phoneId = cfg.phone_number_id ?? "";
      const token = cfg.access_token ?? "";
      if (!phoneId || !token) return { ok: false, error: "Preencha Phone Number ID e Access Token" };
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` };
      return { ok: true, raw: data };
    }
    return { ok: false, error: "Provedor não suportado" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function getQrCode(provider: string, cfg: Record<string, any>) {
  try {
    if (provider === "evolution") {
      const url = (cfg.api_url ?? "").replace(/\/$/, "");
      const instance = cfg.instance ?? "";
      const apiKey = cfg.api_key ?? "";
      if (!url || !instance || !apiKey) return { ok: false, error: "Configuração incompleta" };
      const res = await fetch(`${url}/instance/connect/${encodeURIComponent(instance)}`, {
        headers: { apikey: apiKey },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.message ?? `HTTP ${res.status}` };
      // Evolution retorna { base64, code }
      return { ok: true, qr_base64: data?.base64 ?? data?.qrcode?.base64, code: data?.code, raw: data };
    }
    if (provider === "zapi") {
      const instance = cfg.instance_id ?? "";
      const token = cfg.token ?? "";
      const clientToken = cfg.client_token ?? "";
      const headers: Record<string, string> = {};
      if (clientToken) headers["Client-Token"] = clientToken;
      const res = await fetch(`https://api.z-api.io/instances/${instance}/token/${token}/qr-code/image`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
      return { ok: true, qr_base64: data?.value, raw: data };
    }
    return { ok: false, error: "QR não disponível para este provedor" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function sendMessage(provider: string, cfg: Record<string, any>, to: string, message: string) {
  const phone = to.replace(/\D/g, "");
  try {
    if (provider === "evolution") {
      const url = (cfg.api_url ?? "").replace(/\/$/, "");
      const instance = cfg.instance ?? "";
      const apiKey = cfg.api_key ?? "";
      const res = await fetch(`${url}/message/sendText/${encodeURIComponent(instance)}`, {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ number: phone, text: message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.message ?? `HTTP ${res.status}`, raw: data };
      return { ok: true, raw: data };
    }
    if (provider === "zapi") {
      const instance = cfg.instance_id ?? "";
      const token = cfg.token ?? "";
      const clientToken = cfg.client_token ?? "";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (clientToken) headers["Client-Token"] = clientToken;
      const res = await fetch(`https://api.z-api.io/instances/${instance}/token/${token}/send-text`, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}`, raw: data };
      return { ok: true, raw: data };
    }
    if (provider === "meta_cloud") {
      const phoneId = cfg.phone_number_id ?? "";
      const token = cfg.access_token ?? "";
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: message },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}`, raw: data };
      return { ok: true, raw: data };
    }
    return { ok: false, error: "Provedor não suportado" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
