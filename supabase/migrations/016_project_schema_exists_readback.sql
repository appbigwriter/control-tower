-- Migration 016: isolated project schema readback RPC.
-- This intentionally contains only the missing function from the colliding
-- 012_remediation_saga_states.sql migration, avoiding a redefinition of
-- provision_project in remote environments with newer provisioning contracts.

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
    select 1
    from information_schema.schemata
    where schema_name = p_schema_name
  );
end;
$$;

grant execute on function public.project_schema_exists(text) to service_role;
