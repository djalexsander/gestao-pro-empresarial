import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type JsonRecord = Record<string, unknown>;

type AsaasPayment = {
  id?: string;
  status?: string;
  value?: number;
  billingType?: string | null;
  externalReference?: string | null;
  paymentDate?: string | null;
  confirmedDate?: string | null;
  clientPaymentDate?: string | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY") ?? "";
const ASAAS_WEBHOOK_TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, asaas-access-token, x-asaas-access-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const CONFIRMED_STATUSES = new Set(["RECEIVED", "CONFIRMED"]);
const OVERDUE_STATUSES = new Set(["OVERDUE"]);
const CANCELED_STATUSES = new Set([
  "REFUNDED",
  "REFUND_REQUESTED",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
  "DUNNING_REQUESTED",
  "DUNNING_RECEIVED",
]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(received: string, expected: string): boolean {
  const left = new TextEncoder().encode(received);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function cents(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchAsaasPayment(
  baseUrl: string,
  paymentId: string,
): Promise<AsaasPayment> {
  const response = await fetch(
    `${baseUrl}/payments/${encodeURIComponent(paymentId)}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        access_token: ASAAS_API_KEY,
        "User-Agent": "GestaoPro/1.1.24",
      },
    },
  );

  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error("[asaas-webhook] consulta ao Asaas falhou", {
      paymentId,
      status: response.status,
    });
    throw new Error(`Consulta ao Asaas respondeu ${response.status}`);
  }
  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida ao consultar o pagamento no Asaas");
  }
  return data as AsaasPayment;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method === "GET") {
    return json(200, { ok: true, service: "asaas-webhook" });
  }
  if (request.method !== "POST") {
    return json(405, { error: "Método não permitido" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { error: "Configuração do Supabase indisponível" });
  }
  if (!ASAAS_API_KEY || !ASAAS_WEBHOOK_TOKEN) {
    return json(503, { error: "Webhook não configurado" });
  }

  const receivedToken =
    request.headers.get("asaas-access-token") ??
    request.headers.get("x-asaas-access-token") ??
    "";
  if (!timingSafeEqual(receivedToken, ASAAS_WEBHOOK_TOKEN)) {
    console.warn("[asaas-webhook] token inválido");
    return json(401, { error: "Não autorizado" });
  }

  const rawPayload = await request.text();
  let payload: JsonRecord;
  try {
    payload = JSON.parse(rawPayload) as JsonRecord;
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const eventType =
    typeof payload.event === "string" ? payload.event : "UNKNOWN";
  const eventPayment =
    payload.payment && typeof payload.payment === "object"
      ? (payload.payment as JsonRecord)
      : null;
  const paymentId =
    typeof eventPayment?.id === "string" ? eventPayment.id : null;
  const eventStatus =
    typeof eventPayment?.status === "string" ? eventPayment.status : null;
  const suppliedEventId =
    typeof payload.id === "string"
      ? payload.id
      : typeof payload.event_id === "string"
        ? payload.event_id
        : null;
  // Eventos sem ID também recebem uma chave determinística para idempotência.
  const eventId = suppliedEventId ?? `sha256:${await sha256(rawPayload)}`;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: eventInsertError } = await supabase
    .from("asaas_webhook_eventos")
    .insert({
      event_id: eventId,
      evento: eventType,
      payment_id: paymentId,
      status: eventStatus,
      payload,
    });

  if (eventInsertError) {
    if (eventInsertError.code !== "23505") {
      console.error("[asaas-webhook] registro do evento falhou:", eventInsertError);
      return json(500, { error: "Não foi possível registrar o evento" });
    }

    const { data: existingEvent, error: existingEventError } = await supabase
      .from("asaas_webhook_eventos")
      .select("processado_em")
      .eq("event_id", eventId)
      .maybeSingle();
    if (existingEventError) {
      console.error("[asaas-webhook] leitura do evento falhou:", existingEventError);
      return json(500, { error: "Não foi possível validar a idempotência" });
    }
    if (existingEvent?.processado_em) {
      return json(200, { received: true, duplicate: true });
    }
    // Um evento previamente registrado, mas não concluído, pode ser reprocessado.
  }

  const markProcessed = async (): Promise<void> => {
    const { error } = await supabase
      .from("asaas_webhook_eventos")
      .update({ processado_em: new Date().toISOString() })
      .eq("event_id", eventId);
    if (error) throw error;
  };

  if (!paymentId) {
    try {
      await markProcessed();
      return json(200, {
        received: true,
        processed: false,
        reason: "evento_sem_pagamento",
      });
    } catch (error) {
      console.error("[asaas-webhook] conclusão do evento falhou:", error);
      return json(500, { error: "Não foi possível concluir o evento" });
    }
  }

  try {
    const [{ data: config, error: configError }, { data: pagamento, error: pagamentoError }] =
      await Promise.all([
        supabase
          .from("config_comercial")
          .select("asaas_enabled, asaas_ambiente")
          .maybeSingle(),
        supabase
          .from("pagamentos")
          .select("id, empresa_id, valor, status, external_reference")
          .eq("asaas_payment_id", paymentId)
          .maybeSingle(),
      ]);

    if (configError) throw configError;
    if (!config?.asaas_enabled) {
      throw new Error("Integração Asaas desativada");
    }
    if (pagamentoError) throw pagamentoError;
    if (!pagamento) {
      await markProcessed();
      return json(200, {
        received: true,
        processed: false,
        reason: "pagamento_nao_encontrado",
      });
    }

    const baseUrl =
      config.asaas_ambiente === "producao"
        ? "https://api.asaas.com/v3"
        : "https://api-sandbox.asaas.com/v3";
    const verifiedPayment = await fetchAsaasPayment(baseUrl, paymentId);
    const verifiedStatus = String(verifiedPayment.status ?? "").toUpperCase();

    if (verifiedPayment.id !== paymentId) {
      throw new Error("ID do pagamento consultado não corresponde ao evento");
    }
    if (cents(verifiedPayment.value) !== cents(pagamento.valor)) {
      throw new Error("Valor confirmado pelo Asaas diverge do pagamento interno");
    }

    const expectedReference = `gestaopro|pagamento|${pagamento.id}`;
    const legacyReference = `gestaopro|${pagamento.empresa_id}`;
    const storedReference = pagamento.external_reference as string | null;
    const verifiedReference = verifiedPayment.externalReference ?? null;
    const allowedReferences = new Set(
      [expectedReference, legacyReference, storedReference].filter(
        (value): value is string => Boolean(value),
      ),
    );
    if (!verifiedReference || !allowedReferences.has(verifiedReference)) {
      throw new Error("Referência externa do pagamento não corresponde ao Gestão Pro");
    }

    let result: unknown = null;
    if (CONFIRMED_STATUSES.has(verifiedStatus)) {
      const paymentDate = dateOnly(
        verifiedPayment.paymentDate ??
          verifiedPayment.confirmedDate ??
          verifiedPayment.clientPaymentDate,
      );
      const { data, error } = await supabase.rpc("confirmar_pagamento_asaas", {
        _pagamento_id: pagamento.id,
        _data_pagamento: paymentDate,
        _forma_pagamento: verifiedPayment.billingType ?? "PIX",
      });
      if (error) throw error;
      result = data;
    } else if (OVERDUE_STATUSES.has(verifiedStatus)) {
      const { error } = await supabase
        .from("pagamentos")
        .update({ status: "atrasado" })
        .eq("id", pagamento.id)
        .neq("status", "pago");
      if (error) throw error;
      result = { status: "atrasado" };
    } else if (CANCELED_STATUSES.has(verifiedStatus)) {
      const { error } = await supabase
        .from("pagamentos")
        .update({ status: "cancelado" })
        .eq("id", pagamento.id)
        .neq("status", "pago");
      if (error) throw error;
      result = { status: "cancelado" };
    } else {
      // O evento é registrado, mas nenhum status do navegador/evento confirma pagamento.
      result = { status: verifiedStatus || "UNKNOWN", changed: false };
    }

    const { error: eventUpdateError } = await supabase
      .from("asaas_webhook_eventos")
      .update({
        status: verifiedStatus || eventStatus,
        processado_em: new Date().toISOString(),
      })
      .eq("event_id", eventId);
    if (eventUpdateError) throw eventUpdateError;

    return json(200, { received: true, processed: true, result });
  } catch (error) {
    console.error("[asaas-webhook] processamento falhou:", error);
    // Mantém processado_em nulo para permitir retry do mesmo evento.
    return json(500, { error: "Falha ao processar o evento" });
  }
});
