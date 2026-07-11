create table if not exists public.admin_message_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  admin_user_id uuid references auth.users(id) on delete set null,
  thread_kind text not null check (thread_kind in ('work', 'contract', 'screening')),
  thread_id uuid not null,
  message_id uuid,
  action text not null check (action in ('delete_message', 'clear_thread')),
  deleted_count integer not null default 1 check (deleted_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists admin_message_deletion_audit_org_created_idx on public.admin_message_deletion_audit(org_id, created_at desc);
alter table public.admin_message_deletion_audit enable row level security;
grant select on public.admin_message_deletion_audit to authenticated;
grant select, insert on public.admin_message_deletion_audit to service_role;

create policy "Admins kan se beskedsletningsaudit for egen organisation"
  on public.admin_message_deletion_audit for select to authenticated
  using (exists (
    select 1 from public.user_org_roles role
    where role.user_id = (select auth.uid())
      and role.org_id = admin_message_deletion_audit.org_id
      and role.role in ('superadmin', 'admin', 'org-admin')
  ));

notify pgrst, 'reload schema';
