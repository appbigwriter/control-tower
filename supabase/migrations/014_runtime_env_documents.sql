-- Migration 014: explicit operational env documents.
-- Values stored here are sanitized references/derived values only.
-- The provider receives resolved secret values server-side during injection.

alter table public.project_runtime_contracts
  add column if not exists env_filename text,
  add column if not exists env_document text;

update public.project_runtime_contracts
set env_filename = case
  when environment = 'production' then 'env.' || (select slug from public.projects where id = project_runtime_contracts.project_id)
  else 'env.' || (select slug from public.projects where id = project_runtime_contracts.project_id) || '.' || environment
end
where env_filename is null;

update public.project_runtime_contracts
set env_document = ''
where env_document is null;

alter table public.project_runtime_contracts
  alter column env_filename set not null,
  alter column env_document set not null;

comment on column public.project_runtime_contracts.env_filename is 'Canonical operational document name: env.<slug> or env.<slug>.<environment>.';
comment on column public.project_runtime_contracts.env_document is 'Complete sanitized KEY=value document. Secret values are references only; provider injection resolves them server-side.';
