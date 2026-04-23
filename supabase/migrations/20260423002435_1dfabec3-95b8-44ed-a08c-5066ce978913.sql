-- Função updated_at genérica (idempotente)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Enum tipo de modo
DO $$ BEGIN
  CREATE TYPE public.system_mode_tipo AS ENUM ('admin', 'operador');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela de modos
CREATE TABLE IF NOT EXISTS public.system_modes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  nome text NOT NULL,
  descricao text,
  rota_inicial text NOT NULL DEFAULT '/',
  tipo public.system_mode_tipo NOT NULL DEFAULT 'admin',
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  icone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mode_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode_id uuid NOT NULL REFERENCES public.system_modes(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.modulos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mode_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_mode_modules_mode ON public.mode_modules(mode_id);
CREATE INDEX IF NOT EXISTS idx_mode_modules_module ON public.mode_modules(module_id);

DROP TRIGGER IF EXISTS trg_system_modes_updated ON public.system_modes;
CREATE TRIGGER trg_system_modes_updated
  BEFORE UPDATE ON public.system_modes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.system_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mode_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Todos autenticados leem modos ativos" ON public.system_modes;
CREATE POLICY "Todos autenticados leem modos ativos"
  ON public.system_modes FOR SELECT TO authenticated
  USING (ativo = true OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admin gerencia modos" ON public.system_modes;
CREATE POLICY "Super admin gerencia modos"
  ON public.system_modes FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Todos autenticados leem vinculos modo modulo" ON public.mode_modules;
CREATE POLICY "Todos autenticados leem vinculos modo modulo"
  ON public.mode_modules FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Super admin gerencia vinculos modo modulo" ON public.mode_modules;
CREATE POLICY "Super admin gerencia vinculos modo modulo"
  ON public.mode_modules FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

INSERT INTO public.system_modes (chave, nome, descricao, rota_inicial, tipo, ordem, icone)
VALUES
  ('erp', 'ERP', 'Gestão completa: vendas, compras, estoque, financeiro, relatórios e configurações.', '/', 'admin', 1, 'LayoutDashboard'),
  ('pdv', 'PDV', 'Frente de caixa: identificação por PIN, abertura de caixa, vendas no balcão e fechamento.', '/pos', 'operador', 2, 'ShoppingCart')
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_modos_listar()
RETURNS TABLE (
  id uuid, chave text, nome text, descricao text, rota_inicial text,
  tipo public.system_mode_tipo, ativo boolean, ordem integer, icone text, modulos jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 
    sm.id, sm.chave, sm.nome, sm.descricao, sm.rota_inicial,
    sm.tipo, sm.ativo, sm.ordem, sm.icone,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'chave', m.chave, 'nome', m.nome) ORDER BY m.ordem)
      FROM public.mode_modules mm
      JOIN public.modulos m ON m.id = mm.module_id
      WHERE mm.mode_id = sm.id
    ), '[]'::jsonb) AS modulos
  FROM public.system_modes sm
  ORDER BY sm.ordem, sm.nome;
$$;
GRANT EXECUTE ON FUNCTION public.admin_modos_listar() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_modo_upsert(
  _id uuid, _chave text, _nome text, _descricao text, _rota_inicial text,
  _tipo public.system_mode_tipo, _ativo boolean, _ordem integer, _icone text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _out uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas super admin pode gerenciar modos';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.system_modes (chave, nome, descricao, rota_inicial, tipo, ativo, ordem, icone)
    VALUES (_chave, _nome, _descricao, _rota_inicial, _tipo, _ativo, _ordem, _icone)
    RETURNING id INTO _out;
  ELSE
    UPDATE public.system_modes
       SET chave=_chave, nome=_nome, descricao=_descricao, rota_inicial=_rota_inicial,
           tipo=_tipo, ativo=_ativo, ordem=_ordem, icone=_icone, updated_at=now()
     WHERE id=_id
     RETURNING id INTO _out;
  END IF;
  RETURN _out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_modo_upsert(uuid,text,text,text,text,public.system_mode_tipo,boolean,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_modo_deletar(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas super admin pode gerenciar modos';
  END IF;
  DELETE FROM public.system_modes WHERE id = _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_modo_deletar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_modo_set_modulos(_mode_id uuid, _module_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas super admin pode gerenciar modos';
  END IF;
  DELETE FROM public.mode_modules WHERE mode_id = _mode_id;
  IF _module_ids IS NOT NULL AND array_length(_module_ids, 1) > 0 THEN
    INSERT INTO public.mode_modules (mode_id, module_id)
    SELECT _mode_id, unnest(_module_ids)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_modo_set_modulos(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.modos_disponiveis()
RETURNS TABLE (
  id uuid, chave text, nome text, descricao text,
  rota_inicial text, tipo public.system_mode_tipo, icone text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, chave, nome, descricao, rota_inicial, tipo, icone
  FROM public.system_modes
  WHERE ativo = true
  ORDER BY ordem, nome;
$$;
GRANT EXECUTE ON FUNCTION public.modos_disponiveis() TO authenticated;