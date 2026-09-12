import { createClient } from '@supabase/supabase-js'

export function createServiceRoleClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://supabase-control-tower.fbr.news'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
