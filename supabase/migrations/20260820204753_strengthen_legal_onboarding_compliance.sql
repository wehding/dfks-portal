alter table public.legal_document_acceptances
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_document_version_id uuid
    references public.legal_document_versions(id) on delete set null;

create index if not exists legal_document_acceptances_active_idx
  on public.legal_document_acceptances(org_id, rights_holder_id, document_type, audience)
  where superseded_at is null;

comment on column public.legal_document_acceptances.superseded_at is
  'Set when a newer legal document version makes this acceptance outdated. The acceptance history is retained.';

comment on column public.legal_document_acceptances.superseded_by_document_version_id is
  'The newer legal document version that caused this acceptance to become outdated, when known.';

create or replace function public.fail_contract_ai_job(
  p_job_id uuid,
  p_status text,
  p_failure_class text,
  p_error_code text,
  p_error_message text,
  p_next_attempt_at timestamptz default null,
  p_refund_attempt boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('retry_wait','blocked','dead') then
    raise exception 'Invalid failure status';
  end if;

  update public.contract_ai_jobs
  set status = p_status,
      attempts = case when p_refund_attempt then greatest(attempts - 1, 0) else attempts end,
      failure_class = left(p_failure_class, 50),
      error_code = left(p_error_code, 100),
      error_message = left(p_error_message, 500),
      next_attempt_at = coalesce(p_next_attempt_at, now()),
      lease_expires_at = null,
      masked_text = case
        when p_status in ('blocked','dead') then null
        else masked_text
      end,
      updated_at = now()
  where id = p_job_id and status = 'processing';

  if not found then
    raise exception 'AI job is not leased';
  end if;
end;
$$;

revoke all on function public.fail_contract_ai_job(uuid, text, text, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.fail_contract_ai_job(uuid, text, text, text, text, timestamptz, boolean)
  to service_role;
