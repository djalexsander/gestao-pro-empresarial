import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Cron diário de envio de cobranças via WhatsApp.
 * Chamado por pg_cron com header `apikey` (Supabase anon).
 *
 * Para cada empresa com integração WhatsApp ativa:
 *   - busca lançamentos a receber dentro da janela configurada
 *   - aplica template e dispara via edge function whatsapp-provider
 *   - registra log em cobranca_whatsapp_logs
 */
export const Route = createFileRoute("/api/public/hooks/cobrancas-wa-cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey");
        if (!apiKey || apiKey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return jsonRes({ error: "unauthorized" }, 401);
        }

        const { data: integs } = await supabaseAdmin
          .from("empresa_integracoes")
          .select("*")
          .eq("tipo_integracao", "whatsapp")
          .eq("ativo", true);

        const today = new Date();
        let totalEnvios = 0;
        let totalErros = 0;

        for (const integ of integs ?? []) {
          const cfg = (integ.configuracoes ?? {}) as Record<string, any>;
          const diasAntes = Number(cfg.dias_antes ?? 3);
          const diasDepois = Number(cfg.dias_depois ?? 3);
          const enviarVencimento = cfg.enviar_no_vencimento !== false;
          const template =
            cfg.template ??
            "Olá {{cliente_nome}}, cobrança em aberto: R$ {{valor}}, vence {{vencimento}}.";

          const dInicio = new Date(today);
          dInicio.setDate(today.getDate() - diasDepois);
          const dFim = new Date(today);
          dFim.setDate(today.getDate() + diasAntes);

          const { data: lancs } = await supabaseAdmin
            .from("financeiro_lancamentos")
            .select("id, descricao, valor, data_vencimento, cliente_id, owner_id")
            .eq("owner_id", integ.owner_id)
            .eq("tipo", "receita")
            .eq("status", "pendente")
            .gte("data_vencimento", dInicio.toISOString().slice(0, 10))
            .lte("data_vencimento", dFim.toISOString().slice(0, 10));

          for (const l of lancs ?? []) {
            if (!l.cliente_id) continue;
            const { data: cliente } = await supabaseAdmin
              .from("clientes")
              .select("nome, celular, telefone")
              .eq("id", l.cliente_id)
              .maybeSingle();

            const tel = (cliente?.celular ?? cliente?.telefone ?? "").replace(
              /\D/g,
              "",
            );
            if (!tel) continue;

            // Evitar duplicar no mesmo dia
            const { data: jaEnviado } = await supabaseAdmin
              .from("cobranca_whatsapp_logs")
              .select("id")
              .eq("lancamento_id", l.id)
              .gte(
                "created_at",
                new Date(today.toDateString()).toISOString(),
              )
              .maybeSingle();
            if (jaEnviado) continue;

            const venc = new Date(l.data_vencimento);
            const diff = Math.round(
              (venc.getTime() - today.getTime()) / 86400000,
            );
            const tipo =
              diff > 0
                ? "antes_vencimento"
                : diff === 0
                  ? "vencimento"
                  : "apos_vencimento";

            if (tipo === "vencimento" && !enviarVencimento) continue;

            const msg = template
              .replaceAll("{{cliente_nome}}", cliente?.nome ?? "Cliente")
              .replaceAll(
                "{{valor}}",
                Number(l.valor).toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                }),
              )
              .replaceAll(
                "{{vencimento}}",
                venc.toLocaleDateString("pt-BR"),
              )
              .replaceAll("{{descricao}}", l.descricao ?? "");

            try {
              const { error } = await supabaseAdmin.functions.invoke(
                "whatsapp-provider",
                {
                  body: {
                    action: "send_message",
                    empresa_id: integ.empresa_id,
                    to: tel,
                    message: msg,
                  },
                },
              );
              await supabaseAdmin.from("cobranca_whatsapp_logs").insert({
                owner_id: integ.owner_id,
                empresa_id: integ.empresa_id,
                lancamento_id: l.id,
                cliente_id: l.cliente_id,
                telefone: tel,
                mensagem: msg,
                tipo,
                status: error ? "failed" : "sent",
                sent_at: error ? null : new Date().toISOString(),
                erro: error?.message ?? null,
              });
              if (error) totalErros++;
              else totalEnvios++;
            } catch (e: any) {
              totalErros++;
              await supabaseAdmin.from("cobranca_whatsapp_logs").insert({
                owner_id: integ.owner_id,
                empresa_id: integ.empresa_id,
                lancamento_id: l.id,
                cliente_id: l.cliente_id,
                telefone: tel,
                mensagem: msg,
                tipo,
                status: "failed",
                erro: e?.message ?? "erro",
              });
            }
          }
        }

        return jsonRes({ ok: true, enviados: totalEnvios, erros: totalErros });
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
