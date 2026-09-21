-- =============================================================================
-- Migration 012: GDB-REM-004 / 005 / 006 / 007
-- Integridade business_type->template, tratamento de erro RPC, idempotencia
-- de provisionamento e maquina de estados (retries/blockers/transicoes).
--
-- ESCopo: catálogo projects/provisioning_jobs (track GDB-REM-004..007).
-- NAO aplicar em remoto sem Gate do Sergio (GDB-REM-016).
-- Espelha src/lib/control-tower/provisioning.ts (fonte canonica em TS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) Normalizar estados legados 'error' -> 'failed' ANTES de trocar constraints
-- -----------------------------------------------------------------------------

update public.projects set status = 'failed' where status = 'error';
update public.provisioning_jobs set status = 'failed' where status = 'error';

-- -----------------------------------------------------------------------------
-- 1) GDB-REM-007 — maquina de estados canonica (constraints)
--    projects: pending|active|archived|failed|blocked|retrying|waiting_external
--    jobs:     pending|running|success|failed|blocked|retrying|waiting_external
-- -----------------------------------------------------------------------------

alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('pending', 'active', 'archived', 'failed', 'blocked', 'retrying', 'waiting_external'));

alter table public.provisioning_jobs drop constraint if exists provisioning_jobs_status_check;
alter table public.provisioning_jobs add constraint provisioning_jobs_status_check
  check (status in ('pending', 'running', 'success', 'failed', 'blocked', 'retrying', 'waiting_external'));

-- Colunas de retry/blocker/correlation (GDB-REM-006/007)
alter table public.provisioning_jobs add column if not exists attempt_count integer not null default 1;
alter table public.provisioning_jobs add column if not exists next_retry_at timestamptz;
alter table public.provisioning_jobs add column if not exists last_error text;
alter table public.provisioning_jobs add column if not exists blocked_owner text;
alter table public.provisioning_jobs add column if not exists blocked_next_check_at timestamptz;
alter table public.provisioning_jobs add column if not exists blocked_closure_criterion text;
alter table public.provisioning_jobs add column if not exists correlation_id text;
alter table public.provisioning_jobs add column if not exists transition_evidence jsonb not null default '{}'::jsonb;

alter table public.projects add column if not exists correlation_id text;
alter table public.projects add column if not exists transition_evidence jsonb not null default '{}'::jsonb;

create index if not exists idx_provisioning_jobs_project_created
  on public.provisioning_jobs (project_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 2) GDB-REM-006 — tabela de idempotencia (unique por operacao)
-- -----------------------------------------------------------------------------

create table if not exists public.provisioning_idempotency (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  operation text not null check (operation in ('provision_project', 'rebuild_schema')),
  request_fingerprint text not null,
  project_id uuid references public.projects(id) on delete set null,
  job_id uuid references public.provisioning_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key, operation)
);

-- -----------------------------------------------------------------------------
-- 3) GDB-REM-007 — log de transicoes (before/after, actor, motivo, timestamp,
--    correlation e evidencia) + enforcement em QUALQUER writer
-- -----------------------------------------------------------------------------

create table if not exists public.entity_state_transitions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('project', 'job')),
  entity_id uuid not null,
  from_status text not null,
  to_status text not null,
  actor text not null default 'system',
  reason text,
  correlation_id text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_entity_state_transitions_entity
  on public.entity_state_transitions (entity_type, entity_id, created_at desc);

