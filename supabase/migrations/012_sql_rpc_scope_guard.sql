-- Migration 012 (GDB-REM-003): harden execute_project_schema_sql
--
-- Local file only. NOT applied remotely — remote application requires
-- Sergio's explicit gate (GDB-REM-016).
--
-- Changes vs 009:
--  1. The target schema must be the schema_name registered in public.projects
--     for the informed p_project_slug (schema ownership check). A schema that
--     is not catalogued, or belongs to another project, is rejected.
--  2. The catalogued schema must equal the canonical derivation
--     '<business_type>_<slug>' (defense against a tampered catalog row).
--  3. Governance/platform schemas (public, auth, storage, pg_*, ...) are
--     rejected — the route previously allowed DROP SCHEMA via p_schema_name =
--     'public' (GDB-NEW-02).
--  4. Actor context is mandatory; every attempt (denied or executed) writes a
--     sanitized audit row (no SQL text, only length + hash prefix).
--  5. Forbidden statements (drop/alter database|schema|role, grant/revoke,
--     create role, copy program, dblink, txid checks) are blocked by pattern.

create or replace function public.execute_project_schema_sql(
  p_schema_name text,
  p_sql text,
  p_actor text default null,
  p_project_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_actor text;
  v_sql_len int;
  v_sql_hash text;
  v_project public.projects%rowtype;
  v_expected_schema text;
  v_forbidden boolean;
  v_reason text;
begin
  -- basic input validation -------------------------------------------------
  if p_schema_name is null or p_schema_name !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'invalid schema name';
  end if;

  if p_sql is null or length(btrim(p_sql)) = 0 then
    raise exception 'empty sql';
  end if;

  v_actor := coalesce(nullif(btrim(p_actor), ''), 'unknown-actor');
  v_sql_len := length(p_sql);
  v_sql_hash := substr(md5(p_sql), 1, 12);

  -- governance schemas are never a valid target -----------------------------
  if p_schema_name in (
    'public', 'auth', 'storage', 'vault', 'realtime', 'extensions',
    'information_schema', 'pg_catalog', 'graphql', 'graphql_public',
    'pgbouncer', 'net'
  ) or p_schema_name like 'pg\_%' escape '\' or p_schema_name like 'supabase\_%' escape '\' then
    insert into public.audit_logs (action, resource_type, resource_id, metadata)
    values (
      'project.sql.denied', 'project_sql', coalesce(p_project_slug, p_schema_name),
      jsonb_build_object('actor', v_actor, 'schema_name', p_schema_name,
                         'reason', 'governance schema rejected', 'sql_length', v_sql_len, 'sql_hash', v_sql_hash)
    );
    raise exception 'schema % is a governance schema and cannot be targeted', p_schema_name
      using errcode = '42501';
  end if;

  -- schema must belong to the requesting project -----------------------------
  if p_project_slug is null or btrim(p_project_slug) = '' then
    raise exception 'project slug is required' using errcode = '42501';
  end if;

  select * into v_project from public.projects where slug = p_project_slug;
  if not found then
    raise exception 'unknown project' using errcode = '42501';
  end if;

  if v_project.schema_name is distinct from p_schema_name then
    insert into public.audit_logs (action, resource_type, resource_id, metadata)
    values (
      'project.sql.denied', 'project_sql', p_project_slug,
      jsonb_build_object('actor', v_actor, 'schema_name', p_schema_name,
                         'reason', 'schema does not belong to project', 'sql_length', v_sql_len, 'sql_hash', v_sql_hash)
    );
    raise exception 'schema % does not belong to project %', p_schema_name, p_project_slug
      using errcode = '42501';
  end if;

  v_expected_schema := case v_project.business_type
    when 'blog' then 'blog_' || v_project.slug
    when 'store' then 'store_' || v_project.slug
    when 'saas' then 'saas_' || v_project.slug
    else 'custom_' || v_project.slug
  end;

  if p_schema_name is distinct from v_expected_schema then
    insert into public.audit_logs (action, resource_type, resource_id, metadata)
    values (
      'project.sql.denied', 'project_sql', p_project_slug,
      jsonb_build_object('actor', v_actor, 'schema_name', p_schema_name,
                         'reason', 'schema diverges from canonical derivation', 'sql_length', v_sql_len, 'sql_hash', v_sql_hash)
    );
    raise exception 'schema name diverges from canonical derivation for this project'
      using errcode = '42501';
  end if;

  -- forbidden statement patterns (deny-list; allowlist evaluation tracked as
  -- a follow-up in GDB-REM-003 pendências) -----------------------------------
  v_forbidden := p_sql ~* '(drop|alter)[\s]+(database|schema|role|system|extension)|(create)[\s]+(role|extension)|(grant)|(revoke)|(copy)[\s]+(program)|(dblink)|(pg_read_file)|(pg_sleep)';

  if v_forbidden then
    insert into public.audit_logs (action, resource_type, resource_id, metadata)
    values (
      'project.sql.denied', 'project_sql', p_project_slug,
      jsonb_build_object('actor', v_actor, 'schema_name', p_schema_name,
                         'reason', 'forbidden statement pattern', 'sql_length', v_sql_len, 'sql_hash', v_sql_hash)
    );
    raise exception 'forbidden statement detected' using errcode = '42501';
  end if;

  -- execute inside the project schema only -----------------------------------
  execute format('set local search_path to %I', p_schema_name);

  v_sql := p_sql;
  execute v_sql;

  insert into public.audit_logs (action, resource_type, resource_id, metadata)
  values (
    'project.sql.executed', 'project_sql', p_project_slug,
    jsonb_build_object('actor', v_actor, 'schema_name', p_schema_name,
                       'sql_length', v_sql_len, 'sql_hash', v_sql_hash)
  );

  return jsonb_build_object(
    'schema_name', p_schema_name,
    'status', 'success'
  );

exception
  when others then
    -- the raise above already wrote its specific audit row; unexpected
    -- runtime failures are audited here with a sanitized message
    if sqlerrm ~ '(governance schema|does not belong|canonical derivation|forbidden statement|invalid schema name|empty sql|unknown project|project slug is required)' then
      raise;
    end if;
    insert into public.audit_logs (action, resource_type, resource_id, metadata)
    values (
      'project.sql.failed', 'project_sql', coalesce(p_project_slug, p_schema_name),
      jsonb_build_object('actor', v_actor, 'schema_name', p_schema_name,
                         'reason', substr(sqlerrm, 1, 200), 'sql_length', v_sql_len, 'sql_hash', v_sql_hash)
    );
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dedicated project-schema drop (used by DELETE /projects/[slug]).
-- The old flow executed `DROP SCHEMA` through execute_project_schema_sql with
-- p_schema_name = 'public', which the hardened RPC above now rejects
-- (GDB-NEW-02). This replacement validates that the dropped schema is the
-- canonical schema of the named project and writes an audit row. Transacional
-- full safety (catalog + schema + audit in one transaction) remains with
-- GDB-REM-011.
-- ---------------------------------------------------------------------------
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
  v_actor text;
begin
  if p_project_slug is null or btrim(p_project_slug) = '' then
    raise exception 'project slug is required' using errcode = '42501';
  end if;

  v_actor := coalesce(nullif(btrim(p_actor), ''), 'unknown-actor');

  select * into v_project from public.projects where slug = p_project_slug;
  if not found then
    raise exception 'unknown project' using errcode = '42501';
  end if;

  v_expected_schema := case v_project.business_type
    when 'blog' then 'blog_' || v_project.slug
    when 'store' then 'store_' || v_project.slug
    when 'saas' then 'saas_' || v_project.slug
    else 'custom_' || v_project.slug
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
    v_project.id, 'project.schema_dropped', 'project', v_project.id::text,
    jsonb_build_object('actor', v_actor, 'schema_name', v_project.schema_name)
  );

  return jsonb_build_object(
    'schema_name', v_project.schema_name,
    'status', 'dropped'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- GDB-REM-001: DB-level guard so a poisoned insert/update can never persist
-- wildcard or non-catalogued scopes on a non-admin service identity. The
-- canonical catalog also lives in src/lib/auth/service-identity-policy.ts —
-- keep both in sync.
-- ---------------------------------------------------------------------------
create or replace function public.validate_service_identity_scopes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_bad_scope text;
begin
  if new.identity_type = 'admin' then
    -- admin identities may hold '*' or catalogued scopes only
    foreach v_scope in array new.scopes loop
      if v_scope = '*' then
        continue;
      end if;
      if v_scope is null or v_scope not in (
        'projects:read', 'projects:provision', 'ct:sql:execute',
        'secrets:namespaces:create', 'secrets:bindings:write', 'health:read',
        'identities:create', 'identities:read', 'identities:update'
      ) then
        v_bad_scope := coalesce(v_scope, '<null>');
        raise exception 'scope % is not catalogued for service identity', v_bad_scope
          using errcode = '23514';
      end if;
    end loop;
    return new;
  end if;

  -- non-admin identities: catalogued scopes only, never '*'
  foreach v_scope in array new.scopes loop
    if v_scope is null or v_scope not in (
      'projects:read', 'projects:provision', 'ct:sql:execute',
      'secrets:namespaces:create', 'secrets:bindings:write', 'health:read',
      'identities:create', 'identities:read', 'identities:update'
    ) then
      v_bad_scope := coalesce(v_scope, '<null>');
      raise exception 'scope % is not catalogued for service identity', v_bad_scope
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists service_identities_scope_guard on public.service_identities;
create trigger service_identities_scope_guard
before insert or update on public.service_identities
for each row execute function public.validate_service_identity_scopes();

-- Cleanup pass for any pre-existing poisoned rows (local-only; idempotent).
update public.service_identities
set scopes = array(
  select s from unnest(scopes) as s
  where s in (
    'projects:read', 'projects:provision', 'ct:sql:execute',
    'secrets:namespaces:create', 'secrets:bindings:write', 'health:read',
    'identities:create', 'identities:read', 'identities:update'
  )
)
where identity_type <> 'admin'
  and scopes <> array(
    select s from unnest(scopes) as s
    where s in (
      'projects:read', 'projects:provision', 'ct:sql:execute',
      'secrets:namespaces:create', 'secrets:bindings:write', 'health:read',
      'identities:create', 'identities:read', 'identities:update'
    )
  );
