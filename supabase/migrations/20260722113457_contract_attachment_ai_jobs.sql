alter table public.contract_ai_jobs
  add column if not exists attachment_id uuid references public.contract_attachments(id) on delete cascade;

create index if not exists contract_ai_jobs_attachment_idx
  on public.contract_ai_jobs (attachment_id)
  where attachment_id is not null;

create unique index if not exists contract_ai_jobs_one_active_attachment
  on public.contract_ai_jobs (attachment_id)
  where attachment_id is not null and status in ('queued', 'processing');

drop function if exists public.claim_next_contract_ai_job(uuid, uuid);

create function public.claim_next_contract_ai_job(p_job_id uuid default null, p_org_id uuid default null)
returns table(id uuid, contract_id uuid, org_id uuid, attempts integer, pdf_url text, attachment_id uuid)
language sql
security definer
set search_path = public
as $$
  with picked as (
    select j.id
    from contract_ai_jobs j
    where (
      j.status = 'queued'
      or (j.status = 'error' and j.attempts < 3)
      or (j.status = 'processing' and j.started_at < now() - interval '15 minutes')
    )
      and (p_job_id is null or j.id = p_job_id)
      and (p_org_id is null or j.org_id = p_org_id)
    order by j.priority asc, j.created_at asc
    limit 1
    for update skip locked
  ), updated as (
    update contract_ai_jobs j
    set status = 'processing', attempts = j.attempts + 1, started_at = now(), updated_at = now(), error_message = null
    from picked where j.id = picked.id
    returning j.id, j.contract_id, j.org_id, j.attempts, j.attachment_id
  )
  select u.id, u.contract_id, u.org_id, u.attempts, coalesce(a.pdf_url, c.pdf_url), u.attachment_id
  from updated u
  join contracts c on c.id = u.contract_id
  left join contract_attachments a on a.id = u.attachment_id;
$$;

revoke all on function public.claim_next_contract_ai_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_contract_ai_job(uuid, uuid) to service_role;
