-- Execute no SQL Editor do Supabase APÓS revisar os nomes das tabelas.
-- Nenhuma chave service_role deve aparecer no navegador.

alter table public.reparos add column if not exists user_id uuid references auth.users(id) default auth.uid();
alter table public.reparos alter column bd type text;
alter table public.reparos add constraint reparos_bd_formato check (bd ~ '^[0-9]{5,20}$') not valid;
alter table public.reparos add constraint reparos_bd_unico unique (bd);

alter table public.reparos enable row level security;
alter table public.reparos force row level security;
drop policy if exists "reparos por usuario" on public.reparos;
drop policy if exists "reparos leitura por usuario" on public.reparos;
drop policy if exists "reparos insercao por usuario" on public.reparos;
drop policy if exists "reparos atualizacao por usuario" on public.reparos;
drop policy if exists "reparos exclusao por usuario" on public.reparos;
create policy "reparos leitura por usuario" on public.reparos
  for select to authenticated using (user_id = auth.uid());
create policy "reparos insercao por usuario" on public.reparos
  for insert to authenticated with check (user_id = auth.uid());
create policy "reparos atualizacao por usuario" on public.reparos
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reparos exclusao por usuario" on public.reparos
  for delete to authenticated using (user_id = auth.uid());

alter table public.reparos_historico add column if not exists user_id uuid references auth.users(id) default auth.uid();
alter table public.reparos_historico enable row level security;
alter table public.reparos_historico force row level security;
drop policy if exists "historico por usuario" on public.reparos_historico;
drop policy if exists "historico leitura por usuario" on public.reparos_historico;
drop policy if exists "historico insercao por usuario" on public.reparos_historico;
drop policy if exists "historico atualizacao por usuario" on public.reparos_historico;
drop policy if exists "historico exclusao por usuario" on public.reparos_historico;
create policy "historico leitura por usuario" on public.reparos_historico
  for select to authenticated
  using (user_id = auth.uid())
;
create policy "historico insercao por usuario" on public.reparos_historico
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.reparos r where r.id = reparo_id and r.user_id = auth.uid())
  );

-- Não há policies de update/delete de histórico: eventos de auditoria não devem ser editados pelo cliente.

-- Dados antigos com user_id nulo permanecem inacessíveis até serem atribuídos
-- a uma conta administradora de forma controlada.
