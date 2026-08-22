alter table public.contract_reviews
  add column if not exists response_draft_to text,
  add column if not exists response_draft_cc text[] not null default '{}',
  add column if not exists response_draft_thread_message_id text,
  add column if not exists response_draft_version integer not null default 0,
  add column if not exists gmail_response_draft_id text,
  add column if not exists gmail_response_draft_message_id text,
  add column if not exists gmail_response_draft_updated_at timestamptz;

alter table public.gmail_contract_messages
  add column if not exists thread_synced_at timestamptz;

create index if not exists gmail_contract_messages_thread_received_idx
  on public.gmail_contract_messages (org_id, mailbox, gmail_thread_id, received_at, id)
  where gmail_thread_id is not null;

comment on column public.contract_reviews.response_draft_to is
  'Valideret modtager til portalens lokale Gmail-svarudkast.';
comment on column public.contract_reviews.response_draft_thread_message_id is
  'Seneste Gmail message-id, som AI-mailforslaget er dannet ud fra.';
comment on column public.contract_reviews.gmail_response_draft_id is
  'Id for kladden i Gmail. Portalen må oprette og opdatere, men aldrig sende kladden.';
comment on column public.gmail_contract_messages.thread_synced_at is
  'Seneste tidspunkt hvor hele den tilhørende Gmail-tråd blev synkroniseret.';

-- Browserroller må fortsat ikke læse eller skrive Gmail-data direkte.
revoke all on table public.gmail_contract_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.gmail_contract_messages to service_role;

-- Ryd lokalt gemt mailindhold og kladdereferencer, når retention eller en
-- eksplicit sletning markerer sagen slettet. Den oprindelige Gmail-tråd ændres
-- aldrig. Trådteksten ryddes først, når ingen aktiv sag længere bruger tråden.
create or replace function private.clear_deleted_contract_review_mail_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_mailbox text;
  v_source_thread text;
begin
  if new.intake_status <> 'deleted' or old.intake_status = 'deleted' then
    return new;
  end if;

  if old.gmail_contract_message_id is not null then
    select mailbox, gmail_thread_id
      into v_source_mailbox, v_source_thread
    from public.gmail_contract_messages
    where id = old.gmail_contract_message_id;
  end if;

  update public.contract_reviews
  set response_draft_subject = null,
      response_draft = null,
      response_draft_to = null,
      response_draft_cc = '{}',
      response_draft_thread_message_id = null,
      gmail_response_draft_id = null,
      gmail_response_draft_message_id = null,
      gmail_response_draft_updated_at = null
  where id = new.id;

  if v_source_thread is not null and not exists (
    select 1
    from public.contract_reviews active_review
    join public.gmail_contract_messages source
      on source.id = active_review.gmail_contract_message_id
    where active_review.intake_status <> 'deleted'
      and source.mailbox = v_source_mailbox
      and source.gmail_thread_id = v_source_thread
  ) then
    update public.gmail_contract_messages
    set body_text = null,
        subject = null,
        from_address = null,
        to_addresses = '{}',
        cc_addresses = '{}',
        updated_at = now()
    where mailbox = v_source_mailbox
      and gmail_thread_id = v_source_thread;
  end if;

  return new;
end;
$$;

drop trigger if exists clear_deleted_contract_review_mail_data
  on public.contract_reviews;
create trigger clear_deleted_contract_review_mail_data
  after update of intake_status on public.contract_reviews
  for each row execute function private.clear_deleted_contract_review_mail_data();

revoke all on function private.clear_deleted_contract_review_mail_data()
  from public, anon, authenticated;