-- Tabela canonica de transicoes (espelha PROJECT_TRANSITIONS/JOB_TRANSITIONS em TS)
create or replace function public.allowed_state_transition(p_entity_type text, p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  with allowed(entity_type, from_status, to_status) as (
    values
      -- project
      ('project', 'pending', 'active'),
      ('project', 'pending', 'archived'),
      ('project', 'pending', 'failed'),
      ('project', 'pending', 'blocked'),
      ('project', 'pending', 'waiting_external'),
      ('project', 'pending', 'retrying'),
      ('project', 'active', 'archived'),
      ('project', 'active', 'failed'),
      ('project', 'active', 'blocked'),
      ('project', 'active', 'waiting_external'),
      ('project', 'active', 'retrying'),
      ('project', 'archived', 'active'),
      ('project', 'blocked', 'pending'),
      ('project', 'blocked', 'retrying'),
      ('project', 'blocked', 'failed'),
      ('project', 'blocked', 'active'),
      ('project', 'failed', 'pending'),
      ('project', 'failed', 'retrying'),
      ('project', 'failed', 'active'),
      ('project', 'waiting_external', 'retrying'),
      ('project', 'waiting_external', 'blocked'),
      ('project', 'waiting_external', 'active'),
      ('project', 'waiting_external', 'failed'),
      ('project', 'retrying', 'active'),
      ('project', 'retrying', 'failed'),
      ('project', 'retrying', 'blocked'),
      ('project', 'retrying', 'waiting_external'),
      ('project', 'retrying', 'retrying'),
      -- job
      ('job', 'pending', 'running'),
      ('job', 'pending', 'blocked'),
      ('job', 'pending', 'failed'),
      ('job', 'running', 'success'),
      ('job', 'running', 'failed'),
      ('job', 'running', 'retrying'),
      ('job', 'running', 'blocked'),
      ('job', 'running', 'waiting_external'),
      ('job', 'retrying', 'running'),
      ('job', 'retrying', 'failed'),
      ('job', 'retrying', 'blocked'),
      ('job', 'waiting_external', 'running'),
      ('job', 'waiting_external', 'blocked'),
      ('job', 'waiting_external', 'failed'),
      ('job', 'blocked', 'running'),
      ('job', 'blocked', 'pending'),
      ('job', 'blocked', 'failed'),
      ('job', 'failed', 'retrying')
  )
  select exists (
    select 1 from allowed a
    where a.entity_type = p_entity_type
      and a.from_status = (case when p_from = 'error' then 'failed' else p_from end)
      and a.to_status = (case when p_to = 'error' then 'failed' else p_to end)
  );
$$;

-- Trigger: valida transicao e registra log para QUALQUER update de status
-- (routes, RPCs ou SQL manual). Actor/correlation/reason vem de variaveis de
-- sessao transacionais (gdb.actor / gdb.correlation_id / gdb.reason).
create or replace function public.enforce_state_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := TG_ARGV[0];
  v_from text;
  v_to text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_from := case when old.status = 'error' then 'failed' else old.status end;
  v_to := case when new.status = 'error' then 'failed' else new.status end;

  if not public.allowed_state_transition(v_entity, v_from, v_to) then
    raise exception 'GDB_INVALID_TRANSITION: % "%" -> "%" nao permitida', v_entity, v_from, v_to
      using errcode = 'GD007';
  end if;

  insert into public.entity_state_transitions
    (entity_type, entity_id, from_status, to_status, actor, reason, correlation_id, evidence)
  values (
    v_entity,
    new.id,
    v_from,
    v_to,
    coalesce(nullif(current_setting('gdb.actor', true), ''), 'system'),
    nullif(current_setting('gdb.reason', true), ''),
    nullif(current_setting('gdb.correlation_id', true), ''),
    coalesce(new.transition_evidence, '{}'::jsonb)
  );

  return new;
end;
$$;

drop trigger if exists trg_projects_state_transition on public.projects;
create trigger trg_projects_state_transition
  before update of status on public.projects
  for each row execute function public.enforce_state_transition('project');

drop trigger if exists trg_provisioning_jobs_state_transition on public.provisioning_jobs;
create trigger trg_provisioning_jobs_state_transition
  before update of status on public.provisioning_jobs
  for each row execute function public.enforce_state_transition('job');

-- -----------------------------------------------------------------------------
-- 4) GDB-REM-004/005 — catalogo de tabelas esperadas + readback estrutural
-- -----------------------------------------------------------------------------

