// Edge Function: asaas-criar-cobranca
// Cria uma cobrança no Asaas a partir de um pagamento interno (pendente).
//
// Fluxo:
//   1) Autentica o usuário via JWT (verify_jwt = true).
//   2) Carrega o pagamento e valida que pertence à empresa do usuário.
//   3) Se ainda não houver, cria customer no Asaas e salva em empresas.asaas_customer_id.
//   4) Cria a cobrança (PIX por padrão) no Asaas.
//   5) Atualiza o pagamento com asaas_payment_id, link da fatura e dados do PIX.
//
// Body (JSON):
//   { pagamento_id: string, billing_type?: "PIX" | "BOLETO" | "CREDIT_CARD" }
//
// Variáveis de ambiente:
//   ASAAS_API_KEY, ASAAS_AMBIENTE? ("sandbox" | "producao"),
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function asaasBaseUrl(): string {
  // Lê config dinâmica depois; default = sandbox
  return "https://sandbox.asaas.com/api/v3";
}

function asaasHeaders() {
  return {
    "Content-Type": "application/json",
    access_token: ASAAS_API_KEY,
    "User-Agent": "GestaoPro/1.0",
  };
}

async function asaasFetch(baseUrl: string, path: string, init: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...asaasHeaders(), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `Asaas ${res.status} ${path}: ${JSON.stringify(data?.errors ?? data ?? {})}`,
    );
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  if (!ASAAS_API_KEY) return json(503, { error: "ASAAS_API_KEY não configurada" });

  // Autenticação do usuário
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "Não autenticado" });
  }
  const jwt = authHeader.slice(7);

  // Cliente com JWT do usuário (para resolver auth.uid)
  const supabaseUser = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return json(401, { error: "Sessão inválida" });
  }
  const userId = userData.user.id;

  // Cliente admin (bypass RLS)
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // Body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  const pagamentoId: string | undefined = body?.pagamento_id;
  const billingType: string = (body?.billing_type ?? "PIX").toUpperCase();
  if (!pagamentoId) return json(400, { error: "pagamento_id é obrigatório" });

  // Carrega config (ambiente) e pagamento + empresa
  const [{ data: cfg }, { data: pagamento }] = await Promise.all([
    supabase.from("config_comercial").select("asaas_ambiente, asaas_enabled").maybeSingle(),
    supabase
      .from("pagamentos")
      .select(
        "id, status, valor, descricao, empresa_id, plano_id, modulo_id, referencia_tipo, asaas_payment_id, asaas_invoice_url, asaas_pix_qrcode, asaas_pix_copia_cola",
      )
      .eq("id", pagamentoId)
      .maybeSingle(),
  ]);

  if (!cfg?.asaas_enabled) {
    return json(503, { error: "Cobrança automática desativada" });
  }
  if (!pagamento) return json(404, { error: "Pagamento não encontrado" });
  if (pagamento.status === "pago") return json(400, { error: "Pagamento já confirmado" });

  const baseUrl =
    cfg?.asaas_ambiente === "producao"
      ? "https://www.asaas.com/api/v3"
      : "https://sandbox.asaas.com/api/v3";

  // Verifica que o usuário pertence à empresa
  const { data: empresa } = await supabase
    .from("empresas")
    .select("id, owner_id, nome, email, telefone, documento, asaas_customer_id")
    .eq("id", pagamento.empresa_id)
    .maybeSingle();

  if (!empresa) return json(404, { error: "Empresa não encontrada" });
  if (empresa.owner_id !== userId) {
    return json(403, { error: "Sem permissão para esta empresa" });
  }

  // Idempotência: se já tem cobrança criada, retorna a existente
  if (pagamento.asaas_payment_id) {
    return json(200, {
      ja_criada: true,
      asaas_payment_id: pagamento.asaas_payment_id,
      invoice_url: pagamento.asaas_invoice_url,
      pix_qrcode: pagamento.asaas_pix_qrcode,
      pix_copia_cola: pagamento.asaas_pix_copia_cola,
    });
  }

  // 1) Garantir customer Asaas
  let customerId = empresa.asaas_customer_id;
  if (!customerId) {
    const cpfCnpj = (empresa.documento ?? "").replace(/\D/g, "");
    if (!cpfCnpj || (cpfCnpj.length !== 11 && cpfCnpj.length !== 14)) {
      return json(400, {
        error: "CNPJ/CPF da empresa é obrigatório para criar cobrança no Asaas",
      });
    }
    try {
      const created = await asaasFetch(baseUrl, "/customers", {
        method: "POST",
        body: JSON.stringify({
          name: empresa.nome,
          cpfCnpj,
          email: empresa.email ?? undefined,
          mobilePhone: empresa.telefone ?? undefined,
          externalReference: `empresa:${empresa.id}`,
        }),
      });
      customerId = created?.id;
      if (!customerId) throw new Error("Customer sem id");
      await supabase
        .from("empresas")
        .update({ asaas_customer_id: customerId })
        .eq("id", empresa.id);
    } catch (e) {
      console.error("[asaas-criar-cobranca] erro ao criar customer:", e);
      return json(502, { error: String(e) });
    }
  }

  // 2) Criar cobrança
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3); // vencimento em 3 dias
  const due = dueDate.toISOString().slice(0, 10);

  let cobranca: any;
  try {
    cobranca = await asaasFetch(baseUrl, "/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType,
        value: Number(pagamento.valor),
        dueDate: due,
        description: pagamento.descricao ?? "Assinatura Gestão Pro",
        externalReference: `gestao-pro:${pagamento.referencia_tipo}:${pagamento.id}`,
      }),
    });
  } catch (e) {
    console.error("[asaas-criar-cobranca] erro ao criar cobrança:", e);
    return json(502, { error: String(e) });
  }

  // 3) Se PIX, buscar QR Code
  let pixQr: string | null = null;
  let pixCopia: string | null = null;
  if (billingType === "PIX") {
    try {
      const pix = await asaasFetch(baseUrl, `/payments/${cobranca.id}/pixQrCode`, {
        method: "GET",
      });
      pixQr = pix?.encodedImage ?? null;
      pixCopia = pix?.payload ?? null;
    } catch (e) {
      console.warn("[asaas-criar-cobranca] PIX QR indisponível:", e);
    }
  }

  // 4) Atualiza pagamento interno
  const { error: updErr } = await supabase
    .from("pagamentos")
    .update({
      asaas_payment_id: cobranca.id,
      asaas_invoice_url: cobranca.invoiceUrl ?? null,
      asaas_pix_qrcode: pixQr,
      asaas_pix_copia_cola: pixCopia,
      asaas_billing_type: billingType,
      data_vencimento: due,
      forma_pagamento: billingType.toLowerCase(),
    })
    .eq("id", pagamento.id);

  if (updErr) {
    console.error("[asaas-criar-cobranca] erro ao salvar dados Asaas:", updErr);
    return json(500, { error: "Falha ao salvar cobrança" });
  }

  return json(200, {
    asaas_payment_id: cobranca.id,
    invoice_url: cobranca.invoiceUrl,
    pix_qrcode: pixQr,
    pix_copia_cola: pixCopia,
    due_date: due,
  });
});
