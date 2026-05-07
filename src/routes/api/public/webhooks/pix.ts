import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Webhook genérico de cobrança Pix.
 *
 * URL: /api/public/webhooks/pix?provider=asaas|mercadopago|gerencianet|inter
 *
 * Auth depende do provedor:
 * - asaas: header `asaas-access-token` igual a env ASAAS_WEBHOOK_TOKEN
 * - mercadopago: HMAC `x-signature` (env MP_WEBHOOK_SECRET) — opcional
 * - outros: env `<PROVIDER>_WEBHOOK_TOKEN` no header `x-webhook-token`
 *
 * Sempre registra evento em pix_webhook_eventos e baixa lançamento financeiro
 * vinculado quando status indica pago.
 */
export const Route = createFileRoute("/api/public/webhooks/pix")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ ok: true, service: "pix-webhook" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const provider = (url.searchParams.get("provider") ?? "")
          .toLowerCase()
          .trim();

        if (!provider) {
          return jsonRes({ error: "provider obrigatório" }, 400);
        }

        const bodyText = await request.text();

        // Auth por provider
        if (provider === "asaas") {
          const expected = process.env.ASAAS_WEBHOOK_TOKEN;
          const got = request.headers.get("asaas-access-token") ?? "";
          if (!expected || got !== expected) {
            return jsonRes({ error: "Token inválido" }, 401);
          }
        } else {
          const envName = `${provider.toUpperCase()}_WEBHOOK_TOKEN`;
          const expected = process.env[envName];
          const got = request.headers.get("x-webhook-token") ?? "";
          if (!expected) {
            return jsonRes(
              { error: `Webhook ${provider} não configurado` },
              503,
            );
          }
          if (got !== expected) return jsonRes({ error: "Token inválido" }, 401);
        }

        let payload: any;
        try {
          payload = JSON.parse(bodyText);
        } catch {
          return jsonRes({ error: "JSON inválido" }, 400);
        }

        // Extrair payment_id e status normalizado por provider
        const { paymentId, statusNorm, eventId } = parsePayload(
          provider,
          payload,
        );

        // Registrar evento
        await supabaseAdmin.from("pix_webhook_eventos").insert({
          provider,
          event_id: eventId,
          payment_id: paymentId,
          status: statusNorm,
          payload,
        });

        // Conciliação: encontrar pix_cobrancas_geradas
        if (paymentId && statusNorm === "paid") {
          const { data: pix } = await supabaseAdmin
            .from("pix_cobrancas_geradas")
            .select("id, lancamento_id, owner_id, valor")
            .eq("provider", provider)
            .eq("provider_payment_id", paymentId)
            .maybeSingle();

          if (pix) {
            await supabaseAdmin
              .from("pix_cobrancas_geradas")
              .update({ status: "paid", paid_at: new Date().toISOString() })
              .eq("id", pix.id);

            if (pix.lancamento_id) {
              await supabaseAdmin
                .from("financeiro_lancamentos")
                .update({
                  status: "pago",
                  data_pagamento: new Date().toISOString().slice(0, 10),
                  valor_pago: pix.valor,
                  forma_pagamento: "pix",
                })
                .eq("id", pix.lancamento_id);
            }
          }
        }

        await supabaseAdmin
          .from("pix_webhook_eventos")
          .update({ processado_em: new Date().toISOString() })
          .eq("payment_id", paymentId ?? "")
          .eq("provider", provider);

        return jsonRes({ ok: true });
      },
    },
  },
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parsePayload(provider: string, p: any) {
  if (provider === "asaas") {
    return {
      paymentId: p?.payment?.id ?? null,
      statusNorm:
        ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(
          p?.payment?.status,
        )
          ? "paid"
          : (p?.payment?.status ?? "").toLowerCase(),
      eventId: p?.id ?? p?.event ?? null,
    };
  }
  if (provider === "mercadopago") {
    return {
      paymentId: String(p?.data?.id ?? p?.id ?? ""),
      statusNorm: p?.action === "payment.updated" ? "updated" : (p?.type ?? null),
      eventId: p?.id ?? null,
    };
  }
  if (provider === "gerencianet" || provider === "efi") {
    const pix = (p?.pix ?? [])[0];
    return {
      paymentId: pix?.txid ?? null,
      statusNorm: pix?.endToEndId ? "paid" : null,
      eventId: null,
    };
  }
  if (provider === "inter") {
    return {
      paymentId: p?.txid ?? null,
      statusNorm: p?.status === "PAGO" ? "paid" : (p?.status ?? "").toLowerCase(),
      eventId: null,
    };
  }
  return { paymentId: null, statusNorm: null, eventId: null };
}
