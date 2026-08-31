-- Hold dashboardets smalle loengrundlag semantisk identisk med
-- salarySupplements() i applikationen: strukturerede efterarbejdstillaeg har
-- forrang, mens det gamle enkeltfelt kun bruges som fallback.
create or replace function public.get_member_salary_facts(
  p_org_id uuid,
  p_include_drafts boolean default false
)
returns table (
  rights_holder_id uuid,
  period_year integer,
  production_type text,
  professional_start_year integer,
  weekly_salary numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with raw as (
    select
      fact.rights_holder_id,
      fact.period_year,
      fact.production_type,
      fact.professional_start_year,
      fact.contract_type,
      lower(btrim(coalesce(fact.extracted_data->>'salaryUnit', ''))) as salary_unit,
      case
        when btrim(coalesce(fact.extracted_data->>'salary', '')) ~ '^[0-9]+([.,][0-9]+)?$'
          then replace(btrim(fact.extracted_data->>'salary'), ',', '.')::numeric
        else null
      end as salary,
      case
        when btrim(coalesce(fact.extracted_data->>'personalSupplement', '')) ~ '^[0-9]+([.,][0-9]+)?$'
          then replace(btrim(fact.extracted_data->>'personalSupplement'), ',', '.')::numeric
        else 0
      end as personal_supplement,
      coalesce(structured.structured_post_production, 0) as structured_post_production,
      case
        when btrim(coalesce(fact.extracted_data->>'postProductionSupplement', '')) ~ '^[0-9]+([.,][0-9]+)?$'
          then replace(btrim(fact.extracted_data->>'postProductionSupplement'), ',', '.')::numeric
        else 0
      end as legacy_post_production
    from analytics.contract_facts fact
    join public.org_affiliations affiliation
      on affiliation.org_id = fact.org_id
     and affiliation.rights_holder_id = fact.rights_holder_id
     and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
     and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
    left join lateral (
      select coalesce(sum(
        case
          when supplement->>'category' = 'efterarbejde'
            and btrim(coalesce(supplement->>'amount', '')) ~ '^[0-9]+([.,][0-9]+)?$'
          then replace(btrim(supplement->>'amount'), ',', '.')::numeric
          else 0
        end
      ), 0) as structured_post_production
      from jsonb_array_elements(
        case
          when jsonb_typeof(fact.extracted_data->'otherSupplements') = 'array'
            then fact.extracted_data->'otherSupplements'
          else '[]'::jsonb
        end
      ) supplement
    ) structured on true
    where fact.org_id = p_org_id
      and fact.statistics_allowed
      and fact.period_year is not null
      and fact.contract_type is distinct from 'leverandør'
      and (fact.contract_status = 'valideret' or p_include_drafts)
  )
  select
    raw.rights_holder_id,
    raw.period_year,
    raw.production_type,
    raw.professional_start_year,
    (
      case
        when raw.salary_unit in ('uge', 'ugeløn', 'week') then raw.salary
        when raw.salary_unit in ('dag', 'dagsløn', 'day') then raw.salary * 5
        when raw.salary_unit in ('måned', 'månedsløn', 'month') then raw.salary * 12 / 52
        else null
      end
      + raw.personal_supplement
      + case
          when raw.structured_post_production > 0 then raw.structured_post_production
          else raw.legacy_post_production
        end
    ) as weekly_salary
  from raw
  where raw.salary > 0;
$$;

revoke all on function public.get_member_salary_facts(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.get_member_salary_facts(uuid, boolean)
  to service_role;
