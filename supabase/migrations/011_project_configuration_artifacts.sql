-- Migration 011: generated project configuration artifacts
-- Stores generated configuration metadata without persisting secret values.

create table if not exists public.project_configuration_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  artifact_type text not null check (artifact_type in ('public_variables', 'namespace', 'validation_domain')),
  payload jsonb not null default '{}'::jsonb,
  created_by text not null default 'admin-panel',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, artifact_type)
);

create index if not exists idx_project_configuration_artifacts_project_id
  on public.project_configuration_artifacts(project_id);

 drop trigger if exists set_project_configuration_artifacts_updated_at on public.project_configuration_artifacts;
create trigger set_project_configuration_artifacts_updated_at
before update on public.project_configuration_artifacts
for each row execute function public.update_updated_at_column();
