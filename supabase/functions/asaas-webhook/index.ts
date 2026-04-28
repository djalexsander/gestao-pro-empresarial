// Edge Function: asaas-webhook
// Recebe eventos do Asaas, valida token, registra evento (idempotente)
// e ativa plano/módulo automaticamente quando o pagamento é confirmado.
//
// URL pública:
//   https://<project-ref>.supabase.co/functions/v1/asaas-webhook

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, asaas-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    return json(200, { ok: true, service: "asaas-webhook" });
  }

  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // 1) Segurança — token do webhook
  if (!WEBHOOK_TOKEN) {
    console.error("ASAAS_WEBHOOK_TOKEN não configurado");
    return json(503, { error: "Webhook não configurado" });
  }

  const received =
    req.headers.get("asaas-access-token") ??
    req.headers.get("x-asaas-access-token") ??
    "";

  if (!timingSafeEqual(received, WEBHOOK_TOKEN)) {
    console.warn("[asaas-webhook] token inválido");
    return json(401, { error: "Unauthorized" });
  }

  // 2) Payload
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const eventId: string | null = payload?.id ?? null;
  const eventType: string = payload?.event ?? "UNKNOWN";
  const payment = payload?.payment ?? null;
  const paymentId: string | null = payment?.id ?? null;
  const paymentStatus: string | null = payment?.status ?? null;
  const externalReference: string | null = payment?.externalReference ?? null;

  console.log("[asaas-webhook] evento recebido:", {
    eventId,
    eventType,
    paymentId,
    paymentStatus,
    externalReference,
  });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // 3) Idempotência — registra evento; se event_id duplicado, ignora
  if (eventId) {
    const { data: existente } = await supabase
      .from("asaas_webhook_eventos")
      .select("id, processado_em")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existente) {
      console.log("[asaas-webhook] evento duplicado, ignorando:", eventId);
      return json(200, { received: true, duplicado: true });
    }
  }

  const { error: insertErr } = await supabase
    .from("asaas_webhook_eventos")
    .insert({
      event_id: eventId,
      evento: eventType,
      payment_id: paymentId,
      status: paymentStatus,
      payload,
    });

  if (insertErr) {
    console.error("[asaas-webhook] falha ao registrar evento:", insertErr);
    return json(500, { error: "Falha ao registrar" });
  }

  // 4) Processa apenas eventos de pagamento confirmado
  const eventosProcessar = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);
  if (!eventosProcessar.has(eventType) || !paymentId) {
    return json(200, { received: true, processado: false });
  }

  // 5) Localiza pagamento interno por asaas_payment_id
  const { data: pagamento, error: pagErr } = await supabase
    .from("pagamentos")
    .select("id, status, referencia_tipo, plano_id, modulo_id, empresa_id")
    .eq("asaas_payment_id", paymentId)
    .maybeSingle();

  if (pagErr) {
    console.error("[asaas-webhook] erro ao buscar pagamento:", pagErr);
    return json(200, { received: true, erro: "lookup_falhou" });
  }

  if (!pagamento) {
    console.log(
      "[asaas-webhook] pagamento não encontrado p/ asaas_payment_id:",
      paymentId,
    );
    // Marca evento processado mesmo sem ação para não reprocessar
    if (eventId) {
      await supabase
        .from("asaas_webhook_eventos")
        .update({ processado_em: new Date().toISOString() })
        .eq("event_id", eventId);
    }
    return json(200, { received: true, processado: false, motivo: "pagamento_nao_encontrado" });
  }

  // 6) Confirma pagamento e ativa plano/módulo (idempotente na função SQL)
  const dataPg: string | null = payment?.paymentDate ?? payment?.confirmedDate ?? null;
  const formaPg: string | null = payment?.billingType ?? null;

  const { data: confirmRes, error: confirmErr } = await supabase.rpc(
    "confirmar_pagamento_asaas",
    {
      _pagamento_id: pagamento.id,
      _data_pagamento: dataPg,
      _forma_pagamento: formaPg,
    },
  );

  if (confirmErr) {
    console.error("[asaas-webhook] erro ao confirmar pagamento:", confirmErr);
    return json(200, { received: true, erro: "confirmacao_falhou" });
  }

  console.log("[asaas-webhook] ativação:", confirmRes);

  if (eventId) {
    await supabase
      .from("asaas_webhook_eventos")
      .update({ processado_em: new Date().toISOString() })
      .eq("event_id", eventId);
  }

  return json(200, { received: true, processado: true, resultado: confirmRes });
});
