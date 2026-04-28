import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Webhook Asaas — recebe eventos de cobrança.
 *
 * Segurança:
 * - O Asaas envia o token configurado no painel via header `asaas-access-token`.
 * - Validamos contra a env `ASAAS_WEBHOOK_TOKEN` (timing-safe).
 * - Sem token configurado → 503 (integração desabilitada).
 *
 * Persistência: registra o evento bruto em `asaas_webhook_eventos` para auditoria.
 *
 * URL pública (use no painel Asaas):
 *   {APP_URL}/api/public/webhooks/asaas
 */
export const Route = createFileRoute("/api/public/webhooks/asaas")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ ok: true, service: "asaas-webhook" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),

      POST: async ({ request }) => {
        const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
        if (!expectedToken) {
          return new Response(
            JSON.stringify({ error: "Webhook não configurado" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

        const receivedToken =
          request.headers.get("asaas-access-token") ??
          request.headers.get("x-asaas-access-token") ??
          "";

        // Timing-safe compare
        const a = Buffer.from(receivedToken);
        const b = Buffer.from(expectedToken);
        const valid =
          a.length === b.length &&
          (await import("crypto")).timingSafeEqual(a, b);

        if (!valid) {
          return new Response(JSON.stringify({ error: "Token inválido" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "JSON inválido" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const evento: string = payload?.event ?? "UNKNOWN";
        const paymentId: string | null = payload?.payment?.id ?? null;
        const status: string | null = payload?.payment?.status ?? null;
        // event_id do Asaas (quando presente) — usado para idempotência
        const eventId: string | null =
          payload?.id ?? payload?.event_id ?? null;

        const { error } = await supabaseAdmin
          .from("asaas_webhook_eventos")
          .insert({
            evento,
            payment_id: paymentId,
            status,
            payload,
            event_id: eventId,
          });

        if (error) {
          // 23505 = unique_violation → evento duplicado, responder 200 (idempotente)
          if ((error as any).code === "23505") {
            return new Response(
              JSON.stringify({ received: true, duplicate: true, evento }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          console.error("[asaas-webhook] erro ao persistir:", error);
          return new Response(JSON.stringify({ error: "Falha ao registrar" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ received: true, evento }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
