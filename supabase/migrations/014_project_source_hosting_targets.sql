-- Migration 014: source repository and hosting target metadata.
-- No provider credentials are stored here.

alter table if exists public.projects
  add column if not exists repository_url text,
  add column if not exists hosting_target text,
  add column if not exists hosting_project_name text,
  add column if not exists service_name text;

alter table if exists public.projects
  drop constraint if exists projects_hosting_target_check;

alter table if exists public.projects
  add constraint projects_hosting_target_check
  check (hosting_target is null or hosting_target in ('vps1', 'vps2'));

create index if not exists idx_projects_hosting_target
  on public.projects(hosting_target);

comment on column public.projects.repository_url is 'Source repository URL; no credentials or tokens.';
comment on column public.projects.hosting_target is 'Registered deployment target: vps1 or vps2.';
comment on column public.projects.hosting_project_name is 'Derived provider project name: projetos or sistemas.';
comment on column public.projects.service_name is 'Derived provider service name from the first project name token.';