create or replace function public.expected_tables_for_type(p_business_type text)
returns text[]
language sql
immutable
as $$
  select case p_business_type
    when 'blog' then array[
      'articles', 'categories', 'authors', 'tags', 'article_tags', 'media_assets',
      'redirects', 'settings', 'site_config'
    ]
    when 'store' then array[
      'products', 'categories', 'product_images', 'variants', 'customers',
      'orders', 'order_items', 'inventory_movements', 'settings'
    ]
    when 'saas' then array[
      'organizations', 'workspaces', 'workspace_members', 'plans', 'subscriptions',
      'subscription_items', 'billing_accounts', 'invoices', 'usage_events',
      'feature_flags', 'api_keys', 'notifications', 'settings'
    ]
    when 'custom' then array[
      'entities', 'entity_relations', 'records', 'files', 'settings', 'audit_logs', 'events'
    ]
    else null
  end;
$$;

-- Readback estrutural: schema existe + nenhuma tabela esperada ausente.
create or replace function public.verify_project_schema(p_schema_name text, p_business_type text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with exp as (
    select unnest(public.expected_tables_for_type(p_business_type)) as tbl
  )
  select jsonb_build_object(
    'schema_exists', exists (select 1 from information_schema.schemata where schema_name = p_schema_name),
    'expected_tables', public.expected_tables_for_type(p_business_type),
    'missing_tables', coalesce((
      select array_agg(e.tbl order by e.tbl)
      from exp e
      where not exists (
        select 1 from information_schema.tables t
        where t.table_schema = p_schema_name and t.table_name = e.tbl
      )
    ), '{}'::text[]),
    'verified_at', now()
  );
$$;

-- -----------------------------------------------------------------------------
-- 5) GDB-REM-005/007 — execucao de job de schema com classificacao de falha,
--    retry (attempt_count/next_retry_at/last_error) e blocker com owner/nextCheck.
--    Sucesso SOMENTE apos readback estrutural; evidencia grava na transicao.
-- -----------------------------------------------------------------------------

