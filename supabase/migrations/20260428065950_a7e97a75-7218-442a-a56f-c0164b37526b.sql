ALTER TABLE public.empresa_assinaturas REPLICA IDENTITY FULL;
ALTER TABLE public.empresa_modulos REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.empresa_assinaturas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.empresa_modulos;