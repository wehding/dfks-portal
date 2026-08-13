-- Finalise the database deletion before removing the storage object. This
-- closes the legal-hold race: a review is checked and soft-deleted under one
-- row lock, while the private deletion certificate retains the storage path
-- until the object deletion has succeeded.

alter table private.contract_review_deletion_certificates
  add column if not exists storage_path text,
  add column if not exists storage_deleted_at timestamptz,
  add column if not exists storage_delete_error text,
  add column if not exists storage_delete_attempted_at timestamptz;

create or replace function private.finalize_contract_review_deletion(
  target_review_id uuid,
  actor_id uuid,
  deletion_origin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_row public.contract_reviews%rowtype;
  retention integer;
begin
  select * into review_row
  from public.contract_reviews
  where id = target_review_id
  for update;

  if not found
    or review_row.legal_hold
    or review_row.completed_at is null
    or review_row.intake_status = 'deleted'
  then
    return false;
  end if;

  select contract_review_retention_months into retention
  from public.organisations
  where id = review_row.org_id;

  if review_row.completed_at + make_interval(months => retention) > now() then
    return false;
  end if;

  insert into private.contract_review_deletion_certificates(
    review_hash,
    org_id,
    retention_months,
    deleted_by,
    deletion_source,
    storage_path
  )
  values (
    encode(extensions.digest(review_row.id::text, 'sha256'), 'hex'),
    review_row.org_id,
    retention,
    actor_id,
    deletion_origin,
    review_row.storage_path
  )
  on conflict (review_hash) do update
    set storage_path = coalesce(
      private.contract_review_deletion_certificates.storage_path,
      excluded.storage_path
    );

  update public.contract_reviews
  set storage_path = null,
      ai_result = null,
      compliance_extract = null,
      notes = null,
      member_email = null,
      member_name = null,
      soft_deleted_at = coalesce(soft_deleted_at, now()),
      intake_status = 'deleted',
      updated_at = now()
  where id = target_review_id;

  return true;
end;
$$;

revoke all on function private.finalize_contract_review_deletion(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.finalize_contract_review_deletion(uuid, uuid, text)
  to service_role;

create or replace function private.pending_contract_review_storage_deletions(batch_size integer default 100)
returns table(certificate_id uuid, storage_path text)
language sql
security definer
set search_path = ''
as $$
  select certificate.id, certificate.storage_path
  from private.contract_review_deletion_certificates certificate
  where certificate.storage_path is not null
    and certificate.storage_deleted_at is null
  order by certificate.deleted_at asc
  limit greatest(1, least(coalesce(batch_size, 100), 500));
$$;

revoke all on function private.pending_contract_review_storage_deletions(integer)
  from public, anon, authenticated;
grant execute on function private.pending_contract_review_storage_deletions(integer)
  to service_role;

create or replace function private.complete_contract_review_storage_deletion(
  target_certificate_id uuid,
  deletion_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.contract_review_deletion_certificates
  set storage_delete_attempted_at = now(),
      storage_deleted_at = case when deletion_error is null then now() else storage_deleted_at end,
      storage_delete_error = case
        when deletion_error is null then null
        else left(deletion_error, 500)
      end
  where id = target_certificate_id;
  return found;
end;
$$;

revoke all on function private.complete_contract_review_storage_deletion(uuid, text)
  from public, anon, authenticated;
grant execute on function private.complete_contract_review_storage_deletion(uuid, text)
  to service_role;

create or replace function public.pending_contract_review_storage_deletions(batch_size integer default 100)
returns table(certificate_id uuid, storage_path text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.pending_contract_review_storage_deletions(batch_size);
$$;

revoke all on function public.pending_contract_review_storage_deletions(integer)
  from public, anon, authenticated;
grant execute on function public.pending_contract_review_storage_deletions(integer)
  to service_role;

create or replace function public.complete_contract_review_storage_deletion(
  target_certificate_id uuid,
  deletion_error text default null
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.complete_contract_review_storage_deletion(target_certificate_id, deletion_error);
$$;

revoke all on function public.complete_contract_review_storage_deletion(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_contract_review_storage_deletion(uuid, text)
  to service_role;

create or replace function private.delete_contract_review_immediately(
  target_review_id uuid,
  target_org_id uuid,
  actor_id uuid,
  deletion_origin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_row public.contract_reviews%rowtype;
  retention integer;
begin
  select * into review_row
  from public.contract_reviews
  where id = target_review_id and org_id = target_org_id
  for update;

  if not found or review_row.legal_hold or review_row.intake_status = 'deleted' then
    return false;
  end if;

  select contract_review_retention_months into retention
  from public.organisations
  where id = review_row.org_id;

  insert into private.contract_review_deletion_certificates(
    review_hash,
    org_id,
    retention_months,
    deleted_by,
    deletion_source,
    storage_path
  )
  values (
    encode(extensions.digest(review_row.id::text, 'sha256'), 'hex'),
    review_row.org_id,
    retention,
    actor_id,
    deletion_origin,
    review_row.storage_path
  )
  on conflict (review_hash) do update
    set storage_path = coalesce(
      private.contract_review_deletion_certificates.storage_path,
      excluded.storage_path
    );

  update public.contract_reviews
  set storage_path = null,
      ai_result = null,
      compliance_extract = null,
      notes = null,
      member_email = null,
      member_name = null,
      soft_deleted_at = coalesce(soft_deleted_at, now()),
      intake_status = 'deleted',
      updated_at = now()
  where id = review_row.id and org_id = review_row.org_id;

  return true;
end;
$$;

revoke all on function private.delete_contract_review_immediately(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.delete_contract_review_immediately(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.delete_contract_review_immediately(
  target_review_id uuid,
  target_org_id uuid,
  actor_id uuid,
  deletion_origin text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.delete_contract_review_immediately(
    target_review_id,
    target_org_id,
    actor_id,
    deletion_origin
  );
$$;

revoke all on function public.delete_contract_review_immediately(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.delete_contract_review_immediately(uuid, uuid, uuid, text)
  to service_role;
