-- Server-actions enqueue and idempotently inspect contract AI jobs after a work
-- has been linked. Keep the grant limited to the operations used by that flow.
grant select, insert on table public.contract_ai_jobs to service_role;
