-- =========================================================
-- 1. PERMISSÕES POR TERMINAL
-- =========================================================
ALTER TABLE public.terminais
  ADD COLUMN IF NOT EXISTS pode_pdv boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pode_erp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pode_financeiro boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pode_configuracoes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pode_relatorios boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pode_cadastros boolean NOT NULL DEFAULT false;

-- Servidor principal sempre tem acesso total
UPDATE public.terminais
   SET pode_pdv = true,
       pode_erp = true,
       pode_financeiro = true,
       pode_configuracoes = true,
       pode_relatorios = true,
       pode_cadastros = true
 WHERE papel = 'servidor';

-- =========================================================
-- 2. TRAVA: 1 caixa aberto por terminal (não permite duplicar)
-- =========================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_aberto_por_terminal
  ON public.caixas (terminal_id)
  WHERE status = 'aberto' AND terminal_id IS NOT NULL;

-- Também: 1 caixa aberto por operador (já era regra de negócio)
CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_aberto_por_operador
  ON public.caixas (operador_id)
  WHERE status = 'aberto' AND operador_id IS NOT NULL;

-- =========================================================
-- 3. RPC: atualizar permissões de um terminal (super admin / dono)
-- =========================================================
CREATE OR REPLACE FUNCTION public.terminal_atualizar_permissoes(
  _terminal_id uuid,
  _pode_pdv boolean,
  _pode_erp boolean,
  _pode_financeiro boolean,
  _pode_configuracoes boolean,
  _pode_relatorios boolean,
  _pode_cadastros boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.terminais WHERE id = _terminal_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Terminal não encontrado';
  END IF;
  IF v_owner <> auth.uid() AND NOT public.acessa_owner_id(v_owner, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para alterar este terminal';
  END IF;

  UPDATE public.terminais
     SET pode_pdv          = _pode_pdv,
         pode_erp          = _pode_erp,
         pode_financeiro   = _pode_financeiro,
         pode_configuracoes= _pode_configuracoes,
         pode_relatorios   = _pode_relatorios,
         pode_cadastros    = _pode_cadastros,
         updated_at        = now()
   WHERE id = _terminal_id;
END;
$$;

-- =========================================================
-- 4. RPC: testar latência / ping (usado pela tela de status)
-- =========================================================
CREATE OR REPLACE FUNCTION public.terminal_ping()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now();
$$;