create or replace function public.execute_schema_job_attempt(
  p_job_id uuid,
  p_project_id uuid,
  p_schema_name text,
  p_business_type text,
  p_attempt integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_readback jsonb;
  v_class text;
  v_err text;
  v_state text;
  v_next_retry timestamptz;
begin
  begin
    if p_business_type = 'blog' then
      perform public.create_blog_schema(p_schema_name);
    elsif p_business_type = 'store' then
      perform public.create_store_schema(p_schema_name);
    elsif p_business_type = 'saas' then
      perform public.create_saas_schema(p_schema_name);
    elsif p_business_type = 'custom' then
      perform public.create_custom_schema(p_schema_name);
    else
      raise exception 'GDB_INVALID_BUSINESS_TYPE: business_type "%" invalido', p_business_type
        using errcode = 'GD004';
    end if;

    -- GDB-REM-005: readback ANTES de success
    v_readback := public.verify_project_schema(p_schema_name, p_business_type);

    if not coalesce((v_readback->>'schema_exists')::boolean, false) then
      raise exception 'GDB_SCHEMA_READBACK_INCOMPLETE: schema "%" nao existe apos provisionamento', p_schema_name
        using errcode = 'GD010';
    end if;

    if coalesce(jsonb_array_length(v_readback->'missing_tables'), 0) > 0 then
      raise exception 'GDB_SCHEMA_READBACK_INCOMPLETE: tabelas ausentes em "%": %', p_schema_name, v_readback->>'missing_tables'
        using errcode = 'GD010';
    end if;

    perform set_config('gdb.reason', 'readback estrutural completo', false);

    update public.provisioning_jobs
    set status = 'success',
        finished_at = now(),
        last_error = null,
        next_retry_at = null,
        attempt_count = p_attempt,
        output_payload = jsonb_build_object('schema_name', p_schema_name, 'readback', v_readback),
        transition_evidence = jsonb_build_object('readback', v_readback)
    where id = p_job_id;

    update public.projects
    set status = 'active',
        transition_evidence = jsonb_build_object('readback', v_readback, 'job_id', p_job_id)
    where id = p_project_id;

    return jsonb_build_object(
      'ok', true,
      'job_status', 'success',
      'project_status', 'active',
      'readback', v_readback
    );

  exception when others then
    v_err := sqlerrm;
    v_state := sqlstate;
    get stacked diagnostics v_err = MESSAGE_TEXT;

    -- Classificacao espelha classifyRpcFailure() em TS
    if v_err like 'GDB_SCHEMA_READBACK_INCOMPLETE%' or v_state in ('55P03', '55006') then
      v_class := 'blocked';
    elsif v_state in ('40001', '40P01', '57014', '08000', '08001', '08003', '08004', '08006')
          or v_err ~* 'timeout|timed out|connection|network|econnreset|fetch failed|temporarily unavailable' then
      v_class := case when p_attempt >= 5 then 'failed' else 'retrying' end;
    else
      v_class := 'failed';
    end if;

    if v_class = 'retrying' then
      v_next_retry := now() + make_interval(secs => least(5 * (2 ^ (p_attempt - 1)), 600)::double precision);
    end if;

    perform set_config('gdb.reason', left('falha classificada como ' || v_class || ': ' || v_err, 480), false);

    update public.provisioning_jobs
    set status = v_class,
        last_error = left(v_err, 500),
        finished_at = case when v_class = 'failed' then now() else finished_at end,
        attempt_count = p_attempt,
        next_retry_at = v_next_retry,
        blocked_owner = case when v_class = 'blocked' then 'control-tower-ops' else blocked_owner end,
        blocked_next_check_at = case when v_class = 'blocked' then now() + interval '10 minutes' else blocked_next_check_at end,
        blocked_closure_criterion = case when v_class = 'blocked'
          then 'readback do schema retorna schema_exists=true e missing_tables=vazio'
          else blocked_closure_criterion end,
        output_payload = jsonb_build_object('schema_name', p_schema_name),
        transition_evidence = jsonb_build_object('error_class', v_class)
    where id = p_job_id;

    update public.projects
    set status = v_class,
        transition_evidence = jsonb_build_object('error_class', v_class, 'job_id', p_job_id)
    where id = p_project_id;

    return jsonb_build_object(
      'ok', false,
      'job_status', v_class,
      'project_status', v_class,
      'error', left(v_err, 500),
      'next_retry_at', v_next_retry
    );
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) GDB-REM-004/005/006 — provision_project_v2
--    - rejeita par business_type/template divergente (GD001) antes de criar algo
--    - rejeita template inexistente/inativo (GD002)
--    - idempotencia por (idempotency_key, operation): replay retorna original,
--      fingerprint divergente -> conflito (GD003), reconcilia por slug sem duplicar
--    - falha de execucao persiste job/project em failed/blocked/retrying
-- -----------------------------------------------------------------------------

