create index if not exists work_assignments_rights_holder_created_at_idx
  on public.work_assignments (rights_holder_id, created_at desc);

create index if not exists work_assignments_work_rights_holder_idx
  on public.work_assignments (work_id, rights_holder_id);

create index if not exists contracts_rights_holder_created_at_idx
  on public.contracts (rights_holder_id, created_at desc);

create index if not exists contracts_org_created_at_idx
  on public.contracts (org_id, created_at desc);

create index if not exists contracts_org_status_created_at_idx
  on public.contracts (org_id, status, created_at desc);

create index if not exists works_org_created_at_idx
  on public.works (org_id, created_at desc);

create index if not exists works_org_status_created_at_idx
  on public.works (org_id, status, created_at desc);
