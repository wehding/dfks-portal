-- Robusthed for AI-kontrakt-koen:
--  * Attempt-cap: fejl-jobs (status='error') genkoeres kun sa laenge attempts < 3,
--    sa en permanent ulaeselig PDF ikke genkoeres i det uendelige og braender API-budget.
--  * Reaper: jobs der er sat til 'processing' men aldrig blev faerdige (serverless-timeout
--    eller crash for catch-blokken naaede at koere) genoplives efter 15 minutter.
--
-- Erstatter claim_next_contract_ai_job fra 20260707120000_contract_ai_jobs.sql.
-- Signatur og returkolonner er uaendrede.

create or replace function claim_next_contract_ai_job(
    p_job_id uuid default null,
    p_org_id uuid default null
)
returns table (
    id uuid,
    contract_id uuid,
    org_id uuid,
    attempts integer,
    pdf_url text
)
language sql
security definer
set search_path = public
as $$
    with picked as (
        select j.id
        from contract_ai_jobs j
        join contracts c on c.id = j.contract_id
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
    ),
    updated as (
        update contract_ai_jobs j
        set status = 'processing',
            attempts = j.attempts + 1,
            started_at = now(),
            updated_at = now(),
            error_message = null
        from picked
        where j.id = picked.id
        returning j.id, j.contract_id, j.org_id, j.attempts
    )
    select u.id, u.contract_id, u.org_id, u.attempts, c.pdf_url
    from updated u
    join contracts c on c.id = u.contract_id;
$$;

revoke all on function claim_next_contract_ai_job(uuid, uuid) from public;
grant execute on function claim_next_contract_ai_job(uuid, uuid) to service_role;
