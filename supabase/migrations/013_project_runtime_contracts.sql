-- Migration 013: versioned runtime contracts and complete variable inventory.
-- Stores sanitized references/metadata only; secret values never enter this table.

create table if not exists public.project_runtime_contracts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  environment text not null check (environment in ('development', 'staging', 'production')),
  contract_version text not null,
  status text not null default 'generated' check (status in ('generated', 'registered', 'delivered', 'verified', 'blocked')),
  namespace text not null,
  service_name text not null,
  inventory jsonb not null default '[]'::jsonb,
  document_markdown text not null,
  generated_by text not null default 'control-tower',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, environment, contract_version)
);

create index if not exists idx_project_runtime_contracts_project_environment
  on public.project_runtime_contracts(project_id, environment, updated_at desc);

drop trigger if exists set_project_runtime_contracts_updated_at on public.project_runtime_contracts;
create trigger set_project_runtime_contracts_updated_at
before update on public.project_runtime_contracts
for each row execute function public.update_updated_at_column();

comment on table public.project_runtime_contracts is 'Sanitized runtime contracts and complete variable inventories; never stores secret values.';
comment on column public.project_runtime_contracts.inventory is 'Variable names, classification, required flag, source, references and validations; no secret values.';
comment on column public.project_runtime_contracts.document_markdown is 'Developer Document generated from the sanitized contract.';
