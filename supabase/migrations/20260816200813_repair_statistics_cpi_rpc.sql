-- Idempotent repair migration. Production was observed without these RPCs even
-- though the original migration exists in source control. The analytics schema
-- remains private; only service_role can read or update the aggregate CPI data.
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to service_role;

create table if not exists analytics.cpi_monthly (
  period_month date primary key,
  index_value numeric not null check (index_value > 0),
  source text not null default 'Danmarks Statistik PRIS01',
  source_updated_at timestamptz,
  synced_at timestamptz not null default now()
);
revoke all on analytics.cpi_monthly from public, anon, authenticated;
grant all on analytics.cpi_monthly to service_role;

create or replace function public.get_statistics_annual_cpi()
returns table(year integer, index_value numeric, latest_period date)
language sql
stable
security definer
set search_path = ''
as $$
  select
    extract(year from cpi.period_month)::integer as year,
    round(avg(cpi.index_value), 2) as index_value,
    max(cpi.period_month) as latest_period
  from analytics.cpi_monthly cpi
  group by extract(year from cpi.period_month)::integer
  order by year;
$$;

revoke all on function public.get_statistics_annual_cpi() from public, anon, authenticated;
grant execute on function public.get_statistics_annual_cpi() to service_role;

create or replace function public.upsert_statistics_cpi(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  insert into analytics.cpi_monthly (
    period_month,
    index_value,
    source,
    source_updated_at,
    synced_at
  )
  select
    row_data.period_month,
    row_data.index_value,
    'Danmarks Statistik PRIS01',
    coalesce(row_data.source_updated_at, now()),
    now()
  from jsonb_to_recordset(p_rows) as row_data(
    period_month date,
    index_value numeric,
    source_updated_at timestamptz
  )
  where row_data.period_month is not null
    and extract(day from row_data.period_month) = 1
    and row_data.index_value > 0
  on conflict (period_month) do update
  set index_value = excluded.index_value,
      source = excluded.source,
      source_updated_at = excluded.source_updated_at,
      synced_at = excluded.synced_at;

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

revoke all on function public.upsert_statistics_cpi(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_statistics_cpi(jsonb) to service_role;

comment on function public.get_statistics_annual_cpi() is
  'Service-role-only annual CPI aggregate from the private analytics schema.';
comment on function public.upsert_statistics_cpi(jsonb) is
  'Service-role-only validated PRIS01 upsert into the private analytics schema.';

-- Repair an older statistics profile function that referenced a non-existent
-- rettighedshavere.updated_at column. The operation remains atomic and
-- service-role-only; no profile fields or consent are exposed to the browser.
create or replace function private.update_member_statistics_profile(
  target_rights_holder_id uuid,
  target_org_id uuid,
  actor_user_id uuid,
  participates boolean,
  start_year integer,
  primary_profession_id uuid,
  secondary_profession_ids uuid[],
  work_mode text,
  work_region_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.org_affiliations
    where org_id = target_org_id and rights_holder_id = target_rights_holder_id
  ) then
    return false;
  end if;

  if primary_profession_id is not null and not exists (
    select 1 from public.organisation_profession_types
    where org_id = target_org_id and profession_type_id = primary_profession_id
  ) then
    return false;
  end if;

  if exists (
    select 1
    from unnest(coalesce(secondary_profession_ids, '{}'::uuid[])) profession_id
    where not exists (
      select 1 from public.organisation_profession_types
      where org_id = target_org_id and profession_type_id = profession_id
    )
  ) then
    return false;
  end if;

  if work_region_code is not null and not exists (
    select 1 from public.organisation_work_regions
    where org_id = target_org_id and code = work_region_code and active
  ) then
    return false;
  end if;

  update public.rettighedshavere
  set opt_out_statistics = not participates,
      professional_start_year = start_year,
      primary_profession_type_id = primary_profession_id,
      usual_work_mode = work_mode,
      primary_work_region_code = work_region_code
  where id = target_rights_holder_id;
  if not found then return false; end if;

  update public.org_affiliations
  set statistics_participation = participates,
      statistics_participation_source = 'profile_choice',
      statistics_participation_updated_at = now(),
      statistics_participation_updated_by = actor_user_id
  where org_id = target_org_id and rights_holder_id = target_rights_holder_id;

  delete from public.rights_holder_profession_types
  where rights_holder_id = target_rights_holder_id;

  insert into public.rights_holder_profession_types(rights_holder_id, profession_type_id)
  select target_rights_holder_id, profession_id
  from (
    select distinct unnest(coalesce(secondary_profession_ids, '{}'::uuid[])) profession_id
  ) selected
  where profession_id is distinct from primary_profession_id;

  return true;
end;
$$;

revoke all on function private.update_member_statistics_profile(uuid, uuid, uuid, boolean, integer, uuid, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function private.update_member_statistics_profile(uuid, uuid, uuid, boolean, integer, uuid, uuid[], text, text)
  to service_role;
