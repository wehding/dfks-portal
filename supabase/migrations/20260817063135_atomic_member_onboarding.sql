create or replace function public.complete_member_onboarding(
  actor_user_id uuid,
  target_rights_holder_id uuid,
  target_org_id uuid,
  login_email text,
  phone_value text,
  address_value text,
  encrypted_cpr text,
  encrypted_bank_account text,
  gender_value text,
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
  if actor_user_id is null
     or target_rights_holder_id is null
     or target_org_id is null
     or not exists (
       select 1
       from public.rettighedshavere holder
       join public.org_affiliations affiliation
         on affiliation.rights_holder_id = holder.id
        and affiliation.org_id = target_org_id
       where holder.id = target_rights_holder_id
         and holder.user_id = actor_user_id
     ) then
    return false;
  end if;

  update public.rettighedshavere
  set email = login_email,
      phone = nullif(phone_value, ''),
      address = nullif(address_value, ''),
      cpr_no = nullif(encrypted_cpr, ''),
      bank_account = nullif(encrypted_bank_account, ''),
      gender = nullif(gender_value, ''),
      onboarding_completed = true,
      onboarding_completed_at = now(),
      onboarding_required_at = null,
      updated_at = now()
  where id = target_rights_holder_id
    and user_id = actor_user_id;

  if not found then
    return false;
  end if;

  if not private.update_member_statistics_profile(
    target_rights_holder_id,
    target_org_id,
    actor_user_id,
    participates,
    start_year,
    primary_profession_id,
    coalesce(secondary_profession_ids, '{}'::uuid[]),
    work_mode,
    work_region_code
  ) then
    raise exception 'statistics profile rejected';
  end if;

  return true;
end;
$$;

revoke all on function public.complete_member_onboarding(
  uuid, uuid, uuid, text, text, text, text, text, text,
  boolean, integer, uuid, uuid[], text, text
) from public, anon, authenticated;

grant execute on function public.complete_member_onboarding(
  uuid, uuid, uuid, text, text, text, text, text, text,
  boolean, integer, uuid, uuid[], text, text
) to service_role;

comment on function public.complete_member_onboarding(
  uuid, uuid, uuid, text, text, text, text, text, text,
  boolean, integer, uuid, uuid[], text, text
) is 'Atomisk onboardingopdatering. Kun service_role; kontrollerer bruger, profil og organisation før ændringer.';
