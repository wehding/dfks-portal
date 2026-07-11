-- Tilføj ai_mined_data til contracts (pdf_url og created_at eksisterer allerede)
alter table contracts
    add column if not exists ai_mined_data jsonb;

-- RLS: members kan se og oprette egne kontrakter
create policy "Member kan se egne kontrakter"
    on contracts for select
    to authenticated
    using (
        rights_holder_id in (
            select id from rettighedshavere where user_id = auth.uid()
        )
    );

create policy "Member kan oprette egne kontrakter"
    on contracts for insert
    to authenticated
    with check (
        rights_holder_id in (
            select id from rettighedshavere where user_id = auth.uid()
        )
    );

create policy "Member kan opdatere egne kontrakter"
    on contracts for update
    to authenticated
    using (
        rights_holder_id in (
            select id from rettighedshavere where user_id = auth.uid()
        )
    );
