alter table public.contracts
  add column if not exists archive_received_at date;

comment on column public.contracts.archive_received_at is
  'Dato hvor den historiske kontrakt blev modtaget i DFKS-arkivet. Ikke kontraktens underskriftsdato.';
