create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'archived', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  business_type text not null check (business_type in ('blog', 'store', 'saas', 'custom')),
  name text not null,
  version text not null default '1.0.0',
  source_path text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  slug text not null unique,
  business_type text not null check (business_type in ('blog', 'store', 'saas', 'custom')),
  template_key text not null,
  schema_name text not null unique,
  domain text,
  language text not null default 'pt',
  status text not null default 'pending' check (status in ('pending', 'active', 'archived', 'error')),
  template_version text not null default '1.0.0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  job_type text not null check (job_type in ('create_project', 'upgrade_template', 'rebuild_schema')),
  status text not null default 'pending' check (status in ('pending', 'running', 'success', 'error')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  project_id uuid references public.projects(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language plpgsql
security invoker
as $$
begin
  return true;
end;
$$;

create or replace function public.create_blog_schema(p_schema_name text)
returns void
language plpgsql
security definer
as $$
begin
  execute format('create schema if not exists %I', p_schema_name);
  execute format('create table if not exists %I.categories (id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now())', p_schema_name);
  execute format('create table if not exists %I.authors (id uuid primary key default gen_random_uuid(), name text not null, bio text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())', p_schema_name);
  execute format('create table if not exists %I.tags (id uuid primary key default gen_random_uuid(), name text not null unique, slug text not null unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now())', p_schema_name);
  execute format('create table if not exists %I.articles (id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null, excerpt text, content text, image_url text, description text, prompt_image text, search_terms text, status text not null default ''DRAFT'', published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), language text not null default ''pt'')', p_schema_name);
end;
$$;

create or replace function public.create_store_schema(p_schema_name text)
returns void
language plpgsql
security definer
as $$
begin
  execute format('create schema if not exists %I', p_schema_name);
  execute format('create table if not exists %I.products (id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, price numeric(12,2) not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now())', p_schema_name);
end;
$$;

create or replace function public.create_saas_schema(p_schema_name text)
returns void
language plpgsql
security definer
as $$
begin
  execute format('create schema if not exists %I', p_schema_name);
  execute format('create table if not exists %I.workspaces (id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now())', p_schema_name);
end;
$$;

create or replace function public.create_custom_schema(p_schema_name text)
returns void
language plpgsql
security definer
as $$
begin
  execute format('create schema if not exists %I', p_schema_name);
  execute format('create table if not exists %I.entities (id uuid primary key default gen_random_uuid(), key text not null unique, name text not null, type text not null, metadata jsonb not null default ''{}''::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now())', p_schema_name);
end;
$$;

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
  update public.projects set status = 'error' where id = v_project_id;
  update public.provisioning_jobs set status = 'error', error_message = sqlerrm, finished_at = now() where project_id = v_project_id;
  insert into public.audit_logs (project_id, action, resource_type, resource_id, metadata)
  values (v_project_id, 'project.provision_failed', 'project', v_project_id::text, jsonb_build_object('error', sqlerrm));
  raise;
end;
$$;

insert into public.templates (template_key, business_type, name, version, source_path, is_active)
values
  ('blog_standard', 'blog', 'Blog Standard', '1.0.0', 'generic_blog_schema_template.sql', true),
  ('store_standard', 'store', 'Store Standard', '1.0.0', 'generic_onlinestore_schema_template.sql', true),
  ('saas_standard', 'saas', 'SaaS Standard', '1.0.0', 'saas_standard_template.sql', true),
  ('custom_base', 'custom', 'Custom Base', '1.0.0', 'custom_base_template.sql', true)
on conflict (template_key) do update
set business_type = excluded.business_type,
    name = excluded.name,
    version = excluded.version,
    source_path = excluded.source_path,
    is_active = excluded.is_active,
    updated_at = now();
