-- Migration 010: Service Identity and Secrets Module for Control Tower
-- Provides secure identity brokering, isolated secret namespaces, and reference bindings.

-- 1. Service Identities Table
create table if not exists public.service_identities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  namespace text not null,
  identity_type text not null check (identity_type in ('agent', 'service', 'admin')),
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked', 'expired')),
  issuer text not null default 'control-tower',
  audience text not null default 'fbr-agency',
  key_id text not null default 'ct-key-v1',
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_service_identities_namespace on public.service_identities(namespace);
create index if not exists idx_service_identities_status on public.service_identities(status);

-- 2. Secret Namespaces Table
create table if not exists public.secret_namespaces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete restrict,
  namespace text not null unique,
  provider text not null default 'easypanel',
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_secret_namespaces_project_id on public.secret_namespaces(project_id);

-- 3. Secret Bindings Table
create table if not exists public.secret_bindings (
  id uuid primary key default gen_random_uuid(),
  namespace_id uuid not null references public.secret_namespaces(id) on delete cascade,
  secret_name text not null,
  reference_path text not null,
  provider text not null default 'easypanel',
  environment text not null default 'production',
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(namespace_id, secret_name, environment)
);

create index if not exists idx_secret_bindings_namespace on public.secret_bindings(namespace_id);

-- 4. Triggers for updated_at
drop trigger if exists set_service_identities_updated_at on public.service_identities;
create trigger set_service_identities_updated_at
before update on public.service_identities
for each row execute function public.update_updated_at_column();

drop trigger if exists set_secret_namespaces_updated_at on public.secret_namespaces;
create trigger set_secret_namespaces_updated_at
before update on public.secret_namespaces
for each row execute function public.update_updated_at_column();

drop trigger if exists set_secret_bindings_updated_at on public.secret_bindings;
create trigger set_secret_bindings_updated_at
before update on public.secret_bindings
for each row execute function public.update_updated_at_column();
