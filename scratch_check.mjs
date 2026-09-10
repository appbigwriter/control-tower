import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync('f:/Projetos/_FBR/GestaoDB/.env.local', 'utf-8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.split('=')[0].trim(), l.split('=').slice(1).join('=').trim()])
)

const client = createClient(env['SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'], {
  auth: { persistSession: false }
})

async function run() {
  const sql = `
    DO $body$
    DECLARE
      v_tables text;
    BEGIN
      SELECT string_agg(table_name, ', ' ORDER BY table_name) INTO v_tables
      FROM information_schema.tables
      WHERE table_schema = 'blog_facebrasilblog';
      
      RAISE EXCEPTION 'TABELAS_FACEBRASIL: %', v_tables;
    END;
    $body$;
  `

  const { error } = await client.rpc('execute_project_schema_sql', {
    p_schema_name: 'public',
    p_sql: sql
  })

  console.log('Resultado da verificação:')
  console.log(error?.message || 'Sem erro')
}



run()
