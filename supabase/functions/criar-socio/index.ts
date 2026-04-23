// Edge function: cria conta de sócio/admin e vincula à empresa
// Apenas o owner da empresa pode usar esta função
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Payload {
  empresa_id: string;
  nome: string;
  email: string;
  senha: string;
  telefone?: string;
  papel: "admin" | "gerente_operacional";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, erro: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente com o JWT do usuário para identificar quem chamou
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ ok: false, erro: "Sessão inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = userRes.user.id;

    const body: Payload = await req.json();
    const { empresa_id, nome, email, senha, telefone, papel } = body;

    // Validação básica
    if (!empresa_id || !nome?.trim() || !email?.trim() || !senha || !papel) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Campos obrigatórios faltando" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (senha.length < 8) {
      return new Response(
        JSON.stringify({ ok: false, erro: "A senha deve ter ao menos 8 caracteres" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!["admin", "gerente_operacional"].includes(papel)) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Papel inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verifica se quem chamou é o owner da empresa
    const { data: empresa, error: empErr } = await admin
      .from("empresas")
      .select("id, owner_id, nome")
      .eq("id", empresa_id)
      .maybeSingle();
    if (empErr || !empresa) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Empresa não encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (empresa.owner_id !== callerId) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Apenas o proprietário pode adicionar sócios" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cria (ou reutiliza) o usuário no Auth
    const emailNorm = email.trim().toLowerCase();
    let novoUserId: string | null = null;

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: emailNorm,
      password: senha,
      email_confirm: true,
      user_metadata: {
        nome,
        telefone: telefone || null,
      },
    });

    if (createErr) {
      // Se o e-mail já existe, busca o usuário existente
      const msg = createErr.message?.toLowerCase() || "";
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        // Lista usuários para encontrar pelo e-mail
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existing = list?.users?.find((u) => u.email?.toLowerCase() === emailNorm);
        if (!existing) {
          return new Response(
            JSON.stringify({ ok: false, erro: "E-mail já cadastrado, mas não foi possível localizá-lo." }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        novoUserId = existing.id;
      } else {
        return new Response(
          JSON.stringify({ ok: false, erro: createErr.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      novoUserId = created.user!.id;
    }

    // Vincula à empresa (upsert por empresa_id+user_id)
    const { error: insertErr } = await admin
      .from("empresa_membros")
      .upsert(
        {
          empresa_id,
          user_id: novoUserId,
          papel,
          nome,
          email: emailNorm,
          telefone: telefone || null,
          convidado_por: callerId,
        },
        { onConflict: "empresa_id,user_id" },
      );

    if (insertErr) {
      return new Response(
        JSON.stringify({ ok: false, erro: `Erro ao vincular: ${insertErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, user_id: novoUserId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, erro: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
