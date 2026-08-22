-- Hurtigere arkivlister og server-side søgning på værker/kontrakter.
-- Indeksene er additive og ændrer ikke eksisterende data.

create index if not exists contracts_org_superseded_created_idx
  on public.contracts (org_id, superseded_by_contract_id, created_at desc);

create index if not exists contracts_org_rights_holder_created_idx
  on public.contracts (org_id, rights_holder_id, created_at desc);

create index if not exists contracts_org_work_status_idx
  on public.contracts (org_id, work_id, status);

create index if not exists contract_comments_contract_author_admin_read_created_idx
  on public.contract_comments (contract_id, author_role, admin_read_at, created_at);

create index if not exists contract_ai_jobs_contract_attachment_created_idx
  on public.contract_ai_jobs (contract_id, attachment_id, created_at desc);

create index if not exists work_assignments_org_rights_holder_created_idx
  on public.work_assignments (org_id, rights_holder_id, created_at desc);

create index if not exists work_assignments_org_work_idx
  on public.work_assignments (org_id, work_id);

create index if not exists work_change_requests_org_work_status_created_idx
  on public.work_change_requests (org_id, work_id, status, created_at desc);

create index if not exists work_production_numbers_work_number_idx
  on public.work_production_numbers (work_id, number);

create index if not exists member_series_episode_scopes_org_holder_series_season_idx
  on public.member_series_episode_scopes (org_id, rights_holder_id, series_work_id, season_number);;