create or replace function public.provision_project_v2(
  p_name text,
  p_slug text,
  p_business_type text,
  p_template_key text,
  p_domain text default null,
  p_language text default 'pt',
  p_organization_id uuid default null,
  p_idempotency_key text default null,
  p_request_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_template text;
  v_template_active boolean;
  v_schema_name text;
  v_project_id uuid;
  v_project_status text;
  v_job_id uuid;
  v_job_status text;
  v_attempt integer;
  v_result jsonb;
  v_fingerprint text;
  v_idem record;
  v_by_slug record;
begin
  -- ===== GDB-REM-004: validacao canonica do PAR (espelha TS) =====
  v_expected_template := case p_business_type
    when 'blog' then 'blog_standard'
    when 'store' then 'store_standard'
    when 'saas' then 'saas_standard'
    when 'custom' then 'custom_base'
    else null
  end;

  if v_expected_template is null then
    raise exception 'GDB_INVALID_BUSINESS_TYPE: business_type "%" invalido (aceitos: blog, store, saas, custom)', p_business_type
      using errcode = 'GD004';
  end if;

  if p_template_key is distinct from v_expected_template then
    raise exception 'GDB_TEMPLATE_MISMATCH: business_type "%" exige template "%", recebido "%"', p_business_type, v_expected_template, p_template_key
      using errcode = 'GD001';
  end if;

  select t.is_active into v_template_active from public.templates t where t.template_key = p_template_key;
  if v_template_active is null then
    raise exception 'GDB_TEMPLATE_INACTIVE_OR_MISSING: template "%" nao existe no catalogo', p_template_key
      using errcode = 'GD002';
  end if;
  if not v_template_active then
    raise exception 'GDB_TEMPLATE_INACTIVE_OR_MISSING: template "%" esta inativo e nao pode provisionar', p_template_key
      using errcode = 'GD002';
  end if;

  -- ===== GDB-REM-006: idempotencia =====
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 or length(btrim(p_idempotency_key)) > 128 then
    raise exception 'GDB_INVALID_IDEMPOTENCY_KEY: Idempotency-Key obrigatoria (8-128 caracteres), recebida "%"', p_idempotency_key
      using errcode = 'GD005';
  end if;

  v_fingerprint := coalesce(p_request_fingerprint, 'nofingerprint');

  perform set_config('gdb.actor', 'provision_project_v2', false);
  perform set_config('gdb.correlation_id', p_idempotency_key, false);
  perform set_config('gdb.reason', 'provisionamento de projeto', false);

  -- Replay pela chave
  select * into v_idem from public.provisioning_idempotency
  where idempotency_key = p_idempotency_key and operation = 'provision_project'
  for update;

  if found then
    if v_idem.request_fingerprint is distinct from v_fingerprint then
      raise exception 'GDB_IDEMPOTENCY_KEY_CONFLICT: chave "%" ja usada com payload diferente', p_idempotency_key
        using errcode = 'GD003';
    end if;

    select p.id, p.status into v_project_id, v_project_status
    from public.projects p where p.id = v_idem.project_id;

    if v_project_id is not null then
      select j.id, j.status, j.attempt_count into v_job_id, v_job_status, v_attempt
      from public.provisioning_jobs j where j.id = v_idem.job_id;

      if v_job_id is not null and v_job_status = 'success' then
        return jsonb_build_object(
          'ok', true,
          'status', 'replayed',
          'project_id', v_project_id,
          'job_id', v_job_id,
          'project_status', v_project_status,
          'job_status', v_job_status
        );
      end if;

      -- tentativa anterior nao terminou em success: re-tentativa NO MESMO job
      if v_job_id is not null then
        v_attempt := coalesce(v_attempt, 1) + 1;
        if v_job_status = 'failed' then
          perform set_config('gdb.reason', 're-tentativa apos falha (job original preservado)', false);
          update public.provisioning_jobs set status = 'retrying' where id = v_job_id;
        end if;
        perform set_config('gdb.reason', 're-tentativa de provisionamento', false);
        update public.provisioning_jobs
        set status = 'running', attempt_count = v_attempt, correlation_id = p_idempotency_key
        where id = v_job_id;
        perform set_config('gdb.reason', 're-tentativa idempotente de provision_project', false);
        v_result := public.execute_schema_job_attempt(v_job_id, v_project_id,
          (select schema_name from public.projects where id = v_project_id), p_business_type, v_attempt);
        return v_result || jsonb_build_object(
          'status', 'retry', 'project_id', v_project_id, 'job_id', v_job_id
        );
      end if;
      -- job sumiu (delete set null): segue como fresh rebind abaixo
    end if;
    -- projeto sumiu (deletado): re-provisiona reutilizando a chave
  end if;

  -- ===== Reconciliacao por slug (evento duplicado sem mesma chave) =====
  select p.id, p.status, p.name, p.business_type, p.template_key, p.schema_name
  into v_by_slug
  from public.projects p where p.slug = p_slug;

  if v_by_slug.id is not null then
    if v_by_slug.name is distinct from p_name
      or v_by_slug.business_type is distinct from p_business_type
      or v_by_slug.template_key is distinct from p_template_key then
      raise exception 'GDB_SLUG_CONFLICT: slug "%" ja pertence ao projeto % com payload diferente', p_slug, v_by_slug.id
        using errcode = 'GD006';
    end if;

    -- mesmo payload: reconcilia SEM duplicar projeto/schema
    perform set_config('gdb.reason', 'reconciliacao por slug (sem duplicacao)', false);
    insert into public.provisioning_jobs (project_id, job_type, status, input_payload, correlation_id, attempt_count)
    values (
      v_by_slug.id, 'create_project', 'pending',
      jsonb_build_object('name', p_name, 'slug', p_slug, 'business_type', p_business_type,
        'template_key', p_template_key, 'schema_name', v_by_slug.schema_name,
        'idempotency_key', p_idempotency_key, 'reconciled', true),
      p_idempotency_key, 1
    )
    returning id into v_job_id;

    insert into public.provisioning_idempotency (idempotency_key, operation, request_fingerprint, project_id, job_id)
    values (p_idempotency_key, 'provision_project', v_fingerprint, v_by_slug.id, v_job_id)
    on conflict (idempotency_key, operation) do update
      set project_id = excluded.project_id, job_id = excluded.job_id, updated_at = now();

    perform set_config('gdb.reason', 'reconciliacao: reexecucao idempotente do schema', false);
    update public.provisioning_jobs set status = 'running' where id = v_job_id;

    v_result := public.execute_schema_job_attempt(v_job_id, v_by_slug.id, v_by_slug.schema_name, p_business_type, 1);

    return v_result || jsonb_build_object(
      'status', 'reconciled', 'project_id', v_by_slug.id, 'job_id', v_job_id
    );
  end if;

  -- ===== Provisionamento novo =====
  v_schema_name := case p_business_type
    when 'blog' then 'blog_' || p_slug
    when 'store' then 'store_' || p_slug
    when 'saas' then 'saas_' || p_slug
    else 'custom_' || p_slug
  end;

  perform set_config('gdb.reason', 'criacao de projeto', false);

  insert into public.projects (
    organization_id, name, slug, business_type, template_key, schema_name, domain,
    language, status, template_version, correlation_id
  ) values (
    p_organization_id, p_name, p_slug, p_business_type, p_template_key, v_schema_name, p_domain,
    p_language, 'pending',
    coalesce((select version from public.templates where template_key = p_template_key), '1.0.0'),
    p_idempotency_key
  )
  returning id into v_project_id;

  insert into public.provisioning_jobs (project_id, job_type, status, input_payload, correlation_id, attempt_count)
  values (
    v_project_id, 'create_project', 'pending',
    jsonb_build_object('name', p_name, 'slug', p_slug, 'business_type', p_business_type,
      'template_key', p_template_key, 'schema_name', v_schema_name, 'idempotency_key', p_idempotency_key),
    p_idempotency_key, 1
  )
  returning id into v_job_id;

  insert into public.provisioning_idempotency (idempotency_key, operation, request_fingerprint, project_id, job_id)
  values (p_idempotency_key, 'provision_project', v_fingerprint, v_project_id, v_job_id)
  on conflict (idempotency_key, operation) do update
    set project_id = excluded.project_id, job_id = excluded.job_id,
        request_fingerprint = excluded.request_fingerprint, updated_at = now();

  perform set_config('gdb.reason', 'execucao do provisionamento', false);
  update public.provisioning_jobs set status = 'running' where id = v_job_id;

  v_result := public.execute_schema_job_attempt(v_job_id, v_project_id, v_schema_name, p_business_type, 1);

  if coalesce((v_result->>'ok')::boolean, false) then
    insert into public.audit_logs (project_id, action, resource_type, resource_id, metadata)
    values (v_project_id, 'project.provisioned', 'project', v_project_id::text,
      jsonb_build_object('schema_name', v_schema_name, 'job_id', v_job_id,
        'idempotency_key', p_idempotency_key, 'readback', v_result->'readback'));
  end if;

  return v_result || jsonb_build_object(
    'status', 'created', 'project_id', v_project_id, 'job_id', v_job_id
  );

exception
  when unique_violation then
    -- corrida concurrente no slug: o outro commit venceu -> reconcilia
    select p.id, p.status, p.name, p.business_type, p.template_key, p.schema_name
    into v_by_slug
    from public.projects p where p.slug = p_slug;

    if v_by_slug.id is not null
      and v_by_slug.name = p_name
      and v_by_slug.business_type = p_business_type
      and v_by_slug.template_key = p_template_key then
      raise exception 'GDB_SLUG_CONFLICT_RECONCILE: projeto % ja criado concorrentemente para slug "%"', v_by_slug.id, p_slug
        using errcode = 'GD011';
    end if;

    raise exception 'GDB_SLUG_CONFLICT: slug "%" ja em uso por projeto com payload diferente', p_slug
      using errcode = 'GD006';
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) GDB-REM-005/006/007 — rebuild_project_schema_v2
--    rebuild idempotente por chave; re-tentativa reusa o MESMO job
--    (attempt_count/next_retry_at/last_error); success apenas com readback.
-- -----------------------------------------------------------------------------

