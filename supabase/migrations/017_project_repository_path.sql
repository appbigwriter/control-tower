-- Migration 017: canonical repository source path.
-- FBR projects keep application code under /09-codigo by convention.
-- No provider credentials are stored here.

alter table if exists public.projects
  add column if not exists repository_path text not null default '/09-codigo';

update public.projects
set repository_path = '/09-codigo'
where repository_path is null or btrim(repository_path) = '';

comment on column public.projects.repository_path is 'Repository subdirectory used by the runtime source; default /09-codigo.';
