const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://supabase-control-tower-api.fbr.news';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODkwMDI4NzAsImV4cCI6MjEwNDM2Mjg3MH0.O8OuvwNYZalxBJtkgD2OjXW0Xosa67F-WaxIl084fNg';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('Fetching projects with full schema...');
  const { data, error } = await supabase.from('projects').select('id, name, slug, business_type, template_key, schema_name, domain, status, template_version, created_at').order('created_at', { ascending: true });
  if (error) {
    console.error('Supabase Error:', error);
  } else {
    console.log('Success. Found', data.length, 'projects.');
  }
}

test();
