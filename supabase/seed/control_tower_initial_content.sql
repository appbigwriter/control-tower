insert into public.organizations (name, slug)
values ('GestaoDB', 'gestaodb')
on conflict (slug) do nothing;

insert into public.projects (
  organization_id, name, slug, business_type, template_key, schema_name, domain, language, status, template_version
)
select
  o.id,
  'Control Tower Blog',
  'control-tower-blog',
  'blog',
  'blog_standard',
  'blog_control_tower_blog',
  null,
  'pt',
  'active',
  '1.0.0'
from public.organizations o
where o.slug = 'gestaodb'
on conflict (slug) do nothing;
