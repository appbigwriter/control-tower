-- Migration 017: normalize slug when validating canonical project schemas.
-- Existing projects may use hyphenated slugs while PostgreSQL schema names are
-- normalized with underscores (e.g. control-tower-blog -> control_tower_blog).

create or replace function public.drop_project_schema(
  p_project_slug text,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_expected_schema text;
  v_normalized_slug text;
  v_actor text;
begin
  if p_project_slug is null or btrim(p_project_slug) = '' then
    raise exception 'project slug is required' using errcode = '42501';
  end if;

  v_actor := coalesce(nullif(btrim(p_actor), ''), 'unknown-actor');

  select * into v_project
  from public.projects
  where slug = p_project_slug;

  if not found then
    raise exception 'unknown project' using errcode = '42501';
  end if;

  v_normalized_slug := regexp_replace(lower(v_project.slug), '[^a-z0-9_]', '_', 'g');
  v_expected_schema := case v_project.business_type
    when 'blog' then 'blog_' || v_normalized_slug
    when 'store' then 'store_' || v_normalized_slug
    when 'saas' then 'saas_' || v_normalized_slug
    else 'custom_' || v_normalized_slug
  end;

  if v_project.schema_name is distinct from v_expected_schema then
    raise exception 'schema name diverges from canonical derivation for this project'
      using errcode = '42501';
  end if;

  if v_project.schema_name is null or v_project.schema_name in (
    'public', 'auth', 'storage', 'vault', 'realtime', 'extensions'
  ) or v_project.schema_name like 'pg\_%' escape '\' then
    raise exception 'refusing to drop governance schema' using errcode = '42501';
  end if;

  execute format('drop schema if exists %I cascade', v_project.schema_name);

  insert into public.audit_logs (project_id, action, resource_type, resource_id, metadata)
  values (
    v_project.id,
    'project.schema_dropped',
    'project',
    v_project.id::text,
    jsonb_build_object(
      'actor', v_actor,
      'schema_name', v_project.schema_name,
      'normalized_slug', v_normalized_slug
    )
  );

  return jsonb_build_object(
    'schema_name', v_project.schema_name,
    'status', 'dropped'
  );
end;
$$;

grant execute on function public.drop_project_schema(text, text) to service_role;
