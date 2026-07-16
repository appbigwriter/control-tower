create or replace function public.bootstrap_default_organizations()
returns void
language plpgsql
as $$
begin
  insert into public.organizations (name, slug)
  values ('GestaoDB', 'gestaodb')
  on conflict (slug) do nothing;
end;
$$;
