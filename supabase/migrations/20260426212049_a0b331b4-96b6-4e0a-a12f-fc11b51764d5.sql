-- Bucket público para logos das empresas
insert into storage.buckets (id, name, public)
values ('empresa-logos', 'empresa-logos', true)
on conflict (id) do nothing;

-- Leitura pública (necessário para exibir em comprovantes/cabeçalhos)
create policy "Logos publicas para leitura"
on storage.objects for select
using (bucket_id = 'empresa-logos');

-- Cada usuário só envia/atualiza/remove dentro da pasta do próprio uid
create policy "Upload de logo da propria empresa"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'empresa-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Atualizar logo da propria empresa"
on storage.objects for update
to authenticated
using (
  bucket_id = 'empresa-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Remover logo da propria empresa"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'empresa-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);