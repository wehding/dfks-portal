-- Rows on Producentforeningen's public group pages are members. The source
-- currently has no "Medlemstype" column, which previously stored them as
-- unknown. Explicit associated-member values remain supported by the parser.
update public.employer_producer_types
set membership_type = 'member', updated_at = now()
where source = 'producentforeningen'
  and membership_type = 'unknown';

create or replace function public.delete_unlinked_employers_permanently(
  target_ids uuid[],
  actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_ids uuid[];
  deleted_count integer := 0;
begin
  if actor_id is null or not exists (
    select 1 from public.user_org_roles
    where user_id = actor_id and role = 'superadmin'
  ) then
    raise exception 'Only superadmins can permanently delete producers';
  end if;

  select array_agg(distinct candidate)
  into normalized_ids
  from unnest(coalesce(target_ids, '{}'::uuid[])) candidate;

  if normalized_ids is null or cardinality(normalized_ids) = 0 then
    raise exception 'No producers selected';
  end if;
  if cardinality(normalized_ids) > 25 then
    raise exception 'At most 25 producers can be deleted at once';
  end if;
  if exists (
    select 1 from public.work_employers where employer_id = any(normalized_ids)
    union all
    select 1 from public.contract_employers where employer_id = any(normalized_ids)
    union all
    select 1 from public.works where employer_id = any(normalized_ids)
    union all
    select 1 from public.contracts where employer_id = any(normalized_ids)
    union all
    select 1 from public.employers where merged_into_id = any(normalized_ids)
    union all
    select 1 from public.employer_merge_audit
      where source_employer_id = any(normalized_ids) or target_employer_id = any(normalized_ids)
  ) then
    raise exception 'A selected producer still has linked records';
  end if;

  delete from public.employer_legal_entities where employer_id = any(normalized_ids);
  delete from public.employers
  where id = any(normalized_ids)
    and merged_into_id is null;
  get diagnostics deleted_count = row_count;

  return jsonb_build_object('deleted_count', deleted_count);
end;
$$;

revoke all on function public.delete_unlinked_employers_permanently(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.delete_unlinked_employers_permanently(uuid[], uuid) to service_role;
