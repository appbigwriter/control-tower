import { createClient } from '@supabase/supabase-js'

export function createServiceRoleClient() {
  let supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.API_EXTERNAL_URL ||
    'https://supabase-control-tower-api.fbr.news'

  // Correção de resiliência caso o hostname tenha sido injetado com o prefixo abreviado "sup-"
  if (supabaseUrl.includes('sup-control-tower.fbr.news')) {
    supabaseUrl = supabaseUrl.replace('sup-control-tower.fbr.news', 'supabase-control-tower-api.fbr.news')
  }

  // Garantir HTTPS se for api pública
  if (supabaseUrl.includes('supabase-control-tower-api.fbr.news') && supabaseUrl.startsWith('http://')) {
    supabaseUrl = supabaseUrl.replace('http://', 'https://')
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
