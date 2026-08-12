create or replace function private.guard_contract_validation_transition()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if new.status = 'valideret'
     and (tg_op = 'INSERT' or old.status is distinct from 'valideret')
     and coalesce(current_setting('app.explicit_contract_validation', true), '') <> 'on' then
    raise exception 'Kontrakter skal valideres gennem den eksplicitte adminhandling';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_contract_validation_transition on public.contracts;
create trigger guard_contract_validation_transition
before insert or update of status on public.contracts
for each row execute function private.guard_contract_validation_transition();
