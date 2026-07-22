create or replace function public.upsert_work_for_member(
  p_org_id uuid,
  p_title text,
  p_type text,
  p_year integer default null,
  p_dfi_id text default null,
  p_tmdb_id integer default null,
  p_description text default null,
  p_poster_url text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if p_dfi_id is not null then
    select id into v_id from works where dfi_id = p_dfi_id limit 1;
  end if;
  if v_id is null and p_tmdb_id is not null then
    select id into v_id from works where tmdb_id = p_tmdb_id::text limit 1;
  end if;
  if v_id is null then
    insert into works (org_id, title, type, year, dfi_id, tmdb_id, description, poster_url)
    values (p_org_id, p_title, p_type, p_year, p_dfi_id, p_tmdb_id::text, p_description, p_poster_url)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.upsert_work_for_member(uuid, text, text, integer, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.upsert_work_for_member(uuid, text, text, integer, text, integer, text, text) to service_role;
