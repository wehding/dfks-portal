-- analytics forbliver et privat schema. Disse to snævre funktioner er den
-- eneste Data API-adgang til forbrugerprisindekset og kan kun kaldes af den
-- serverbeskyttede service_role.
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
