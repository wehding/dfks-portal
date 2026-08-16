-- A Vercel/AI timeout must not leave a review job permanently in processing.
-- Only service_role can call the public wrapper, as established by the
-- original queue migration.
create or replace function private.claim_contract_review_job(worker_id text)
returns setof public.contract_review_jobs
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with candidate as (
    select id
    from public.contract_review_jobs
    where (
        status in ('queued','error')
        or (status = 'processing' and locked_at < now() - interval '15 minutes')
      )
      and attempts < 5
      and next_attempt_at <= now()
      and (locked_at is null or locked_at < now() - interval '15 minutes')
    order by priority asc, created_at asc
    for update skip locked
    limit 1
  )
  update public.contract_review_jobs job
  set status = 'processing',
      attempts = attempts + 1,
      locked_at = now(),
      locked_by = worker_id,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

revoke all on function private.claim_contract_review_job(text) from public, anon, authenticated;
grant execute on function private.claim_contract_review_job(text) to service_role;
