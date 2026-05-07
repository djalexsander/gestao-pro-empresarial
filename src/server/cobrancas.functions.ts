import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Types
type EnviarWAInput = {
  empresa_id: string;
  lancamento_id?: string | null;
  cliente_id?: string | null;
  telefone: string;
  mensagem: string;
  tipo?: "manual" | "antes_vencimento" | "vencimento" | "apos_vencimento";
};

type GerarPixInput = {
  empresa_id: string;
  lancamento_id?: string | null;
  cliente_id?: string | null;
  valor: number;
  vencimento?: string | null;
  descricao?: string;
};

// ─────────────────────────────────────────────
// Enviar WhatsApp + log
// ─────────────────────────────────────────────
export const enviarCobrancaWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: EnviarWAInput) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: integ } = await supabase
      .from("empresa_integracoes")
      .select("*")
      .eq("empresa_id", data.empresa_id)
      .eq("tipo_integracao", "whatsapp")
      .maybeSingle();

    const cfg = (integ?.configuracoes ?? {}) as Record<string, any>;
    const provider = cfg.provider ?? "manual";

    let status: "pending" | "sent" | "failed" = "pending";
    let erro: string | null = null;
    let sentAt: string | null = null;

    try {
      if (provider === "manual") {
        // Apenas registra — envio é via wa.me no front
        status = "sent";
        sentAt = new Date().toISOString();
      } else {
        // Chama edge function whatsapp-provider
        const { data: resp, error } = await supabase.functions.invoke(
          "whatsapp-provider",
          {
            body: {
              action: "send_message",
              empresa_id: data.empresa_id,
              to: data.telefone.replace(/\D/g, ""),
              message: data.mensagem,
            },
          },
        );
        if (error) throw new Error(error.message);
        if ((resp as any)?.error) throw new Error((resp as any).error);
        status = "sent";
        sentAt = new Date().toISOString();
      }
    } catch (e: any) {
      status = "failed";
      erro = e?.message ?? "Falha ao enviar";
    }

    const { data: log, error: logErr } = await supabase
      .from("cobranca_whatsapp_logs")
      .insert({
        owner_id: userId,
        empresa_id: data.empresa_id,
        lancamento_id: data.lancamento_id ?? null,
        cliente_id: data.cliente_id ?? null,
        telefone: data.telefone,
        mensagem: data.mensagem,
        status,
        tipo: data.tipo ?? "manual",
        sent_at: sentAt,
        erro,
      })
      .select()
      .single();

    if (logErr) throw new Error(logErr.message);
    return { log, status, erro };
  });

// ─────────────────────────────────────────────
// Gerar Pix dinâmico
// ─────────────────────────────────────────────
export const gerarPixDinamico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: GerarPixInput) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: integ } = await supabase
      .from("empresa_integracoes")
      .select("*")
      .eq("empresa_id", data.empresa_id)
      .eq("tipo_integracao", "pix")
      .maybeSingle();

    if (!integ) throw new Error("Integração PIX não configurada");
    const cfg = (integ.configuracoes ?? {}) as Record<string, any>;
    const provider = cfg.provider as string;

    if (provider === "estatico") {
      throw new Error(
        "PIX está em modo estático — não é possível gerar cobrança dinâmica.",
      );
    }

    const valor = Number(data.valor);
    if (!valor || valor <= 0) throw new Error("Valor inválido");

    const ambiente = (cfg.ambiente ?? "sandbox") as string;
    let response: any = null;
    let providerPaymentId: string | null = null;
    let qrImage: string | null = null;
    let copiaCola: string | null = null;
    let invoiceUrl: string | null = null;
    let erroProv: string | null = null;

    try {
      if (provider === "asaas") {
        const baseUrl =
          ambiente === "producao"
            ? "https://api.asaas.com/v3"
            : "https://api-sandbox.asaas.com/v3";
        const accessToken = cfg.access_token as string;
        if (!accessToken) throw new Error("Asaas: access_token ausente");

        // Criar/usar customer mínimo (placeholder — usuário pode evoluir)
        const customerId = cfg.default_customer_id ?? null;
        if (!customerId) {
          throw new Error(
            "Asaas: configure 'default_customer_id' nas integrações para emitir Pix dinâmico.",
          );
        }

        const r = await fetch(`${baseUrl}/payments`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            access_token: accessToken,
          },
          body: JSON.stringify({
            customer: customerId,
            billingType: "PIX",
            value: valor,
            dueDate:
              data.vencimento ?? new Date().toISOString().slice(0, 10),
            description: data.descricao ?? "Cobrança",
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.errors?.[0]?.description ?? "Erro Asaas");
        response = j;
        providerPaymentId = j.id;
        invoiceUrl = j.invoiceUrl;

        const qr = await fetch(
          `${baseUrl}/payments/${j.id}/pixQrCode`,
          { headers: { access_token: accessToken } },
        );
        const qrJson = await qr.json();
        if (qr.ok) {
          qrImage = qrJson.encodedImage
            ? `data:image/png;base64,${qrJson.encodedImage}`
            : null;
          copiaCola = qrJson.payload ?? null;
        }
      } else if (provider === "mercadopago") {
        const accessToken = cfg.access_token as string;
        if (!accessToken) throw new Error("Mercado Pago: access_token ausente");
        const r = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            transaction_amount: valor,
            description: data.descricao ?? "Cobrança",
            payment_method_id: "pix",
            payer: { email: cfg.payer_email ?? "cliente@example.com" },
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.message ?? "Erro Mercado Pago");
        response = j;
        providerPaymentId = String(j.id);
        const tx = j.point_of_interaction?.transaction_data;
        if (tx) {
          qrImage = tx.qr_code_base64
            ? `data:image/png;base64,${tx.qr_code_base64}`
            : null;
          copiaCola = tx.qr_code ?? null;
        }
      } else {
        throw new Error(
          `Provedor '${provider}' ainda não implementado para emissão dinâmica.`,
        );
      }
    } catch (e: any) {
      erroProv = e?.message ?? String(e);
    }

    const { data: row, error: insErr } = await supabase
      .from("pix_cobrancas_geradas")
      .insert({
        owner_id: userId,
        empresa_id: data.empresa_id,
        lancamento_id: data.lancamento_id ?? null,
        cliente_id: data.cliente_id ?? null,
        provider,
        provider_payment_id: providerPaymentId,
        valor,
        vencimento: data.vencimento ?? null,
        status: erroProv ? "failed" : "pending",
        qr_code_image: qrImage,
        copia_cola: copiaCola,
        invoice_url: invoiceUrl,
        payload_response: response ?? { erro: erroProv },
      })
      .select()
      .single();

    if (insErr) throw new Error(insErr.message);
    if (erroProv) throw new Error(erroProv);
    return row;
  });

// ─────────────────────────────────────────────
// Listar logs WhatsApp
// ─────────────────────────────────────────────
export const listarLogsWhatsApp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { empresa_id: string; limit?: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("cobranca_whatsapp_logs")
      .select("*")
      .eq("empresa_id", data.empresa_id)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (error) throw new Error(error.message);
    return rows;
  });
