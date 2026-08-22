create or replace function public.get_admin_work_archive_stats(p_org_id uuid)
returns table (
  total bigint,
  with_contract bigint,
  missing_contract bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with work_scope as (
    select work.id
    from public.works work
    where work.org_id = p_org_id
  ),
  contracted as (
    select distinct contract.work_id
    from public.contracts contract
    join work_scope on work_scope.id = contract.work_id
    where contract.org_id = p_org_id
      and contract.work_id is not null
      and contract.superseded_by_contract_id is null
  )
  select
    (select count(*) from work_scope),
    (select count(*) from contracted),
    (select count(*) from work_scope) - (select count(*) from contracted);
$$;

revoke all on function public.get_admin_work_archive_stats(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_work_archive_stats(uuid) to service_role;
