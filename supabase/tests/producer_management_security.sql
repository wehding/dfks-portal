begin;
select plan(1);

do $$
declare
  test_org uuid;
  super_user uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  deletable_employer uuid;
  protected_employer uuid;
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at)
  values
    (super_user, 'producer-delete-super@example.invalid', 'authenticated', 'authenticated', now(), now()),
    (admin_user, 'producer-delete-admin@example.invalid', 'authenticated', 'authenticated', now(), now());
  insert into public.organisations (name) values ('Producenttest') returning id into test_org;
  insert into public.user_org_roles (user_id, org_id, role)
  values (super_user, test_org, 'superadmin'), (admin_user, test_org, 'admin');

  insert into public.employers (name) values ('Sletbar testproducent') returning id into deletable_employer;
  perform public.delete_unlinked_employers_permanently(array[deletable_employer], super_user);
  if exists (select 1 from public.employers where id = deletable_employer) then
    raise exception 'Unlinked producer was not deleted';
  end if;

  insert into public.employers (name) values ('Beskyttet testproducent') returning id into protected_employer;
  begin
    perform public.delete_unlinked_employers_permanently(array[protected_employer], admin_user);
    raise exception 'Expected non-superadmin deletion to fail';
  exception when others then
    if sqlerrm = 'Expected non-superadmin deletion to fail' then raise; end if;
  end;
  if not exists (select 1 from public.employers where id = protected_employer) then
    raise exception 'Non-superadmin deleted a producer';
  end if;

  delete from public.employers where id = protected_employer;
  delete from public.user_org_roles where user_id in (super_user, admin_user);
  delete from public.organisations where id = test_org;
  delete from auth.users where id in (super_user, admin_user);
end;
$$;

select pass('Kun superadmin kan slette producenter permanent');
select * from finish();
rollback;
