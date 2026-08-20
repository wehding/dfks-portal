-- RPC der sætter app.explicit_contract_validation og opdaterer kontrakt-status i én transaktion.
-- Bruges af admin-valideringsflow for at omgå trigger-guard uden at deaktivere den.

create or replace function public.admin_validate_contract(
  p_contract_id   uuid,
  p_status        text,
  p_employer_id   uuid    default null,
  p_type          text    default null,
  p_overenskomst  text    default null,
  p_rights_holder_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  -- Kun admins må kalde denne funktion
  if not (
    public.current_user_has_org_role(
      (select org_id from public.contracts where id = p_contract_id),
      array['superadmin','admin','org-admin','jurist']
    )
  ) then
    raise exception 'Kun administratorer kan godkende kontrakter';
  end if;

  -- Sæt explicit-flag lokalt i denne transaktion (trigger tjekker dette)
  perform set_config('app.explicit_contract_validation', 'on', true);

  update public.contracts set
    status           = p_status,
    employer_id      = coalesce(p_employer_id,      employer_id),
    type             = coalesce(p_type,              type),
    overenskomst     = case when p_overenskomst is not null then p_overenskomst else overenskomst end,
    rights_holder_id = coalesce(p_rights_holder_id, rights_holder_id)
  where id = p_contract_id;
end;
$$;

grant execute on function public.admin_validate_contract to authenticated;