create or replace function public.rebuild_project_schema_v2(
  p_project_id uuid,
  p_schema_name text,
  p_business_type text,
  p_template_key text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_template text;
  v_template_active boolean;
  v_job_id uuid;
  v_job_status text;
  v_attempt integer;
  v_result jsonb;
  v_project_status text;
begin
  -- GDB-REM-004 (defesa em profundidade sobre o par armazenado)
  v_expected_template := case p_business_type
    when 'blog' then 'blog_standard'
    when 'store' then 'store_standard'
    when 'saas' then 'saas_standard'
    when 'custom' then 'custom_base'
    else null
  end;

  if v_expected_template is null then
    raise exception 'GDB_INVALID_BUSINESS_TYPE: business_type "%" invalido', p_business_type
      using errcode = 'GD004';
  end if;

  if p_template_key is distinct from v_expected_template then
    raise exception 'GDB_TEMPLATE_MISMATCH: projeto % tem par business_type/template divergente ("%"/"%")', p_project_id, p_business_type, p_template_key
      using errcode = 'GD001';
  end if;

  select t.is_active into v_template_active from public.templates t where t.template_key = p_template_key;
  if v_template_active is null or not v_template_active then
    raise exception 'GDB_TEMPLATE_INACTIVE_OR_MISSING: template "%" inexistente ou inativo bloqueia rebuild', p_template_key
      using errcode = 'GD002';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception 'GDB_INVALID_IDEMPOTENCY_KEY: chave obrigatoria para rebuild (8-128 caracteres)'
      using errcode = 'GD005';
  end if;

  perform set_config('gdb.actor', 'rebuild_project_schema_v2', false);
  perform set_config('gdb.correlation_id', p_idempotency_key, false);

  select status into v_project_status from public.projects where id = p_project_id;
  if v_project_status is null then
    raise exception 'GDB_PROJECT_NOT_FOUND: projeto % nao existe', p_project_id
      using errcode = 'GD008';
  end if;

  -- idempotencia de rebuild
  select j.id, j.status, j.attempt_count into v_job_id, v_job_status, v_attempt
  from public.provisioning_idempotency i
  join public.provisioning_jobs j on j.id = i.job_id
  where i.idempotency_key = p_idempotency_key and i.operation = 'rebuild_schema'
  for update of i;

  if v_job_id is not null then
    if exists (
      select 1 from public.provisioning_idempotency i
      where i.idempotency_key = p_idempotency_key and i.operation = 'rebuild_schema'
        and i.request_fingerprint is distinct from coalesce(p_request_fingerprint, 'nofingerprint')
    ) then
      raise exception 'GDB_IDEMPOTENCY_KEY_CONFLICT: chave "%" ja usada com payload diferente', p_idempotency_key
        using errcode = 'GD003';
    end if;

    if v_job_status = 'success' then
      return jsonb_build_object(
        'ok', true,
        'status', 'replayed',
        'project_id', p_project_id,
        'job_id', v_job_id,
        'job_status', 'success',
        'project_status', v_project_status,
        'readback', (select output_payload->'readback' from public.provisioning_jobs where id = v_job_id)
      );
    end if;

    -- re-tentativa no MESMO job (observabilidade de tentativas)
    v_attempt := coalesce(v_attempt, 1) + 1;
    if v_job_status = 'failed' then
      perform set_config('gdb.reason', 'retry de rebuild apos falha', false);
      update public.provisioning_jobs set status = 'retrying' where id = v_job_id;
    end if;
    perform set_config('gdb.reason', 're-tentativa de rebuild', false);
    update public.provisioning_jobs
    set status = 'running', attempt_count = v_attempt, correlation_id = p_idempotency_key
    where id = v_job_id;

    v_result := public.execute_schema_job_attempt(v_job_id, p_project_id, p_schema_name, p_business_type, v_attempt);

    if coalesce((v_result->>'ok')::boolean, false) then
      insert into public.audit_logs (project_id, action, resource_type, resource_id, metadata)
      values (p_project_id, 'project.rebuilt', 'project', p_project_id::text,
        jsonb_build_object('schema_name', p_schema_name, 'job_id', v_job_id,
          'idempotency_key', p_idempotency_key, 'readback', v_result->'readback'));
    end if;

    return v_result || jsonb_build_object('status', 'retry', 'project_id', p_project_id, 'job_id', v_job_id);
  end if;

  -- novo job de rebuild
  perform set_config('gdb.reason', 'criacao de job de rebuild', false);
  insert into public.provisioning_jobs (project_id, job_type, status, input_payload, correlation_id, attempt_count)
  values (
    p_project_id, 'rebuild_schema', 'pending',
    jsonb_build_object('schema_name', p_schema_name, 'business_type', p_business_type,
      'idempotency_key', p_idempotency_key),
    p_idempotency_key, 1
  )
  returning id into v_job_id;

  insert into public.provisioning_idempotency (idempotency_key, operation, request_fingerprint, project_id, job_id)
  values (p_idempotency_key, 'rebuild_schema', coalesce(p_request_fingerprint, 'nofingerprint'), p_project_id, v_job_id)
  on conflict (idempotency_key, operation) do update
    set project_id = excluded.project_id, job_id = excluded.job_id,
        request_fingerprint = excluded.request_fingerprint, updated_at = now();

  perform set_config('gdb.reason', 'execucao de rebuild', false);
  update public.provisioning_jobs set status = 'running' where id = v_job_id;

  v_result := public.execute_schema_job_attempt(v_job_id, p_project_id, p_schema_name, p_business_type, 1);

  if coalesce((v_result->>'ok')::boolean, false) then
    insert into public.audit_logs (project_id, action, resource_type, resource_id, metadata)
    values (p_project_id, 'project.rebuilt', 'project', p_project_id::text,
      jsonb_build_object('schema_name', p_schema_name, 'job_id', v_job_id,
        'idempotency_key', p_idempotency_key, 'readback', v_result->'readback'));
  end if;

  return v_result || jsonb_build_object('status', 'created', 'project_id', p_project_id, 'job_id', v_job_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) provision_project legado delega para v2 (mesmas garantias p/ callers antigos)
-- -----------------------------------------------------------------------------

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
set search_path = public
as $$
declare
  v_result jsonb;
  v_fingerprint text;
begin
  v_fingerprint := 'legacy:' || coalesce(p_name, '') || '|' || coalesce(p_slug, '') || '|' ||
    coalesce(p_business_type, '') || '|' || coalesce(p_template_key, '');

  v_result := public.provision_project_v2(
    p_name, p_slug, p_business_type, p_template_key,
    p_domain, p_language, p_organization_id,
    'legacy:' || coalesce(p_slug, 'noslug'), v_fingerprint
  );

  if coalesce((v_result->>'ok')::boolean, false) then
    return (v_result->>'project_id')::uuid;
  end if;

  raise exception '%', coalesce(v_result->>'error', 'GDB_PROVISION_FAILED: falha desconhecida')
    using errcode = 'GD012';
end;
$$;
