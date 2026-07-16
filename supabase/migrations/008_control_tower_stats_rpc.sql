create or replace function public.get_control_tower_stats()
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database()),
    'projects_total', (select count(*) from public.projects),
    'projects_active', (select count(*) from public.projects where status = 'active'),
    'projects_pending', (select count(*) from public.projects where status = 'pending'),
    'projects_archived', (select count(*) from public.projects where status = 'archived'),
    'projects_error', (select count(*) from public.projects where status = 'error'),
    'blog_projects', (select count(*) from public.projects where business_type = 'blog'),
    'store_projects', (select count(*) from public.projects where business_type = 'store'),
    'saas_projects', (select count(*) from public.projects where business_type = 'saas'),
    'custom_projects', (select count(*) from public.projects where business_type = 'custom'),
    'jobs_total', (select count(*) from public.provisioning_jobs),
    'jobs_running', (select count(*) from public.provisioning_jobs where status = 'running'),
    'jobs_success', (select count(*) from public.provisioning_jobs where status = 'success'),
    'jobs_error', (select count(*) from public.provisioning_jobs where status = 'error'),
    'audit_total', (select count(*) from public.audit_logs)
  )
  into v_result;

  return v_result;
end;
$$;
