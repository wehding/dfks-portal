do $$
declare
  dfks_org_id uuid;
  b_klipper_id uuid;
  klipper_id uuid;
begin
  select id into dfks_org_id
  from public.organisations
  where lower(name) = lower('Dansk Filmklipperselskab')
  order by created_at
  limit 1;

  if dfks_org_id is null then
    return;
  end if;

  select id into b_klipper_id from public.profession_types where normalized_name = 'b-klipper';
  select id into klipper_id from public.profession_types where normalized_name = 'klipper';

  if klipper_id is null then
    insert into public.profession_types(name)
    values ('Klipper')
    on conflict (normalized_name) do update set name = excluded.name
    returning id into klipper_id;
  end if;

  insert into public.organisation_profession_types(org_id, profession_type_id, display_order)
  values (dfks_org_id, klipper_id, 0)
  on conflict (org_id, profession_type_id) do nothing;

  -- Bevar alle faggrupper, men gør Klipper til den første synlige mulighed.
  with ordered as (
    select
      relation.profession_type_id,
      row_number() over (
        order by
          case profession.normalized_name
            when 'klipper' then 0
            when 'b-klipper' then 1
            when 'konceptuerende klipper' then 2
            else 3
          end,
          relation.display_order,
          profession.name
      ) - 1 as new_order
    from public.organisation_profession_types relation
    join public.profession_types profession on profession.id = relation.profession_type_id
    where relation.org_id = dfks_org_id
  )
  update public.organisation_profession_types relation
  set display_order = ordered.new_order
  from ordered
  where relation.org_id = dfks_org_id
    and relation.profession_type_id = ordered.profession_type_id;

  update public.organisations organisation
  set terminology = jsonb_set(
    jsonb_set(
      coalesce(organisation.terminology, '{}'::jsonb),
      '{role_labels}',
      coalesce((
        select jsonb_agg(profession.name order by relation.display_order)
        from public.organisation_profession_types relation
        join public.profession_types profession on profession.id = relation.profession_type_id
        where relation.org_id = dfks_org_id
      ), '["Klipper"]'::jsonb),
      true
    ),
    '{default_role_label}',
    '"Klipper"'::jsonb,
    true
  )
  where organisation.id = dfks_org_id;

  -- Undgå konflikt med det unikke indeks før rollen ændres.
  delete from public.work_assignments old_assignment
  where old_assignment.org_id = dfks_org_id
    and lower(trim(old_assignment.role)) = 'b-klipper'
    and exists (
      select 1
      from public.work_assignments klipper_assignment
      where klipper_assignment.work_id = old_assignment.work_id
        and klipper_assignment.rights_holder_id = old_assignment.rights_holder_id
        and lower(trim(klipper_assignment.role)) = 'klipper'
    );

  update public.work_assignments
  set role = 'Klipper'
  where org_id = dfks_org_id
    and lower(trim(role)) = 'b-klipper';

  if b_klipper_id is not null then
    update public.rettighedshavere holder
    set primary_profession_type_id = klipper_id
    where holder.primary_profession_type_id = b_klipper_id
      and exists (
        select 1 from public.org_affiliations affiliation
        where affiliation.org_id = dfks_org_id
          and affiliation.rights_holder_id = holder.id
      );

    delete from public.rights_holder_profession_types old_profession
    where old_profession.profession_type_id = b_klipper_id
      and exists (
        select 1 from public.org_affiliations affiliation
        where affiliation.org_id = dfks_org_id
          and affiliation.rights_holder_id = old_profession.rights_holder_id
      )
      and exists (
        select 1 from public.rights_holder_profession_types klipper_profession
        where klipper_profession.rights_holder_id = old_profession.rights_holder_id
          and klipper_profession.profession_type_id = klipper_id
      );

    update public.rights_holder_profession_types profession
    set profession_type_id = klipper_id
    where profession.profession_type_id = b_klipper_id
      and exists (
        select 1 from public.org_affiliations affiliation
        where affiliation.org_id = dfks_org_id
          and affiliation.rights_holder_id = profession.rights_holder_id
      );
  end if;
end
$$;
