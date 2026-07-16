create or replace function public.execute_project_schema_sql(
  p_schema_name text,
  p_sql text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
begin
  if p_schema_name is null or p_schema_name !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'invalid schema name';
  end if;

  if p_sql is null or length(btrim(p_sql)) = 0 then
    raise exception 'empty sql';
  end if;

  execute format('set local search_path to %I, public', p_schema_name);

  v_sql := p_sql;
  execute v_sql;

  return jsonb_build_object(
    'schema_name', p_schema_name,
    'status', 'success'
  );
end;
$$;
