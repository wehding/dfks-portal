create or replace function public.get_contract_review_job_statuses(
  target_org_id uuid,
  target_review_ids uuid[]
)
returns table (
  review_id uuid,
  status text,
  attempts integer,
  next_attempt_at timestamptz,
  has_error boolean,
  ai_status text,
  intake_status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (job.review_id)
    job.review_id,
    job.status,
    job.attempts,
    job.next_attempt_at,
    (job.error_message is not null) as has_error,
    review.ai_status,
    review.intake_status
  from public.contract_review_jobs job
  join public.contract_reviews review on review.id = job.review_id
  where review.org_id = target_org_id
    and job.review_id = any(coalesce(target_review_ids, '{}'::uuid[]))
  order by job.review_id, job.created_at desc, job.id desc
$$;

revoke all on function public.get_contract_review_job_statuses(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.get_contract_review_job_statuses(uuid, uuid[])
  to service_role;

create index if not exists contract_review_jobs_latest_review_idx
  on public.contract_review_jobs (review_id, created_at desc, id desc);
