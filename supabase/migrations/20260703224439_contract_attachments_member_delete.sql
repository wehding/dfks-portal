-- Medlemmer må selv slette egne allonger, men kun indtil admin har behandlet dem
-- (ai_status = 'klar' via allonge-udtræk i /admin/validering). Herefter er det
-- kun admin ("Admins kan administrere bilag"-policyen) der kan slette.
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'contract_attachments'
          and policyname = 'Brugere kan slette egne allonger inden validering'
    ) then
        create policy "Brugere kan slette egne allonger inden validering"
            on contract_attachments for delete
            to authenticated
            using (
                created_by = (select auth.uid())
                and type = 'allonge'
                and (ai_status is null or ai_status <> 'klar')
            );
    end if;
end $$;
