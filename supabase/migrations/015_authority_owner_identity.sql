-- Migration 015: stable Authority owner identity.
-- The owner identifier is generated once by Control Tower and reused on redeploys.
-- It is an identity/tenant key, not a password or API token.

alter table public.projects
  add column if not exists authority_owner_id uuid;

comment on column public.projects.authority_owner_id is
  'Stable server-generated owner identity for Authority runtime; distinct from project id.';

create unique index if not exists idx_projects_authority_owner_id
  on public.projects(authority_owner_id)
  where authority_owner_id is not null;
