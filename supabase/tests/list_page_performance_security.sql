begin;

select plan(20);

select ok(
  has_function_privilege('service_role', 'public.get_navigation_badge_counts(uuid,uuid,uuid)', 'EXECUTE'),
  'service_role can read navigation badge counts'
);
select ok(
  not has_function_privilege('anon', 'public.get_navigation_badge_counts(uuid,uuid,uuid)', 'EXECUTE'),
  'anon cannot read navigation badge counts'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_navigation_badge_counts(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated cannot read navigation badge counts directly'
);

select ok(
  has_function_privilege('service_role', 'public.list_member_work_page(uuid,uuid,text,text,text,text,text,integer,integer)', 'EXECUTE'),
  'service_role can list paginated member works'
);
select ok(
  not has_function_privilege('anon', 'public.list_member_work_page(uuid,uuid,text,text,text,text,text,integer,integer)', 'EXECUTE'),
  'anon cannot list paginated member works'
);
select ok(
  not has_function_privilege('authenticated', 'public.list_member_work_page(uuid,uuid,text,text,text,text,text,integer,integer)', 'EXECUTE'),
  'authenticated cannot list paginated member works directly'
);

select ok(
  has_function_privilege('service_role', 'public.get_admin_work_archive_stats(uuid)', 'EXECUTE'),
  'service_role can read work archive statistics'
);
select ok(
  not has_function_privilege('anon', 'public.get_admin_work_archive_stats(uuid)', 'EXECUTE'),
  'anon cannot read work archive statistics'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_admin_work_archive_stats(uuid)', 'EXECUTE'),
  'authenticated cannot read work archive statistics directly'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.get_navigation_badge_counts(uuid,uuid,uuid)'::regprocedure),
  false,
  'navigation function is security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.list_member_work_page(uuid,uuid,text,text,text,text,text,integer,integer)'::regprocedure),
  false,
  'member work function is security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.get_admin_work_archive_stats(uuid)'::regprocedure),
  false,
  'work archive stats function is security invoker'
);

select ok(
  has_function_privilege('service_role', 'public.list_admin_producer_summaries(uuid,text,text,text,text,uuid,text,text,integer,integer)', 'EXECUTE'),
  'service_role can list paginated producer summaries'
);
select ok(
  not has_function_privilege('anon', 'public.list_admin_producer_summaries(uuid,text,text,text,text,uuid,text,text,integer,integer)', 'EXECUTE'),
  'anon cannot list producer summaries'
);
select ok(
  not has_function_privilege('authenticated', 'public.list_admin_producer_summaries(uuid,text,text,text,text,uuid,text,text,integer,integer)', 'EXECUTE'),
  'authenticated cannot list producer summaries directly'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.list_admin_producer_summaries(uuid,text,text,text,text,uuid,text,text,integer,integer)'::regprocedure),
  false,
  'producer summary function is security invoker'
);

select ok(
  has_function_privilege('service_role', 'public.get_contract_review_job_statuses(uuid,uuid[])', 'EXECUTE'),
  'service_role can read current contract review job statuses'
);
select ok(
  not has_function_privilege('anon', 'public.get_contract_review_job_statuses(uuid,uuid[])', 'EXECUTE'),
  'anon cannot read contract review job statuses'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_contract_review_job_statuses(uuid,uuid[])', 'EXECUTE'),
  'authenticated cannot read contract review job statuses directly'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.get_contract_review_job_statuses(uuid,uuid[])'::regprocedure),
  false,
  'contract review job status function is security invoker'
);

select * from finish();
rollback;
