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
  -- Sikkerhedsgrænsen ligger nu ved kaldestedet: funktionen kan kun
  -- eksekveres af service_role (jf. GRANT nedenfor), og
  -- app/api/admin/contracts/validate/route.ts udfører sit eget robuste
  -- admin-tjek (requireAdminApi) FØR den kalder denne RPC. Det interne
  -- current_user_has_org_role()-tjek ville altid fejle ved service-role-
  -- kald (auth.uid() er null uden en bruger-session), så det springes
  -- bevidst over her — ikke fordi tjekket er unødvendigt, men fordi det
  -- allerede er udført på et højere niveau.
  if (select auth.role()) is distinct from 'service_role' then
    if not (
      public.current_user_has_org_role(
        (select org_id from public.contracts where id = p_contract_id),
        array['superadmin','admin','org-admin','jurist']
      )
    ) then
      raise exception 'Kun administratorer kan godkende kontrakter';
    end if;
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

revoke all on function public.admin_validate_contract from public, anon, authenticated;
grant execute on function public.admin_validate_contract to service_role;
