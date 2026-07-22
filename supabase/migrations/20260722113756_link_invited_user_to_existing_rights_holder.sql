create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matching_holder_id uuid;
  matching_holder_count integer;
begin
  -- Stabskonti skal ikke automatisk oprette en rettighedshaverprofil.
  -- Feltet giver ingen rettigheder og bruges kun til at undgå en uvedkommende profil.
  if coalesce(new.raw_user_meta_data ->> 'profile_mode', '') = 'staff' then
    return new;
  end if;

  -- Et medlem kan allerede være importeret før portalinvitationen. Link kun
  -- automatisk, når e-mailen identificerer præcis én ledig rettighedshaver.
  select min(id), count(*)::integer
    into matching_holder_id, matching_holder_count
  from public.rettighedshavere
  where user_id is null
    and new.email is not null
    and lower(trim(email)) = lower(trim(new.email));

  if matching_holder_count = 1 then
    update public.rettighedshavere
    set user_id = new.id
    where id = matching_holder_id
      and user_id is null;
    return new;
  end if;

  insert into public.rettighedshavere (user_id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  );
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Genbruger en entydig importeret rettighedshaver ved Auth-oprettelse og undgår profiler for stabskonti.';
