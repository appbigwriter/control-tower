-- Migration 012 (GDB-REM-011/012/013): local-only DDL. Do NOT apply remotely without Sergio Gate.
-- Scope: binding lifecycle states, domain verification persistence, schema readback RPC,
-- and guarded exception handling in provision_project (audit without project when insert never happened).
-- CONFLICT NOTE (see handoff GDB-REM-011-015): GDB-REM-004/006 tracks also redefine
-- public.provision_project; REM-016 must reconcile the merged final body.

-- 1) secret_bindings: intermediate lifecycle states (pending = registered intent,
--    failed = provider injection/confirmation failed). Active remains the only
--    "confirmed externally" state.
alter table public.secret_bindings
  drop constraint if exists secret_bindings_status_check;

alter table public.secret_bindings
  add constraint secret_bindings_status_check
  check (status in ('pending', 'active', 'failed', 'suspended', 'revoked'));

-- 2) project_domain_verification: DNS/health state machine per project (GDB-REM-013).
create table if not exists public.project_domain_verification (
  project_id uuid primary key references public.projects(id) on delete cascade,
  domain text not null,
  state text not null check (
    state in ('domain_generated', 'awaiting_dns', 'dns_manual_confirmed', 'dns_verified', 'dns_failed')
  ),
  attempts int not null default 0,
  last_error text,
  next_check_at timestamptz,
  health_readback_id text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_domain_verification_state
  on public.project_domain_verification(state);

-- 3) Readback RPC: does the isolated project schema still exist? Used by the
--    delete saga to confirm removal BEFORE dropping the catalog row (no ghost catalog).
create or replace function public.project_schema_exists(p_schema_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_schema_name is null or p_schema_name !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'invalid schema name';
  end if;

  return exists (
    select 1 from information_schema.schemata
    where schema_name = p_schema_name
  );
end;
$$;

-- 4) provision_project: guard the exception block so a failure BEFORE the project
--    INSERT (v_project_id null) still writes a valid audit row (project_id nullable)
--    instead of silently skipping diagnostics (GDB-REM-012 acceptance 3).
create or replace function public.provision_project(
  p_name text,
  p_slug text,
  p_business_type text,
  p_template_key text,
  p_domain text default null,
  p_language text default 'pt',
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_project_id uuid;
  v_schema_name text;
begin
  v_schema_name := case p_business_type
    when 'blog' then 'blog_' || p_slug
    when 'store' then 'store_' || p_slug
    when 'saas' then 'saas_' || p_slug
    else 'custom_' || p_slug
  end;

  insert into public.projects (
    organization_id, name, slug, business_type, template_key, schema_name, domain, language, status, template_version
  ) values (
    p_organization_id, p_name, p_slug, p_business_type, p_template_key, v_schema_name, p_domain, p_language, 'pending',
    coalesce((select version from public.templates where template_key = p_template_key), '1.0.0')
  ) returning id into v_project_id;

  insert into public.provisioning_jobs (project_id, job_type, status, input_payload)
  values (
    v_project_id, 'create_project', 'running',
    jsonb_build_object('name', p_name, 'slug', p_slug, 'business_type', p_business_type, 'template_key', p_template_key, 'schema_name', v_schema_name)
  );

  if p_business_type = 'blog' then
    perform public.create_blog_schema(v_schema_name);
  elsif p_business_type = 'store' then
    perform public.create_store_schema(v_schema_name);
  elsif p_business_type = 'saas' then
    perform public.create_saas_schema(v_schema_name);
  else
    perform public.create_custom_schema(v_schema_name);
  end if;

  update public.projects set status = 'active' where id = v_project_id;
  update public.provisioning_jobs set status = 'success', output_payload = jsonb_build_object('schema_name', v_schema_name), finished_at = now() where project_id = v_project_id;
  insert into public.audit_logs (project_id, action, resource_type, resource_id, metadata)
  values (v_project_id, 'project.provisioned', 'project', v_project_id::text, jsonb_build_object('schema_name', v_schema_name));

  return v_project_id;
exception when others then
  -- Guarded failure handling: only update project/job when the project row exists,
  -- and always persist a sanitizable audit entry (project_id may be null).
  if v_project_id is not null then
    update public.projects set status = 'error' where id = v_project_id;
    update public.provisioning_jobs set status = 'error', error_message = sqlerrm, finished_at = now() where project_id = v_project_id;
  end if;
  insert into public.audit_logs (project_id, action, resource_type, resource_id, metadata)
  values (
    v_project_id,
    'project.provision_failed',
    'project',
    coalesce(v_project_id::text, p_slug),
    jsonb_build_object('error', sqlerrm, 'schema_name', v_schema_name, 'project_created', v_project_id is not null)
  );
  raise;
end;
$$;
