alter table public.learned_patterns
  add column if not exists org_id uuid references public.organisations(id) on delete cascade;

create index if not exists learned_patterns_org_created_idx
  on public.learned_patterns (org_id, created_at desc);

drop policy if exists "Indloggede kan se aktive læringsmønstre" on public.learned_patterns;
drop policy if exists "Admins kan oprette læringsmønstre" on public.learned_patterns;
drop policy if exists "Admins kan opdatere læringsmønstre" on public.learned_patterns;
drop policy if exists "Admins kan slette læringsmønstre" on public.learned_patterns;

create policy "Orgroller kan se relevante læringsmønstre"
  on public.learned_patterns for select to authenticated
  using (
    (org_id is null and public.current_user_has_any_role(array['superadmin']))
    or public.current_user_has_org_role(
      org_id,
      array['superadmin','admin','org-admin','jurist']
    )
  );

create policy "Orgroller kan oprette egne læringsmønstre"
  on public.learned_patterns for insert to authenticated
  with check (
    (org_id is null and public.current_user_has_any_role(array['superadmin']))
    or public.current_user_has_org_role(
      org_id,
      array['superadmin','admin','org-admin','jurist']
    )
  );

create policy "Orgroller kan opdatere egne læringsmønstre"
  on public.learned_patterns for update to authenticated
  using (
    (org_id is null and public.current_user_has_any_role(array['superadmin']))
    or public.current_user_has_org_role(
      org_id,
      array['superadmin','admin','org-admin','jurist']
    )
  )
  with check (
    (org_id is null and public.current_user_has_any_role(array['superadmin']))
    or public.current_user_has_org_role(
      org_id,
      array['superadmin','admin','org-admin','jurist']
    )
  );

create policy "Orgroller kan slette egne læringsmønstre"
  on public.learned_patterns for delete to authenticated
  using (
    (org_id is null and public.current_user_has_any_role(array['superadmin']))
    or public.current_user_has_org_role(
      org_id,
      array['superadmin','admin','org-admin','jurist']
    )
  );

drop function if exists public.match_learned_patterns(extensions.vector, double precision, integer);

create function public.match_learned_patterns(
  query_embedding extensions.vector,
  match_threshold double precision,
  match_count integer,
  p_org_id uuid
)
returns table(
  id uuid,
  titel text,
  regel text,
  semantisk_beskrivelse text,
  similaritet double precision
)
language sql
stable
set search_path = ''
as $$
  select pattern.id, pattern.titel, pattern.regel, pattern.semantisk_beskrivelse,
    1 - (pattern.embedding OPERATOR(extensions.<=>) query_embedding) as similaritet
  from public.learned_patterns pattern
  where pattern.aktiv = true
    and (pattern.org_id is null or pattern.org_id = p_org_id)
    and 1 - (pattern.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
  order by pattern.embedding OPERATOR(extensions.<=>) query_embedding
  limit match_count;
$$;

revoke all on function public.match_learned_patterns(extensions.vector, double precision, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.match_learned_patterns(extensions.vector, double precision, integer, uuid)
  to service_role;

alter table public.overenskomst_uploads
  add column if not exists org_id uuid references public.organisations(id) on delete cascade;

create index if not exists overenskomst_uploads_org_created_idx
  on public.overenskomst_uploads (org_id, created_at desc);

drop policy if exists "Admins kan opdatere overenskomstuploads" on public.overenskomst_uploads;
drop policy if exists "Admins kan oprette overenskomstuploads" on public.overenskomst_uploads;
drop policy if exists "Admins kan se overenskomstuploads" on public.overenskomst_uploads;
drop policy if exists "Admins kan slette overenskomstuploads" on public.overenskomst_uploads;

create policy "Orgroller kan se relevante overenskomstuploads"
  on public.overenskomst_uploads for select to authenticated
  using (
    (org_id is null and public.current_user_has_any_role(array['superadmin']))
    or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
  );
create policy "Orgroller kan oprette egne overenskomstuploads"
  on public.overenskomst_uploads for insert to authenticated
  with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));
create policy "Orgroller kan opdatere egne overenskomstuploads"
  on public.overenskomst_uploads for update to authenticated
  using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']))
  with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));
create policy "Orgroller kan slette egne overenskomstuploads"
  on public.overenskomst_uploads for delete to authenticated
  using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));

create function public.delete_contracts_atomic(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 500 then
    raise exception 'invalid contract delete batch';
  end if;
  delete from public.contracts where id = any(p_ids);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_contracts_atomic(uuid[]) from public, anon, authenticated;
grant execute on function public.delete_contracts_atomic(uuid[]) to service_role;

create table if not exists private.api_rate_limits (
  bucket text not null,
  identifier_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (bucket, identifier_hash, window_start)
);

create index if not exists api_rate_limits_window_idx
  on private.api_rate_limits (window_start);

revoke all on table private.api_rate_limits from public, anon, authenticated;

create function public.consume_api_rate_limit(
  p_bucket text,
  p_identifier_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  current_window timestamptz;
  new_count integer;
begin
  if length(p_bucket) not between 1 and 100
     or length(p_identifier_hash) not between 16 and 128
     or p_limit not between 1 and 10000
     or p_window_seconds not between 1 and 604800 then
    raise exception 'invalid rate-limit parameters';
  end if;

  current_window := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into private.api_rate_limits(bucket, identifier_hash, window_start, request_count)
  values (p_bucket, p_identifier_hash, current_window, 1)
  on conflict (bucket, identifier_hash, window_start)
  do update set request_count = private.api_rate_limits.request_count + 1
  returning request_count into new_count;

  return query select
    new_count <= p_limit,
    case when new_count <= p_limit then 0
      else greatest(1, ceil(extract(epoch from (current_window + make_interval(secs => p_window_seconds) - v_now)))::integer)
    end;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer)
  to service_role;
