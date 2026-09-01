-- Rettighedshavere har ikke et generelt updated_at-felt. Den juridiske
-- onboardingmarkør er selv tidsstemplet og er derfor den eneste kolonne, der
-- skal opdateres. Funktionen kaldes kun fra den autoriserede serverklient.
create or replace function public.require_legal_onboarding_for_audience(
  target_org_id uuid,
  target_audience text,
  required_at timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer := 0;
begin
  if target_org_id is null or target_audience not in ('member','non_member') then
    raise exception 'Invalid legal onboarding requirement target';
  end if;

  update public.rettighedshavere holder
  set onboarding_required_at = required_at
  where holder.user_id is not null
    and exists (
      select 1
      from public.org_affiliations affiliation
      where affiliation.rights_holder_id = holder.id
        and affiliation.org_id = target_org_id
        and affiliation.is_member = (target_audience = 'member')
    );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.require_legal_onboarding_for_audience(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.require_legal_onboarding_for_audience(uuid, text, timestamptz)
  to service_role;
