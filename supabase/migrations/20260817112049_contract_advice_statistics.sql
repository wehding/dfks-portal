-- Privacy-safe, versioned fact layer for contract-advice statistics.
-- Raw contract text, filenames, mail content and personal contact data never
-- enter the analytics schema.

create schema if not exists analytics;

alter table public.analysis_feedback
  add column if not exists assessment_type text not null default 'finding_review';
alter table public.analysis_feedback
  drop constraint if exists analysis_feedback_assessment_type_check,
  add constraint analysis_feedback_assessment_type_check
    check (assessment_type in ('finding_review','missed_finding'));

create table if not exists analytics.contract_advice_rule_catalog (
  rule_code text primary key,
  label_da text not null,
  label_en text not null,
  category text not null,
  default_severity text not null check (default_severity in ('LAV','MELLEM','HØJ')),
  active boolean not null default true,
  valid_from date not null default current_date,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into analytics.contract_advice_rule_catalog
  (rule_code, label_da, label_en, category, default_severity, aliases)
values
  ('pension', 'Pension', 'Pension', 'employment', 'HØJ', array['manglende pension']),
  ('copydan', 'Copydan-forbehold', 'Copydan reservation', 'rights', 'MELLEM', array['copydan-forbehold']),
  ('svod', 'Streaming/SVOD', 'Streaming/SVOD', 'rights', 'MELLEM', array['streaming','streaming/svod']),
  ('tdm_ai', 'TDM/AI', 'TDM/AI', 'rights', 'LAV', array['tdm','ai','ai/data-mining']),
  ('promovering', 'Promoveringsret', 'Promotion right', 'rights', 'LAV', array['promoveringsret']),
  ('kreditering', 'Kreditering', 'Credit', 'rights', 'LAV', array['credit']),
  ('opsigelsesvarsel', 'Opsigelsesvarsel', 'Notice period', 'employment', 'MELLEM', array['opsigelse']),
  ('sygdom', 'Sygdomsbestemmelse', 'Sickness provision', 'employment', 'MELLEM', array['sygdomsbestemmelse']),
  ('royalty', 'Royalty', 'Royalty', 'rights', 'HØJ', array['royalty-klausul']),
  ('hybrid_kontrakt', 'Blanding af kontraktformer', 'Mixed contract form', 'contract_form', 'HØJ', array['hybrid kontrakt']),
  ('underskrift', 'Underskrift', 'Signature', 'formalities', 'MELLEM', array['signatur']),
  ('overenskomst', 'Overenskomsthenvisning', 'Collective agreement reference', 'agreement', 'MELLEM', array['overenskomsthenvisning']),
  ('kontraktform', 'Kontraktform', 'Contract form', 'contract_form', 'MELLEM', array['ansættelsesform']),
  ('minimumsloen', 'Minimumsløn', 'Minimum salary', 'compensation', 'HØJ', array['løn','minimumsløn']),
  ('feriepenge', 'Feriepenge', 'Holiday pay', 'compensation', 'MELLEM', array['feriegodtgørelse']),
  ('beta_bidrag', 'BETA-bidrag', 'BETA contribution', 'compensation', 'MELLEM', array['beta','beta-fond']),
  ('producent_overenskomst', 'Producentens overenskomstdækning', 'Producer agreement coverage', 'agreement', 'MELLEM', array['overenskomstdækning'])
on conflict (rule_code) do update set
  label_da = excluded.label_da,
  label_en = excluded.label_en,
  category = excluded.category,
  default_severity = excluded.default_severity,
  aliases = excluded.aliases,
  updated_at = now();

create table if not exists analytics.contract_advice_review_facts (
  review_id uuid primary key references public.contract_reviews(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  member_key uuid,
  contract_id uuid references public.contracts(id) on delete set null,
  received_at timestamptz not null,
  period_year integer not null,
  intake_source text not null,
  review_status text not null,
  analysis_status text not null,
  contract_type text,
  production_type text,
  document_stage text not null check (document_stage in ('draft','unsigned','signed','unknown')),
  agreement_status text not null check (agreement_status in ('present','missing','unclear','not_applicable','unknown')),
  agreement_name text,
  risk_level text,
  should_escalate boolean not null default false,
  issue_count integer not null default 0,
  critical_issue_count integer not null default 0,
  assigned_at timestamptz,
  analysed_at timestamptz,
  responded_at timestamptz,
  completed_at timestamptz,
  analysis_latency_seconds integer,
  response_latency_seconds integer,
  completion_latency_seconds integer,
  has_response_draft boolean not null default false,
  prompt_version text,
  schema_version text,
  refreshed_at timestamptz not null default now()
);

create table if not exists analytics.contract_advice_issue_facts (
  review_id uuid not null references public.contract_reviews(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  member_key uuid,
  rule_code text not null,
  analysis_version text not null default 'legacy',
  severity text not null check (severity in ('LAV','MELLEM','HØJ')),
  finding_status text not null default 'present' check (finding_status in ('present','positive','not_applicable','unknown')),
  requires_producer_text boolean not null default false,
  human_assessment text not null default 'unreviewed' check (human_assessment in ('unreviewed','correct','incorrect','wrong_severity','not_relevant','missed')),
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  primary key (review_id, rule_code, analysis_version)
);

create table if not exists analytics.contract_advice_version_comparisons (
  previous_contract_id uuid not null references public.contracts(id) on delete cascade,
  current_contract_id uuid not null references public.contracts(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  member_key uuid,
  rule_code text not null,
  outcome text not null check (outcome in ('fixed','partially_fixed','not_fixed','new_issue','not_applicable','uncertain')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  comparison_version text not null default 'structured-v1',
  compared_at timestamptz not null default now(),
  primary key (previous_contract_id, current_contract_id, rule_code, comparison_version)
);

create index if not exists contract_advice_review_facts_org_period_idx
  on analytics.contract_advice_review_facts(org_id, period_year, received_at);
create index if not exists contract_advice_issue_facts_org_rule_idx
  on analytics.contract_advice_issue_facts(org_id, rule_code, severity);
create index if not exists contract_advice_comparisons_org_rule_idx
  on analytics.contract_advice_version_comparisons(org_id, rule_code, outcome);

revoke all on all tables in schema analytics from public, anon, authenticated;
grant select, insert, update, delete on analytics.contract_advice_review_facts,
  analytics.contract_advice_issue_facts, analytics.contract_advice_version_comparisons to service_role;
grant select on analytics.contract_advice_rule_catalog to service_role;

create or replace function private.contract_advice_rule_code(raw_id text, raw_title text)
returns text language sql stable set search_path = '' as $$
  select coalesce(
    (select catalog.rule_code
       from analytics.contract_advice_rule_catalog catalog
      where lower(trim(coalesce(raw_id, ''))) = catalog.rule_code
         or lower(trim(coalesce(raw_title, ''))) = catalog.rule_code
         or lower(trim(coalesce(raw_id, ''))) = any(catalog.aliases)
         or lower(trim(coalesce(raw_title, ''))) = any(catalog.aliases)
      limit 1),
    nullif(regexp_replace(lower(trim(coalesce(raw_id, raw_title, ''))), '[^a-z0-9æøå]+', '_', 'g'), '')
  );
$$;

create or replace function private.refresh_contract_advice_review_fact(target_review_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  review public.contract_reviews%rowtype;
  result jsonb;
  compliance jsonb;
  point jsonb;
  code text;
  severity_value text;
  feedback_record record;
begin
  select * into review from public.contract_reviews where id = target_review_id;
  if review.id is null then
    delete from analytics.contract_advice_issue_facts where review_id = target_review_id;
    delete from analytics.contract_advice_review_facts where review_id = target_review_id;
    return;
  end if;
  result := coalesce(review.ai_result, '{}'::jsonb);
  compliance := coalesce(review.compliance_extract, '{}'::jsonb);

  insert into analytics.contract_advice_review_facts (
    review_id, org_id, member_key, contract_id, received_at, period_year,
    intake_source, review_status, analysis_status, contract_type, production_type,
    document_stage, agreement_status, agreement_name, risk_level, should_escalate,
    issue_count, critical_issue_count, analysed_at, responded_at, completed_at,
    analysis_latency_seconds, response_latency_seconds, completion_latency_seconds,
    has_response_draft, prompt_version, schema_version, refreshed_at
  ) values (
    review.id, review.org_id, review.member_id, review.contract_id, review.reviewed_at,
    extract(year from review.reviewed_at)::integer,
    coalesce(review.intake_source, 'unknown'), review.status, coalesce(review.ai_status, 'unknown'),
    coalesce(review.contract_type, result#>>'{overblik,kontrakttype}'), review.production_type,
    case
      when lower(coalesce(result->>'document_stage', compliance->>'document_stage', '')) in ('draft','udkast') then 'draft'
      when lower(coalesce(result->>'document_stage', compliance->>'document_stage', '')) in ('signed','underskrevet') then 'signed'
      when lower(coalesce(result->>'document_stage', compliance->>'document_stage', '')) in ('unsigned','usigneret') then 'unsigned'
      else 'unknown'
    end,
    case
      when coalesce(compliance->>'overenskomst_navn', result#>>'{overblik,overenskomst}') is not null then 'present'
      when lower(coalesce(compliance->>'agreement_status', result->>'agreement_status', '')) in ('missing','mangler') then 'missing'
      when lower(coalesce(compliance->>'agreement_status', result->>'agreement_status', '')) in ('unclear','uklar') then 'unclear'
      when lower(coalesce(compliance->>'agreement_status', result->>'agreement_status', '')) in ('not_applicable','ikke relevant') then 'not_applicable'
      else 'unknown'
    end,
    coalesce(compliance->>'overenskomst_navn', result#>>'{overblik,overenskomst}'),
    upper(coalesce(review.risk_level, compliance->>'risk_level', '')),
    coalesce(review.should_escalate, (compliance->>'should_escalate')::boolean, false),
    coalesce(jsonb_array_length(case when jsonb_typeof(compliance->'points') = 'array' then compliance->'points' else '[]'::jsonb end),
             jsonb_array_length(case when jsonb_typeof(result->'feedbackpunkter') = 'array' then result->'feedbackpunkter' else '[]'::jsonb end)),
    (select count(*) from jsonb_array_elements(
      case when jsonb_typeof(compliance->'points') = 'array' then compliance->'points'
           when jsonb_typeof(result->'feedbackpunkter') = 'array' then result->'feedbackpunkter'
           else '[]'::jsonb end
    ) p where upper(coalesce(p->>'severity', p->>'type', '')) in ('HØJ','KRITISK')),
    review.ai_run_at, review.jurist_response_at, review.completed_at,
    case when review.ai_run_at is not null then greatest(0, extract(epoch from review.ai_run_at - review.reviewed_at)::integer) end,
    case when review.jurist_response_at is not null then greatest(0, extract(epoch from review.jurist_response_at - review.reviewed_at)::integer) end,
    case when review.completed_at is not null then greatest(0, extract(epoch from review.completed_at - review.reviewed_at)::integer) end,
    coalesce(nullif(review.response_draft, '') is not null, false),
    coalesce(compliance->>'prompt_version', result->>'prompt_version'),
    coalesce(compliance->>'schema_version', result->>'schema_version', 'legacy'), now()
  ) on conflict (review_id) do update set
    org_id = excluded.org_id, member_key = excluded.member_key, contract_id = excluded.contract_id,
    review_status = excluded.review_status, analysis_status = excluded.analysis_status,
    contract_type = excluded.contract_type, production_type = excluded.production_type,
    document_stage = excluded.document_stage, agreement_status = excluded.agreement_status,
    agreement_name = excluded.agreement_name, risk_level = excluded.risk_level,
    should_escalate = excluded.should_escalate, issue_count = excluded.issue_count,
    critical_issue_count = excluded.critical_issue_count, analysed_at = excluded.analysed_at,
    responded_at = excluded.responded_at, completed_at = excluded.completed_at,
    analysis_latency_seconds = excluded.analysis_latency_seconds,
    response_latency_seconds = excluded.response_latency_seconds,
    completion_latency_seconds = excluded.completion_latency_seconds,
    has_response_draft = excluded.has_response_draft, prompt_version = excluded.prompt_version,
    schema_version = excluded.schema_version, refreshed_at = now();

  delete from analytics.contract_advice_issue_facts where review_id = review.id;
  for point in select value from jsonb_array_elements(
    case when jsonb_typeof(compliance->'points') = 'array' then compliance->'points'
         when jsonb_typeof(result->'feedbackpunkter') = 'array' then result->'feedbackpunkter'
         else '[]'::jsonb end
  ) loop
    code := private.contract_advice_rule_code(coalesce(point->>'point_id', point->>'id'), coalesce(point->>'title', point->>'titel'));
    if code is null then continue; end if;
    severity_value := case upper(coalesce(point->>'severity', point->>'type', ''))
      when 'HØJ' then 'HØJ' when 'KRITISK' then 'HØJ'
      when 'MELLEM' then 'MELLEM' when 'ADVARSEL' then 'MELLEM'
      else 'LAV' end;
    insert into analytics.contract_advice_issue_facts (
      review_id, org_id, member_key, rule_code, analysis_version, severity,
      finding_status, requires_producer_text, human_assessment, refreshed_at
    ) values (
      review.id, review.org_id, review.member_id, code,
      coalesce(compliance->>'schema_version', result->>'schema_version', 'legacy'), severity_value,
      case when lower(coalesce(point->>'type', '')) = 'positiv' then 'positive' else 'present' end,
      coalesce((point->>'requires_producer_text')::boolean, false), 'unreviewed', now()
    ) on conflict do nothing;
  end loop;

  for feedback_record in
    select feedback.*, private.contract_advice_rule_code(feedback.fund_id, feedback.fund_titel) normalized_code
      from public.analysis_feedback feedback
     where feedback.analyse_id = review.id::text
  loop
    if not exists (
      select 1 from analytics.contract_advice_issue_facts
       where review_id = review.id and rule_code = feedback_record.normalized_code
    ) and feedback_record.normalized_code is not null then
      insert into analytics.contract_advice_issue_facts (
        review_id, org_id, member_key, rule_code, analysis_version, severity,
        finding_status, requires_producer_text, human_assessment, refreshed_at
      ) values (
        review.id, review.org_id, review.member_id, feedback_record.normalized_code,
        coalesce(compliance->>'schema_version', result->>'schema_version', 'legacy'),
        case lower(coalesce(feedback_record.korrektion_svaerhedsgrad, feedback_record.fund_svaerhedsgrad, ''))
          when 'kritisk' then 'HØJ' when 'høj' then 'HØJ'
          when 'advarsel' then 'MELLEM' when 'mellem' then 'MELLEM'
          else 'LAV' end,
        'present', false, 'missed', now()
      );
    end if;
    update analytics.contract_advice_issue_facts
       set human_assessment = case
         when feedback_record.assessment_type = 'missed_finding' then 'missed'
         when feedback_record.skal_ignoreres then 'not_relevant'
         when feedback_record.godkendt then 'correct'
         when feedback_record.korrektion_svaerhedsgrad is not null then 'wrong_severity'
         else 'incorrect' end,
           refreshed_at = now()
     where review_id = review.id and rule_code = feedback_record.normalized_code;
  end loop;
end;
$$;

create or replace function private.contract_advice_version_link_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.superseded_by_contract_id is not null then
    perform private.refresh_contract_advice_version_comparisons(new.superseded_by_contract_id);
  end if;
  return new;
end;
$$;

drop trigger if exists contract_advice_version_link_refresh on public.contracts;
create trigger contract_advice_version_link_refresh
after update of superseded_by_contract_id on public.contracts
for each row when (new.superseded_by_contract_id is distinct from old.superseded_by_contract_id)
execute function private.contract_advice_version_link_trigger();

create or replace function private.refresh_contract_advice_version_comparisons(target_contract_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_contract public.contracts%rowtype;
  previous_contract public.contracts%rowtype;
  current_review uuid;
  previous_review uuid;
begin
  select * into current_contract from public.contracts where id = target_contract_id;
  if current_contract.id is null then return; end if;
  select * into previous_contract from public.contracts
   where superseded_by_contract_id = current_contract.id limit 1;
  if previous_contract.id is null then return; end if;
  select review_id into current_review from analytics.contract_advice_review_facts
   where contract_id = current_contract.id order by analysed_at desc nulls last limit 1;
  select review_id into previous_review from analytics.contract_advice_review_facts
   where contract_id = previous_contract.id order by analysed_at desc nulls last limit 1;
  delete from analytics.contract_advice_version_comparisons
   where previous_contract_id = previous_contract.id and current_contract_id = current_contract.id
     and comparison_version = 'structured-v1';
  if current_review is null or previous_review is null then return; end if;

  insert into analytics.contract_advice_version_comparisons (
    previous_contract_id, current_contract_id, org_id, member_key, rule_code,
    outcome, confidence, comparison_version, compared_at
  )
  select previous_contract.id, current_contract.id, current_contract.org_id,
         coalesce(current_fact.member_key, previous_fact.member_key), codes.rule_code,
         case
           when old_issue.rule_code is not null and new_issue.rule_code is null then 'fixed'
           when old_issue.rule_code is not null and new_issue.rule_code is not null then 'not_fixed'
           when old_issue.rule_code is null and new_issue.rule_code is not null then 'new_issue'
           else 'uncertain'
         end,
         case when current_fact.analysis_status in ('klar','ready') and previous_fact.analysis_status in ('klar','ready') then 0.85 else 0.40 end,
         'structured-v1', now()
    from (select rule_code from analytics.contract_advice_issue_facts where review_id = previous_review
          union
          select rule_code from analytics.contract_advice_issue_facts where review_id = current_review) codes
    join analytics.contract_advice_review_facts current_fact on current_fact.review_id = current_review
    join analytics.contract_advice_review_facts previous_fact on previous_fact.review_id = previous_review
    left join analytics.contract_advice_issue_facts old_issue on old_issue.review_id = previous_review and old_issue.rule_code = codes.rule_code and old_issue.finding_status = 'present'
    left join analytics.contract_advice_issue_facts new_issue on new_issue.review_id = current_review and new_issue.rule_code = codes.rule_code and new_issue.finding_status = 'present';
end;
$$;

create or replace function private.contract_advice_review_fact_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_contract_advice_review_fact(coalesce(new.id, old.id));
  if tg_op <> 'DELETE' and new.contract_id is not null then
    perform private.refresh_contract_advice_version_comparisons(new.contract_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists contract_advice_review_fact_refresh on public.contract_reviews;
create trigger contract_advice_review_fact_refresh
after insert or update of ai_result, compliance_extract, ai_status, status, assigned_to,
  jurist_response_at, completed_at, response_draft, contract_id
on public.contract_reviews for each row execute function private.contract_advice_review_fact_trigger();

create or replace function private.contract_advice_feedback_fact_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare review_uuid uuid;
begin
  begin review_uuid := coalesce(new.analyse_id, old.analyse_id)::uuid;
  exception when invalid_text_representation then return coalesce(new, old); end;
  perform private.refresh_contract_advice_review_fact(review_uuid);
  return coalesce(new, old);
end;
$$;

drop trigger if exists contract_advice_feedback_fact_refresh on public.analysis_feedback;
create trigger contract_advice_feedback_fact_refresh
after insert or update or delete on public.analysis_feedback
for each row execute function private.contract_advice_feedback_fact_trigger();

-- Backfill historical cases without copying raw prose into analytics.
do $$ declare review_row record; begin
  for review_row in select id from public.contract_reviews loop
    perform private.refresh_contract_advice_review_fact(review_row.id);
  end loop;
end $$;

do $$ declare contract_row record; begin
  for contract_row in select id from public.contracts where superseded_by_contract_id is null loop
    perform private.refresh_contract_advice_version_comparisons(contract_row.id);
  end loop;
end $$;

create or replace function public.get_contract_advice_statistics_facts(
  target_org_id uuid,
  page_offset integer default 0,
  page_size integer default 1000
)
returns table (
  fact_type text, review_id uuid, member_key uuid, period_year integer,
  intake_source text, review_status text, analysis_status text, contract_type text,
  production_type text, document_stage text, agreement_status text, agreement_name text,
  risk_level text, should_escalate boolean, rule_code text, severity text,
  human_assessment text, correction_outcome text, confidence numeric,
  received_at timestamptz, analysed_at timestamptz, responded_at timestamptz,
  completed_at timestamptz, analysis_latency_seconds integer,
  response_latency_seconds integer, completion_latency_seconds integer,
  prompt_version text, schema_version text
)
language sql stable security invoker set search_path = '' as $$
  select * from (
  select 'review', fact.review_id, fact.member_key, fact.period_year,
    fact.intake_source, fact.review_status, fact.analysis_status, fact.contract_type,
    fact.production_type, fact.document_stage, fact.agreement_status, fact.agreement_name,
    fact.risk_level, fact.should_escalate, null::text, null::text, null::text, null::text, null::numeric,
    fact.received_at, fact.analysed_at, fact.responded_at, fact.completed_at,
    fact.analysis_latency_seconds, fact.response_latency_seconds,
    fact.completion_latency_seconds, fact.prompt_version, fact.schema_version
  from analytics.contract_advice_review_facts fact where fact.org_id = target_org_id
  union all
  select 'issue', issue.review_id, issue.member_key, extract(year from issue.created_at)::integer,
    null, null, null, null, null, null, null, null, null, false,
    issue.rule_code, issue.severity, issue.human_assessment, null::text, null::numeric,
    issue.created_at, null, null, null, null, null, null, null, issue.analysis_version
  from analytics.contract_advice_issue_facts issue where issue.org_id = target_org_id
  union all
  select 'comparison', null, comparison.member_key, extract(year from comparison.compared_at)::integer,
    null, null, null, null, null, null, null, null, null, false,
    comparison.rule_code, null, null, comparison.outcome, comparison.confidence,
    comparison.compared_at, null, null, null, null, null, null, null, comparison.comparison_version
  from analytics.contract_advice_version_comparisons comparison where comparison.org_id = target_org_id
  ) facts
  order by 1, 20, 2 nulls last, 15 nulls last
  offset greatest(page_offset, 0)
  limit least(greatest(page_size, 1), 1000);
$$;

revoke all on function public.get_contract_advice_statistics_facts(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.get_contract_advice_statistics_facts(uuid,integer,integer) to service_role;

comment on function public.get_contract_advice_statistics_facts(uuid,integer,integer) is
  'Server-only, privacy-safe fact feed. Contains opaque keys and classifications, never contract prose or contact data.';
