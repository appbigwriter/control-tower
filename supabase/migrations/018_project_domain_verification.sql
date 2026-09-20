-- Migration 018: domain verification persistence table.
-- Isolated from the colliding 012_remediation_saga_states.sql migration.

create table if not exists public.project_domain_verification (
  project_id uuid primary key references public.projects(id) on delete cascade,
  domain text not null,
  state text not null check (
    state in ('domain_generated', 'awaiting_dns', 'dns_manual_confirmed', 'dns_verified', 'dns_failed')
  ),
  attempts integer not null default 0,
  last_error text,
  next_check_at timestamptz,
  health_readback_id text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_domain_verification_state
  on public.project_domain_verification(state);

grant select, insert, update on public.project_domain_verification to service_role;
