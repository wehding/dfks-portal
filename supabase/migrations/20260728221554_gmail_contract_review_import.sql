-- Gmail-import til kontraktgennemgang.
-- Mailtabellerne er bevidst kun tilgængelige for service_role. Admin-UI'et
-- læser dem gennem organisationsafgrænsede serverruter.

create table if not exists public.gmail_contract_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  mailbox text not null,
  gmail_message_id text not null,
  gmail_thread_id text,
  internet_message_id text,
  in_reply_to text,
  references_header text,
  subject text,
  from_address text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  received_at timestamptz,
  body_text text,
  input_label_id text not null,
  output_label_applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gmail_contract_messages_mailbox_check
    check (lower(mailbox) = 'bestyrelsen@danskfilmklipperselskab.dk'),
  constraint gmail_contract_messages_mailbox_message_key
    unique (mailbox, gmail_message_id)
);

create index if not exists gmail_contract_messages_org_received_idx
  on public.gmail_contract_messages (org_id, received_at desc);

alter table public.gmail_contract_messages enable row level security;
revoke all on table public.gmail_contract_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.gmail_contract_messages to service_role;

create table if not exists public.gmail_contract_import_state (
  org_id uuid primary key references public.organisations(id) on delete cascade,
  mailbox text not null unique,
  input_label_id text,
  output_label_id text,
  history_id text,
  watch_expiration timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gmail_contract_import_state_mailbox_check
    check (lower(mailbox) = 'bestyrelsen@danskfilmklipperselskab.dk')
);

alter table public.gmail_contract_import_state enable row level security;
revoke all on table public.gmail_contract_import_state from public, anon, authenticated;
grant select, insert, update, delete on table public.gmail_contract_import_state to service_role;

alter table public.contract_reviews
  add column if not exists gmail_contract_message_id uuid
    references public.gmail_contract_messages(id) on delete set null,
  add column if not exists gmail_attachment_id text,
  add column if not exists response_draft_subject text,
  add column if not exists response_draft text,
  add column if not exists response_draft_updated_at timestamptz;

create unique index if not exists contract_reviews_gmail_attachment_key
  on public.contract_reviews (gmail_contract_message_id, gmail_attachment_id)
  where gmail_contract_message_id is not null and gmail_attachment_id is not null;

create index if not exists contract_reviews_gmail_message_idx
  on public.contract_reviews (gmail_contract_message_id)
  where gmail_contract_message_id is not null;

comment on table public.gmail_contract_messages is
  'Serverbeskyttet mailreference for kontraktgennemgange importeret fra bestyrelsens Google Workspace-postkasse.';
comment on table public.gmail_contract_import_state is
  'Serverbeskyttet Gmail watch-, label- og history-tilstand for kontraktimport.';
comment on column public.contract_reviews.response_draft is
  'Lokalt svarudkast. Må kopieres, men kontraktgennemgangsmodulet sender aldrig mail.';
