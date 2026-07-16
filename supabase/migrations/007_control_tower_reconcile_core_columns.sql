alter table if exists public.provisioning_jobs
  add column if not exists project_id uuid;

alter table if exists public.audit_logs
  add column if not exists project_id uuid;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'projects'
  ) then
    alter table public.provisioning_jobs
      drop constraint if exists provisioning_jobs_project_id_fkey;

    alter table public.audit_logs
      drop constraint if exists audit_logs_project_id_fkey;

    alter table public.provisioning_jobs
      add constraint provisioning_jobs_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete set null;

    alter table public.audit_logs
      add constraint audit_logs_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete set null;
  end if;
end;
$$;

create index if not exists idx_provisioning_jobs_project_id
  on public.provisioning_jobs(project_id);

create index if not exists idx_audit_logs_project_id
  on public.audit_logs(project_id);
