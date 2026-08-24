begin;
select plan(7);

select has_column('public', 'contract_reviews', 'response_draft_to', 'Til-feltet findes på kontraktgennemgangen');
select has_column('public', 'contract_reviews', 'gmail_response_draft_id', 'Gmail draft-id findes på kontraktgennemgangen');
select has_column('public', 'gmail_contract_messages', 'thread_synced_at', 'trådsynkroniseringstidspunktet findes');
select ok(
  not has_table_privilege('anon', 'public.gmail_contract_messages', 'SELECT')
  and not has_table_privilege('authenticated', 'public.gmail_contract_messages', 'SELECT')
  and not has_table_privilege('authenticated', 'public.gmail_contract_messages', 'UPDATE'),
  'browserroller har ingen direkte adgang til Gmail-tråddata'
);

do $$
declare
  test_org uuid := gen_random_uuid();
  source_id uuid;
  review_id uuid;
begin
  insert into public.organisations(id, name) values (test_org, 'Gmail retention test');
  insert into public.gmail_contract_messages(org_id, mailbox, gmail_message_id, gmail_thread_id, body_text, subject, input_label_id)
  values (test_org, 'bestyrelsen@danskfilmklipperselskab.dk', 'message-retention', 'thread-retention', 'fortrolig tekst', 'fortroligt emne', 'Label_1')
  returning id into source_id;
  insert into public.contract_reviews(org_id, gmail_contract_message_id, intake_status, response_draft, response_draft_to, gmail_response_draft_id)
  values (test_org, source_id, 'complete', 'lokalt udkast', 'medlem@example.dk', 'draft-1')
  returning id into review_id;
  update public.contract_reviews set intake_status = 'deleted' where id = review_id;
  if exists (
    select 1 from public.contract_reviews
    where id = review_id and (response_draft is not null or response_draft_to is not null or gmail_response_draft_id is not null)
  ) or exists (
    select 1 from public.gmail_contract_messages where id = source_id and (body_text is not null or subject is not null)
  ) then
    raise exception 'Retention ryddede ikke lokalt mailindhold og kladdereferencer';
  end if;
end $$;
select pass('retention rydder lokalt mailindhold uden et Gmail-API-kald');
select ok(
  has_table_privilege('service_role', 'public.gmail_contract_messages', 'SELECT')
  and has_table_privilege('service_role', 'public.gmail_contract_messages', 'UPDATE'),
  'kun serverrollen kan synkronisere Gmail-tråde'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'clear_deleted_contract_review_mail_data'
      and tgrelid = 'public.contract_reviews'::regclass
      and not tgisinternal
  ),
  'retention har en databasehåndhævet oprydning af maildata'
);

select * from finish();
rollback;
