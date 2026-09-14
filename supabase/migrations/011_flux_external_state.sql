-- Local versioned DDL only. Do not run remotely without Sergio Gate
create table if not exists public.flux_state (
  state_key text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists flux_state_updated_at_idx on public.flux_state (updated_at desc);

comment on table public.flux_state is 'FBR Flux external state snapshot; service-role server-side access only';

-- The Flux dispatcher endpoint enforces bearer auth and idempotency in the app layer.
-- Hermes integration remains blocked until its authenticated HTTP contract is approved
-- and an end-to-end call/readback is available
