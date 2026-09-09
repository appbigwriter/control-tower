import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'http://supabase-control-tower.fbr.news'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Will run without it just to see connection error, but let's use a dummy key
const client = createClient(supabaseUrl, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ey.dummy', {
  auth: { persistSession: false }
})

async function run() {
  try {
    const { data, error } = await client.from('organizations').select('id').limit(1)
    console.log('Data:', data)
    console.log('Error:', error)
  } catch (err) {
    console.log('Catch:', err)
  }
}
run()
