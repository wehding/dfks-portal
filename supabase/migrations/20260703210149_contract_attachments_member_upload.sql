-- Forbered ai-felter til senere ekstraktion (ikke brugt endnu i dette task)
alter table contract_attachments
  add column if not exists ai_status text default 'analyserer',
  add column if not exists ai_result jsonb;

-- Medlemmer må selv tilføje bilag/allonger til egne kontrakter
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'contract_attachments'
          and policyname = 'Brugere kan tilføje bilag til egne kontrakter'
    ) then
        create policy "Brugere kan tilføje bilag til egne kontrakter"
            on contract_attachments for insert
            to authenticated
            with check (
                created_by = (select auth.uid())
                and exists (
                    select 1 from contracts c
                    join rettighedshavere rh on rh.id = c.rights_holder_id
                    where c.id = contract_attachments.contract_id
                      and rh.user_id = (select auth.uid())
                )
            );
    end if;
end $$;
