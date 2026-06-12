-- Udvid contract_reviews med indbakke-felter
-- Kontrakter indsendt af medlemmer til juridisk gennemgang

alter table contract_reviews
  add column if not exists member_id         uuid references auth.users(id),
  add column if not exists file_name         text,
  add column if not exists file_size_bytes   int,
  add column if not exists contract_type     text,   -- ansaettelse | freelance | ukendt
  add column if not exists production_type   text,   -- dokumentar | fiktion | reklame | ...
  add column if not exists distribution_channels text[],
  add column if not exists producer_name     text,
  add column if not exists producer_dfks_id  text,
  add column if not exists producer_dfi_id   text,
  add column if not exists producer_overenskomst_bound boolean,
  add column if not exists focus_areas       text[],
  add column if not exists notes             text,
  add column if not exists status            text not null default 'afventer',  -- afventer | behandling | afsluttet
  add column if not exists assigned_to       uuid references auth.users(id),
  add column if not exists storage_path      text,   -- contract-reviews/{id}/{filename}, null når slettet
  add column if not exists ai_run_at         timestamptz,
  add column if not exists ai_language       text,   -- da | en
  add column if not exists updated_at        timestamptz default now();

-- Index til indbakke-forespørgsler
create index if not exists contract_reviews_status_idx    on contract_reviews (status);
create index if not exists contract_reviews_assigned_idx  on contract_reviews (assigned_to);
create index if not exists contract_reviews_member_idx    on contract_reviews (member_id);

-- RLS: Medlemmer kan kun se egne rækker
alter table contract_reviews enable row level security;

drop policy if exists "members_own_reviews"  on contract_reviews;
drop policy if exists "admins_all_reviews"   on contract_reviews;

create policy "members_own_reviews" on contract_reviews
  for select using (member_id = auth.uid());

create policy "admins_all_reviews" on contract_reviews
  for all using (
    exists (
      select 1 from user_org_roles
      where user_id = auth.uid()
        and role in ('admin', 'org-admin', 'superadmin')
    )
  );

-- Trigger: opdater updated_at automatisk
create or replace function update_contract_reviews_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_contract_reviews_updated_at on contract_reviews;
create trigger trg_contract_reviews_updated_at
  before update on contract_reviews
  for each row execute function update_contract_reviews_updated_at();
