import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type JsonRecord = Record<string, unknown>;

type AsaasPayment = {
  id?: string;
  invoiceUrl?: string | null;
  dueDate?: string | null;
};

type AsaasPixQrCode = {
  encodedImage?: string | null;
  payload?: string | null;
  expirationDate?: string | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function maskedPayload(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string" || !body) return body ?? null;
  try {
    const parsed = JSON.parse(body) as JsonRecord;
    const masked = { ...parsed };
    for (const field of ["cpfCnpj", "email", "mobilePhone", "phone"]) {
      if (typeof masked[field] === "string" && masked[field]) {
        const value = masked[field] as string;
        masked[field] = `${value.slice(0, 2)}***${value.slice(-2)}`;
      }
    }
    return masked;
  } catch {
    return "[payload nÃ£o JSON mascarado]";
  }
}

function tomorrowPlusDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function asaasRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const endpoint = `${baseUrl}${path}`;
  const safePayload = maskedPayload(init.body);
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: ASAAS_API_KEY,
      "User-Agent": "GestaoPro/1.2.0",
      ...(init.headers ?? {}),
    },
  });

  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { message: raw };
  }

  if (!response.ok) {
    console.error("[asaas-criar-cobranca] erro HTTP do Asaas", {
      status: response.status,
      endpoint,
      payload: safePayload,
      body: raw,
    });
    throw new Error(`Asaas respondeu ${response.status}: ${raw || "corpo vazio"}`);
  }

  return data as T;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { error: "MÃ©todo nÃ£o permitido" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { error: "ConfiguraÃ§Ã£o do Supabase indisponÃ­vel" });
  }
  if (!ASAAS_API_KEY) {
    return json(503, { error: "ASAAS_API_KEY nÃ£o configurada" });
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json(401, { error: "NÃ£o autenticado" });
  }

  const jwt = authorization.slice("Bearer ".length);
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return json(401, { error: "SessÃ£o invÃ¡lida" });
  }

  let body: JsonRecord;
  try {
    body = (await request.json()) as JsonRecord;
  } catch {
    return json(400, { error: "JSON invÃ¡lido" });
  }

  const pagamentoId =
    typeof body.pagamento_id === "string" ? body.pagamento_id.trim() : "";
  if (!pagamentoId) {
    return json(400, { error: "pagamento_id Ã© obrigatÃ³rio" });
  }

  const [{ data: config, error: configError }, { data: pagamento, error: pagamentoError }] =
    await Promise.all([
      admin
        .from("config_comercial")
        .select("asaas_enabled, asaas_ambiente")
        .maybeSingle(),
      admin
        .from("pagamentos")
        .select(
          "id, empresa_id, status, valor, descricao, referencia_tipo, data_vencimento, asaas_payment_id, asaas_invoice_url, asaas_pix_qrcode, asaas_pix_copia_cola",
        )
        .eq("id", pagamentoId)
        .maybeSingle(),
    ]);

  if (configError) {
    console.error("[asaas-criar-cobranca] config_comercial:", configError);
    return json(500, { error: "NÃ£o foi possÃ­vel carregar a configuraÃ§Ã£o comercial" });
  }
  if (!config?.asaas_enabled) {
    return json(503, { error: "CobranÃ§a automÃ¡tica desativada" });
  }
  if (pagamentoError) {
    console.error("[asaas-criar-cobranca] pagamento:", pagamentoError);
    return json(500, { error: "NÃ£o foi possÃ­vel carregar o pagamento" });
  }
  if (!pagamento) {
    return json(404, { error: "Pagamento nÃ£o encontrado" });
  }
  if (pagamento.status === "pago") {
    return json(409, { error: "Pagamento jÃ¡ confirmado" });
  }

  const { data: empresa, error: empresaError } = await admin
    .from("empresas")
    .select("id, owner_id, nome, email, telefone, documento, asaas_customer_id")
    .eq("id", pagamento.empresa_id)
    .maybeSingle();

  if (empresaError) {
    console.error("[asaas-criar-cobranca] empresa:", empresaError);
    return json(500, { error: "NÃ£o foi possÃ­vel carregar a empresa" });
  }
  if (!empresa) {
    return json(404, { error: "Empresa nÃ£o encontrada" });
  }

  let autorizado = empresa.owner_id === userData.user.id;
  if (!autorizado) {
    const { data: membro, error: membroError } = await admin
      .from("empresa_membros")
      .select("empresa_id")
      .eq("empresa_id", empresa.id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (membroError) {
      console.error("[asaas-criar-cobranca] empresa_membros:", membroError);
      return json(500, { error: "NÃ£o foi possÃ­vel validar o acesso Ã  empresa" });
    }
    autorizado = Boolean(membro);
  }
  if (!autorizado) {
    return json(403, { error: "Sem permissÃ£o para esta empresa" });
  }

  const baseUrl =
    config.asaas_ambiente === "producao"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";

  const formatResult = (
    asaasPaymentId: string,
    invoiceUrl: string | null,
    pix: AsaasPixQrCode,
    dueDate: string | null,
    reused: boolean,
  ) => ({
    asaas_payment_id: asaasPaymentId,
    invoiceUrl,
    pix_copia_cola: pix.payload ?? null,
    qr_code: pix.encodedImage ?? null,
    vencimento: pix.expirationDate ?? dueDate,
    reutilizada: reused,
  });

  // Se a cobranÃ§a jÃ¡ foi criada, recupera novamente o QR Code quando necessÃ¡rio.
  if (pagamento.asaas_payment_id) {
    try {
      let pix: AsaasPixQrCode = {
        encodedImage: pagamento.asaas_pix_qrcode,
        payload: pagamento.asaas_pix_copia_cola,
      };
      if (!pix.encodedImage || !pix.payload) {
        pix = await asaasRequest<AsaasPixQrCode>(
          baseUrl,
          `/payments/${encodeURIComponent(pagamento.asaas_payment_id)}/pixQrCode`,
          { method: "GET" },
        );
        const { error: updatePixError } = await admin
          .from("pagamentos")
          .update({
            asaas_pix_qrcode: pix.encodedImage ?? null,
            asaas_pix_copia_cola: pix.payload ?? null,
          })
          .eq("id", pagamento.id)
          .eq("asaas_payment_id", pagamento.asaas_payment_id);
        if (updatePixError) throw updatePixError;
      }

      return json(
        200,
        formatResult(
          pagamento.asaas_payment_id,
          pagamento.asaas_invoice_url,
          pix,
          pagamento.data_vencimento,
          true,
        ),
      );
    } catch (error) {
      console.error("[asaas-criar-cobranca] recuperar PIX:", error);
      return json(502, { error: "NÃ£o foi possÃ­vel recuperar os dados do Pix" });
    }
  }

  const valor = Number(pagamento.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return json(400, { error: "Valor do pagamento invÃ¡lido" });
  }

  const { data: configuracaoEmpresa, error: configuracaoEmpresaError } =
    await admin
      .from("configuracoes_empresa")
      .select("razao_social, nome_fantasia, cnpj, email, telefone")
      .eq("owner_id", empresa.owner_id)
      .maybeSingle();
  if (configuracaoEmpresaError) {
    console.error(
      "[asaas-criar-cobranca] configuracoes_empresa:",
      configuracaoEmpresaError,
    );
    return json(500, { error: "NÃ£o foi possÃ­vel carregar os dados fiscais" });
  }

  let customerId = empresa.asaas_customer_id as string | null;
  try {
    if (!customerId) {
      const cpfCnpj = String(
        configuracaoEmpresa?.cnpj ?? empresa.documento ?? "",
      ).replace(/\D/g, "");
      if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
        return json(400, {
          error:
            "Cadastre um CPF ou CNPJ vÃ¡lido em ConfiguraÃ§Ãµes > Empresa antes de gerar o Pix",
        });
      }

      const customer = await asaasRequest<{ id?: string }>(
        baseUrl,
        "/customers",
        {
          method: "POST",
          body: JSON.stringify({
            name:
              configuracaoEmpresa?.razao_social ||
              configuracaoEmpresa?.nome_fantasia ||
              empresa.nome,
            cpfCnpj,
            email: configuracaoEmpresa?.email ?? empresa.email ?? undefined,
            mobilePhone:
              configuracaoEmpresa?.telefone ?? empresa.telefone ?? undefined,
            externalReference: `gestaopro|empresa|${empresa.id}`,
          }),
        },
      );
      if (!customer.id) throw new Error("Asaas nÃ£o retornou o ID do cliente");
      customerId = customer.id;

      const { error: customerUpdateError } = await admin
        .from("empresas")
        .update({ asaas_customer_id: customerId })
        .eq("id", empresa.id)
        .is("asaas_customer_id", null);
      if (customerUpdateError) throw customerUpdateError;
    }

    const dueDate = tomorrowPlusDays(3);
    const externalReference = `gestaopro|pagamento|${pagamento.id}`;
    const payment = await asaasRequest<AsaasPayment>(baseUrl, "/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: "PIX",
        value: valor,
        dueDate,
        description: pagamento.descricao || "Assinatura GestÃ£o Pro",
        externalReference,
      }),
    });
    if (!payment.id) throw new Error("Asaas nÃ£o retornou o ID da cobranÃ§a");

    // Persiste primeiro o ID externo para que uma repetiÃ§Ã£o nÃ£o crie outra cobranÃ§a.
    const { error: paymentUpdateError } = await admin
      .from("pagamentos")
      .update({
        asaas_payment_id: payment.id,
        asaas_invoice_url: payment.invoiceUrl ?? null,
        asaas_billing_type: "PIX",
        external_reference: externalReference,
        data_vencimento: payment.dueDate ?? dueDate,
        forma_pagamento: "pix",
      })
      .eq("id", pagamento.id)
      .is("asaas_payment_id", null);
    if (paymentUpdateError) throw paymentUpdateError;

    const pix = await asaasRequest<AsaasPixQrCode>(
      baseUrl,
      `/payments/${encodeURIComponent(payment.id)}/pixQrCode`,
      { method: "GET" },
    );
    if (!pix.payload || !pix.encodedImage) {
      throw new Error("Asaas nÃ£o retornou o cÃ³digo Pix completo");
    }

    const { error: pixUpdateError } = await admin
      .from("pagamentos")
      .update({
        asaas_pix_qrcode: pix.encodedImage,
        asaas_pix_copia_cola: pix.payload,
      })
      .eq("id", pagamento.id)
      .eq("asaas_payment_id", payment.id);
    if (pixUpdateError) throw pixUpdateError;

    return json(
      200,
      formatResult(
        payment.id,
        payment.invoiceUrl ?? null,
        pix,
        payment.dueDate ?? dueDate,
        false,
      ),
    );
  } catch (error) {
    console.error("[asaas-criar-cobranca] falha:", error);
    return json(502, {
      error: errorMessage(error),
    });
  }
});

